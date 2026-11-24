import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ModelRoutingConfig, ToolDescriptor } from "../protocol/index.ts";
import {
  BUILTIN_BLUEPRINTS,
  egmBlueprint,
  openSpecBlueprint,
  resolveProjectBlueprint,
  validateBlueprint,
} from "../blueprints/index.ts";
import {
  EuComplianceViolationError,
  FailureLoopWatchdog,
  formatMicroSkillsContext,
  pruneToolsForStage,
  resolveStageModel,
} from "./index.ts";

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
});

test("EGM blueprint exposes Elephant brainstorm/draft and two Goldfish audit gates", () => {
  const goldfishStages = egmBlueprint.stages.filter((s) => s.contextIsolation === "goldfish");
  assert.deepEqual(
    goldfishStages.map((s) => s.id),
    ["spec_audit", "drift_audit"],
  );
  assert.equal(goldfishStages.every((s) => s.requiresSandbox === false && s.useCodeMode === true), true);
});

test("ModelRouter: the project's own model and the app default are reachable, and unavailable profile models are skipped", () => {
  const stage = openSpecBlueprint.stages.find((s) => s.id === "propose_delta")!; // role: reasoning
  const base: ModelRoutingConfig = {
    profile: "max-quality",
    appDefault: { provider: "openai", model: "gpt-5-mini" },
    compliance: { euOnlyMode: false },
  };
  // The profile's model is used when it can be used here...
  assert.equal(resolveStageModel(stage, base).ref.model, "claude-opus-4-5");
  // ...but not when the provider isn't set up: the app's own model is used instead of failing later.
  const none = resolveStageModel(stage, base, undefined, { available: () => false });
  assert.equal(none.source, "app-default");
  assert.equal(none.ref.model, "gpt-5-mini");
  // A project that names a model gets it, ahead of the profile's.
  const project = resolveStageModel(stage, { ...base, projectOverride: { provider: "mistral", model: "mistral-large-latest" } });
  assert.equal(project.source, "project-override");
  assert.equal(project.ref.model, "mistral-large-latest");
  // A project that never chose a profile keeps the session's model.
  const keep = resolveStageModel(stage, base, undefined, { useProfileRoles: false });
  assert.equal(keep.source, "app-default");
  // A stage override still wins over everything.
  const pinned = resolveStageModel(stage, { ...base, projectOverride: { provider: "mistral", model: "x" }, stageOverrides: { propose_delta: { provider: "openai", model: "gpt-5" } } });
  assert.equal(pinned.source, "stage-override");
});
