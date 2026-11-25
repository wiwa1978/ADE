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

test("swarm overview: goal, threads, live focus, and automatic thread status sync", () => {
	const t = setup();
	try {
		assert.match(t.board.setSwarmOverview("s", "lead", {
			title: "ADE Audit: Security, Zod & UI Refactor",
			goalTitle: "Harden security, Zod types, and modular UI",
			goalSummary: "Patch vulnerabilities, add Zod validation, optimize runtime, and modularize UI.",
		}), /Harden security/);
		const th1 = t.board.upsertThread("s", "lead", {
			title: "End-to-end Zod type safety",
			summary: "Every API boundary validates with Zod and strict TypeScript passes.",
		});
		assert.equal(th1, "TH1");
		const task1 = t.board.addTask("s", "lead", { title: "Add Zod schemas", owner: "s1", threadId: th1 });
		assert.equal(t.board.state("s").tasks[0].threadId, "TH1");

		t.board.takeTask("s", "s1", task1);
		assert.equal(t.board.state("s").threads[0].status, "moving");

		t.board.setFocus("s", "s1", "Check MobilePairingManager constructor signature");
		assert.equal(t.board.state("s").focus.s1.text, "Check MobilePairingManager constructor signature");
		assert.equal(t.board.state("s").threads[0].focus, "Check MobilePairingManager constructor signature");
		assert.match(t.board.describeOverview("s"), /End-to-end Zod type safety \(0\/1\) · Now: Check MobilePairingManager/);

		t.board.finishTask("s", "s1", task1, "Zod schemas added");
		assert.equal(t.board.state("s").threads[0].status, "done");

		t.board.reviewTask("s", "lead", task1, "send_back", "Add missing route validator");
		assert.equal(t.board.state("s").threads[0].status, "moving");

		const reloaded = new TeamBoard(t.dir);
		assert.equal(reloaded.state("s").title, "ADE Audit: Security, Zod & UI Refactor");
		assert.equal(reloaded.state("s").goal?.title, "Harden security, Zod types, and modular UI");
		assert.equal(reloaded.state("s").threads.length, 1);
	} finally {
		t.cleanup();
	}
});

test("a runaway agent can't grow the board without limit, and a chosen thread id never collides with a made one", () => {
	const board = new TeamBoard(mkdtempSync(join(tmpdir(), "ade-board-limits-")));
	// A chosen id TH2 is taken before the generated ones reach it.
	const first = board.upsertThread("s1", "lead", { title: "One", id: "TH2" });
	assert.equal(first, "TH2");
	const second = board.upsertThread("s1", "lead", { title: "Two" });
	const third = board.upsertThread("s1", "lead", { title: "Three" });
	assert.deepEqual([second, third], ["TH1", "TH3"], "TH2 is skipped, not reused");
	assert.equal(new Set(board.state("s1").threads.map(thread => thread.id)).size, 3);
	for (let i = 0; i < 47; i++) board.upsertThread("s1", "lead", { title: `T${i}` });
	assert.throws(() => board.upsertThread("s1", "lead", { title: "one too many" }), /already 50 threads/);
	for (let i = 0; i < 500; i++) board.addTask("s1", "lead", { title: `task ${i}` });
	assert.throws(() => board.addTask("s1", "lead", { title: "one too many" }), /task board is full/);
	for (let i = 0; i < 1005; i++) board.post("s1", "lead", { text: `post ${i}` });
	const posts = board.state("s1").posts;
	assert.equal(posts.length, 1000);
	assert.equal(posts.at(-1)?.text, "post 1004", "the newest posts are kept");
	board.post("s1", "lead", { text: "odd kind", kind: "<script>" as never });
	assert.equal(board.state("s1").posts.at(-1)?.kind, "update", "an unknown kind becomes a plain update");
});

test("a stalled claim returns the task to todo and a late write is claim_lost", () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-lease-"));
	let now = 1_000_000;
	const board = new TeamBoard(dir, undefined, () => now);
	try {
		const id = board.addTask("s", "lead", { title: "Work" });
		const claim = board.claimTask("s", "s1", id, 10_000);
		assert.equal(board.state("s").tasks[0]?.status, "in_progress");
		assert.equal(board.state("s").tasks[0]?.leaseExpiresAt, now + 10_000);
		now += 10_001;
		assert.throws(() => board.finishTask("s", "s1", id, "late", claim.claimToken), /claim_lost/);
		assert.equal(board.state("s").tasks[0]?.status, "todo");
		assert.equal(board.state("s").tasks[0]?.owner, null);
		const again = board.claimTask("s", "s2", id, 10_000);
		assert.throws(() => board.finishTask("s", "s2", id, "nope", "stale-token"), /claim_lost/);
		assert.match(board.finishTask("s", "s2", id, "ok", again.claimToken), /Done/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("project boards are separate from session boards and posts carry a channel", () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-channel-"));
	const board = new TeamBoard(dir);
	try {
		board.post("s", "lead", { text: "session note", channel: "#General" });
		board.post("project:alpha", "lead", { text: "project note", channel: "ops" });
		assert.equal(board.posts("s", "general").length, 1);
		assert.equal(board.posts("s", "ops").length, 0);
		assert.equal(board.posts("project:alpha", "ops")[0]?.text, "project note");
		assert.equal(board.state("s").posts.length, 1);
		assert.notEqual(board.state("s").title, board.state("project:alpha").posts[0]?.text);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
