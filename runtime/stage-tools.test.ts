import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_BLUEPRINTS } from "@ade/blueprints";
import { allowedStageTools, stageToolBlock } from "./stage-tools.ts";

test("groups turn into real tools; looking around and the team are always there", () => {
	const review = { name: "Review", allowedToolGroups: ["repo-read", "diff-read", "artifacts"] };
	const tools = allowedStageTools(review);
	for (const tool of ["read", "grep_search", "finish_stage", "team_post", "spawn_subagent", "write_artifact"]) assert.ok(tools.has(tool), tool);
	for (const tool of ["write", "edit", "run_command", "browser_click"]) assert.ok(!tools.has(tool), tool);
});

test("a stage with checks may edit, so a failing check can be fixed", () => {
	assert.ok(allowedStageTools({ allowedToolGroups: ["shell", "browser"], deterministicChecks: ["test"] }).has("write"));
	assert.ok(!allowedStageTools({ allowedToolGroups: ["shell", "browser"] }).has("write"));
});

test("a document stage writes only in its document's folder", () => {
	const stage = { name: "Specify", allowedToolGroups: ["repo-read", "artifacts"] };
	assert.equal(stageToolBlock(stage, "write", { path: "specs/x/spec.md" }, "specs/x/spec.md", "/repo"), null);
	assert.equal(stageToolBlock(stage, "edit", { path: "/repo/specs/x/notes.md" }, "specs/x/spec.md", "/repo"), null);
	assert.match(stageToolBlock(stage, "write", { path: "src/app.ts" }, "specs/x/spec.md", "/repo") ?? "", /only write in specs\/x\//);
	assert.match(stageToolBlock(stage, "write", { path: "specs/x/../../src/app.ts" }, "specs/x/spec.md", "/repo") ?? "", /Not allowed/);
	assert.match(stageToolBlock(stage, "write", { path: "specs/x" }, "specs/x/spec.md", "/repo") ?? "", /Not allowed/, "the folder itself is not a file");
	assert.match(stageToolBlock({ name: "Triage", allowedToolGroups: ["repo-read"] }, "write", { path: "a.txt" }, null, "/repo") ?? "", /Not allowed/);
});

test("every built-in stage can do what its own instructions ask of it", () => {
	for (const blueprint of BUILTIN_BLUEPRINTS) {
		for (const stage of blueprint.stages) {
			const tools = allowedStageTools(stage);
			assert.ok(tools.has("finish_stage"), `${blueprint.id}/${stage.id} can finish`);
			if (stage.executor === "subagent" || stage.executor === "parallel_subagents") assert.ok(tools.has("spawn_subagent"), `${blueprint.id}/${stage.id} can start subagents`);
			if (stage.artifactPathPattern) assert.equal(stageToolBlock(stage, "write", { path: stage.artifactPathPattern.replace("{issue}", "i") }, stage.artifactPathPattern.replace("{issue}", "i"), "/repo"), null, `${blueprint.id}/${stage.id} can write its document`);
			if (stage.deterministicChecks?.length) assert.ok(tools.has("run_command") || stage.executor === "deterministic_hook", `${blueprint.id}/${stage.id} can run its checks`);
		}
	}
});
