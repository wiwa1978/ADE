import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { LocalAgentHost } from "./host.ts";
import { WorktreeManager } from "./worktrees.ts";
import {
	getWorkspaceFileDiff,
	getWorkspaceGitSummary,
	gitCommitChanges,
	gitStageFiles,
	listWorkspaceDirectory,
	readWorkspaceFile,
	writeWorkspaceFile,
} from "./workspace-files.ts";
import { discoverSkillsAndRules } from "./skills.ts";
import { validateExternalUrl } from "./browser.ts";

function createFixture(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]) {
	const faux = fauxProvider();
	faux.setResponses(responses);
	const models = createModels();
	models.setProvider(faux.provider);
	return {
		provider: faux.provider.id,
		defaultModel: faux.getModel().id,
		availableModels: [{ id: faux.getModel().id, name: "Fixture model" }],
		configured: true,
		setupMessage: "",
		models,
		faux,
		resolveModel: (id: string) => models.getModel(faux.provider.id, id),
	};
}

function initGitRepo(dir: string) {
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "ade@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "ADE Test"], { cwd: dir });
	writeFileSync(join(dir, "README.md"), "# Demo Repo\nhello world\n", "utf8");
	writeFileSync(join(dir, "app.ts"), "export const answer = 42;\n", "utf8");
	execFileSync("git", ["add", "-A"], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
}

test("approval gates pause risky shell commands and resume on approval + always-allow rule", { timeout: 30_000 }, async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "ade-approvals-"));
	const repoDir = mkdtempSync(join(tmpdir(), "ade-repo-"));
	let host: LocalAgentHost | undefined;
	let manager: WorktreeManager | undefined;
	try {
		initGitRepo(repoDir);
		const fixture = createFixture([
			fauxAssistantMessage(fauxToolCall("run_command", { command: "echo approved-hello > created.txt" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Command succeeded!"),
		]);
		host = new LocalAgentHost({ stateDirectory: stateDir, modelConfigFactory: () => fixture });
		manager = new WorktreeManager(stateDir);
		const taskId = randomUUID();
		await host.createCodingTask({ id: taskId, title: "Shell approval", repository: repoDir, kind: "checkout" }, manager);

		const approvalPromise = new Promise<{ id: string; toolName: string }>((resolve) => {
			host!.events.subscribe((event) => {
				if (event.type === "approval.requested") resolve(event.payload as { id: string; toolName: string });
			});
		});

		const sendPromise = host.send("coding", { content: "Create file", model: "faux-1", reasoning: "none" }, taskId);
		const req = await approvalPromise;
		assert.equal(req.toolName, "run_command");
		assert.equal(host.approvals.listPending(taskId).length, 1);

		await host.approvals.resolve(req.id, { allow: true, alwaysAllow: true, prefix: "echo approved-hello" });
		await sendPromise;

		assert.equal(host.approvals.listPending(taskId).length, 0);
		assert.ok(host.approvals.hasAllowRule("run_command", "echo approved-hello"));
		assert.equal(host.approvals.hasAllowRule("run_command", "echo approved-hello > created.txt"), false);
		const created = readWorkspaceFile(repoDir, "created.txt");
		assert.match(created.content, /approved-hello/);
	} finally {
		await host?.close();
		manager?.close();
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	}
});

test("multi-subagent spawn_subagent supports parallel background subagents and artifacts/tasks", { timeout: 30_000 }, async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "ade-subagents-"));
	const repoDir = mkdtempSync(join(tmpdir(), "ade-subrepo-"));
	let host: LocalAgentHost | undefined;
	let manager: WorktreeManager | undefined;
	try {
		initGitRepo(repoDir);
		const fixture = createFixture([
			// Lead spawns 2 subagents and writes an artifact + tasks
			fauxAssistantMessage(
				fauxToolCall("spawn_subagent", { name: "Searcher", role: "Code Researcher", task: "Find answer constant", mode: "readonly", background: false }),
				{ stopReason: "toolUse" },
			),
			// Subagent 1 response
			fauxAssistantMessage("Found `answer = 42` in app.ts"),
			// Lead writes artifact + updates tasks
			fauxAssistantMessage(
				fauxToolCall("write_artifact", { title: "Implementation Plan", kind: "plan", content: "# Plan\n- Step 1", requestApproval: true }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("update_tasks", { items: [{ id: "1", title: "Inspect repo", status: "done" }, { id: "2", title: "Implement", status: "in_progress" }] }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Plan is ready for your approval."),
		]);
		host = new LocalAgentHost({ stateDirectory: stateDir, modelConfigFactory: () => fixture });
		manager = new WorktreeManager(stateDir);
		host.setWorktreeManager(manager);
		const taskId = randomUUID();
		await host.createCodingTask({ id: taskId, title: "Multi-subagent", repository: repoDir, kind: "checkout" }, manager);

		await host.send("coding", { content: "Analyze and plan", model: "faux-1", reasoning: "none" }, taskId);

		const agents = await host.featureAgents(taskId);
		assert.equal(agents.length, 1);
		assert.equal(agents[0].name, "Searcher");
		assert.equal(agents[0].role, "Code Researcher");
		assert.equal(agents[0].mode, "readonly");
		assert.equal(agents[0].status, "completed");

		const artifacts = host.artifacts.listArtifacts(taskId);
		assert.equal(artifacts.length, 1);
		assert.equal(artifacts[0].title, "Implementation Plan");
		assert.equal(artifacts[0].status, "awaiting_approval");

		const reviewed = host.artifacts.reviewArtifact(artifacts[0].id, "approved");
		assert.equal(reviewed.status, "approved");

		const tasks = host.artifacts.getTasks(taskId);
		assert.equal(tasks.length, 2);
		assert.equal(tasks[0].status, "done");

		const timeline = await host.getTimeline(taskId);
		assert.ok(timeline.items.length >= 2);
	} finally {
		await host?.close();
		manager?.close();
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	}
});

test("workspace files, git diff/stage/commit, skills discovery, and browser URL validation", async () => {
	const repoDir = mkdtempSync(join(tmpdir(), "ade-files-"));
	try {
		initGitRepo(repoDir);
		const tree = listWorkspaceDirectory(repoDir, ".");
		assert.ok(tree.some(e => e.name === "app.ts"));

		writeWorkspaceFile(repoDir, "app.ts", "export const answer = 43;\nexport const extra = true;\n");
		const summary = await getWorkspaceGitSummary(repoDir);
		assert.equal(summary.isGitRepo, true);
		assert.equal(summary.files.length, 1);
		assert.equal(summary.files[0].path, "app.ts");
		assert.ok(summary.additions >= 2);

		const diff = await getWorkspaceFileDiff(repoDir, "app.ts", false);
		assert.match(diff, /\+export const answer = 43;/);

		await gitStageFiles(repoDir, ["app.ts"]);
		const commit = await gitCommitChanges(repoDir, "update answer");
		assert.ok(commit.hash.length >= 4);

		const afterCommit = await getWorkspaceGitSummary(repoDir);
		assert.equal(afterCommit.files.length, 0);

		// Skills & rules discovery
		mkdirSync(join(repoDir, ".ade", "skills", "demo-skill"), { recursive: true });
		writeFileSync(join(repoDir, ".ade", "skills", "demo-skill", "SKILL.md"), "---\nname: demo-skill\ndescription: A demo skill\n---\nInstructions here.\n", "utf8");
		writeFileSync(join(repoDir, "AGENTS.md"), "Always write clean TypeScript.\n", "utf8");
		const catalog = discoverSkillsAndRules(repoDir);
		assert.ok(catalog.skills.some(s => s.name === "demo-skill"));
		assert.ok(catalog.rules.some(r => r.name === "AGENTS.md"));
		assert.ok(catalog.commands.some(c => c.name === "plan"));

		// Browser URL validation
		assert.equal(validateExternalUrl("localhost:3000"), "https://localhost:3000/");
		assert.equal(validateExternalUrl("http://localhost:1420/test"), "http://localhost:1420/test");
		assert.throws(() => validateExternalUrl("javascript:alert(1)"));
	} finally {
		rmSync(repoDir, { recursive: true, force: true });
	}
});
