import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AutomationStore, lastScheduledTime, scheduleIsDue, validateAutomation } from "./automations.ts";
import { createAutomationRunner } from "./automation-runner.ts";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test("schedules find their most recent slot in local time", () => {
	// Wednesday 25 Nov 2026, 10:30.
	const now = at(2026, 11, 25, 10, 30);
	assert.equal(lastScheduledTime({ type: "schedule", every: "daily", at: "09:00" }, now), at(2026, 11, 25, 9));
	assert.equal(lastScheduledTime({ type: "schedule", every: "daily", at: "11:00" }, now), at(2026, 11, 24, 11));
	assert.equal(lastScheduledTime({ type: "schedule", every: "hourly", at: "00:15" }, now), at(2026, 11, 25, 10, 15));
	assert.equal(lastScheduledTime({ type: "schedule", every: "hourly", at: "00:45" }, now), at(2026, 11, 25, 9, 45));
	assert.equal(lastScheduledTime({ type: "schedule", every: "weekly", at: "08:00", day: 1 }, now), at(2026, 11, 23, 8), "last Monday");
	// Sunday 29 Nov: the last weekday slot is Friday.
	assert.equal(lastScheduledTime({ type: "schedule", every: "weekdays", at: "09:00" }, at(2026, 11, 29, 12)), at(2026, 11, 27, 9));
});

test("a schedule is due once per slot, and never for slots before it was created", () => {
	const trigger = { type: "schedule" as const, every: "daily" as const, at: "09:00" };
	const created = at(2026, 11, 25, 10);
	assert.equal(scheduleIsDue({ trigger, createdAt: created, lastRunAt: null }, at(2026, 11, 25, 11)), false, "today's 09:00 was before it existed");
	assert.equal(scheduleIsDue({ trigger, createdAt: created, lastRunAt: null }, at(2026, 11, 26, 9, 1)), true);
	assert.equal(scheduleIsDue({ trigger, createdAt: created, lastRunAt: at(2026, 11, 26, 9, 1) }, at(2026, 11, 26, 17)), false);
});

test("automations are validated and stored per project", () => {
	assert.throws(() => validateAutomation({ name: "", prompt: "x", trigger: { type: "schedule", every: "daily", at: "09:00" } }), /name/);
	assert.throws(() => validateAutomation({ name: "a", prompt: "x", trigger: { type: "schedule", every: "daily", at: "25:00" } }), /time/);
	assert.throws(() => validateAutomation({ name: "a", prompt: "x", trigger: { type: "issue-label", label: "" } }), /label/);
	const dir = mkdtempSync(join(tmpdir(), "ade-automations-"));
	try {
		const store = new AutomationStore(dir);
		const item = store.create("p1", { name: "Triage", prompt: "Fix {{issue}}", agent: "codex", trigger: { type: "issue-label", label: "agent" } }, [3]);
		store.recordRun(item.id, { at: 1, sessionId: "s1", reason: "Issue #7" }, 7);
		const reloaded = new AutomationStore(dir).get(item.id);
		assert.deepEqual(reloaded.seenIssues, [3, 7]);
		assert.equal(reloaded.runs[0].sessionId, "s1");
		store.update(item.id, { trigger: { type: "issue-label", label: "ai" } });
		assert.deepEqual(store.get(item.id).seenIssues, [], "a new label starts fresh");
		assert.equal(store.forProject("p2").length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the runner starts due schedules and new labelled issues as sessions, never overlapping", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-automation-runner-"));
	try {
		let now = at(2026, 11, 25, 8, 0);
		const store = new AutomationStore(dir);
		const daily = store.create("p1", { name: "Deps", prompt: "Update dependencies", agent: "codex", trigger: { type: "schedule", every: "daily", at: "09:00" } });
		daily.createdAt = now;
		const triage = store.create("p1", { name: "Triage", prompt: "Fix this: {{issue}}", agent: "pi", trigger: { type: "issue-label", label: "agent" } }, [1]);
		const created: Array<Record<string, unknown>> = [];
		const sent: Array<[string, string]> = [];
		const engines: Array<[string, string]> = [];
		const working = new Set<string>();
		const runner = createAutomationRunner({
			store,
			now: () => now,
			projects: () => [{ id: "p1", repository: "/repo", githubUrl: "https://github.com/acme/app" }],
			sessions: () => created.map(input => ({ id: String(input.id), mode: "coding", label: String(input.title), status: working.has(String(input.id)) ? "working" : "idle" }) as never),
			createSession: async input => { created.push(input); return { id: String(input.id), workspace: { status: "ready" } } as never; },
			setEngine: (id, engine) => engines.push([id, engine]),
			prepareWorktree: () => undefined,
			sendToAgent: async (id, content) => { sent.push([id, content]); working.add(id); },
			listLabelledIssues: async () => [{ number: 1, title: "Old", body: "", url: "https://github.com/acme/app/issues/1" }, { number: 2, title: "Crash on save", body: "Stack trace", url: "https://github.com/acme/app/issues/2" }],
		});

		await runner.tick();
		assert.equal(created.length, 1, "only the new labelled issue (#2) runs; #1 was already labelled");
		assert.match(String(created[0].title), /Triage: #2 Crash on save/);
		assert.equal((created[0].githubIssue as { number: number }).number, 2);
		assert.match(sent[0][1], /Fix this: #2: Crash on save\nhttps:\/\/github.com\/acme\/app\/issues\/2\n\nStack trace/);

		now = at(2026, 11, 25, 9, 1);
		await runner.tick();
		assert.equal(created.length, 2, "the daily schedule fires at 09:00");
		assert.deepEqual(engines, [[String(created[1].id), "codex"]]);
		now = at(2026, 11, 26, 9, 1);
		await runner.tick();
		assert.equal(created.length, 2, "yesterday's run is still working, so today's waits");
		working.clear();
		await runner.tick();
		assert.equal(created.length, 3);
		assert.equal(store.get(daily.id).runs.length, 2);
		assert.equal(store.get(triage.id).runs[0].reason, "Issue #2 labelled agent");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
