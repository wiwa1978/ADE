import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentTask, listAgentTasks, syncClaimedAgentTask, transitionAgentTask } from "./agent-tasks.ts";

function repo() {
	return mkdtempSync(join(tmpdir(), "ade-tasks-"));
}

test("a task cannot start until depends_on are DONE, and a parent cannot finish with open children", () => {
	const root = repo();
	try {
		createAgentTask(root, { path: "auth", title: "Auth", status: "TODO" });
		createAgentTask(root, { path: "auth/login", title: "Login", dependsOn: ["auth"] });
		assert.equal(listAgentTasks(root).tasks.find(task => task.path === "auth/login")?.ready, false);
		assert.throws(() => transitionAgentTask(root, { path: "auth/login", status: "IN_PROGRESS", sessionId: "s1" }), /Start gate/);
		transitionAgentTask(root, { path: "auth", status: "IN_PROGRESS", sessionId: "parent" });
		assert.throws(() => transitionAgentTask(root, { path: "auth", status: "DONE" }), /child tasks still open/);
		transitionAgentTask(root, { path: "auth", status: "DONE" }).task;
	} catch (error) {
		if (!(error instanceof Error) || !/child tasks still open/.test(error.message)) throw error;
	}
	try {
		transitionAgentTask(root, { path: "auth", status: "DONE", sessionId: "parent" });
		assert.fail("parent should stay open");
	} catch (error) {
		assert.match(String(error), /child tasks still open/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("claim records the session, and pause, archive, and stage updates rewrite state.md", () => {
	const root = repo();
	try {
		createAgentTask(root, { path: "ship", title: "Ship" });
		const claimed = transitionAgentTask(root, { path: "ship", status: "IN_PROGRESS", sessionId: "sess-1" });
		assert.equal(claimed.task.claimedSession, "sess-1");
		assert.match(readFileSync(join(root, ".tasks/ship/task.md"), "utf8"), /claimed_session: sess-1/);
		const paused = syncClaimedAgentTask(root, "sess-1", "pause", "Stopped after the parser.");
		assert.equal(paused?.status, "PAUSED");
		assert.match(readFileSync(join(root, ".tasks/ship/state.md"), "utf8"), /Stopped after the parser/);
		assert.match(readFileSync(join(root, ".tasks/ship/task.md"), "utf8"), /status: PAUSED/);
		const stage = syncClaimedAgentTask(root, "sess-1", "stage", "Stage specify finished.");
		assert.equal(stage?.status, "PAUSED");
		assert.match(readFileSync(join(root, ".tasks/ship/state.md"), "utf8"), /Stage specify finished/);
		const archived = syncClaimedAgentTask(root, "sess-1", "archive", "Session archived.");
		assert.match(readFileSync(join(root, ".tasks/ship/task.md"), "utf8"), /claimed_session: sess-1/);
		assert.match(readFileSync(join(root, ".tasks/ship/state.md"), "utf8"), /Session archived/);
		assert.equal(archived?.claimedSession, "sess-1");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
