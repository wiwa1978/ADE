import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBoardArgs } from "./ade-board.ts";

test("ade board parses read, post, claim, complete, and wait", () => {
	assert.equal(parseBoardArgs(["read", "--session", "s1", "--channel", "ops"]).board, "s1");
	assert.equal(parseBoardArgs(["post", "--project", "alpha", "--text", "hi"]).board, "project:alpha");
	assert.equal(parseBoardArgs(["task", "claim", "--session", "s1", "--id", "T1", "--as", "bee"]).action, "claim");
	const done = parseBoardArgs(["task", "complete", "--session", "s1", "--id", "T1", "--token", "abc", "--result", "shipped"]);
	assert.equal(done.action, "complete");
	assert.equal(done.token, "abc");
	assert.equal(parseBoardArgs(["wait", "--session", "s1", "--after", "4", "--timeout", "1000"]).after, 4);
	assert.throws(() => parseBoardArgs(["read"]), /--session or --project/);
	assert.throws(() => parseBoardArgs(["read", "--session", "s", "--project", "p"]), /either/);
});

test("ade board refuses a runtime that is not on this machine", async () => {
	const { runBoard } = await import("./ade-board.ts");
	process.env.ADE_RUNTIME_URL = "http://example.com:4319";
	try {
		await assert.rejects(() => runBoard(["read", "--session", "s1"]), /only talks to a runtime on this machine/);
	} finally {
		delete process.env.ADE_RUNTIME_URL;
	}
});
