import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sessionBranchName } from "./host.ts";
import { createSessionGit } from "./session-git.ts";
import { removeWorktree, restoreWorktree } from "./worktrees.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=ade@test", "-c", "user.name=ADE Test", ...args], { cwd, encoding: "utf8" });

/** A repository with a local bare "origin" and an ADE-style worktree on its own branch. */
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "ade-session-vcs-"));
	const origin = join(root, "origin.git");
	const repo = join(root, "repo");
	const worktrees = join(root, "worktrees");
	mkdirSync(origin);
	git(origin, "init", "--bare", "-b", "main");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	writeFileSync(join(repo, "a.txt"), "one\n");
	git(repo, "add", ".");
	git(repo, "commit", "-m", "init");
	git(repo, "remote", "add", "origin", origin);
	git(repo, "push", "-u", "origin", "main");
	const base = git(repo, "rev-parse", "HEAD").trim();
	mkdirSync(worktrees);
	const workspace = join(worktrees, "session-1");
	git(repo, "worktree", "add", "-b", "ade/test-session-1", workspace, base);
	return { root, origin, repo, worktrees, workspace, base, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("session branch names are readable, unique per session, and safe", () => {
	assert.equal(sessionBranchName("Fix the login redirect!", "1a2b3c4d-0000-4000-8000-000000000000"), "ade/fix-the-login-redirect-1a2b3c4d");
	assert.equal(sessionBranchName("   ", "abcdef12-0000-4000-8000-000000000000"), "ade/abcdef12");
	assert.match(sessionBranchName("Ünïcødé ~ weird: chars/../..", "abcdef12-0000-4000-8000-000000000000"), /^ade\/[a-z0-9-]+-abcdef12$/);
	assert.ok(sessionBranchName("x".repeat(200), "abcdef12-0000-4000-8000-000000000000").length < 60);
});

test("branch status, branch diff, and push work against the session's base", async () => {
	const f = fixture();
	try {
		const sessionGit = createSessionGit();
		let status = await sessionGit.status(f.workspace, f.base);
		assert.equal(status.branch, "ade/test-session-1");
		assert.equal(status.commitsAhead, 0);
		assert.equal(status.hasRemote, true);

		writeFileSync(join(f.workspace, "a.txt"), "one\ntwo\n");
		writeFileSync(join(f.workspace, "b.txt"), "new\n");
		git(f.workspace, "add", ".");
		git(f.workspace, "commit", "-m", "change");
		writeFileSync(join(f.workspace, "a.txt"), "one\ntwo\nthree\n");

		status = await sessionGit.status(f.workspace, f.base);
		assert.equal(status.commitsAhead, 1);
		assert.equal(status.unpushed, 1);
		assert.equal(status.uncommitted, 1);

		const diff = await sessionGit.branchDiffFiles(f.workspace, f.base);
		assert.deepEqual(diff.files.map(file => [file.path, file.status, file.additions]).sort(), [["a.txt", "modified", 2], ["b.txt", "added", 1]]);
		assert.match(await sessionGit.branchDiffFile(f.workspace, f.base, "a.txt"), /\+three/);
		await assert.rejects(sessionGit.branchDiffFile(f.workspace, f.base, "../outside.txt"), /outside/);

		await sessionGit.push(f.workspace);
		assert.match(git(f.origin, "branch"), /ade\/test-session-1/);
		status = await sessionGit.status(f.workspace, f.base);
		assert.equal(status.unpushed, 0);
		assert.equal(status.upstream, "origin/ade/test-session-1");
	} finally {
		f.cleanup();
	}
});

test("pull request input is validated before anything is pushed", async () => {
	const f = fixture();
	try {
		const calls: string[] = [];
		const sessionGit = createSessionGit(async (command, args, cwd) => {
			calls.push(`${command} ${args.join(" ")}`);
			return execFileSync(command, args, { cwd, encoding: "utf8" });
		});
		await assert.rejects(sessionGit.createPullRequest(f.workspace, { title: "  " }), /title/);
		assert.ok(!calls.some(call => call.includes(" push ")), "no push happens for an invalid title");
	} finally {
		f.cleanup();
	}
});

test("worktree removal only touches ADE worktrees, keeps the branch, and restore recreates it", async () => {
	const f = fixture();
	try {
		await assert.rejects(removeWorktree({ repository: f.repo, path: f.repo, allowedRoot: f.worktrees }), /Only worktrees created by ADE/);
		await removeWorktree({ repository: f.repo, path: f.workspace, allowedRoot: f.worktrees });
		assert.equal(existsSync(f.workspace), false);
		assert.match(git(f.repo, "branch", "--list", "ade/test-session-1"), /ade\/test-session-1/);
		await restoreWorktree({ repository: f.repo, path: f.workspace, branch: "ade/test-session-1", allowedRoot: f.worktrees });
		assert.equal(existsSync(join(f.workspace, "a.txt")), true);
		await assert.rejects(restoreWorktree({ repository: f.repo, path: f.workspace, branch: "ade/test-session-1", allowedRoot: f.worktrees }), /already exists/);
	} finally {
		f.cleanup();
	}
});
