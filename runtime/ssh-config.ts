// Cross-platform OpenSSH config scanner (Windows %USERPROFILE%\.ssh\config, macOS/Linux ~/.ssh/config,
// or any user-specified config file path). Supports Host, HostName, User, Port, and Include directives.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { badRequest } from "./http-error.ts";

export type SshConfigHost = {
	alias: string;
	hostName?: string;
	user?: string;
	port?: number;
};

export type SshConfigScanResult = {
	configPath: string;
	defaultPath: string;
	exists: boolean;
	hosts: SshConfigHost[];
};

export function defaultSshConfigPath(home = homedir()): string {
	return join(home, ".ssh", "config");
}

export function resolveSshConfigPath(raw: string | null | undefined, home = homedir()): string {
	if (!raw || !raw.trim()) return defaultSshConfigPath(home);
	const trimmed = raw.trim();
	if (trimmed.length > 500 || /[\0\r\n]/.test(trimmed)) {
		throw badRequest("Enter a valid SSH config file path.");
	}
	if (trimmed === "~") return home;
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return join(home, trimmed.slice(2));
	}
	return resolve(trimmed);
}

function expandIncludePaths(pattern: string, baseDir: string, home: string): string[] {
	const raw = pattern.trim().replace(/^["']|["']$/g, "");
	if (!raw) return [];
	const expanded = raw.startsWith("~/") || raw.startsWith("~\\")
		? join(home, raw.slice(2))
		: isAbsolute(raw) ? raw : join(baseDir, raw);

	if (!expanded.includes("*")) {
		return existsSync(expanded) ? [expanded] : [];
	}
	// Handle simple single-level wildcards such as `config.d/*` or `config.d/*.conf`.
	const dir = dirname(expanded);
	const leaf = expanded.slice(dir.length + 1);
	if (!existsSync(dir)) return [];
	const regex = new RegExp(`^${leaf.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
	try {
		return readdirSync(dir)
			.filter(name => regex.test(name))
			.map(name => join(dir, name))
			.filter(full => {
				try { return statSync(full).isFile(); } catch { return false; }
			})
			.sort();
	} catch {
		return [];
	}
}

function isConcreteAlias(token: string): boolean {
	if (!token || token.startsWith("!") || token.startsWith("-")) return false;
	if (/[*?[\]]/.test(token)) return false;
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(token);
}

function parseSshConfigContent(
	content: string,
	fileDir: string,
	home: string,
	visited: Set<string>,
	depth: number,
	byAlias: Map<string, SshConfigHost>,
) {
	if (depth > 3) return;
	let currentAliases: string[] = [];

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, "").trim();
		if (!line) continue;
		const match = /^([A-Za-z]+)(?:\s*=\s*|\s+)(.+)$/.exec(line);
		if (!match) continue;
		const key = match[1].toLowerCase();
		const value = match[2].trim();

		if (key === "include") {
			for (const token of value.split(/\s+/)) {
				for (const incPath of expandIncludePaths(token, fileDir, home)) {
					if (visited.has(incPath)) continue;
					visited.add(incPath);
					try {
						const incText = readFileSync(incPath, "utf8");
						parseSshConfigContent(incText, dirname(incPath), home, visited, depth + 1, byAlias);
					} catch {
						// Ignore unreadable include files.
					}
				}
			}
			continue;
		}

		if (key === "match") {
			currentAliases = [];
			continue;
		}

		if (key === "host") {
			currentAliases = value.split(/\s+/).filter(isConcreteAlias);
			for (const alias of currentAliases) {
				if (!byAlias.has(alias)) byAlias.set(alias, { alias });
			}
			continue;
		}

		if (!currentAliases.length) continue;

		for (const alias of currentAliases) {
			const entry = byAlias.get(alias);
			if (!entry) continue;
			if (key === "hostname" && !entry.hostName) entry.hostName = value.replace(/^["']|["']$/g, "");
			else if (key === "user" && !entry.user) entry.user = value.replace(/^["']|["']$/g, "");
			else if (key === "port" && entry.port === undefined) {
				const port = Number(value);
				if (Number.isInteger(port) && port >= 1 && port <= 65535) entry.port = port;
			}
		}
	}
}

export function scanSshConfig(customPath?: string | null, home = homedir()): SshConfigScanResult {
	const defaultPath = defaultSshConfigPath(home);
	const configPath = resolveSshConfigPath(customPath, home);
	if (!existsSync(configPath)) {
		return { configPath, defaultPath, exists: false, hosts: [] };
	}
	let text: string;
	try {
		const stat = statSync(configPath);
		if (!stat.isFile()) return { configPath, defaultPath, exists: false, hosts: [] };
		text = readFileSync(configPath, "utf8");
	} catch {
		return { configPath, defaultPath, exists: false, hosts: [] };
	}
	const visited = new Set<string>([configPath]);
	const byAlias = new Map<string, SshConfigHost>();
	parseSshConfigContent(text, dirname(configPath), home, visited, 0, byAlias);
	return {
		configPath,
		defaultPath,
		exists: true,
		hosts: [...byAlias.values()],
	};
}
