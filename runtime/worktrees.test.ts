import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { inspectWorktrees, WorktreeManager } from "./worktrees.ts";

test("inspect linked worktrees without changing either checkout", async () => {
	const root = mkdtempSync(join(tmpdir(), "ade-worktrees-"));
	const repo = join(root, "repo");
	const linked = join(root, "linked");
	const git = (...args: string[]) => execFileSync("git", args, { stdio: "pipe" });
	try {
		git("init", repo);
		git("-C", repo, "config", "user.name", "ADE test");
		git("-C", repo, "config", "user.email", "test@example.invalid");
		writeFileSync(join(repo, "file.txt"), "initial");
		git("-C", repo, "add", "file.txt");
		git("-C", repo, "commit", "-m", "initial");
		git("-C", repo, "worktree", "add", "-b", "fixture", linked);
		writeFileSync(join(repo, "file.txt"), "uncommitted");
		const before = git("-C", repo, "status", "--porcelain").toString();
		const result = await inspectWorktrees(repo);
		assert.equal(result.length, 2);
		const listedPath = result.find(item => item.branch === "fixture")!.path;
		assert.ok(existsSync(listedPath));
		assert.equal(statSync(listedPath).ino, statSync(linked).ino);
		assert.equal(git("-C", repo, "status", "--porcelain").toString(), before);
		await assert.rejects(inspectWorktrees("relative"), /absolute path/);
		await assert.rejects(inspectWorktrees(join(root, "missing")), /Git|checkout/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("creation is idempotent, disables hooks and filters, and preserves changes", { timeout: 60000 }, async () => {
	const root = mkdtempSync(join(tmpdir(), "ade-worktree-create-"));
	const repo = join(root, "repo");
	const state = join(root, "state");
	const git = (...args: string[]) => execFileSync("git", args, { stdio: "pipe" }).toString().trim();
	let manager: WorktreeManager | undefined;
	try {
		mkdirSync(state);
		git("init", repo);
		git("-C", repo, "config", "user.name", "ADE test");
		git("-C", repo, "config", "user.email", "test@example.invalid");
		writeFileSync(join(repo, ".gitattributes"), "filtered.txt filter=adefixture\n");
		writeFileSync(join(repo, "filtered.txt"), "raw data\n");
		git("-C", repo, "add", ".");
		git("-C", repo, "commit", "-m", "initial");
		const marker = join(root, "ran-hook");
		writeFileSync(join(repo, ".git", "hooks", "post-checkout"), `#!/bin/sh\ntouch '${marker.replaceAll("\\", "/")}'\n`, { mode: 0o755 });
		git("-C", repo, "config", "filter.adefixture.smudge", "exit 1");
		git("-C", repo, "config", "filter.adefixture.process", "exit 1");
		git("-C", repo, "config", "filter.adefixture.required", "true");
		writeFileSync(join(repo, "local.txt"), "keep me");
		manager = new WorktreeManager(state);
		const input = { id: randomUUID(), repository: repo, branch: "feature/ade", base: "HEAD" };
		const result = await manager.create(input);
		assert.equal(result.status, "completed", result.message);
		assert.match(result.message, /filters disabled/);
		assert.equal(readFileSync(join(result.target, "filtered.txt"), "utf8").replace(/\r\n/g, "\n"), "raw data\n");
		assert.equal(existsSync(marker), false);
		assert.equal(readFileSync(join(repo, "local.txt"), "utf8"), "keep me");
		assert.deepEqual(await manager.create(input), result);
		await assert.rejects(manager.create({ ...input, branch: "changed" }), /different inputs/);
		assert.equal((await inspectWorktrees(repo)).length, 2);
		await assert.rejects(manager.create({ ...input, id: randomUUID() }), /already exists/);
		await assert.rejects(manager.create({ ...input, id: randomUUID(), branch: "../bad" }), /valid new Git branch/);
		await assert.rejects(manager.create({ ...input, id: randomUUID(), branch: "new", base: "missing" }), /base ref/);
		await assert.rejects(manager.create({ ...input, id: randomUUID(), repository: "relative" }), /absolute checkout/);
		manager.close();
		manager = undefined;

		// Model an interruption after Git completed but before ADE recorded its receipt.
		const db = new DatabaseSync(join(state, "worktrees.sqlite"));
		db.prepare("UPDATE operations SET status='running' WHERE id=?").run(input.id);
		db.close();
		manager = new WorktreeManager(state);
		const recovered = await manager.create(input);
		assert.equal(recovered.status, "attention");
		assert.match(recovered.message, /will not retry or remove/);
		assert.equal((await inspectWorktrees(repo)).length, 2);
		assert.equal(readFileSync(join(result.target, "filtered.txt"), "utf8").replace(/\r\n/g, "\n"), "raw data\n");
	} finally {
		manager?.close();
		rmSync(root, { recursive: true, force: true });
	}
});
