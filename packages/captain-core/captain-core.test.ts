import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  ModelRoutingConfig,
  SandboxHandle,
  SandboxProvider,
  ToolDescriptor,
} from "../protocol/index.ts";
import {
  BUILTIN_BLUEPRINTS,
  egmBlueprint,
  openSpecBlueprint,
  resolveProjectBlueprint,
  validateBlueprint,
} from "../blueprints/index.ts";
import {
  CaptainCore,
  createMemoryCaptainHost,
  EscalationAggregator,
  estimateTokenSavings,
  EuComplianceViolationError,
  FailureLoopWatchdog,
  formatMicroSkillsContext,
  pruneToolsForStage,
  resolveStageModel,
} from "./index.ts";
import { createNodeSqliteCaptainHost } from "../host-node/index.ts";

function createFauxSandbox(): SandboxProvider & {
  calls: string[];
} {
  const calls: string[] = [];
  let seq = 0;
  return {
    kind: "memory",
    calls,
    async create(opts) {
      const id = `sbx_${++seq}`;
      calls.push(`create:${opts.runId}:${id}`);
      return {
        id,
        provider: "memory",
        status: "running",
        region: opts.region ?? "local",
        createdAt: Date.now(),
      } satisfies SandboxHandle;
    },
    async exec(id, cmd) {
      calls.push(`exec:${id}:${cmd.join(" ")}`);
      return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 5 };
    },
    async spawnWorker(id, task) {
      calls.push(`spawn:${id}:${task.taskId}`);
      return { workerRunId: `run_${task.taskId}` };
    },
    async pause(id) {
      calls.push(`pause:${id}`);
    },
    async resume(id) {
      calls.push(`resume:${id}`);
    },
    async destroy(id) {
      calls.push(`destroy:${id}`);
    },
    async getDiff() {
      return "diff --git a/a.ts b/a.ts";
    },
  };
}

test("packages/protocol, blueprints, and captain-core contain zero node:* runtime imports", () => {
  const dirs = [
    join(process.cwd(), "packages/protocol"),
    join(process.cwd(), "packages/blueprints"),
    join(process.cwd(), "packages/captain-core"),
  ];
  for (const dir of dirs) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    assert.ok(files.length > 0, `Expected TS files in ${dir}`);
    for (const file of files) {
      const content = readFileSync(join(dir, file), "utf8");
      assert.equal(
        /from\s+["']node:/.test(content),
        false,
        `Forbidden node:* import found in ${join(dir, file)}`,
      );
    }
  }
});

test("all built-in blueprints validate and support repo-local overrides", () => {
  assert.ok(BUILTIN_BLUEPRINTS.length >= 5);
  for (const bp of BUILTIN_BLUEPRINTS) {
    const res = validateBlueprint(bp);
    assert.equal(res.valid, true, `Blueprint ${bp.id} errors: ${res.errors.join(", ")}`);
  }

  const resolved = resolveProjectBlueprint({
    baseBlueprintId: "openspec",
    disabledStageIds: ["verify"],
    stageOverrides: {
      propose_delta: { approvalGate: "never" },
    },
  });
  assert.equal(resolved.disabledStageIds.includes("verify"), true);
  assert.equal(
    resolved.blueprint.stages.find((s) => s.id === "propose_delta")?.approvalGate,
    "never",
  );
  // Original built-in blueprint remains unmutated
  assert.equal(
    openSpecBlueprint.stages.find((s) => s.id === "propose_delta")?.approvalGate,
    "after",
  );
});

test("ModelRouter enforces 4-level precedence and fail-closed EU-Only Mode", () => {
  const stage = openSpecBlueprint.stages.find((s) => s.id === "propose_delta")!;

  const baseConfig: ModelRoutingConfig = {
    profile: "balanced",
    appDefault: { provider: "anthropic", model: "claude-sonnet-4-5", endpointRegion: "us" },
    stageOverrides: {
      propose_delta: { provider: "anthropic", model: "claude-opus-4-5", endpointRegion: "us" },
    },
    compliance: { euOnlyMode: false },
  };

  const resolvedStage = resolveStageModel(stage, baseConfig);
  assert.equal(resolvedStage.source, "stage-override");
  assert.equal(resolvedStage.ref.model, "claude-opus-4-5");

  // Run override beats stage override
  const withRunOverride: ModelRoutingConfig = {
    ...baseConfig,
    runOverrides: {
      propose_delta: { provider: "bedrock-eu", model: "eu.anthropic.claude-opus-4-5", endpointRegion: "eu" },
    },
  };
  const resolvedRun = resolveStageModel(stage, withRunOverride);
  assert.equal(resolvedRun.source, "run-override");
  assert.equal(resolvedRun.euCompliant, true);

  // Fail-closed EU-Only Mode rejects US endpoints
  const euLockedBad: ModelRoutingConfig = {
    ...baseConfig,
    compliance: { euOnlyMode: true },
  };
  assert.throws(() => resolveStageModel(stage, euLockedBad), EuComplianceViolationError);

  // EU-Only profile passes under EU-Only Mode
  const euLockedGood: ModelRoutingConfig = {
    profile: "eu-only",
    appDefault: { provider: "bedrock-eu", model: "eu.anthropic.claude-sonnet-4-5", endpointRegion: "eu" },
    compliance: { euOnlyMode: true },
  };
  const resolvedEu = resolveStageModel(stage, euLockedGood);
  assert.equal(resolvedEu.euCompliant, true);
  assert.equal(resolvedEu.ref.provider, "vertex-eu");
});

