import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createStartFrom, parseStartFrom } from "./start-from.ts";
import { WorktreeManager } from "./worktrees.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=ade@test", "-c", "user.name=ADE Test", ...args], { cwd, encoding: "utf8" });

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "ade-start-from-"));
	const origin = join(root, "origin.git");
	const repo = join(root, "repo");
	const other = join(root, "other");
	mkdirSync(origin);
	git(origin, "init", "--bare", "-b", "main");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	writeFileSync(join(repo, "a.txt"), "one\n");
	git(repo, "add", ".");
	git(repo, "commit", "-m", "init");
	git(repo, "remote", "add", "origin", origin);
	git(repo, "push", "-u", "origin", "main");
	const mainHead = git(repo, "rev-parse", "HEAD").trim();
	// A teammate pushes a feature branch that this checkout has never seen.
	git(root, "clone", "-q", origin, other);
	git(other, "checkout", "-b", "feature/login");
	writeFileSync(join(other, "login.txt"), "login\n");
	git(other, "add", ".");
	git(other, "commit", "-m", "login");
	git(other, "push", "-u", "origin", "feature/login");
	// And a local-only branch.
	git(repo, "branch", "local-work");
	return { root, repo, mainHead, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("startFrom input is validated", () => {
	assert.equal(parseStartFrom(undefined), null);
	assert.deepEqual(parseStartFrom({ branch: "origin/feature/x" }), { branch: "feature/x" });
	assert.deepEqual(parseStartFrom({ pullRequest: "#42" }), { pullRequest: 42 });
	assert.throws(() => parseStartFrom({ branch: "bad name" }), /valid branch/);
	assert.throws(() => parseStartFrom({ branch: "-x" }), /valid branch/);
	assert.throws(() => parseStartFrom({ pullRequest: 0 }), /branch name or a pull request/);
});

test("starting from a branch on origin creates a tracking branch and a worktree on it", async () => {
	const f = fixture();
	const state = join(f.root, "state");
	mkdirSync(state);
	const manager = new WorktreeManager(state);
	try {
		const startFrom = createStartFrom();
		const branches = await startFrom.listBranches(f.repo);
		assert.ok(branches.some(branch => branch.name === "feature/login" && branch.remote));
		assert.ok(branches.some(branch => branch.name === "local-work" && !branch.remote && branch.checkedOutAt === null));
		assert.ok(branches.find(branch => branch.name === "main")?.checkedOutAt, "main is in use by the checkout itself");

		const prepared = await startFrom.prepare(f.repo, { branch: "feature/login" });
		assert.equal(prepared.branch, "feature/login");
		assert.equal(prepared.base, f.mainHead, "the base is where the branch left main");
		assert.match(git(f.repo, "rev-parse", "--abbrev-ref", "feature/login@{u}"), /origin\/feature\/login/);

		const operation = await manager.create({ id: randomUUID(), repository: f.repo, branch: prepared.branch, base: prepared.base, existingBranch: true });
		assert.equal(operation.status, "completed", operation.message);
		assert.equal(git(operation.target, "rev-parse", "--abbrev-ref", "HEAD").trim(), "feature/login");
		assert.match(git(operation.target, "ls-files"), /login\.txt/);

		// A branch can only be checked out once.
		await assert.rejects(manager.create({ id: randomUUID(), repository: f.repo, branch: "feature/login", base: prepared.base, existingBranch: true }), /already checked out/);
		await assert.rejects(startFrom.prepare(f.repo, { branch: "nope" }), /not found/);
	} finally {
		manager.close();
		f.cleanup();
	}
});
