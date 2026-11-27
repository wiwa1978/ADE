// What a Claude Code or Codex session gets from ADE's on/off settings.
// Claude Code is started with --mcp-config and --strict-mcp-config (only the servers that are on).
// Active skills are copied into that CLI's skills folder in the workspace. A skill already there is left alone.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerStatus } from "./mcp.ts";

export type CliEngine = "claude-code" | "codex" | "opencode";

export type CliSkill = { name: string; dir: string };

export function cliSkillsDir(workspace: string, engine: CliEngine): string {
	const folder = engine === "claude-code" ? ".claude" : engine === "opencode" ? ".opencode" : ".codex";
	return join(workspace, folder, "skills");
}

/** Copy active skills into the CLI's project skills folder. Returns how many folders were copied. */
export function copySkillsForCli(workspace: string, engine: CliEngine, skills: CliSkill[]): number {
	const destRoot = cliSkillsDir(workspace, engine);
	mkdirSync(destRoot, { recursive: true });
	let copied = 0;
	for (const skill of skills) {
		const name = skill.name.trim();
		if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") continue;
		const dest = join(destRoot, name);
		const from = resolve(skill.dir);
		if (!existsSync(join(from, "SKILL.md"))) continue;
		if (from === resolve(dest) || from.startsWith(`${resolve(destRoot)}/`)) continue;
		if (existsSync(dest)) continue;
		cpSync(from, dest, { recursive: true, dereference: true });
		copied += 1;
	}
	return copied;
}

/** MCP config Claude Code reads. Servers with no discovered tools stay (tools are unknown until connected). A server whose every known tool is off is left out. */
export function claudeMcpConfig(servers: McpServerStatus[]): { mcpServers: Record<string, Record<string, unknown>> } {
	const mcpServers: Record<string, Record<string, unknown>> = {};
	for (const server of servers) {
		if (!server.active) continue;
		if (server.tools.length > 0 && server.tools.every(tool => tool.enabled === false)) continue;
		const entry: Record<string, unknown> = {};
		if (server.transport === "http") {
			if (!server.url) continue;
			entry.type = "http";
			entry.url = server.url;
			if (server.headers && Object.keys(server.headers).length) entry.headers = server.headers;
		} else {
			if (!server.command) continue;
			entry.command = server.command;
			entry.args = server.args ?? [];
			if (server.env && Object.keys(server.env).length) entry.env = server.env;
		}
		mcpServers[server.name] = entry;
	}
	return { mcpServers };
}

export function writeClaudeMcpConfig(sessionKey: string, servers: McpServerStatus[]): string {
	const safe = sessionKey.replace(/[^a-zA-Z0-9-]/g, "").slice(-80) || "session";
	const dir = join(tmpdir(), "ade-cli-mcp");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${safe}.json`);
	writeFileSync(path, JSON.stringify(claudeMcpConfig(servers)));
	return path;
}
