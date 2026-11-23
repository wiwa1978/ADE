import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mergeSubagentBranch, subagentChanges, subagentFileDiff } from "./subagent-work.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function repo() {
	const root = mkdtempSync(join(tmpdir(), "ade-subwork-"));
	const main = join(root, "session");
	git(root, "init", "-q", "-b", "main", main);
	for (const [key, value] of [["user.name", "ADE"], ["user.email", "ade@example.invalid"], ["commit.gpgsign", "false"]]) git(main, "config", key, value);
	writeFileSync(join(main, "app.ts"), "export const a = 1;\n");
	git(main, "add", "."); git(main, "commit", "-qm", "start");
	git(main, "switch", "-qc", "ade/session");
	const sub = join(root, "sub");
	git(main, "worktree", "add", "-q", "-b", "ade/sub-1", sub);
	return { root, main, sub, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("a worktree subagent's changes: its commits, uncommitted edits and new files, against where it started", async () => {
	const r = repo();
	try {
		writeFileSync(join(r.sub, "app.ts"), "export const a = 2;\nexport const b = 3;\n");
		git(r.sub, "commit", "-qam", "edit");
		writeFileSync(join(r.sub, "new.ts"), "one\ntwo\n");
		// The session moving on doesn't count as the subagent's work.
		writeFileSync(join(r.main, "other.ts"), "x\n");
		git(r.main, "add", "."); git(r.main, "commit", "-qm", "session work");

		const changes = await subagentChanges(r.sub, "ade/session");
		assert.equal(changes.commits, 1);
		assert.deepEqual(changes.files.map(file => [file.path, file.status, file.added, file.removed]).sort(), [["app.ts", "modified", 2, 1], ["new.ts", "added", 2, 0]]);
		assert.equal(changes.added, 4);
		assert.match(await subagentFileDiff(r.sub, "ade/session", "app.ts"), /\+export const b = 3;/);
		assert.match(await subagentFileDiff(r.sub, "ade/session", "new.ts"), /\+one/);
		await assert.rejects(subagentFileDiff(r.sub, "ade/session", "--output=x"), /Choose a file/);

		const merged = await mergeSubagentBranch(r.main, r.sub, "ade/sub-1", "Researcher");
		assert.equal(merged.merged, true, merged.message);
		assert.match(git(r.main, "log", "--oneline", "-1"), /Merge Researcher/);
		assert.match(git(r.main, "show", "HEAD:new.ts"), /one/, "uncommitted work was committed on the subagent's branch first");
	} finally {
		r.cleanup();
	}
});

test("a conflicting merge is undone and explained", async () => {
	const r = repo();
	try {
		writeFileSync(join(r.sub, "app.ts"), "export const a = 'sub';\n");
		writeFileSync(join(r.main, "app.ts"), "export const a = 'session';\n");
		git(r.main, "commit", "-qam", "session edit");
		const result = await mergeSubagentBranch(r.main, r.sub, "ade/sub-1", "Builder");
		assert.equal(result.merged, false);
		assert.match(result.message, /conflicts in app\.ts[\s\S]*Nothing was changed/);
		assert.equal(git(r.main, "status", "--porcelain").trim(), "", "the session's branch is clean again");
	} finally {
		r.cleanup();
	}
});
