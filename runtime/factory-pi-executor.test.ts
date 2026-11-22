import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

import { CaptainCore } from "../packages/captain-core/index.ts";
import { createNodeSqliteCaptainHost } from "../packages/host-node/index.ts";
import { LocalDockerSandbox } from "../packages/sandbox-docker/index.ts";
import { RuntimeEventBus } from "./events.ts";
import { ApprovalManager } from "./approvals.ts";
import { ArtifactManager } from "./artifacts.ts";
import { BrowserManager } from "./browser.ts";
import { ProcessManager } from "./shell-tools.ts";
import { LocalFactoryRunner } from "./factory-runner.ts";
import { createPiFactoryStageExecutor, parseGoldfishVerdict } from "./factory-pi-executor.ts";

function createTempRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "ade-pi-factory-repo-"));
	execFileSync("git", ["init", "-b", "main"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "ade@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "ADE"], { cwd: dir });
	writeFileSync(join(dir, "README.md"), "# Demo Repo\n", "utf8");
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
	return dir;
}

test("parseGoldfishVerdict extracts structured findings and verdicts cleanly", () => {
	const changes = parseGoldfishVerdict(
		"Audit summary:\n- BLOCKER (src/auth.ts:42): Missing token expiry check\nVERDICT: CHANGES_REQUESTED",
	);
	assert.equal(changes.outcome, "changes_requested");
	assert.equal(changes.findings?.length, 1);
	assert.equal(changes.findings?.[0].file, "src/auth.ts");
	assert.equal(changes.findings?.[0].line, 42);

	const pass = parseGoldfishVerdict("Looks solid across the codebase.\nVERDICT: PASS");
	assert.equal(pass.outcome, "pass");
});

test("Real Pi Durable stage executor runs Captain, isolated coding worker, Goldfish loopback, Auto-Run, and restart hydration", { timeout: 60_000 }, async () => {
	const repoDir = createTempRepo();
	const stateDir = mkdtempSync(join(tmpdir(), "ade-pi-factory-state-"));
	const db = new DatabaseSync(join(stateDir, "ade-host.sqlite"));
	const events = new RuntimeEventBus();
	const approvals = new ApprovalManager(db, events);
	const artifacts = new ArtifactManager(db, events);
	const processes = new ProcessManager(events);
	const browser = new BrowserManager(stateDir, events);

	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const modelConfig = {
		provider: faux.provider.id,
		defaultModel: faux.getModel().id,
		availableModels: [{ id: faux.getModel().id, name: "Faux Pi Model" }],
		configured: true,
		setupMessage: "",
		models,
		resolveModel: (id: string) => models.getModel(faux.provider.id, id),
	};

	// Sequence of real Pi Durable tool + assistant responses across stages:
	// 1. Triage -> answer
	// 2. Plan -> answer
	// 3. Implement #1 -> calls real `write` tool to create hello.ts -> answer
	// 4. Verify #1 -> answer
	// 5. Goldfish Review #1 -> calls real read-only `read` tool on hello.ts -> returns CHANGES_REQUESTED
	// 6. Implement #2 (loopback) -> updates hello.ts via `write` -> answer
	// 7. Verify #2 -> answer
	// 8. Goldfish Review #2 -> returns PASS
	faux.setResponses([
		fauxAssistantMessage("Triaged: straightforward utility module."),
		fauxAssistantMessage("Plan: create hello.ts exporting greet()."),
		fauxAssistantMessage(fauxToolCall("write", { path: "hello.ts", content: "const greet = () => 'hi';\n" }), { stopReason: "toolUse" }),
		fauxAssistantMessage("Created hello.ts."),
		fauxAssistantMessage("Verification passed."),
		fauxAssistantMessage(fauxToolCall("read", { path: "hello.ts" }), { stopReason: "toolUse" }),
		fauxAssistantMessage("- BLOCKER (hello.ts:1): greet is not exported\nVERDICT: CHANGES_REQUESTED"),
		fauxAssistantMessage(fauxToolCall("write", { path: "hello.ts", content: "export const greet = () => 'hi';\n" }), { stopReason: "toolUse" }),
		fauxAssistantMessage("Fixed export in hello.ts."),
		fauxAssistantMessage("Verification passed after fix."),
		fauxAssistantMessage("Verified export cleanly.\nVERDICT: PASS"),
	]);

	const captainHost = createNodeSqliteCaptainHost({ db, region: "local" });
	const captain = new CaptainCore({ host: captainHost });
	const sandbox = new LocalDockerSandbox({
		worktreesRoot: join(stateDir, "worktrees"),
		mode: "worktree",
	});

	const executor = createPiFactoryStageExecutor({
		stateDirectory: stateDir,
		resolveModelConfig: async () => modelConfig,
		processes,
		browser,
		artifacts,
		approvals,
	});

	const runner = new LocalFactoryRunner({
		captain,
		stateDirectory: stateDir,
		sandbox,
		stageExecutor: executor,
	});

	try {
		const created = await runner.createRun({
			runId: "pi_real_e2e",
			projectId: "proj_ade",
			blueprintId: "automated-factory",
			repoPath: repoDir,
			taskPrompt: "Add hello.ts exporting greet()",
		});
		assert.equal(created.subagents.length, 0);

		// Kick off real autonomous Auto-Run — runs all stages + Goldfish loopback until human PR gate!
		runner.startAutoRun("pi_real_e2e");

		// Wait until Auto-Run pauses at the publish_pr human approval gate
		const deadline = Date.now() + 45_000;
		let current = runner.getRun("pi_real_e2e")!;
		while (Date.now() < deadline && (current.autoRunning || current.run.status === "idle" || current.run.status === "running")) {
			await new Promise((r) => setTimeout(r, 80));
			current = runner.getRun("pi_real_e2e")!;
		}

		assert.equal(current.lastError, null, `Unexpected error: ${current.lastError}`);
		assert.equal(current.run.status, "awaiting_human");
		assert.equal(current.run.auditLoopbacksUsed, 1);
		assert.equal(current.pendingEscalations.length, 1);
		assert.ok(current.subagents.some((s) => s.contextIsolation === "goldfish" && s.status === "changes_requested"));
		assert.ok(current.subagents.some((s) => s.contextIsolation === "goldfish" && s.status === "completed"));
		assert.match(current.diff, /hello\.ts/);
		assert.ok(current.worktreePath);
		assert.match(readFileSync(join(current.worktreePath!, "hello.ts"), "utf8"), /export const greet/);

		// Persistence across restart: hydrate a fresh runner from the same SQLite DB
		const hydratedRunner = new LocalFactoryRunner({
			captain: new CaptainCore({ host: captainHost }),
			stateDirectory: stateDir,
			sandbox,
		});
		await hydratedRunner.hydrateFromStorage();
		const restored = hydratedRunner.getRun("pi_real_e2e");
		assert.ok(restored);
		assert.equal(restored.run.auditLoopbacksUsed, 1);
		assert.ok(restored.subagents.length >= 6);
	} finally {
		await runner.close();
		captainHost.close();
		processes.close();
		browser.close();
		events.close();
		db.close();
		rmSync(repoDir, { recursive: true, force: true });
		rmSync(stateDir, { recursive: true, force: true });
	}
});
