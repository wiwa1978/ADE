import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runHostMigrations } from "./db/migrations.ts";
import { resolveSessionBlueprint, SessionBlueprints } from "./session-blueprints.ts";

function setup(blueprintId: string | null) {
	const db = new DatabaseSync(":memory:");
	runHostMigrations(db);
	db.prepare("INSERT INTO coding_tasks (id,title,repository,kind,base,branch,status,createdAt,blueprintId) VALUES ('s1','Login page','/repo','worktree','HEAD','ade/login-page','ready',1,?)").run(blueprintId);
	let now = 1000;
	const events: Array<{ type: string; payload: unknown }> = [];
	const blueprints = new SessionBlueprints(db, { emit: (type: string, payload: unknown) => events.push({ type, payload }) } as never, () => ++now);
	return { db, blueprints, events };
}

test("the way of working: the session's choice, else the project's default, and a lock wins", () => {
	assert.equal(resolveSessionBlueprint(null, undefined), "vibe");
	assert.equal(resolveSessionBlueprint({ blueprintId: "speckit" }, undefined), "speckit");
	assert.equal(resolveSessionBlueprint({ blueprintId: "speckit" }, "vibe"), "vibe");
	assert.equal(resolveSessionBlueprint({ blueprintId: "unknown" }, ""), "vibe");
	assert.throws(() => resolveSessionBlueprint({ blueprintId: "speckit" }, "nope"), /way of working/);
	assert.throws(() => resolveSessionBlueprint({ blueprintId: "speckit", blueprintLocked: 1 }, "vibe"), /all use its blueprint/);
	assert.equal(resolveSessionBlueprint({ blueprintId: "speckit", blueprintLocked: true }, "speckit"), "speckit");
});

