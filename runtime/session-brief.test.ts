import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, shorten } from "./session-brief.ts";

test("shorten drops markdown and code, and ends on a sentence when it can", () => {
	assert.equal(shorten("## Done\n\nAdded the **/health** endpoint in `server.ts`.\n\n```ts\nconst x = 1\n```\nTests pass."), "Done Added the /health endpoint in server.ts. Tests pass.");
	assert.equal(shorten(null), "");
	const long = `${"The agent changed many things in the codebase. ".repeat(12)}`;
	const cut = shorten(long, 100);
	assert.ok(cut.length <= 101 && cut.endsWith("."), cut);
	assert.match(shorten("word ".repeat(100), 30), /…$/);
});

test("the brief says what was asked, what was done, and what waits for the person", () => {
	const brief = buildBrief({
		question: "Add a /health endpoint that returns ok",
		lastAnswer: "I added GET /health in server.ts and a test. All tests pass.",
		lastTurnStatus: "completed",
		pendingApprovals: [],
		git: { files: 2, additions: 14, deletions: 1 },
		stage: { name: "Plan", done: 1, total: 4, waiting: true, waitingSummary: "A plan with three steps: route, test, docs." },
		subagents: 2,
	});
	assert.equal(brief.question, "Add a /health endpoint that returns ok");
	assert.equal(brief.work.summary, "I added GET /health in server.ts and a test. All tests pass.");
	assert.deepEqual([brief.work.files, brief.work.added, brief.work.removed, brief.work.subagents], [2, 14, 1, 2]);
	assert.deepEqual(brief.work.stage, { name: "Plan", done: 1, total: 4 });
	assert.deepEqual(brief.approval, { kind: "stage", subject: "Plan", detail: "A plan with three steps: route, test, docs." });
});

test("a command waiting for approval comes first, then a stage, a failure, a review, and finally nothing", () => {
	const base = { pendingApprovals: [], lastTurnStatus: "completed" as const };
	assert.equal(buildBrief({ ...base, pendingApprovals: [{ summary: "Run command: npm test", command: "npm test", toolName: "run_command" }, { summary: "x" }], stage: { name: "Build", done: 0, total: 2, waiting: true } }).approval.kind, "command");
	assert.deepEqual(buildBrief({ ...base, pendingApprovals: [{ summary: "s", command: "git push origin main" }] }).approval, { kind: "command", subject: "git push origin main", detail: "", count: 1 });
	assert.equal(buildBrief({ ...base, stage: { name: "Build", done: 0, total: 2, waiting: true, startsAfterApproval: true } }).approval.detail, "", "a stage that hasn't started has no result to describe");
	assert.deepEqual(buildBrief({ ...base, lastTurnStatus: "failed", lastError: "Provider returned 500" }).approval, { kind: "failed", subject: "", detail: "Provider returned 500" });
	assert.equal(buildBrief({ ...base, git: { files: 3, additions: 1, deletions: 0 } }).approval.kind, "review");
	assert.equal(buildBrief({ ...base, commitsAhead: 1 }).approval.kind, "review");
	assert.equal(buildBrief(base).approval.kind, "none");
	assert.equal(buildBrief({ pendingApprovals: [] }).question, "");
});

test("the first message and the last answer of a session come from its turns", { timeout: 60_000 }, async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { randomUUID } = await import("node:crypto");
	const { createModels } = await import("@earendil-works/pi-ai/models");
	const { fauxAssistantMessage, fauxProvider } = await import("@earendil-works/pi-ai/providers/faux");
	const { LocalAgentHost } = await import("./host.ts");
	const { WorktreeManager } = await import("./worktrees.ts");
	const stateDir = mkdtempSync(join(tmpdir(), "ade-brief-"));
	const faux = fauxProvider();
	faux.setResponses([fauxAssistantMessage("I added GET /health and a test."), fauxAssistantMessage("Docs updated too.")]);
	const models = createModels();
	models.setProvider(faux.provider);
	const fixture = { provider: faux.provider.id, defaultModel: faux.getModel().id, availableModels: [{ id: faux.getModel().id, name: "Fixture" }], configured: true, setupMessage: "", models, faux, resolveModel: (id: string) => models.getModel(faux.provider.id, id) };
	const host = new LocalAgentHost({ stateDirectory: stateDir, modelConfigFactory: () => fixture });
	const manager = new WorktreeManager(stateDir);
	host.setWorktreeManager(manager);
	try {
		const taskId = randomUUID();
		await host.createCodingTask({ id: taskId, title: "Health", repository: "", kind: "none" }, manager);
		assert.deepEqual(host.turnsOverview(taskId), { first: null, lastAnswered: null, latest: null }, "nothing asked yet");
		await host.send("coding", { content: "Add a /health endpoint that returns ok", model: faux.getModel().id, reasoning: "none" }, taskId);
		await host.send("coding", { content: "Also update the docs", model: faux.getModel().id, reasoning: "none" }, taskId);
		const turns = host.turnsOverview(taskId);
		assert.equal(turns.first?.content, "Add a /health endpoint that returns ok", "the original question, not the latest message");
		assert.equal(turns.lastAnswered?.answer, "Docs updated too.");
		assert.equal(turns.latest?.status, "completed");
		const brief = buildBrief({ question: turns.first?.content, lastAnswer: turns.lastAnswered?.answer, lastTurnStatus: turns.latest?.status, pendingApprovals: [] });
		assert.equal(brief.question, "Add a /health endpoint that returns ok");
		assert.equal(brief.work.summary, "Docs updated too.");
	} finally {
		await host.close();
		manager.close();
		rmSync(stateDir, { recursive: true, force: true });
	}
});
