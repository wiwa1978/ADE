import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LimitGuard, type LimitStop } from "./limits.ts";

function setup() {
	const dir = mkdtempSync(join(tmpdir(), "ade-limits-"));
	let now = 1_000_000;
	const spent: Record<string, number> = {};
	let today = 0;
	const stopped: string[] = [];
	const notified: LimitStop[] = [];
	const guard = new LimitGuard(dir, {
		sessionCost: id => spent[id] ?? 0,
		todayCost: () => today,
		stop: id => stopped.push(id),
		notify: (_id, stop) => notified.push(stop),
		now: () => now,
	});
	return {
		dir, guard, stopped, notified,
		advance: (minutes: number) => { now += minutes * 60_000; },
		spend: (id: string, cost: number) => { spent[id] = (spent[id] ?? 0) + cost; today += cost; },
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("no limits by default: nothing is ever stopped", () => {
	const t = setup();
	try {
		t.guard.started("s1");
		t.advance(600);
		t.spend("s1", 500);
		t.guard.check();
		assert.deepEqual(t.stopped, []);
	} finally {
		t.cleanup();
	}
});

test("a task is stopped when it runs too long or costs too much, counting only this run", () => {
	const t = setup();
	try {
		t.guard.set({ taskMinutes: 60, taskCost: 2 });
		t.spend("s1", 10); // earlier work in the session doesn't count against this run
		t.guard.started("s1");
		t.spend("s1", 1.5);
		t.advance(30);
		t.guard.check();
		assert.deepEqual(t.stopped, []);
		t.spend("s1", 0.6);
		t.guard.check("s1");
		assert.deepEqual(t.stopped, ["s1"]);
		assert.equal(t.guard.stopped("s1")?.kind, "cost");
		assert.match(t.notified[0].reason, /\$2\.10 for this task \(limit \$2\.00\)/);

		t.guard.started("s2");
		t.advance(61);
		t.guard.check();
		assert.deepEqual(t.stopped, ["s1", "s2"]);
		assert.equal(t.guard.stopped("s2")?.kind, "time");
		t.guard.started("s2");
		assert.equal(t.guard.stopped("s2"), null, "running again clears the stop");
	} finally {
		t.cleanup();
	}
});

test("the daily budget stops running agents and refuses new work", () => {
	const t = setup();
	try {
		t.guard.set({ dayCost: 5 });
		t.guard.started("a");
		t.guard.started("b");
		t.guard.assertCanStart();
		t.spend("a", 3);
		t.spend("b", 2.5);
		t.guard.check();
		assert.deepEqual(t.stopped.sort(), ["a", "b"]);
		assert.throws(() => t.guard.assertCanStart(), /Today's limit of \$5\.00/);
		assert.deepEqual(new LimitGuard(t.dir, { sessionCost: () => 0, todayCost: () => 0, stop: () => undefined, notify: () => undefined }).get(), { taskMinutes: 0, taskCost: 0, dayCost: 5, fallbackProvider: "", fallbackModel: "", maxSubagents: 0 }, "limits are saved");
		assert.throws(() => t.guard.set({ taskMinutes: -1 }), /between 0/);
	} finally {
		t.cleanup();
	}
});
