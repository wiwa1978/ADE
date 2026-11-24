import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { CapabilitySettings } from "./capabilities.ts";
import { configureSkillCatalog } from "./skill-catalog.ts";
import { discoverSkillsAndRules } from "./skills.ts";
import { McpManager } from "./mcp.ts";
import { effectiveSkills, scanSkillLandscape } from "./skill-catalog.ts";
import { SkillLibrary } from "./skill-library.ts";

const skill = (root: string, folder: string, name: string, description: string) => {
	mkdirSync(join(root, folder), { recursive: true });
	writeFileSync(join(root, folder, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nDo the thing.\n`);
};

function temp<T>(run: (dir: string) => T | Promise<T>) {
	const dir = mkdtempSync(join(tmpdir(), "ade-caps-"));
	return Promise.resolve(run(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("on unless turned off: a project's setting beats the global one, which beats the default", () => {
	const caps = new CapabilitySettings(new DatabaseSync(":memory:"));
	assert.equal(caps.isActive("skill", "Review", "p1"), true, "default is on");
	caps.set("global", null, "skill", "review", false);
	assert.equal(caps.isActive("skill", "REVIEW", "p1"), false, "skill names don't care about case");
	caps.set("project", "p1", "skill", "review", true);
	assert.equal(caps.isActive("skill", "review", "p1"), true, "the project turns it back on");
	assert.equal(caps.isActive("skill", "review", "p2"), false, "other projects follow the global setting");
	assert.deepEqual(caps.state("skill", "review", "p1"), { active: true, global: false, project: true });
	caps.set("project", "p1", "skill", "review", null);
	assert.equal(caps.isActive("skill", "review", "p1"), false, "clearing the project setting means inherit");
	assert.throws(() => caps.set("project", null, "skill", "x", true), /project id/);
	// Tool servers keep their key's case, and a repository's .mcp.json is untrusted until allowed.
	assert.equal(caps.state("mcp-trust", ".mcp.json", "p1", false).active, false);
	caps.set("project", "p1", "mcp-trust", ".mcp.json", true);
	assert.equal(caps.state("mcp-trust", ".mcp.json", "p1", false).active, true);
	caps.clearProject("p1");
	assert.equal(caps.state("mcp-trust", ".mcp.json", "p1", false).active, false);
});

test("skills are found in the project, ADE's folder and other tools' folders; one wins per name, in a set order", () => temp(home => {
	const workspace = join(home, "repo");
	skill(join(workspace, ".claude", "skills"), "deploy", "deploy", "From the project");
	skill(join(home, ".ade", "skills"), "deploy", "deploy", "From ADE");
	skill(join(home, ".claude", "skills"), "deploy", "deploy", "From Claude Code");
	skill(join(home, ".codex", "skills"), "lint-fix", "lint-fix", "From Codex");
	const landscape = scanSkillLandscape({ workspace, home, sources: [] });
	assert.equal(landscape.filter(item => item.name === "deploy").length, 3);
	const winner = effectiveSkills(landscape).find(item => item.name === "deploy")!;
	assert.equal(winner.origin.kind, "project", "project beats ADE beats other tools");
	assert.equal(landscape.filter(item => item.shadowedBy).length, 2);
	assert.deepEqual(effectiveSkills(landscape).map(item => item.name).sort(), ["deploy", "lint-fix"]);
	assert.equal(landscape.find(item => item.name === "lint-fix")!.origin.tool, "Codex");
}));

test("skills from a Git repository are previewed first, then installed, listed with their source, and removable", () => temp(async home => {
	const repo = join(home, "skills-repo");
	skill(repo, "refactor", "refactor", "Refactor safely");
	skill(join(repo, "nested"), "testing", "testing", "Write tests");
	for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "skills"]]) execFileSync("git", args, { cwd: repo });
	const library = new SkillLibrary({ db: new DatabaseSync(":memory:"), home });
	await assert.rejects(library.preview({ url: "--upload-pack=evil" }), /valid Git repository URL/);
	await assert.rejects(library.preview({ url: "not a url" }), /Git/);
	const preview = await library.preview({ url: repo });
	assert.deepEqual(preview.skills.map(item => item.name).sort(), ["refactor", "testing"]);
	assert.equal(library.list().length, 0, "nothing is installed until the preview is confirmed");
	const source = library.confirm(preview.previewId);
	assert.equal(library.list().length, 1);
	assert.equal(source.status, "ready");
	const landscape = scanSkillLandscape({ home, sources: library.list() });
	const refactor = landscape.find(item => item.name === "refactor")!;
	assert.equal(refactor.origin.kind, "git");
	assert.equal(refactor.origin.sourceId, source.id);
	assert.throws(() => library.confirm(preview.previewId), /expired/, "a preview can be installed once");
	library.remove(source.id);
	assert.equal(library.list().length, 0);
	assert.equal(scanSkillLandscape({ home, sources: library.list() }).some(item => item.name === "refactor"), false);
}));

test("skills written in ADE live in ~/.ade/skills and only those can be changed there", () => temp(home => {
	const library = new SkillLibrary({ db: new DatabaseSync(":memory:"), home });
	assert.throws(() => library.createUserSkill({ name: "../escape", description: "x" }), /skill name/);
	assert.throws(() => library.createUserSkill({ name: "Release notes", description: "" }), /Describe when/);
	const created = library.createUserSkill({ name: "Release notes", description: "Write release notes from commits", body: "List the commits." });
	assert.match(library.readUserSkill(created.path).content, /name: Release notes/);
	library.writeUserSkill(created.path, "---\nname: Release notes\ndescription: Updated\n---\nNew body\n");
	assert.match(library.readUserSkill(created.path).content, /New body/);
	assert.throws(() => library.createUserSkill({ name: "Release notes", description: "again" }), /already exists/);
	const outside = join(home, "elsewhere");
	skill(outside, "other", "other", "Not ours");
	assert.throws(() => library.readUserSkill(join(outside, "other", "SKILL.md")), /Only skills in ~\/.ade\/skills/);
	assert.throws(() => library.deleteUserSkill(join(home, ".ade", "skills", "..", "..", "elsewhere", "other")), /Only skills/);
	library.deleteUserSkill(created.path);
	assert.throws(() => library.readUserSkill(created.path), /not found/i);
}));

test("tool servers: a repository's .mcp.json needs trust once, other tools' servers are read-only until copied into ADE", () => temp(home => {
	const db = new DatabaseSync(":memory:");
	const caps = new CapabilitySettings(db);
	const mcp = new McpManager(db, { emit() {} } as never, { home, capabilities: caps });
	const workspace = join(home, "repo");
	mkdirSync(workspace, { recursive: true });
	writeFileSync(join(workspace, ".mcp.json"), JSON.stringify({ mcpServers: { local: { command: "node", args: ["server.js"] } } }));
	mkdirSync(join(home, ".cursor"), { recursive: true });
	writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { docs: { url: "https://docs.example.com/mcp" } } }));
	const scope = { workspace, projectId: "p1" };

	const before = mcp.list(scope);
	const project = before.find(item => item.name === "local")!;
	assert.equal(project.origin.kind, "project");
	assert.equal(project.needsTrust, true);
	assert.equal(project.active, false, "untrusted repository servers don't run");
	assert.equal(project.readOnly, true);
	const docs = before.find(item => item.name === "docs")!;
	assert.equal(docs.origin.kind, "file");
	assert.equal(docs.active, true, "everything is on unless turned off");

	caps.set("project", "p1", "mcp-trust", ".mcp.json", true);
	assert.equal(mcp.list(scope).find(item => item.name === "local")!.active, true, "trusted once, it runs");
	caps.set("global", null, "mcp", docs.key, false);
	assert.equal(mcp.list(scope).find(item => item.name === "docs")!.active, false, "turned off globally");
	assert.deepEqual(mcp.active(scope).map(item => item.name), ["local"]);

	const copy = mcp.adopt(docs.id, scope);
	assert.equal(copy.readOnly, false);
	assert.equal(copy.origin.kind, "ade");
	assert.equal(mcp.list(scope).find(item => item.name === "docs" && item.origin.kind === "file")?.shadowedBy, copy.id, "ADE's copy wins by name");
}));

test("a session only gets the skills that are on for its project", () => temp(home => {
	configureSkillCatalog({ sources: () => [], home });
	skill(join(home, ".ade", "skills"), "deploy", "deploy", "Ship it");
	skill(join(home, ".ade", "skills"), "review", "review", "Review code");
	const caps = new CapabilitySettings(new DatabaseSync(":memory:"));
	caps.set("global", null, "skill", "review", false);
	const names = (projectId: string) => {
		const state = caps.resolver("skill", projectId);
		return discoverSkillsAndRules(null, name => state(name).active).skills.map(item => item.name).sort();
	};
	assert.deepEqual(names("p1"), ["deploy"], "review is off for everyone");
	caps.set("project", "p2", "skill", "review", true);
	assert.deepEqual(names("p2"), ["deploy", "review"], "a project can turn it back on");
	assert.deepEqual(names("p1"), ["deploy"]);
}));
