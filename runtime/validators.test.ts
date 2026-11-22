import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LocalAgentHost } from "./host.ts";
import { createRuntimeServer } from "./server.ts";
import { WorktreeManager } from "./worktrees.ts";

function initGitRepo(dir: string) {
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "ade@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "ADE Test"], { cwd: dir });
	writeFileSync(join(dir, "hello.txt"), "initial\n", "utf8");
	execFileSync("git", ["add", "-A"], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
}

test("API boundary rejects wrong-type inputs with 400 on git and workspace-file routes", async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "ade-validate-state-"));
	const repoDir = mkdtempSync(join(tmpdir(), "ade-validate-repo-"));
	initGitRepo(repoDir);
	const host = new LocalAgentHost({ stateDirectory: stateDir, modelConfigFactory: () => ({}) as never });
	const manager = new WorktreeManager(stateDir);
	const sessionId = randomUUID();
	await host.createCodingTask({ id: sessionId, title: "Validate", repository: repoDir, kind: "checkout" }, manager);
	const server = createRuntimeServer({ host, worktreeManager: manager });
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	const send = (method: string, path: string, body: unknown) =>
		fetch(`${base}${path}`, {
			method,
			headers: {
				origin: "http://127.0.0.1:1420",
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});

	try {
		// Non-object JSON body
		assert.equal((await send("POST", "/api/workspace/git/commit", ["not-an-object"])).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/commit", "plain-string")).status, 400);

		// Git commit wrong types (previously caused 500 from (5).trim())
		assert.equal((await send("POST", "/api/workspace/git/commit", { sessionId, message: 5 })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/commit", { sessionId, message: "   " })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/commit", { sessionId: 42, message: "ok" })).status, 400);

		// Git stage / unstage wrong types (previously passed [1] into workspacePath/git add)
		assert.equal((await send("POST", "/api/workspace/git/stage", { sessionId, paths: [1] })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/stage", { sessionId, paths: "hello.txt" })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/stage", { sessionId: null, paths: [] })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/unstage", { sessionId, paths: [1] })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/unstage", { sessionId, paths: { a: 1 } })).status, 400);

		// Git discard wrong types
		assert.equal((await send("POST", "/api/workspace/git/discard", { sessionId, path: 123 })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/discard", { sessionId, path: "" })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/discard", { sessionId: true, path: "hello.txt" })).status, 400);

		// Workspace file write wrong types
		assert.equal((await send("PUT", "/api/workspace/file", { sessionId, path: 5, content: "ok" })).status, 400);
		assert.equal((await send("PUT", "/api/workspace/file", { sessionId, path: "hello.txt", content: 99 })).status, 400);
		assert.equal((await send("PUT", "/api/workspace/file", { sessionId: 123, path: "hello.txt", content: "ok" })).status, 400);
		assert.equal((await send("PUT", "/api/workspace/file", { sessionId, path: "", content: "ok" })).status, 400);

		// Valid workspace file write + stage + commit still succeed cleanly
		assert.equal((await send("PUT", "/api/workspace/file", { sessionId, path: "hello.txt", content: "updated\n" })).status, 200);
		assert.equal((await send("POST", "/api/workspace/git/stage", { sessionId, paths: ["hello.txt"] })).status, 200);
		assert.equal((await send("POST", "/api/workspace/git/commit", { sessionId, message: "Update hello" })).status, 200);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await host.close();
		manager.close();
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	}
});
