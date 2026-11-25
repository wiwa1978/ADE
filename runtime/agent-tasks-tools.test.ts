import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentTask } from "./agent-tasks.ts";
import { runAgentTaskCommand } from "./agent-tasks-tools.ts";

test("agent_tasks lists a repo task and refuses to start it while a dependency is open", () => {
	const root = mkdtempSync(join(tmpdir(), "ade-agent-tasks-tool-"));
	try {
		createAgentTask(root, { path: "base", title: "Base" });
		createAgentTask(root, { path: "next", title: "Next", dependsOn: ["base"] });
		assert.match(runAgentTaskCommand(root, "s1", { action: "list" }), /next \[TODO\]/);
		assert.throws(() => runAgentTaskCommand(root, "s1", { action: "status", path: "next", status: "IN_PROGRESS" }), /Start gate/);
		assert.match(runAgentTaskCommand(root, "s1", { action: "status", path: "base", status: "IN_PROGRESS" }), /base is IN_PROGRESS/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
