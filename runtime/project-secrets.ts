// Secrets per project: environment variables (API keys, database URLs) that agents, setup/run
// scripts and terminals in that project's sessions get, without committing a .env file.
// Values live in a 0600 file in ADE's state directory (with optional OS SecretStore protection)
// and are never sent back to the UI; they are masked in command output that ADE shows or stores.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { createSecretStore, isSecretStoreAvailable, type SecretStore } from "./copilot-auth.ts";
import { badRequest, notFound } from "./http-error.ts";

const SecretEntrySchema = z.object({
	value: z.string(),
	updatedAt: z.number(),
});

const StoredSecretsSchema = z.record(z.string(), z.record(z.string(), SecretEntrySchema));
type Stored = z.infer<typeof StoredSecretsSchema>;

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const RESERVED = new Set([
	"PATH",
	"HOME",
	"SHELL",
	"USER",
	"PWD",
	"TERM",
	"PORT",
	"NODE_OPTIONS",
	"LD_PRELOAD",
	"LD_LIBRARY_PATH",
	"DYLD_INSERT_LIBRARIES",
	"DYLD_LIBRARY_PATH",
	"BASH_ENV",
	"ENV",
	"ZDOTDIR",
	"PYTHONSTARTUP",
	"PYTHONPATH",
	"RUBYOPT",
	"PERL5OPT",
	"GIT_SSH_COMMAND",
	"GIT_EXEC_PATH",
	"ELECTRON_RUN_AS_NODE",
	"SSL_CERT_FILE",
]);
const MASK = "••••••";

export type ProjectSecretsOptions = {
	secretStore?: SecretStore | null;
};

export class ProjectSecrets {
	#file: string;
	#data: Stored;
	#secretStore: SecretStore | null;

	constructor(stateDirectory: string, options: ProjectSecretsOptions = {}) {
		this.#file = join(stateDirectory, "project-secrets.json");
		this.#secretStore = options.secretStore ?? null;
		this.#data = this.#load();
	}

	/** Optional async hydration from the OS protected SecretStore (Keychain/DPAPI/libsecret). */
	async hydrateFromProtectedStore(): Promise<void> {
		const store = this.#secretStore ?? (isSecretStoreAvailable() ? createSecretStore() : null);
		if (!store || store.backend === "unsupported") return;
		this.#secretStore = store;
		if (!existsSync(this.#file)) return;
		try {
			const raw = await store.read(this.#file);
			const parsed = StoredSecretsSchema.safeParse(JSON.parse(raw));
			if (parsed.success) this.#data = parsed.data;
		} catch {
			// File may still be plaintext 0600 JSON (migrated on next flushProtectedStore) or empty.
		}
	}

	/** Persist current secrets using the OS protected SecretStore when available. */
	async flushProtectedStore(): Promise<boolean> {
		const store = this.#secretStore ?? (isSecretStoreAvailable() ? createSecretStore() : null);
		if (!store || store.backend === "unsupported") return false;
		this.#secretStore = store;
		mkdirSync(dirname(this.#file), { recursive: true });
		await store.write(this.#file, JSON.stringify(this.#data));
		return true;
	}

	#load(): Stored {
		try {
			if (!existsSync(this.#file)) return {};
			const parsed = StoredSecretsSchema.safeParse(JSON.parse(readFileSync(this.#file, "utf8")));
			if (parsed.success) return parsed.data;
		} catch {
			// Unreadable file or protected-store pointer: start empty until hydrated or replaced.
		}
		return {};
	}

	#save() {
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.${randomUUID()}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#data), { mode: 0o600 });
		renameSync(temp, this.#file);
		chmodSync(this.#file, 0o600);
		if (this.#secretStore && this.#secretStore.backend !== "unsupported") {
			void this.#secretStore.write(this.#file, JSON.stringify(this.#data)).catch(() => undefined);
		}
	}

	/** Names only — values never leave the runtime through the API. */
	list(projectId: string) {
		return Object.entries(this.#data[projectId] ?? {})
			.map(([name, entry]) => ({ name, updatedAt: entry.updatedAt }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	set(projectId: string, name: unknown, value: unknown) {
		if (typeof name !== "string" || !NAME.test(name)) throw badRequest("Use a name like STRIPE_KEY: letters, digits and underscores, not starting with a digit.");
		if (RESERVED.has(name.toUpperCase())) throw badRequest(`${name} is managed by the system and can't be set as a secret.`);
		if (typeof value !== "string" || !value || value.length > 32_768) throw badRequest("Enter a value (up to 32 KB).");
		(this.#data[projectId] ??= {})[name] = { value, updatedAt: Date.now() };
		this.#save();
		return this.list(projectId);
	}

	remove(projectId: string, name: string) {
		if (!this.#data[projectId]?.[name]) throw notFound("That secret doesn't exist.");
		delete this.#data[projectId][name];
		this.#save();
		return this.list(projectId);
	}

	env(projectId: string | null | undefined): Record<string, string> {
		if (!projectId) return {};
		return Object.fromEntries(Object.entries(this.#data[projectId] ?? {}).map(([name, entry]) => [name, entry.value]));
	}

	removeProject(projectId: string) {
		if (!this.#data[projectId]) return;
		delete this.#data[projectId];
		this.#save();
	}
}

/** Replace secret values in text with a mask. Very short values are left alone to avoid mangling output. */
export function redact(text: string, secrets: Record<string, string>) {
	let out = text;
	for (const value of Object.values(secrets).sort((a, b) => b.length - a.length)) {
		if (value.length >= 6 && out.includes(value)) out = out.split(value).join(MASK);
	}
	return out;
}

// Spawn points (agent shell tools, terminals, scripts, Claude Code/Codex) ask for the secrets of
// the project a working directory belongs to. The runtime installs the lookup at startup.
let resolver: (cwd: string) => Record<string, string> = () => ({});

export function setSecretResolver(next: (cwd: string) => Record<string, string>) {
	resolver = next;
}

export function secretEnv(cwd: string | null | undefined): Record<string, string> {
	if (!cwd) return {};
	try {
		return resolver(cwd);
	} catch {
		return {};
	}
}

export function redactForCwd(text: string, cwd: string | null | undefined) {
	const secrets = secretEnv(cwd);
	return Object.keys(secrets).length ? redact(text, secrets) : text;
}
