import assert from "node:assert/strict";
import { test } from "node:test";
import { describeToolCall, replaySteps, transcriptMarkdown, type TranscriptItem } from "../packages/protocol/transcript.ts";

const items: TranscriptItem[] = [
	{ id: "u1", kind: "user", content: "Fix the login bug", createdAt: Date.UTC(2026, 10, 23, 9, 0, 0) },
	{
		id: "a1", kind: "assistant", thinking: "Look at auth first", text: "Fixed it.", createdAt: Date.UTC(2026, 10, 23, 9, 0, 5),
		toolCalls: [
			{ callId: "c1", name: "run_command", arguments: { command: "npm test -- auth" }, status: "done", output: "1 failing\n```nested```", isError: false },
			{ callId: "c2", name: "edit_files", arguments: { path: "src/auth.ts", edits: [{ old: "a", new: "b" }] }, status: "error", output: "", isError: true },
		],
	},
	{ id: "e1", kind: "error", message: "Rate limited", createdAt: Date.UTC(2026, 10, 23, 9, 1, 0) },
];

test("tool calls are summarized by their command or file", () => {
	assert.equal(describeToolCall({ name: "run_command", arguments: { command: "npm test\nmore" } }), "npm test");
	assert.equal(describeToolCall({ name: "edit_files", arguments: { path: "a.ts" } }), "a.ts");
	assert.equal(describeToolCall({ name: "x", arguments: {} }), "");
	assert.equal(describeToolCall({ name: "edit_files", arguments: { changes: [{ path: "a.ts" }, { path: "b.ts" }] } }), "a.ts, b.ts");
});

test("the Markdown transcript is readable and survives backticks in output", () => {
	const markdown = transcriptMarkdown(items, { title: "Login fix", project: "app", branch: "ade/login", agent: "Codex", exportedAt: 0 });
	assert.match(markdown, /^# Login fix\n\nProject: app · Branch: `ade\/login` · Agent: Codex/);
	assert.match(markdown, /## You · 09:00:00\n\nFix the login bug/);
	assert.match(markdown, /\*\*run_command\*\* `npm test -- auth`/);
	assert.match(markdown, /````\n1 failing\n```nested```\n````/, "a longer fence wraps output that contains backticks");
	assert.match(markdown, /\*\*edit_files\*\* `src\/auth.ts` — failed/);
	assert.match(markdown, /> \*\*Error:\*\* Rate limited/);
	assert.doesNotMatch(markdown, /Look at auth first/, "thinking is left out unless asked for");
	assert.match(transcriptMarkdown(items, { title: "x" }, { includeThinking: true }), /> Look at auth first/);
});

test("replay steps list every message and tool call in order", () => {
	const steps = replaySteps(items);
	assert.deepEqual(steps.map(step => step.kind), ["user", "tool", "tool", "reply", "note"]);
	assert.deepEqual(steps.map(step => step.index), [0, 1, 2, 3, 4]);
});
