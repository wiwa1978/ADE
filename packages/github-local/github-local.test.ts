import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildMergeReadyPrBody, LocalGitHubProvider } from "./index.ts";

test("LocalGitHubProvider parses issues, validates issue numbers, and passes exact gh CLI arguments", async () => {
  const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
  const gh = new LocalGitHubProvider({
    runCommand: async (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts?.cwd });
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          number: 42,
          title: "Add OAuth PKCE",
          body: "Support PKCE flow",
          url: "https://github.com/acme/demo/issues/42",
          state: "CLOSED",
          labels: [{ name: "security" }, { name: "p1" }],
        }),
        stderr: "",
      };
    },
  });

  await assert.rejects(() => gh.getIssue("acme/demo", 0), /Invalid GitHub issue number/);
  await assert.rejects(() => gh.getIssue("acme/demo", -3), /Invalid GitHub issue number/);
  await assert.rejects(() => gh.getIssue("acme/demo", 1.5), /Invalid GitHub issue number/);

  const issue = await gh.getIssue("acme/demo", 42);
  assert.deepEqual(calls[0], {
    cmd: "gh",
    args: [
      "issue",
      "view",
      "42",
      "--repo",
      "acme/demo",
      "--json",
      "number,title,body,url,state,labels",
    ],
    cwd: undefined,
  });
  assert.equal(issue.number, 42);
  assert.equal(issue.state, "closed");
  assert.deepEqual(issue.labels, ["security", "p1"]);
  assert.equal(issue.body, "Support PKCE flow");
});

test("LocalGitHubProvider builds exact gh pr create and git commit/push argument lists", async () => {
  const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
  const gh = new LocalGitHubProvider({
    runCommand: async (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts?.cwd });
      if (cmd === "git" && args[0] === "status") return { exitCode: 0, stdout: " M app.ts\n", stderr: "" };
      if (cmd === "git" && args[0] === "rev-parse") return { exitCode: 0, stdout: "deadbeef\n", stderr: "" };
      if (cmd === "gh" && args[0] === "pr") {
        return { exitCode: 0, stdout: "https://github.com/acme/demo/pull/123\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });

  const pushed = await gh.commitAndPushBranch({
    worktreePath: "/tmp/wt-1",
    branch: "ade/fix-42",
    commitMessage: "Fix #42",
  });
  assert.deepEqual(pushed, { committed: true, pushed: true, sha: "deadbeef" });
  assert.deepEqual(
    calls.map((c) => [c.cmd, c.args]),
    [
      ["git", ["status", "--porcelain"]],
      ["git", ["add", "-A"]],
      ["git", ["-c", "core.hooksPath=/dev/null", "commit", "-m", "Fix #42"]],
      ["git", ["rev-parse", "HEAD"]],
      ["git", ["push", "-u", "origin", "ade/fix-42"]],
    ],
  );

  const pr = await gh.publishPullRequest({
    repository: "acme/demo",
    headBranch: "ade/fix-42",
    baseBranch: "main",
    title: "Fix #42",
    body: "Body text",
    draft: true,
  });
  assert.equal(pr.number, 123);
  assert.equal(pr.url, "https://github.com/acme/demo/pull/123");
  assert.deepEqual(calls[calls.length - 1], {
    cmd: "gh",
    args: [
      "pr",
      "create",
      "--repo",
      "acme/demo",
      "--head",
      "ade/fix-42",
      "--base",
      "main",
      "--title",
      "Fix #42",
      "--body",
      "Body text",
      "--draft",
    ],
    cwd: undefined,
  });
});

test("LocalGitHubProvider reads files safely and blocks path traversal", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "ade-gh-local-"));
  try {
    writeFileSync(join(repoDir, "package.json"), '{"name":"demo"}\n', "utf8");
    const gh = new LocalGitHubProvider({ resolveCheckoutPath: () => repoDir });

    assert.equal(await gh.readRepoFile("acme/demo", "main", "package.json"), '{"name":"demo"}\n');
    assert.equal(await gh.readRepoFile("acme/demo", "main", "missing.txt"), null);
    await assert.rejects(() => gh.readRepoFile("acme/demo", "main", "../secret.txt"), /Blocked path traversal/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("buildMergeReadyPrBody formats optional issue reference, audit, and telemetry sections", () => {
  const withoutIssue = buildMergeReadyPrBody({
    blueprintName: "Spec Kit",
    summary: "Refactored parser",
    checksSummary: "",
    goldfishAuditSummary: "",
  });
  assert.doesNotMatch(withoutIssue, /Closes #/);
  assert.match(withoutIssue, /## Blueprint & Verification \(Spec Kit\)/);
  assert.match(withoutIssue, /Deterministic checks passed/);
  assert.match(withoutIssue, /Passed with no blocking findings/);
  assert.doesNotMatch(withoutIssue, /Factory Telemetry/);

  const full = buildMergeReadyPrBody({
    issueRef: { number: 99, title: "Fix crash", url: "https://github.com/acme/demo/issues/99" },
    blueprintName: "Automated Factory",
    summary: "Added null guard",
    checksSummary: "- `npm test` green",
    goldfishAuditSummary: "- Cross-family audit PASS",
    telemetry: { inputTokens: 12000, outputTokens: 2500, usd: 0.0815, loopInterventions: 2 },
  });
  assert.match(full, /^Closes #99 \(Fix crash\)/);
  assert.match(full, /\$0\.0815/);
  assert.match(full, /Failure-Loop Interventions: 2/);
});
