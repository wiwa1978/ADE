// EU-only mode: one switch. When it is on, everything that sends your code or prompts outside the
// EU stays off: models, agent CLIs (Claude Code, Codex) and remote tool servers. It fails closed:
// anything ADE can't place in the EU or on this computer is blocked. The only way around it is an
// exception, and exceptions are granted here (Settings → EU-only), never by an agent.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forbidden } from "./http-error.ts";

export type Region = "eu" | "local" | "non-eu";
export type EuSettings = {
	euOnly: boolean;
	/** Things allowed anyway, as "provider:<id>", "engine:<id>" or "mcp:<key>". */
	exceptions: string[];
	/** The user's word that their OpenAI-compatible endpoint runs in the EU. */
	compatibleInEu: boolean;
};

const DEFAULTS: EuSettings = { euOnly: false, exceptions: [], compatibleInEu: false };

/** Hosts known to be EU-operated. Anything else needs the user's declaration. */
const EU_HOSTS = [/(^|\.)mistral\.ai$/i, /(^|\.)scaleway\.(ai|com)$/i, /(^|\.)ovh(cloud)?\.(net|com)$/i, /(^|\.)hetzner\.(com|cloud)$/i, /(^|\.)ionos\.com$/i, /(^|\.)aleph-alpha\.com$/i];
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function hostRegion(url: string, declaredEu: boolean): Region {
	let host: string;
	try { host = new URL(url).hostname; } catch { return "non-eu"; }
	if (LOOPBACK.has(host)) return "local";
	if (EU_HOSTS.some(pattern => pattern.test(host))) return "eu";
	return declaredEu ? "eu" : "non-eu";
}

/** Where a model provider's servers are. */
export function providerRegion(id: string, compatibleUrl: string, compatibleInEu: boolean): Region {
	if (id === "compatible") return compatibleUrl ? hostRegion(compatibleUrl, compatibleInEu) : "non-eu";
	return "non-eu";
}

export const REGION_LABEL: Record<Region, string> = { eu: "EU", local: "this computer", "non-eu": "outside the EU" };

function clean(value: unknown): EuSettings {
	const input = value && typeof value === "object" ? value as Partial<EuSettings> : {};
	return {
		euOnly: input.euOnly === true,
		exceptions: Array.isArray(input.exceptions) ? [...new Set(input.exceptions.filter((item): item is string => typeof item === "string" && /^(provider|engine|mcp):.{1,200}$/.test(item)))].slice(0, 100) : [],
		compatibleInEu: input.compatibleInEu === true,
	};
}

export class EuPolicy {
	#path: string;
	#settings: EuSettings;
	#compatibleUrl: () => string;

	constructor(stateDirectory: string, compatibleUrl: () => string = () => "") {
		this.#path = join(stateDirectory, "eu-settings.json");
		this.#compatibleUrl = compatibleUrl;
		let saved: unknown = {};
		try { if (existsSync(this.#path)) saved = JSON.parse(readFileSync(this.#path, "utf8")); } catch { /* unreadable: start from the defaults */ }
		this.#settings = clean(saved);
	}

	get(): EuSettings { return { ...this.#settings, exceptions: [...this.#settings.exceptions] }; }
	get on() { return this.#settings.euOnly; }

	set(input: unknown): EuSettings {
		const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
		this.#settings = clean({ ...this.#settings, ...Object.fromEntries(Object.entries(body).filter(([key]) => key in DEFAULTS)) });
		writeFileSync(`${this.#path}.tmp`, JSON.stringify(this.#settings, null, 2), { mode: 0o600 });
		renameSync(`${this.#path}.tmp`, this.#path);
		return this.get();
	}

	regionOfProvider(id: string): Region {
		return providerRegion(id, this.#compatibleUrl(), this.#settings.compatibleInEu);
	}

	/** Null when it may be used; otherwise what to tell the user. */
	blockReason(kind: "provider" | "engine" | "mcp", id: string, region: Region, forceEuOnly = false): string | null {
		if ((!this.#settings.euOnly && !forceEuOnly) || region !== "non-eu") return null;
		if (this.#settings.exceptions.includes(`${kind}:${id}`)) return null;
		const what = kind === "provider" ? `The model provider "${id}"` : kind === "engine" ? `The agent "${id}"` : `The tool server "${id}"`;
		return `EU-only mode is on: ${what} runs ${REGION_LABEL[region]}. Pick an EU or local one, or allow it as an exception in Settings → EU-only.`;
	}

	guardProvider(id: string, forceEuOnly = false): void {
		const reason = this.blockReason("provider", id, this.regionOfProvider(id), forceEuOnly);
		if (reason) throw forbidden(reason);
	}

	/** Claude Code and Codex send your code to US servers. */
	engineBlock(id: string, forceEuOnly = false): string | null {
		return id === "pi" ? null : this.blockReason("engine", id, "non-eu", forceEuOnly);
	}
}
