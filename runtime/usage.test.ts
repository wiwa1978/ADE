import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { UsageTracker } from "./usage.ts";

test("cumulative usage becomes per-session, per-project and per-day totals", () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-usage-"));
	let now = new Date(2026, 10, 20, 12).getTime();
	try {
		const usage = new UsageTracker(dir, () => now);
		usage.record("s1", "0", { inputTokens: 1000, outputTokens: 100, totalCost: 0.01 }, "p1");
		usage.record("s1", "0", { inputTokens: 1500, outputTokens: 150, totalCost: 0.015 }, "p1");
		usage.record("s1", "0", { inputTokens: 1500, outputTokens: 150, totalCost: 0.015 }, "p1"); // repeated snapshot: no change
		usage.record("s1", "sub-1", { inputTokens: 200, outputTokens: 20, totalCost: 0.002 }, "p1"); // a subagent adds its own
		now += 86_400_000;
		usage.record("s2", "0", { inputTokens: 300, outputTokens: 30 }, null); // no cost reported (e.g. Codex)
		usage.record("s2", "0", { inputTokens: 50, outputTokens: 5 }, null); // counter restarted
		usage.flush();

		const report = new UsageTracker(dir, () => now).report();
		assert.deepEqual(report.sessions.s1 && { i: report.sessions.s1.inputTokens, o: report.sessions.s1.outputTokens, c: report.sessions.s1.cost, p: report.sessions.s1.projectId }, { i: 1700, o: 170, c: 0.017, p: "p1" });
		assert.equal(report.sessions.s2.inputTokens, 350);
		assert.equal(report.month, "2026-11");
		assert.deepEqual(report.monthTotal, { inputTokens: 2050, outputTokens: 205, cost: 0.017 });
		assert.deepEqual(report.projects.map(item => item.projectId), ["p1", ""]);
		assert.equal(report.days.length, 30);
		assert.equal(report.days.at(-1)?.totals.inputTokens, 350);
		assert.equal(report.days.at(-2)?.totals.inputTokens, 1700);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