test("TokenEconomizer prunes tools by stage & history, formats micro-skills, and detects failure loops", () => {
  const tools: ToolDescriptor[] = [
    { name: "read_file", group: "repo-read", description: "Read file", estimatedSchemaTokens: 200 },
    { name: "legacy_unused", group: "repo-read", description: "Never called", estimatedSchemaTokens: 300 },
    { name: "docker_exec", group: "shell", description: "Run shell", estimatedSchemaTokens: 400 },
  ];

  const triageStage = openSpecBlueprint.stages[0];
  const pruned = pruneToolsForStage(tools, triageStage, [
    { toolName: "legacy_unused", calls: 0, sessionsSeen: 6 },
    { toolName: "read_file", calls: 24, sessionsSeen: 6 },
  ]);

  assert.deepEqual(
    pruned.allowedTools.map((t) => t.name),
    ["read_file"],
  );
  assert.equal(pruned.estimatedTokensSavedPerTurn, 700);

  const microSkillsPrompt = formatMicroSkillsContext([
    {
      id: "ms1",
      repository: "owner/ade",
      category: "test_command",
      fact: "Run npm run test:core via Node 22+",
      confidence: 0.95,
      learnedAt: 1000,
    },
  ]);
  assert.match(microSkillsPrompt, /npm run test:core/);

  const watchdog = new FailureLoopWatchdog({ interveneAfter: 3, escalateAfter: 5 });
  const obs = {
    signature: "ERR_TS2307:missing-mod",
    stageId: "implement",
    subagentId: "worker-1",
    commandOrTool: "npm run build",
    errorExcerpt: "Cannot find module",
    timestamp: Date.now(),
  };
  assert.equal(watchdog.recordFailure(obs).action, "continue");
  assert.equal(watchdog.recordFailure(obs).action, "continue");
  assert.equal(watchdog.recordFailure(obs).action, "intervene");
  assert.equal(watchdog.recordFailure(obs).action, "intervene");
  assert.equal(watchdog.recordFailure(obs).action, "escalate_human");
  assert.equal(watchdog.interventionCount, 3);

  watchdog.recordSuccess("implement", "worker-1");
  assert.equal(watchdog.recordFailure(obs).action, "continue");

  const savings = estimateTokenSavings({
    prunedToolTokensPerTurn: 700,
    turnsExecuted: 20,
    loopInterventions: 2,
    sandboxMinutesAvoided: 14,
  });
  assert.equal(savings.estimatedTokensSaved, 38_000);
  assert.ok(savings.estimatedUsdSaved > 0);
});

test("EscalationAggregator batches concurrent subagent questions into one Captain card", () => {
  const agg = new EscalationAggregator();
  agg.enqueueSubagentSignal({
    subagentId: "w1",
    subagentName: "Backend Worker",
    stageId: "implement",
    kind: "spec_conflict",
    summary: "Legacy users table lacks email_verified column",
    file: "db/schema.sql",
    createdAt: 100,
  });
  agg.enqueueSubagentSignal({
    subagentId: "w2",
    subagentName: "Frontend Worker",
    stageId: "implement",
    kind: "question",
    summary: "Should expired token banner auto-dismiss?",
    createdAt: 101,
  });

  const card = agg.flushSubagentBatch("run_1", 200);
  assert.ok(card);
  assert.equal(card.kind, "spec_conflict");
  assert.deepEqual(card.sourceSubagentIds, ["w1", "w2"]);
  assert.match(card.summary, /Backend Worker/);
  assert.match(card.summary, /Frontend Worker/);
  assert.equal(agg.listPending("run_1").length, 1);

  const resolved = agg.resolve(card.id, "opt_1", "Add migration", 300);
  assert.equal(resolved.status, "resolved");
  assert.equal(agg.listPending("run_1").length, 0);
});

