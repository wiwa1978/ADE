import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claudeMcpConfig, copySkillsForCli, writeClaudeMcpConfig } from "./cli-capabilities.ts";
import { engineArgs } from "./engines.ts";
import type { McpServerStatus } from "./mcp.ts";

function server(partial: Partial<McpServerStatus> & Pick<McpServerStatus, "name">): McpServerStatus {
	return {
		id: partial.name, key: partial.name, transport: "stdio", command: "npx", args: ["srv"], enabled: true,
		status: "disconnected", error: null, tools: [], origin: { kind: "ade", label: "ADE" }, readOnly: false,
		active: true, globalSetting: null, projectSetting: null, needsTrust: false, shadowedBy: null, ...partial,
	};
}

test("Claude Code is limited to the MCP config ADE writes", () => {
	const args = engineArgs("claude-code", "hi", null, "ask", null, [], false, "/tmp/ade-mcp.json");
	const at = args.indexOf("--mcp-config");
	assert.equal(args[at + 1], "/tmp/ade-mcp.json");
	assert.ok(args.includes("--strict-mcp-config"));
	assert.ok(args.indexOf("--") > at);
	assert.ok(!engineArgs("codex", "hi", null, "ask", null, [], false, "/tmp/ade-mcp.json").includes("--mcp-config"));
});

test("a server whose tools are all off is left out of the Claude config", () => {
	const config = claudeMcpConfig([
		server({ name: "kept", tools: [{ name: "read", description: "", enabled: true }] }),
		server({ name: "dropped", tools: [{ name: "write", description: "", enabled: false }] }),
		server({ name: "off", active: false, command: "nope" }),
	]);
	assert.deepEqual(Object.keys(config.mcpServers), ["kept"]);
	const path = writeClaudeMcpConfig("session-1", [server({ name: "kept" })]);
	assert.equal(JSON.parse(readFileSync(path, "utf8")).mcpServers.kept.command, "npx");
});

test("active skills are copied into the CLI skills folder and existing ones stay", () => {
	const root = mkdtempSync(join(tmpdir(), "ade-cli-skills-"));
	const source = join(root, "src-skill");
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, "SKILL.md"), "# Skill\n");
	const workspace = join(root, "repo");
	mkdirSync(join(workspace, ".claude", "skills", "mine"), { recursive: true });
	writeFileSync(join(workspace, ".claude", "skills", "mine", "SKILL.md"), "keep");
	const copied = copySkillsForCli(workspace, "claude-code", [
		{ name: "fresh", dir: source },
		{ name: "mine", dir: source },
	]);
	assert.equal(copied, 1);
	assert.equal(readFileSync(join(workspace, ".claude", "skills", "fresh", "SKILL.md"), "utf8"), "# Skill\n");
	assert.equal(readFileSync(join(workspace, ".claude", "skills", "mine", "SKILL.md"), "utf8"), "keep");
});
