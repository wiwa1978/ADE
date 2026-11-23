import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { engineArgs, gitWritableDirs } from "./engines.ts";
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
		// A new file the agent hasn't committed yet counts as an added file.
		writeFileSync(join(f.workspace, "new.txt"), "hello\nworld\n");
		const withNew = await sessionGit.branchDiffFiles(f.workspace, f.base);
		assert.deepEqual(withNew.files.find(file => file.path === "new.txt"), { path: "new.txt", additions: 2, deletions: 0, status: "added" });
		assert.match(await sessionGit.branchDiffFile(f.workspace, f.base, "new.txt"), /@@ -0,0 \+1,2 @@\n\+hello\n\+world/);
		rmSync(join(f.workspace, "new.txt"));

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

test("update from base: behind count, clean merge, conflicts and abort", async () => {
	const f = fixture();
	try {
		const sessionGit = createSessionGit();
		// New work lands on main and is pushed while the session works on its branch.
		writeFileSync(join(f.repo, "c.txt"), "from main\n");
		git(f.repo, "add", ".");
		git(f.repo, "commit", "-m", "main work");
		git(f.repo, "push", "origin", "main");
		git(f.workspace, "config", "user.email", "ade@test");
		git(f.workspace, "config", "user.name", "ADE Test");
		assert.equal(await sessionGit.fetchBase(f.workspace), true);
		let status = await sessionGit.status(f.workspace, f.base);
		assert.equal(status.baseRef, "origin/main");
		assert.equal(status.behindBase, 1);

		let update = await sessionGit.updateFromBase(f.workspace);
		assert.equal(update.result, "updated");
		status = await sessionGit.status(f.workspace, f.base);
		assert.equal(status.behindBase, 0);
		assert.equal((await sessionGit.updateFromBase(f.workspace)).result, "up-to-date");

		// Both sides change the same line: the merge stops on a conflict.
		writeFileSync(join(f.repo, "a.txt"), "main says hi\n");
		git(f.repo, "commit", "-am", "main edit");
		git(f.repo, "push", "origin", "main");
		writeFileSync(join(f.workspace, "a.txt"), "branch says hi\n");
		git(f.workspace, "commit", "-am", "branch edit");
		writeFileSync(join(f.workspace, "a.txt"), "dirty\n");
		await assert.rejects(sessionGit.updateFromBase(f.workspace), /uncommitted/);
		git(f.workspace, "checkout", "--", "a.txt");
		update = await sessionGit.updateFromBase(f.workspace);
		assert.equal(update.result, "conflicts");
		assert.deepEqual(update.conflicts, ["a.txt"]);
		status = await sessionGit.status(f.workspace, f.base);
		assert.equal(status.mergeInProgress, true);
		assert.deepEqual(status.conflicts, ["a.txt"]);
		await assert.rejects(sessionGit.updateFromBase(f.workspace), /already in progress/);
		await assert.rejects(sessionGit.finishMerge(f.workspace), /Conflict markers are still in a\.txt/);
		await sessionGit.abortMerge(f.workspace);
		status = await sessionGit.status(f.workspace, f.base);
		assert.equal(status.mergeInProgress, false);
		assert.equal(status.behindBase, 1);

		// Resolve by hand (as an agent would), then finish the update from ADE.
		await sessionGit.updateFromBase(f.workspace);
		writeFileSync(join(f.workspace, "a.txt"), "branch says hi\nmain says hi\n");
		await sessionGit.finishMerge(f.workspace);
		status = await sessionGit.status(f.workspace, f.base);
		assert.equal(status.mergeInProgress, false);
		assert.equal(status.behindBase, 0);
		assert.equal(status.uncommitted, 0);
	} finally {
		f.cleanup();
	}
});

test("review feedback and failed CI runs are read through gh", async () => {
	const f = fixture();
	try {
		const head = git(f.workspace, "rev-parse", "HEAD").trim();
		const sessionGit = createSessionGit(async (command, args, cwd) => {
			if (command === "git") return execFileSync("git", args, { cwd, encoding: "utf8" });
			const call = args.join(" ");
			if (call.startsWith("pr view")) return JSON.stringify({
				number: 7,
				url: "https://github.com/acme/app/pull/7",
				reviews: [{ author: { login: "rev" }, state: "CHANGES_REQUESTED", body: "Please add tests", submittedAt: "2026-01-01" }, { author: { login: "rev" }, state: "APPROVED", body: "" }],
				comments: [{ author: { login: "pm" }, body: "Can we rename this?", createdAt: "2026-01-02" }],
			});
			if (call.startsWith("api graphql")) {
				assert.ok(args.includes("owner=acme") && args.includes("name=app") && args.includes("number=7"));
				return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [
					{ id: "T1", isResolved: false, isOutdated: false, path: "a.txt", line: 3, comments: { nodes: [{ author: { login: "rev" }, body: "Off by one", createdAt: "x" }, { author: { login: "me" }, body: "Will fix", createdAt: "y" }] } },
					{ id: "T2", isResolved: true, isOutdated: false, path: "b.txt", line: null, originalLine: 9, comments: { nodes: [{ author: { login: "rev" }, body: "Done", createdAt: "z" }] } },
				] } } } } });
			}
			if (call.startsWith("run list")) return JSON.stringify([
				{ databaseId: 1, workflowName: "CI", conclusion: "failure", headSha: head, url: "u1" },
				{ databaseId: 2, workflowName: "Lint", conclusion: "success", headSha: head, url: "u2" },
				{ databaseId: 3, workflowName: "CI", conclusion: "failure", headSha: "old", url: "u3" },
			]);
			if (call.startsWith("run view 1")) return "build\tTest\t2026-01-01T00:00:00.0000000Z \u001b[31mFAIL\u001b[0m expected 2 got 3\n";
			throw new Error(`unexpected ${call}`);
		});
		const feedback = await sessionGit.reviewFeedback(f.workspace);
		assert.equal(feedback?.number, 7);
		assert.deepEqual(feedback?.items.map(item => [item.kind, item.author, item.path ?? null, item.line ?? null, item.resolved ?? null]), [
			["thread", "rev", "a.txt", 3, false],
			["thread", "rev", "b.txt", 9, true],
			["review", "rev", null, null, null],
			["comment", "pm", null, null, null],
		]);
		assert.equal(feedback?.items[0].replies?.[0].body, "Will fix");
		const runs = await sessionGit.failedRuns(f.workspace);
		assert.deepEqual(runs.map(run => [run.id, run.name, run.log]), [[1, "CI", "FAIL expected 2 got 3"]]);
	} finally {
		f.cleanup();
	}
});

test("sandboxed agents may write the worktree's Git metadata in the main repository", () => {
	const f = fixture();
	try {
		const dirs = gitWritableDirs(f.workspace);
		assert.equal(dirs.length, 1);
		assert.equal(realpathSync(dirs[0]), realpathSync(join(f.repo, ".git")));
		assert.deepEqual(gitWritableDirs(f.repo), [], "a normal checkout needs nothing extra");
		const args = engineArgs("codex", "hi", null, "auto-safe", null, dirs);
		assert.deepEqual(args.slice(args.indexOf("--add-dir"), args.indexOf("--add-dir") + 2), ["--add-dir", dirs[0]]);
		assert.ok(!engineArgs("codex", "hi", null, "ask", null, dirs).includes("--add-dir"), "read-only sessions stay read-only");
	} finally {
		f.cleanup();
	}
});
