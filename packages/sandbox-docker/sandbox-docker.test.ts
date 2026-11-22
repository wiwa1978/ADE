import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SandboxExecResult } from "../protocol/index.ts";
import { LocalDockerSandbox } from "./index.ts";

type RecordedCall = { cmd: string; args: string[]; cwd?: string };

function ok(stdout = ""): SandboxExecResult {
  return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
}

function fail(stderr = "error", exitCode = 1): SandboxExecResult {
  return { exitCode, stdout: "", stderr, durationMs: 1 };
}

test("LocalDockerSandbox falls back to git worktree mode when Docker daemon is unavailable", async () => {
  const root = mkdtempSync(join(tmpdir(), "ade-sbx-fallback-"));
  const repoDir = mkdtempSync(join(tmpdir(), "ade-sbx-repo-"));
  const calls: RecordedCall[] = [];

  try {
    const sandbox = new LocalDockerSandbox({
      worktreesRoot: root,
      mode: "auto",
      resolveRepoPath: () => repoDir,
      runCommand: async (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts?.cwd });
        if (cmd === "docker" && args[0] === "info") {
          return fail("Cannot connect to the Docker daemon");
        }
        return ok("hello from worktree\n");
      },
    });

    assert.equal(await sandbox.isDockerAvailable(), false);

    const handle = await sandbox.create({
      runId: "run_fallback",
      repoUrl: repoDir,
      baseBranch: "main",
      workBranch: "ade/feat test",
    });

    const record = sandbox.getRecord(handle.id);
    assert.ok(record);
    assert.equal(record.activeMode, "worktree");
    assert.equal(record.containerId, null);
    assert.equal(record.branch, "ade/feat-test");

    // Verify git worktree add disabled hooks
    const wtCall = calls.find((c) => c.cmd === "git" && c.args.includes("worktree"));
    assert.ok(wtCall);
    assert.deepEqual(wtCall.args.slice(0, 5), ["-c", "core.hooksPath=/dev/null", "worktree", "add", "-B"]);
    assert.equal(wtCall.cwd, repoDir);

    // exec runs directly in the worktree (never via docker)
    const execRes = await sandbox.exec(handle.id, ["npm", "test"]);
    assert.equal(execRes.exitCode, 0);
    const npmCall = calls.find((c) => c.cmd === "npm");
    assert.ok(npmCall);
    assert.deepEqual(npmCall.args, ["test"]);
    assert.equal(npmCall.cwd, record.worktreePath);

    await sandbox.destroy(handle.id);
    assert.equal(sandbox.getRecord(handle.id), undefined);
    assert.ok(calls.some((c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "remove"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("LocalDockerSandbox constructs docker run/exec/pause/unpause/rm commands when Docker is available", async () => {
  const root = mkdtempSync(join(tmpdir(), "ade-sbx-docker-"));
  const repoDir = mkdtempSync(join(tmpdir(), "ade-sbx-repo-"));
  const calls: RecordedCall[] = [];

  try {
    const sandbox = new LocalDockerSandbox({
      worktreesRoot: root,
      dockerImage: "node:22-alpine",
      mode: "auto",
      resolveRepoPath: () => repoDir,
      runCommand: async (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts?.cwd });
        if (cmd === "docker" && args[0] === "info") return ok("27.1.0\n");
        if (cmd === "docker" && args[0] === "run") return ok("cid_abc123\n");
        if (cmd === "git" && args[0] === "status") return ok(" M index.ts\n");
        if (cmd === "git" && args[0] === "diff") return ok("diff --git a/index.ts b/index.ts\n+ok\n");
        return ok("");
      },
    });

    const handle = await sandbox.create({
      runId: "run_docker",
      repoUrl: repoDir,
      baseBranch: "main",
      workBranch: "ade/docker-run",
    });

    const record = sandbox.getRecord(handle.id);
    assert.ok(record);
    assert.equal(record.activeMode, "docker");
    assert.equal(record.containerId, "cid_abc123");

    const runCall = calls.find((c) => c.cmd === "docker" && c.args[0] === "run");
    assert.ok(runCall);
    assert.deepEqual(runCall.args, [
      "run",
      "-d",
      "--rm",
      "--name",
      `ade-${handle.id}`,
      "-w",
      "/workspace",
      "-v",
      `${record.worktreePath}:/workspace`,
      "node:22-alpine",
      "sleep",
      "infinity",
    ]);

    await sandbox.pause(handle.id);
    assert.equal(record.handle.status, "paused");
    assert.ok(calls.some((c) => c.cmd === "docker" && c.args[0] === "pause" && c.args[1] === "cid_abc123"));

    // Calling exec while paused auto-resumes via docker unpause before docker exec
    await sandbox.exec(handle.id, ["node", "-v"]);
    assert.equal(record.handle.status, "running");
    assert.ok(calls.some((c) => c.cmd === "docker" && c.args[0] === "unpause" && c.args[1] === "cid_abc123"));
    const execCall = calls.find((c) => c.cmd === "docker" && c.args[0] === "exec");
    assert.deepEqual(execCall?.args, ["exec", "-w", "/workspace", "cid_abc123", "node", "-v"]);

    const diff = await sandbox.getDiff(handle.id);
    assert.match(diff, /# git status --short/);
    assert.match(diff, /diff --git a\/index\.ts b\/index\.ts/);

    await sandbox.destroy(handle.id);
    assert.ok(calls.some((c) => c.cmd === "docker" && c.args[0] === "rm" && c.args[1] === "-f" && c.args[2] === "cid_abc123"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("LocalDockerSandbox rejects missing repository paths and cleans up worktree when strict docker mode fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "ade-sbx-strict-"));
  const repoDir = mkdtempSync(join(tmpdir(), "ade-sbx-repo-"));
  const calls: RecordedCall[] = [];

  try {
    const sandbox = new LocalDockerSandbox({
      worktreesRoot: root,
      mode: "docker",
      runCommand: async (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts?.cwd });
        if (cmd === "docker" && args[0] === "run") return fail("image pull denied");
        return ok();
      },
    });

    await assert.rejects(
      () => sandbox.create({ runId: "run_missing", repoUrl: join(root, "does-not-exist"), baseBranch: "main", workBranch: "ade/x" }),
      /does not exist/i,
    );

    await assert.rejects(
      () => sandbox.create({ runId: "run_fail", repoUrl: repoDir, baseBranch: "main", workBranch: "ade/fail" }),
      /Failed to start Docker sandbox: image pull denied/,
    );
    assert.ok(calls.some((c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "remove"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});