test("CaptainCore runs lazy Hands-on-Demand, Goldfish audit loopback, and SQLite host persistence", async () => {
  const db = new DatabaseSync(":memory:");
  const emitted: string[] = [];
  const nodeHost = createNodeSqliteCaptainHost({
    db,
    region: "eu",
    onEvent: (ev) => emitted.push(ev.type),
  });
  const sandbox = createFauxSandbox();
  const captain = new CaptainCore({ host: nodeHost, sandbox });

  const modelConfig: ModelRoutingConfig = {
    profile: "eu-only",
    appDefault: { provider: "bedrock-eu", model: "eu.anthropic.claude-sonnet-4-5", endpointRegion: "eu" },
    compliance: { euOnlyMode: true },
  };

  // Start an OpenSpec run (disable verify for compact test)
  await captain.startBlueprintRun({
    runId: "run_eu_1",
    projectId: "proj_1",
    blueprint: openSpecBlueprint,
    disabledStageIds: ["verify"],
    issueRef: { repository: "acme/app", number: 42, title: "Add SSO", url: "https://github.com/acme/app/issues/42" },
  });

  // Stage 1: triage (Brain-only -> NO sandbox created!)
  const step1 = await captain.advanceRun({ runId: "run_eu_1", blueprint: openSpecBlueprint, modelConfig });
  assert.equal(step1.action.kind, "execute_stage");
  assert.equal(step1.sandbox, undefined);
  assert.equal(sandbox.calls.length, 0);
  await captain.finishStage({ runId: "run_eu_1", blueprint: openSpecBlueprint, stageId: "triage" });

  // Stage 2: propose_delta (Brain-only -> STILL no sandbox; has "after" human gate)
  const step2 = await captain.advanceRun({ runId: "run_eu_1", blueprint: openSpecBlueprint, modelConfig });
  assert.equal(step2.action.kind, "execute_stage");
  assert.equal(sandbox.calls.length, 0);
  await captain.finishStage({
    runId: "run_eu_1",
    blueprint: openSpecBlueprint,
    stageId: "propose_delta",
    artifactPaths: ["openspec/changes/42/delta.md"],
  });

  // Advance hits human approval gate on propose_delta
  const gateStep = await captain.advanceRun({ runId: "run_eu_1", blueprint: openSpecBlueprint, modelConfig });
  assert.equal(gateStep.action.kind, "await_approval");
  assert.ok(gateStep.escalation);
  await captain.approveCurrentStage({
    runId: "run_eu_1",
    blueprint: openSpecBlueprint,
    decision: "approve",
    cardId: gateStep.escalation.id,
  });

  // Stage 3: implement (requiresSandbox: true -> NOW sandbox is lazily attached!)
  const step3 = await captain.advanceRun({ runId: "run_eu_1", blueprint: openSpecBlueprint, modelConfig });
  assert.equal(step3.action.kind, "execute_stage");
  assert.ok(step3.sandbox);
  assert.deepEqual(sandbox.calls, ["create:run_eu_1:sbx_1"]);
  await captain.finishStage({ runId: "run_eu_1", blueprint: openSpecBlueprint, stageId: "implement" });

  // Stage 4 (verify) skipped -> Stage 5: review (Goldfish, requiresSandbox: false -> pauses sandbox!)
  const step5 = await captain.advanceRun({ runId: "run_eu_1", blueprint: openSpecBlueprint, modelConfig });
  assert.equal(step5.action.kind, "execute_stage");
  if (step5.action.kind === "execute_stage") {
    assert.equal(step5.action.stage.id, "review");
    assert.equal(step5.action.contextIsolation, "goldfish");
    assert.equal(step5.action.requiresSandbox, false);
  }
  assert.equal(sandbox.calls.includes("pause:sbx_1"), true);

  // Goldfish returns CHANGES_REQUESTED -> loops back to implement!
  const loopResult = await captain.finishStage({
    runId: "run_eu_1",
    blueprint: openSpecBlueprint,
    stageId: "review",
    verdict: {
      outcome: "changes_requested",
      summary: "Missing null check on SAML assertion",
      findings: [{ severity: "blocker", file: "src/sso.ts", line: 84, message: "Possible null deref" }],
    },
  });
  assert.equal(loopResult.loopedBackTo, "implement");

  // Next advance resumes the paused sandbox instead of recreating it!
  const retryStep = await captain.advanceRun({ runId: "run_eu_1", blueprint: openSpecBlueprint, modelConfig });
  assert.equal(retryStep.action.kind, "execute_stage");
  assert.equal(sandbox.calls.includes("resume:sbx_1"), true);

  // Persistence check: a brand-new CaptainCore over the same SQLite DB recovers the exact run state
  const restartedCaptain = new CaptainCore({ host: nodeHost });
  const reloaded = await restartedCaptain.getRun("run_eu_1");
  assert.ok(reloaded);
  assert.equal(reloaded.auditLoopbacksUsed, 1);
  assert.ok(emitted.includes("sandbox.attached"));
  assert.ok(emitted.includes("sandbox.detached"));

  nodeHost.close();
  db.close();
});

test("EGM blueprint exposes Elephant brainstorm/draft and two Goldfish audit gates", () => {
  const memoryHost = createMemoryCaptainHost("local");
  assert.equal(memoryHost.kind, "memory");
  const goldfishStages = egmBlueprint.stages.filter((s) => s.contextIsolation === "goldfish");
  assert.deepEqual(
    goldfishStages.map((s) => s.id),
    ["spec_audit", "drift_audit"],
  );
  assert.equal(goldfishStages.every((s) => s.requiresSandbox === false && s.useCodeMode === true), true);
});
