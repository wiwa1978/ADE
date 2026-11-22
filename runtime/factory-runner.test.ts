import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CaptainCore } from "../packages/captain-core/index.ts";
import { createNodeSqliteCaptainHost } from "../packages/host-node/index.ts";
import { LocalDockerSandbox } from "../packages/sandbox-docker/index.ts";
import { buildMergeReadyPrBody, LocalGitHubProvider } from "../packages/github-local/index.ts";
import { LocalFactoryRunner } from "./factory-runner.ts";

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ade-factory-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "ade-test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "ADE Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# Test Repo\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir });
  return dir;
}

test("LocalGitHubProvider reads private/public issues via gh CLI, blocks path traversal, and formats PR body", async () => {
  const repoDir = createTempGitRepo();
  try {
    const ghCalls: string[] = [];
    const gh = new LocalGitHubProvider({
      resolveCheckoutPath: () => repoDir,
      runCommand: async (cmd, args) => {
        ghCalls.push(`${cmd} ${args.join(" ")}`);
        if (cmd === "gh" && args[0] === "issue") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              number: 77,
              title: "Fix private billing bug",
              body: "Ensure null invoices do not throw.",
              url: "https://github.com/acme/private-app/issues/77",
              state: "OPEN",
              labels: [{ name: "bug" }],
            }),
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: "https://github.com/acme/private-app/pull/88\n", stderr: "" };
      },
    });

    const issue = await gh.getIssue("acme/private-app", 77);
    assert.equal(issue.number, 77);
    assert.equal(issue.state, "open");

    const readme = await gh.readRepoFile("acme/private-app", "main", "README.md");
    assert.match(readme ?? "", /Test Repo/);

    await assert.rejects(() => gh.readRepoFile("acme/private-app", "main", "../../etc/passwd"), /traversal/i);

    const body = buildMergeReadyPrBody({
      issueRef: { number: 77, title: issue.title, url: issue.url },
      blueprintName: "Automated Factory",
      summary: "Fixed null invoice crash.",
      checksSummary: "- `npm test` passed",
      goldfishAuditSummary: "- Passed (cross-family auditor)",
      telemetry: { inputTokens: 8400, outputTokens: 1200, usd: 0.0432, loopInterventions: 1 },
    });
    assert.match(body, /Closes #77/);
    assert.match(body, /\$0\.0432/);

    const pr = await gh.publishPullRequest({
      repository: "acme/private-app",
      headBranch: "ade/run_77",
      baseBranch: "main",
      title: "Fix private billing bug (#77)",
      body,
    });
    assert.equal(pr.number, 88);
    assert.equal(ghCalls.length, 2);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("LocalFactoryRunner drives real git worktree sandbox, Goldfish audit loopback, Pause/Takeover, and PR gate", async () => {
  const repoDir = createTempGitRepo();
  const stateDir = mkdtempSync(join(tmpdir(), "ade-factory-state-"));
  const db = new DatabaseSync(":memory:");
  const host = createNodeSqliteCaptainHost({ db, region: "local" });
  const captain = new CaptainCore({ host });
  const sandbox = new LocalDockerSandbox({
    worktreesRoot: join(stateDir, "worktrees"),
    mode: "worktree",
  });

  let reviewAttempts = 0;
  const runner = new LocalFactoryRunner({
    captain,
    stateDirectory: stateDir,
    sandbox,
    stageExecutor: async ({ detail, stageId, contextIsolation }) => {
      if (stageId === "implement" && detail.sandboxId) {
        const rec = sandbox.getRecord(detail.sandboxId)!;
        writeFileSync(join(rec.worktreePath, "feature.ts"), "export const ok = true;\n", "utf8");
        return { summary: "Implemented feature.ts", inputTokens: 2000, outputTokens: 500, usd: 0.015 };
      }
      if (stageId === "review") {
        assert.equal(contextIsolation, "goldfish");
        reviewAttempts += 1;
        if (reviewAttempts === 1) {
          return {
            summary: "Goldfish found missing doc comment",
            verdict: { outcome: "changes_requested", summary: "Add JSDoc" },
            inputTokens: 1500,
            outputTokens: 300,
            usd: 0.01,
          };
        }
        return {
          summary: "Goldfish passed all checks",
          verdict: { outcome: "pass", summary: "Clean" },
          inputTokens: 1200,
          outputTokens: 200,
          usd: 0.008,
        };
      }
      return { summary: `Done ${stageId}`, inputTokens: 400, outputTokens: 100, usd: 0.002 };
    },
  });

  try {
    const created = await runner.createRun({
      runId: "mvp_e2e_1",
      blueprintId: "automated-factory",
      repoPath: repoDir,
      taskPrompt: "Add feature.ts",
      euOnlyMode: true,
    });
    assert.equal(created.crossFamilyVerified, true);
    assert.equal(created.sandboxId, null);

    // 1. Triage (Brain only -> NO sandbox created)
    const s1 = await runner.stepRun("mvp_e2e_1");
    assert.equal(s1.sandboxId, null);

    // 2. Plan (Brain only -> NO sandbox created)
    const s2 = await runner.stepRun("mvp_e2e_1");
    assert.equal(s2.sandboxId, null);

    // 3. Implement (Lazily creates real git worktree sandbox + writes feature.ts!)
    const s3 = await runner.stepRun("mvp_e2e_1");
    assert.ok(s3.sandboxId);
    assert.match(s3.diff, /feature\.ts/);

    // Test Pause / Take Over guardrails
    const paused = await runner.takeOverRun("mvp_e2e_1", true);
    assert.equal(paused.humanTakeOver, true);
    await assert.rejects(() => runner.stepRun("mvp_e2e_1"), /paused/i);
    await runner.takeOverRun("mvp_e2e_1", false);

    // 4. Verify (runs in sandbox)
    await runner.stepRun("mvp_e2e_1");

    // 5. Review #1 (Goldfish returns changes_requested -> loops back to implement)
    const s5 = await runner.stepRun("mvp_e2e_1");
    assert.equal(s5.run.auditLoopbacksUsed, 1);
    assert.equal(s5.telemetry.loopInterventions, 1);

    // Loopback: Implement -> Verify -> Review #2 (passes!)
    await runner.stepRun("mvp_e2e_1");
    await runner.stepRun("mvp_e2e_1");
    const sReviewPass = await runner.stepRun("mvp_e2e_1");
    assert.equal(reviewAttempts, 2);
    assert.ok(sReviewPass.telemetry.actualInputTokens > 0);
    assert.ok(sReviewPass.telemetry.actualUsd > 0);

    // 6. Publish PR gate -> hits human approval gate before publishing
    const sGate = await runner.stepRun("mvp_e2e_1");
    assert.equal(sGate.run.status, "awaiting_human");
    assert.equal(sGate.pendingEscalations.length, 1);

    await runner.approveRunStage("mvp_e2e_1", "approve", sGate.pendingEscalations[0].id);
    const sPublish = await runner.stepRun("mvp_e2e_1");
    assert.equal(sPublish.run.status, "completed");

    // Final advance cleans up sandbox
    const sDone = await runner.stepRun("mvp_e2e_1");
    assert.equal(sDone.sandboxId, null);
  } finally {
    await runner.close();
    host.close();
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
});