test("Vibe sessions have no stages and no stage instructions", () => {
	const { blueprints } = setup("vibe");
	assert.equal(blueprints.summary("s1"), null);
	assert.equal(blueprints.instructions("s1"), null);
	assert.deepEqual(blueprints.view("s1").stages, []);
	assert.match(blueprints.finish("s1", { stageId: "x", summary: "" }).reply, /doesn't follow a blueprint/);
});

test("Spec Kit: stages run in order, gates wait for the user, feedback sends a stage back", () => {
	const { blueprints, events } = setup("speckit");
	// Created lazily on first use, at the first stage.
	const first = blueprints.summary("s1")!;
	assert.equal(first.stage?.id, "constitution");
	assert.equal(first.stage?.status, "running");
	assert.equal(first.done, 0);
	const prompt = blueprints.instructions("s1")!;
	assert.match(prompt, /Way of working: Spec Kit/);
	assert.match(prompt, /Current stage: Constitution Check \(constitution\)/);
	assert.match(prompt, /2\. Specify \(specify\) — to do; the user approves its result/);

	// The wrong stage is answered, not recorded.
	assert.match(blueprints.finish("s1", { stageId: "plan", summary: "x" }).reply, /current stage is "constitution"/);

	// No gate: the reply carries the next stage's instructions.
	let result = blueprints.finish("s1", { stageId: "constitution", summary: "Principles loaded.", artifacts: [".specify/constitution.md"] });
	assert.equal(result.waiting, false);
	assert.match(result.reply, /Continue now with the next stage[\s\S]*Current stage: Specify/);
	assert.match(result.reply, /specs\/login-page\/spec\.md/, "{issue} becomes the branch name");

	// Gate after Specify: stop and wait.
	result = blueprints.finish("s1", { stageId: "specify", summary: "Spec written." });
	assert.equal(result.waiting, true);
	assert.match(result.reply, /Stop here/);
	assert.equal(blueprints.summary("s1")!.stage?.status, "awaiting_approval");
	assert.match(blueprints.instructions("s1")!, /Waiting for the user: Specify/);
	assert.ok(events.some(event => event.type === "stages.update"));

	// Request changes: the stage runs again with the feedback.
	assert.throws(() => blueprints.decide("s1", "request_changes", ""), /Say what should change/);
	const again = blueprints.decide("s1", "request_changes", "Add the password reset flow.")!;
	assert.match(again, /Add the password reset flow[\s\S]*call finish_stage for "specify" again/);
	assert.equal(blueprints.summary("s1")!.stage?.status, "running");
	// The feedback stays in the agent's instructions until the stage is finished again.
	assert.match(blueprints.instructions("s1")!, /asked for changes[\s\S]*Add the password reset flow/);
	blueprints.finish("s1", { stageId: "specify", summary: "Spec with reset flow." });
	assert.doesNotMatch(blueprints.instructions("s1")!, /Add the password reset flow/);

	// Approve: on to the next stage.
	const next = blueprints.decide("s1", "approve", "")!;
	assert.match(next, /approved "Specify"[\s\S]*Continue with the stage "Architecture Plan"/);
	assert.throws(() => blueprints.decide("s1", "approve"), /Nothing is waiting/);
	const view = blueprints.view("s1");
	assert.equal(view.stages[1].status, "completed");
	assert.equal(view.stages[1].summary, "Spec with reset flow.");
	assert.deepEqual(view.history.map(item => `${item.stageId}:${item.event}`).slice(0, 6), ["constitution:started", "constitution:finished", "specify:started", "specify:finished", "specify:changes_requested", "specify:started"]);
});

test("a review that asks for changes loops back to building, then needs the user after the allowed rounds", () => {
	const { blueprints } = setup("automated-factory");
	for (const stageId of ["triage", "plan", "implement", "verify"]) assert.equal(blueprints.finish("s1", { stageId, summary: `${stageId} done` }).waiting, false);
	assert.match(blueprints.finish("s1", { stageId: "review", summary: "Reviewed" }).reply, /needs? a verdict|with a verdict/);
	const changes = { outcome: "changes_requested" as const, summary: "Missing tests", findings: [{ severity: "major" as const, file: "src/login.ts", message: "No test for lockout" }] };
	let result = blueprints.finish("s1", { stageId: "review", summary: "Changes needed", verdict: changes });
	assert.match(result.reply, /Back to stage "implement"[\s\S]*\[major\] src\/login\.ts: No test for lockout[\s\S]*Current stage: Implement/);
	for (let round = 0; round < 1; round++) {
		blueprints.finish("s1", { stageId: "implement", summary: "fixed" });
		blueprints.finish("s1", { stageId: "verify", summary: "ok" });
		result = blueprints.finish("s1", { stageId: "review", summary: "Still missing", verdict: changes });
		assert.match(result.reply, /Back to stage "implement"/);
	}
	blueprints.finish("s1", { stageId: "implement", summary: "fixed" });
	blueprints.finish("s1", { stageId: "verify", summary: "ok" });
	result = blueprints.finish("s1", { stageId: "review", summary: "Still missing", verdict: changes });
	assert.equal(result.waiting, true);
	assert.match(result.reply, /needs the user's decision/);
	// The user accepts; the PR stage asks before it starts.
	const message = blueprints.decide("s1", "approve");
	assert.equal(message, null, "the next stage has a gate before it");
	assert.equal(blueprints.summary("s1")!.stage?.id, "publish_pr");
	assert.equal(blueprints.summary("s1")!.stage?.status, "awaiting_approval");
	assert.match(blueprints.decide("s1", "approve")!, /approved starting "Merge-Ready PR"/);
	blueprints.finish("s1", { stageId: "publish_pr", summary: "PR #4 opened" });
	const done = blueprints.summary("s1")!;
	assert.equal(done.status, "completed");
	assert.equal(done.stage, undefined);
	assert.equal(done.done, done.total);
	assert.match(blueprints.instructions("s1")!, /All stages are done/);
});

test("switching: to Vibe drops the stages, to a blueprint starts at its first stage", () => {
	const { blueprints } = setup("speckit");
	blueprints.finish("s1", { stageId: "constitution", summary: "ok" });
	blueprints.begin("s1", "vibe");
	assert.equal(blueprints.summary("s1"), null);
	assert.equal(blueprints.blueprintId("s1"), "vibe");
	blueprints.begin("s1", "openspec");
	assert.equal(blueprints.summary("s1")!.stage?.id, "triage");
	assert.throws(() => blueprints.begin("s1", "nope"), /Unknown blueprint/);
});

test("Request changes on a stage that hasn't started keeps it waiting; nothing is 'redone'", () => {
	const { blueprints } = setup("automated-factory");
	for (const stageId of ["triage", "plan", "implement", "verify"]) blueprints.finish("s1", { stageId, summary: `${stageId} done` });
	blueprints.finish("s1", { stageId: "review", summary: "Reviewed", verdict: { outcome: "pass", summary: "Fine" } });
	const gate = blueprints.summary("s1")!.stage!;
	assert.deepEqual([gate.id, gate.status], ["publish_pr", "awaiting_approval"], "the PR stage asks before it starts");

	const message = blueprints.decide("s1", "request_changes", "Squash the commits first")!;
	assert.match(message, /doesn't want "Merge-Ready PR" to start yet[\s\S]*Squash the commits first[\s\S]*Don't start the stage/);
	assert.doesNotMatch(message, /Redo this stage/);
	assert.equal(blueprints.summary("s1")!.stage?.status, "awaiting_approval", "still waiting for approval");
	const history = blueprints.view("s1").history;
	assert.equal(history.at(-1)?.event, "changes_requested", "no stage was started");
	assert.ok(!history.some(entry => entry.stageId === "publish_pr" && entry.event === "started"));
	assert.match(blueprints.instructions("s1")!, /Waiting for the user: Merge-Ready PR/);

	// When the user is satisfied, approving starts the stage as usual.
	assert.match(blueprints.decide("s1", "approve")!, /approved starting "Merge-Ready PR"/);
	assert.equal(blueprints.summary("s1")!.stage?.status, "running");
});

test("after a gate the agent may only read and talk until the next turn; the tool result ends the turn", async () => {
	const { blueprints } = setup("speckit");
	const finish = (blueprints.createExtension("s1").tools ?? []).find(tool => tool.name === "finish_stage") as unknown as {
		execute: (args: Record<string, unknown>, api: unknown) => Promise<{ output: Array<{ text: string }>; control?: { terminate?: boolean } }>;
	};
	const call = (args: Record<string, unknown>) => finish.execute(args, { conversationId: 0 });

	// A stage without a gate doesn't end the turn, and nothing is locked.
	const first = await call({ stageId: "constitution", summary: "ok" });
	assert.equal(first.control, undefined);
	assert.equal(blueprints.gateReason("s1", "write"), null);

	// Specify has a gate: the result ends the turn, and changing things is refused for the rest of it.
	const gate = await call({ stageId: "specify", summary: "Spec written." });
	assert.equal(gate.control?.terminate, true);
	assert.match(gate.output[0].text, /Stop here/);
	assert.match(blueprints.gateReason("s1", "write") ?? "", /"Specify" is waiting for the user's approval[\s\S]*End your turn/);
	for (const tool of ["edit", "run_command", "spawn_subagent", "team_tasks", "browser_click"]) assert.ok(blueprints.gateReason("s1", tool), `${tool} is refused`);
	for (const tool of ["read", "grep_search", "list_files", "team_read", "team_post", "finish_stage"]) assert.equal(blueprints.gateReason("s1", tool), null, `${tool} still works`);
	assert.match(blueprints.gateNote("s1") ?? "", /Waiting for your approval: Specify/);

	// The next turn lifts it.
	blueprints.unlock("s1");
	assert.equal(blueprints.gateReason("s1", "write"), null);
	assert.equal(blueprints.gateNote("s1"), null);
});

test("a stage with checks can't finish while ADE's own run of them fails; passing runs are recorded", async () => {
	const { blueprints } = setup("automated-factory");
	const failing = { source: "package" as const, ok: false, at: 1, missing: ["typecheck"], results: [
		{ label: "lint", command: "npm run lint", status: "passed" as const, exitCode: 0, output: "", ms: 10 },
		{ label: "test", command: "npm test", status: "failed" as const, exitCode: 1, output: "FAIL a.test.ts: expected 2, got 3", ms: 20 },
	] };
	let calls = 0;
	let outcome: typeof failing | null = failing;
	blueprints.setChecker(async (_sessionId, stage) => {
		calls++;
		assert.equal(stage.id, "verify");
		return outcome;
	});
	for (const stageId of ["triage", "plan", "implement"]) await blueprints.finishChecked("s1", { stageId, summary: `${stageId} done` });
	assert.equal(calls, 0, "stages without checks don't run any");

	// Failing: refused with the output; the stage is still running, and the failure is on record.
	const refused = await blueprints.finishChecked("s1", { stageId: "verify", summary: "All green, trust me" });
	assert.match(refused.reply, /one failed, so "Deterministic Hooks" is not finished[\s\S]*✕ test[\s\S]*expected 2, got 3[\s\S]*call finish_stage again/);
	assert.equal(blueprints.summary("s1")!.stage?.id, "verify");
	assert.equal(blueprints.summary("s1")!.stage?.status, "running");
	let view = blueprints.view("s1").stages.find(stage => stage.id === "verify")!;
	assert.equal(view.checks?.ok, false);
	assert.equal(view.summary, null, "the agent's claim wasn't recorded as the result");
	assert.equal(blueprints.view("s1").history.at(-1)?.event, "checks_failed");

	// Fixed: the checks pass, the stage finishes, and the summary says what ran.
	outcome = { ...failing, ok: true, results: [{ ...failing.results[0] }, { ...failing.results[1], status: "passed", exitCode: 0, output: "" }] };
	const done = await blueprints.finishChecked("s1", { stageId: "verify", summary: "Tests fixed" });
	assert.match(done.reply, /Recorded "Deterministic Hooks"/);
	view = blueprints.view("s1").stages.find(stage => stage.id === "verify")!;
	assert.equal(view.status, "completed");
	assert.match(view.summary ?? "", /Tests fixed\n\nChecks passed: lint, test\. Not available here: typecheck\./);
	assert.equal(view.checks?.ok, true);
	assert.deepEqual(blueprints.view("s1").history.filter(entry => entry.event.startsWith("checks")).map(entry => entry.event), ["checks_failed", "checks_passed"]);
});

test("if the checks can't run, or there is nothing to run, the stage isn't blocked", async () => {
	const { blueprints } = setup("automated-factory");
	for (const stageId of ["triage", "plan", "implement"]) blueprints.finish("s1", { stageId, summary: "ok" });
	blueprints.setChecker(async () => { throw new Error("runner busy"); });
	assert.match((await blueprints.finishChecked("s1", { stageId: "verify", summary: "ok" })).reply, /Recorded/, "a checker that throws doesn't block");

	const second = setup("automated-factory");
	for (const stageId of ["triage", "plan", "implement"]) second.blueprints.finish("s1", { stageId, summary: "ok" });
	second.blueprints.setChecker(async () => ({ source: "none", ok: true, at: 1, missing: ["lint", "typecheck", "test"], results: [] }));
	assert.match((await second.blueprints.finishChecked("s1", { stageId: "verify", summary: "ok" })).reply, /Recorded/);
	const view = second.blueprints.view("s1");
	assert.match(view.stages.find(stage => stage.id === "verify")!.summary ?? "", /Not available here: lint, typecheck, test\./, "the summary says which checks this project has no command for");
	assert.ok(!view.history.some(entry => entry.event.startsWith("checks")), "nothing ran, so nothing is logged as run");
});
