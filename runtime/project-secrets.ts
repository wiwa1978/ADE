// Secrets per project: environment variables (API keys, database URLs) that agents, setup/run
// scripts and terminals in that project's sessions get, without committing a .env file.
// Values live in a 0600 file in ADE's state directory and are never sent back to the UI;
// they are masked in command output that ADE shows or stores.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { badRequest, notFound } from "./http-error.ts";

type Stored = Record<string, Record<string, { value: string; updatedAt: number }>>;

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const RESERVED = new Set(["PATH", "HOME", "SHELL", "USER", "PWD", "TERM", "PORT", "NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"]);
const MASK = "••••••";

export class ProjectSecrets {
	#file: string;
	#data: Stored;

	constructor(stateDirectory: string) {
		this.#file = join(stateDirectory, "project-secrets.json");
		this.#data = this.#load();
	}

	#load(): Stored {
		try {
			if (existsSync(this.#file)) return JSON.parse(readFileSync(this.#file, "utf8")) as Stored;
		} catch {
			// Unreadable file: start empty rather than crash; the next save replaces it.
		}
		return {};
	}

	#save() {
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#data), { mode: 0o600 });
		renameSync(temp, this.#file);
		chmodSync(this.#file, 0o600);
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
