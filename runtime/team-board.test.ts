import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TeamBoard } from "./team-board.ts";

function setup() {
	const dir = mkdtempSync(join(tmpdir(), "ade-team-"));
	let now = 1_000;
	const emitted: string[] = [];
	const board = new TeamBoard(dir, { emit: (type: string) => emitted.push(type) } as never, () => (now += 1000));
	const names = (party: string) => ({ lead: "lead", s1: "api", s2: "ui", user: "you" } as Record<string, string>)[party] ?? party;
	return { dir, board, emitted, names, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("tasks: added with dependencies, taken by one agent at a time, done unlocks what waits", () => {
	const t = setup();
	try {
		const T1 = t.board.addTask("s", "lead", { title: "Theme setting in the API" });
		const T2 = t.board.addTask("s", "lead", { title: "Toggle in Settings", dependsOn: [T1] });
		assert.deepEqual([T1, T2], ["T1", "T2"]);
		assert.throws(() => t.board.takeTask("s", "s2", T2), /waits for T1/);
		assert.match(t.board.takeTask("s", "s1", T1), /You have T1/);
		assert.throws(() => t.board.takeTask("s", "s2", T1), /in progress/, "only one agent gets a task");
		assert.throws(() => t.board.finishTask("s", "s2", T1, "x"), /isn't yours/);
		assert.match(t.board.finishTask("s", "s1", T1, "Added theme to preferences"), /T2 can start/);
		assert.match(t.board.takeTask("s", "s2", T2), /You have T2/);
		assert.match(t.board.describe("s", t.names), /T1 \[done\] Theme setting in the API · api\nT2 \[in progress\] Toggle in Settings · ui/);
		assert.match(t.board.reviewTask("s", "lead", "t1", "send_back", "Add a test"), /T1 is in progress/);
		assert.match(t.board.read("s", "s1", t.names), /T1 was sent back: Add a test/);
		assert.ok(t.emitted.every(type => type === "team.update"));
	} finally {
		t.cleanup();
	}
});

test("plans: a member submits, the lead or you approve or return, and the member hears about it", () => {
	const t = setup();
	try {
		t.board.setRequirePlans("s", true);
		t.board.addTask("s", "lead", { title: "Restore theme before first paint", owner: "s1" });
		assert.throws(() => t.board.takeTask("s", "s2", "T1"), /assigned to someone else/);
		assert.match(t.board.takeTask("s", "s1", "T1"), /Submit your plan/);
		assert.throws(() => t.board.finishTask("s", "s1", "T1", ""), /plan isn't approved/);
		t.board.submitPlan("s", "s1", "T1", "Move the boot script into <head>.");
		t.board.decidePlan("s", "user", "T1", "return", "Also handle the cookie fallback");
		assert.match(t.board.read("s", "s1", t.names), /returned: Also handle the cookie fallback/);
		t.board.submitPlan("s", "s1", "T1", "Boot script in <head>, cookie fallback.");
		t.board.decidePlan("s", "lead", "T1", "approve", "");
		assert.match(t.board.read("s", "s1", t.names), /approved/);
		t.board.finishTask("s", "s1", "T1", "done");
		const actions = t.board.state("s").events.filter(event => event.part === "plans").map(event => `${event.action}:${event.from}`);
		assert.deepEqual(actions, ["submit:s1", "notify:plans", "return:user", "verdict:plans", "submit:s1", "notify:plans", "approve:lead", "verdict:plans"]);
	} finally {
		t.cleanup();
	}
});

test("team board posts reach who they're for; claims refuse files another agent holds", () => {
	const t = setup();
	try {
		t.board.post("s", "s1", { text: "Is the theme per user or per device?", kind: "question", to: ["lead"] });
		t.board.post("s", "lead", { text: "Per user.", kind: "answer", re: 1 });
		assert.match(t.board.read("s", "lead", t.names), /#1 api \(question\): Is the theme per user/);
		assert.match(t.board.read("s", "s2", t.names), /#2 lead \(answer, re #1\): Per user/, "posts to all reach everyone");
		assert.match(t.board.read("s", "s2", t.names), /Nothing new/);

		assert.match(t.board.claim("s", "s1", ["src/boot.ts", "api/"], t.names), /Claimed: src\/boot\.ts, api/);
		assert.match(t.board.claim("s", "s2", ["src/boot.ts", "api/prefs.ts", "ui/Toggle.tsx"], t.names), /Claimed: ui\/Toggle\.tsx\. Refused: src\/boot\.ts \(held by api\); api\/prefs\.ts \(held by api\)/);
		assert.equal(t.board.holderOf("s", "s2", "api/x.ts"), "s1");
		t.board.release("s", "s1", null);
		assert.equal(t.board.holderOf("s", "s2", "api/x.ts"), null);
		const claims = t.board.state("s").events.filter(event => event.part === "claims").map(event => event.action);
		assert.deepEqual(claims, ["claim", "conflict", "conflict", "claim", "release"]);
	} finally {
		t.cleanup();
	}
});

test("state survives a restart; repeated reads fold into one event", () => {
	const t = setup();
	try {
		t.board.addTask("s", "lead", { title: "One" });
		for (let i = 0; i < 3; i++) {
			t.board.post("s", "lead", { text: `update ${i}` });
			t.board.read("s", "s1");
		}
		const reads = t.board.state("s").events.filter(event => event.action === "read");
		assert.equal(reads.length, 1);
		assert.equal(reads[0].count, 3);
		const again = new TeamBoard(t.dir);
		assert.equal(again.state("s").tasks[0].title, "One");
		assert.equal(again.state("s").posts.length, 3);
	} finally {
		t.cleanup();
	}
});
