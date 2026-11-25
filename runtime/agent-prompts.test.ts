import assert from "node:assert/strict";
import { test } from "node:test";
import { fixCiPrompt, resolveConflictsPrompt, reviewFeedbackPrompt } from "@ade/protocol/agent-prompts.ts";

test("review feedback prompt lists each point with its location and replies", () => {
	const prompt = reviewFeedbackPrompt([
		{ kind: "thread", author: "rev", body: "Off by one", path: "src/a.ts", line: 3, replies: [{ author: "me", body: "Will fix" }] },
		{ kind: "review", author: "rev", body: "Please add tests" },
		{ kind: "note", body: "Rename this", path: "src/b.ts", line: 10 },
	], 7);
	assert.match(prompt, /pull request #7/);
	assert.match(prompt, /1\. src\/a\.ts:3 \(rev\)\n {3}Off by one\n {3}↳ me: Will fix/);
	assert.match(prompt, /2\. Review \(rev\)/);
	assert.match(prompt, /3\. src\/b\.ts:10\n {3}Rename this/);
});

test("prompts stay under the message limit", () => {
	const many = Array.from({ length: 40 }, (_, index) => ({ kind: "comment" as const, author: "a", body: "x".repeat(1400) + index }));
	const prompt = reviewFeedbackPrompt(many);
	assert.ok(prompt.length < 8000);
	assert.match(prompt, /left out/);
	assert.ok(fixCiPrompt([{ name: "CI", url: "", log: "y".repeat(20000) }]).length < 8000);
});

test("CI and conflict prompts", () => {
	assert.match(fixCiPrompt([{ name: "CI", url: "https://x", log: "FAIL" }]), /### CI \(https:\/\/x\)\n```\nFAIL\n```/);
	assert.match(fixCiPrompt([], ["buildkite"]), /buildkite/);
	const conflicts = resolveConflictsPrompt("origin/main", ["a.txt", "b.txt"]);
	assert.match(conflicts, /merged origin\/main .* 2 files:\n\n- a\.txt\n- b\.txt/);
	assert.match(conflicts, /git commit --no-edit/);
});
