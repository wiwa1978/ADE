import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	getWorkspaceFileDiff,
	getWorkspaceGitSummary,
	gitCommitChanges,
	gitDiscardFile,
	gitStageFiles,
	gitUnstageFiles,
	listWorkspaceDirectory,
	readWorkspaceFile,
	writeWorkspaceFile,
} from "./workspace-files.ts";

function createTempRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "ade-ws-files-"));
	execFileSync("git", ["init", "-b", "main"], { cwd: dir });
	// Windows checkouts turn \n into \r\n by default; these tests are about content, not line endings.
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "ade-test@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "ADE Test"], { cwd: dir });
	writeFileSync(join(dir, "hello.txt"), "line 1\nline 2\n", "utf8");
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync("git", ["commit", "-m", "initial"], { cwd: dir });
	return dir;
}

test("workspace-files supports git stage, unstage, diff, discard, and commit in a temporary repo", async () => {
	const repo = createTempRepo();
	try {
		// Clean initial state
		const initial = await getWorkspaceGitSummary(repo);
		assert.equal(initial.isGitRepo, true);
		assert.equal(initial.branch, "main");
		assert.equal(initial.files.length, 0);

		// Modify tracked file and add a new untracked file
		writeWorkspaceFile(repo, "hello.txt", "line 1\nline 2 edited\nline 3\n");
		writeWorkspaceFile(repo, "notes.md", "# Notes\n");

		const dirty = await getWorkspaceGitSummary(repo);
		assert.equal(dirty.files.length, 2);
		const helloEntry = dirty.files.find((f) => f.path === "hello.txt");
		assert.ok(helloEntry);
		assert.equal(helloEntry.unstaged, true);
		assert.equal(helloEntry.staged, false);

		// Unstaged diff shows the edit
		const unstagedDiff = await getWorkspaceFileDiff(repo, "hello.txt", false);
		assert.match(unstagedDiff, /\+line 2 edited/);

		// Stage hello.txt, verify staged diff, then unstage it
		await gitStageFiles(repo, ["hello.txt"]);
		const afterStage = await getWorkspaceGitSummary(repo);
		assert.equal(afterStage.files.find((f) => f.path === "hello.txt")?.staged, true);
		const stagedDiff = await getWorkspaceFileDiff(repo, "hello.txt", true);
		assert.match(stagedDiff, /\+line 2 edited/);

		await gitUnstageFiles(repo, ["hello.txt"]);
		const afterUnstage = await getWorkspaceGitSummary(repo);
		assert.equal(afterUnstage.files.find((f) => f.path === "hello.txt")?.staged, false);

		// Discard tracked edit restores original content
		await gitDiscardFile(repo, "hello.txt");
		assert.equal(readWorkspaceFile(repo, "hello.txt").content, "line 1\nline 2\n");

		// Stage all and commit notes.md
		await gitStageFiles(repo, ["notes.md"]);
		const commit = await gitCommitChanges(repo, "Add notes");
		assert.ok(commit.hash.length >= 7);
		const clean = await getWorkspaceGitSummary(repo);
		assert.equal(clean.files.length, 0);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("workspace-files rejects path traversal and symlinks escaping the workspace root", async () => {
	const repo = createTempRepo();
	const outsideDir = mkdtempSync(join(tmpdir(), "ade-ws-outside-"));
	const outsideFile = join(outsideDir, "secret.txt");
	writeFileSync(outsideFile, "top-secret\n", "utf8");
	symlinkSync(outsideFile, join(repo, "escape-link.txt"));
	symlinkSync(outsideDir, join(repo, "escape-dir"));

	try {
		// Direct path traversal
		assert.throws(() => readWorkspaceFile(repo, "../secret.txt"), /outside the task workspace/i);
		assert.throws(() => writeWorkspaceFile(repo, "../pwn.txt", "bad"), /outside the task workspace/i);
		assert.throws(() => listWorkspaceDirectory(repo, ".."), /outside the task workspace/i);
		await assert.rejects(() => gitStageFiles(repo, ["../secret.txt"]), /outside the task workspace/i);
		await assert.rejects(() => gitUnstageFiles(repo, ["../secret.txt"]), /outside the task workspace/i);
		await assert.rejects(() => gitDiscardFile(repo, "../secret.txt"), /outside the task workspace/i);
		await assert.rejects(() => getWorkspaceFileDiff(repo, "../secret.txt", false), /outside the task workspace/i);

		// Symlink escaping the workspace
		assert.throws(() => readWorkspaceFile(repo, "escape-link.txt"), /outside the task workspace|symbolic link/i);
		assert.throws(() => writeWorkspaceFile(repo, "escape-link.txt", "overwrite"), /outside the task workspace|symbolic link/i);
		assert.throws(() => writeWorkspaceFile(repo, "escape-dir/new.txt", "overwrite"), /outside the task workspace|symbolic link/i);
		assert.throws(() => listWorkspaceDirectory(repo, "escape-dir"), /outside the task workspace|symbolic link/i);

		// Verify outside file was never touched
		assert.equal(readFileSync(outsideFile, "utf8"), "top-secret\n");
	} finally {
		rmSync(repo, { recursive: true, force: true });
		rmSync(outsideDir, { recursive: true, force: true });
	}
});
