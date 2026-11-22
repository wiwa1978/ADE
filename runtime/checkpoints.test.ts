import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCheckpoints } from "./checkpoints.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=ade@test", "-c", "user.name=ADE Test", ...args], { cwd, encoding: "utf8" }).trim();

test("checkpoints rewind files, new files, and commits, and a rewind can be undone", async () => {
	const repo = mkdtempSync(join(tmpdir(), "ade-checkpoints-"));
	try {
		git(repo, "init", "-b", "main");
		writeFileSync(join(repo, "a.txt"), "one\n");
		writeFileSync(join(repo, ".gitignore"), "ignored/\n");
		git(repo, "add", ".");
		git(repo, "commit", "-m", "init");
		writeFileSync(join(repo, "draft.txt"), "untracked before the turn\n");
		const startHead = git(repo, "rev-parse", "HEAD");
		const checkpoints = createCheckpoints();

		const first = await checkpoints.create("s1", repo, "Fix the bug");
		assert.ok(first);
		assert.equal(await checkpoints.create("s1", repo, "Nothing changed"), null, "identical state is not saved twice");
		assert.equal(git(repo, "status", "--porcelain"), "?? draft.txt", "the user's index and files are untouched");

		// The agent edits, creates, deletes, and commits.
		writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
		writeFileSync(join(repo, "new.txt"), "agent file\n");
		rmSync(join(repo, "draft.txt"));
		git(repo, "add", "-A");
		git(repo, "commit", "-m", "agent work");
		writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");

		const listed = await checkpoints.withChanges("s1", repo);
		assert.equal(listed.length, 1);
		assert.equal(listed[0].label, "Fix the bug");
		assert.equal(listed[0].filesChanged, 3);

		await checkpoints.restore("s1", repo, first.id);
		assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "one\n");
		assert.equal(existsSync(join(repo, "new.txt")), false);
		assert.equal(readFileSync(join(repo, "draft.txt"), "utf8"), "untracked before the turn\n");
		assert.equal(git(repo, "rev-parse", "HEAD"), startHead);

		// Restoring saved the pre-restore state, so the rewind itself can be undone.
		const after = await checkpoints.list("s1", repo);
		assert.equal(after.length, 2);
		assert.match(after[0].label, /^Before restoring/);
		await checkpoints.restore("s1", repo, after[0].id);
		assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "one\ntwo\nthree\n");
		assert.equal(existsSync(join(repo, "new.txt")), true);
		assert.notEqual(git(repo, "rev-parse", "HEAD"), startHead);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});
