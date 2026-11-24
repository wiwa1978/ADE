import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { LocalAgentHost } from "./host.ts";
import { WorktreeManager } from "./worktrees.ts";

test("at an approval gate ADE ends the agent's turn itself: it can't carry on editing in the same turn", { timeout: 30_000 }, async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "ade-gate-"));
	const repoDir = mkdtempSync(join(tmpdir(), "ade-gate-repo-"));
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	writeFileSync(join(repoDir, "app.ts"), "export const answer = 41;\n");
	const faux = fauxProvider();
	// The model finishes Constitution, then Specify (which has a gate), then ignores the gate and tries to write a file.
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("finish_stage", { stageId: "constitution", summary: "Principles loaded." }), { stopReason: "toolUse" }),
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
		await host.send("coding", { content: "Build it with the spec", model: faux.getModel().id, reasoning: "none" }, taskId);

		const stage = host.blueprints.summary(taskId)?.stage;
		assert.deepEqual([stage?.id, stage?.status], ["specify", "awaiting_approval"], "the gate was reached");
		assert.equal(existsSync(join(repoDir, "after-the-gate.txt")), false, "nothing was written after the gate");
		assert.equal(faux.state.callCount, 2, "the model was not asked again after the gate: the turn ended");
		const timeline = await host.getTimeline(taskId);
		const calls = timeline.items.flatMap(item => (item.kind === "assistant" ? item.toolCalls : []));
		assert.deepEqual(calls.map(call => call.name), ["finish_stage", "finish_stage"]);
	} finally {
		await host.close();
		manager.close();
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	}
});
