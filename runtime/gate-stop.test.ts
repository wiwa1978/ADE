import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createAgentWorkflow } from "./agent-workflow.ts";
import { LocalAgentHost } from "./host.ts";
import { createSessionGit } from "./session-git.ts";
import { WorktreeManager } from "./worktrees.ts";

test("at an approval gate ADE ends the agent's turn itself: it can't carry on editing in the same turn", { timeout: 30_000 }, async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "ade-gate-"));
	const repoDir = mkdtempSync(join(tmpdir(), "ade-gate-repo-"));
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	writeFileSync(join(repoDir, "app.ts"), "export const answer = 41;\n");
	const faux = fauxProvider();
	// The model finishes Constitution, writes the spec and finishes Specify (which has a gate), then ignores the gate and tries to write a file.
	const respond = (specPath: string) => faux.setResponses([
		fauxAssistantMessage(fauxToolCall("finish_stage", { stageId: "constitution", summary: "Principles loaded." }), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxToolCall("write", { path: "app.ts", content: "export const answer = 42;\n" }), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxToolCall("write", { path: specPath, content: "# Spec\nThe answer is 42.\n" }), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxToolCall("finish_stage", { stageId: "specify", summary: "Spec written." }), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxToolCall("write", { path: "after-the-gate.txt", content: "should never exist" }), { stopReason: "toolUse" }),
		fauxAssistantMessage("Done, carrying on."),
	]);
	const models = createModels();
	models.setProvider(faux.provider);
	const fixture = { provider: faux.provider.id, defaultModel: faux.getModel().id, availableModels: [{ id: faux.getModel().id, name: "Fixture" }], configured: true, setupMessage: "", models, faux, resolveModel: (id: string) => models.getModel(faux.provider.id, id) };
	const host = new LocalAgentHost({ stateDirectory: stateDir, modelConfigFactory: () => fixture });
	const manager = new WorktreeManager(stateDir);
	host.setWorktreeManager(manager);
	try {
		const taskId = randomUUID();
		await host.createCodingTask({ id: taskId, title: "Gate", repository: repoDir, kind: "checkout", blueprintId: "speckit" }, manager);
		// The repository already has its principles.
		for (const path of host.blueprints.view(taskId).stages.find(item => item.id === "constitution")!.artifactPaths) {
			mkdirSync(join(repoDir, path, ".."), { recursive: true });
			writeFileSync(join(repoDir, path), "# Principles\n");
		}
		respond(host.blueprints.view(taskId).stages.find(item => item.id === "specify")!.artifactPaths[0]);
		await host.send("coding", { content: "Build it with the spec", model: faux.getModel().id, reasoning: "none" }, taskId);

		const stage = host.blueprints.summary(taskId)?.stage;
		assert.deepEqual([stage?.id, stage?.status], ["specify", "awaiting_approval"], "the gate was reached");
		assert.equal(existsSync(join(repoDir, "after-the-gate.txt")), false, "nothing was written after the gate");
		assert.equal(faux.state.callCount, 4, "the model was not asked again after the gate: the turn ended");
		const timeline = await host.getTimeline(taskId);
		const calls = timeline.items.flatMap(item => (item.kind === "assistant" ? item.toolCalls : []));
		assert.deepEqual(calls.map(call => call.name), ["finish_stage", "write", "write", "finish_stage"]);
		assert.equal(readFileSync(join(repoDir, "app.ts"), "utf8"), "export const answer = 41;\n", "Specify could not edit the app");
		assert.match(readFileSync(join(repoDir, host.blueprints.view(taskId).stages.find(item => item.id === "specify")!.artifactPaths[0]), "utf8"), /answer is 42/, "but it wrote its own spec");
	} finally {
		await host.close();
		manager.close();
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	}
});

test("ADE runs the project's tests itself before a verify stage can finish: a failing test blocks it, a fixed one lets it through", { timeout: 60_000 }, async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "ade-checks-"));
	const repoDir = mkdtempSync(join(tmpdir(), "ade-checks-repo-"));
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	// A project whose "test" script fails until the flag file exists; it has no build, lint or typecheck script.
	writeFileSync(join(repoDir, "package.json"), JSON.stringify({ name: "p", scripts: { test: "node -e \"process.exit(require('fs').existsSync('fixed.flag') ? 0 : 1)\"" } }));
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const fixture = { provider: faux.provider.id, defaultModel: faux.getModel().id, availableModels: [{ id: faux.getModel().id, name: "Fixture" }], configured: true, setupMessage: "", models, faux, resolveModel: (id: string) => models.getModel(faux.provider.id, id) };
	const host = new LocalAgentHost({ stateDirectory: stateDir, modelConfigFactory: () => fixture });
	const manager = new WorktreeManager(stateDir);
	host.setWorktreeManager(manager);
	createAgentWorkflow({ host, worktreeManager: manager, sessionGit: createSessionGit() });
	try {
		const taskId = randomUUID();
		await host.createCodingTask({ id: taskId, title: "Checks", repository: repoDir, kind: "checkout", blueprintId: "automated-factory" }, manager);
		for (const stageId of ["triage", "plan", "implement"]) {
			// ADE looks for each stage's document before it lets the stage finish.
			for (const path of host.blueprints.view(taskId).stages.find(item => item.id === stageId)!.artifactPaths) {
				mkdirSync(join(repoDir, path, ".."), { recursive: true });
				writeFileSync(join(repoDir, path), `# ${stageId}\n`);
			}
			host.blueprints.finish(taskId, { stageId, summary: `${stageId} done` });
		}

		const refused = await host.blueprints.finishChecked(taskId, { stageId: "verify", summary: "Everything passes" });
		assert.match(refused.reply, /one failed, so "Deterministic Hooks" is not finished[\s\S]*✕ test \(`npm test`, exit 1\)/);
		assert.equal(host.blueprints.summary(taskId)?.stage?.id, "verify", "still on verify");
		const checks = host.blueprints.view(taskId).stages.find(stage => stage.id === "verify")?.checks;
		assert.deepEqual(checks?.missing, ["lint", "typecheck"], "words the project has no script for are skipped, not failed");

		writeFileSync(join(repoDir, "fixed.flag"), "");
		const done = await host.blueprints.finishChecked(taskId, { stageId: "verify", summary: "Fixed the test" });
		assert.match(done.reply, /Recorded "Deterministic Hooks"/);
		const verify = host.blueprints.view(taskId).stages.find(stage => stage.id === "verify");
		assert.equal(verify?.status, "completed");
		assert.match(verify?.summary ?? "", /Checks passed: test\. Not available here: lint, typecheck\./);
	} finally {
		await host.close();
		manager.close();
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	}
});
