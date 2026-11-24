import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { LocalAgentHost } from "./host.ts";
import { WorktreeManager } from "./worktrees.ts";

/**
 * The reviewer end to end with two model providers: the Captain runs on provider A, ADE puts the
 * independent reviewer on provider B (another model family), and the review stage only finishes
 * after that reviewer really ran on B. Both providers are scripted, so this proves the switching
 * and the evidence, not the quality of a real model's review.
 */
test("the independent reviewer runs on the other provider, and its run is what lets the review stage finish", { timeout: 90_000 }, async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "ade-reviewer-"));
	const repoDir = mkdtempSync(join(tmpdir(), "ade-reviewer-repo-"));
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	const captain = fauxProvider({ provider: "faux-captain", models: [{ id: "claude-fake" }] });
	const reviewer = fauxProvider({ provider: "faux-reviewer", models: [{ id: "gpt-fake" }] });
	const models = createModels();
	models.setProvider(captain.provider);
	models.setProvider(reviewer.provider);
	const fixture = { provider: captain.provider.id, defaultModel: "claude-fake", availableModels: [{ id: "claude-fake", name: "Claude fake" }], configured: true, setupMessage: "", models, resolveModel: (id: string) => models.getModel(captain.provider.id, id) };
	const host = new LocalAgentHost({ stateDirectory: stateDir, modelConfigFactory: () => fixture });
	const manager = new WorktreeManager(stateDir);
	host.setWorktreeManager(manager);
	try {
		// ADE's choice of reviewer model is covered in model-routing.test.ts; here it picks the second provider.
		host.routing.reviewer = async () => ({ model: { provider: reviewer.provider.id, model: "gpt-fake" }, label: `${reviewer.provider.id}/gpt-fake`, independent: true });
		const taskId = randomUUID();
		await host.createCodingTask({ id: taskId, title: "Review me", repository: repoDir, kind: "checkout", blueprintId: "automated-factory" }, manager);
		// Bring the blueprint to its review stage (each stage's document has to exist first).
		for (const stageId of ["triage", "plan", "implement", "verify"]) {
			for (const path of host.blueprints.view(taskId).stages.find(item => item.id === stageId)!.artifactPaths) {
				mkdirSync(join(repoDir, path, ".."), { recursive: true });
				writeFileSync(join(repoDir, path), `# ${stageId}\n`);
			}
			await host.blueprints.finishChecked(taskId, { stageId, summary: `${stageId} done` });
		}
		assert.equal(host.blueprints.summary(taskId)?.stage?.id, "review");
		for (const path of host.blueprints.view(taskId).stages.find(item => item.id === "review")!.artifactPaths) {
			mkdirSync(join(repoDir, path, ".."), { recursive: true });
			writeFileSync(join(repoDir, path), "# Review\n");
		}

		captain.setResponses([
			// Too early: nobody has reviewed yet, so ADE refuses and says how.
			fauxAssistantMessage(fauxToolCall("finish_stage", { stageId: "review", summary: "Looks fine to me.", verdict: { outcome: "pass", summary: "Fine" } }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("spawn_subagent", { name: "Reviewer", task: "Review the branch against the plan.", mode: "readonly" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("finish_stage", { stageId: "review", summary: "Reviewed.", verdict: { outcome: "pass", summary: "No blockers" } }), { stopReason: "toolUse" }),
		]);
		reviewer.setResponses([fauxAssistantMessage("One minor naming issue; no blockers.")]);
		await host.send("coding", { content: "Finish the review stage", model: "claude-fake", reasoning: "none" }, taskId);

		assert.equal(reviewer.state.callCount, 1, "the reviewer's turn ran on the second provider");
		assert.equal(captain.state.callCount, 3, "and the Captain's own turns on the first (the turn ends at the next stage's gate, so there is no closing message)");
		const review = host.blueprints.view(taskId).stages.find(item => item.id === "review")!;
		assert.equal(review.status, "completed");
		assert.equal(review.review?.model, "faux-reviewer/gpt-fake");
		assert.equal(review.review?.independent, true);
		assert.equal(review.review?.status, "completed");
		assert.match(review.review?.report ?? "", /minor naming issue/);
		assert.match(review.summary ?? "", /Independent review by faux-reviewer\/gpt-fake \(a different model family/);
		const timeline = await host.getTimeline(taskId);
		const outputs = timeline.items.flatMap(item => (item.kind === "assistant" ? item.toolCalls.map(call => call.output ?? "") : []));
		assert.ok(outputs.some(text => /independent review, and ADE hasn't seen one yet/.test(text)), "the first, unreviewed attempt was refused");
	} finally {
		await host.close();
		manager.close();
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	}
});
