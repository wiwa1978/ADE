import type {
  BlueprintRunState,
  BlueprintStage,
  FactoryBlueprint,
  ModelRoutingConfig,
  StageVerdict,
} from "../protocol/index.ts";
import { resolveStageModel } from "./model-router.ts";

export type NextStageAction =
  | { kind: "await_approval"; stage: BlueprintStage; gateMoment: "before" | "after" }
  | {
      kind: "execute_stage";
      stage: BlueprintStage;
      requiresSandbox: boolean;
      contextIsolation: "elephant" | "goldfish";
      useCodeMode: boolean;
    }
  | { kind: "completed" }
  | { kind: "failed"; reason: string };

/**
 * Pure, deterministic state machine for Seam 1 (BlueprintEngine).
 * Drives any declarative FactoryBlueprint without hardcoded methodology branches.
 */
export function createBlueprintRun(params: {
  runId: string;
  projectId: string;
  blueprint: FactoryBlueprint;
  disabledStageIds?: string[];
  issueRef?: BlueprintRunState["issueRef"];
  maxAuditLoopbacks?: number;
  now?: number;
}): BlueprintRunState {
  const now = params.now ?? Date.now();
  const disabled = new Set(params.disabledStageIds ?? []);

  return {
    runId: params.runId,
    projectId: params.projectId,
    blueprintId: params.blueprint.id,
    ...(params.issueRef ? { issueRef: params.issueRef } : {}),
    status: "idle",
    currentStageIndex: 0,
    stages: params.blueprint.stages.map((stage) => ({
      stageId: stage.id,
      status: disabled.has(stage.id) ? "skipped" : "pending",
      attempt: 0,
      sandboxAttached: false,
      artifactPaths: [],
    })),
    disabledStageIds: [...disabled],
    maxAuditLoopbacks: params.maxAuditLoopbacks ?? 2,
    auditLoopbacksUsed: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Advances the run to the next actionable decision (execute stage, pause for human approval, or finish).
 */
export function planNextStep(
  run: BlueprintRunState,
  blueprint: FactoryBlueprint,
  modelConfig: ModelRoutingConfig,
  now = Date.now(),
): { run: BlueprintRunState; action: NextStageAction } {
  const nextRun: BlueprintRunState = {
    ...run,
    stages: run.stages.map((s) => ({ ...s })),
    updatedAt: now,
  };

  // Skip already completed/skipped stages
  while (nextRun.currentStageIndex < blueprint.stages.length) {
    const state = nextRun.stages[nextRun.currentStageIndex];
    if (state.status === "completed" || state.status === "skipped") {
      nextRun.currentStageIndex++;
      continue;
    }
    break;
  }

  if (nextRun.currentStageIndex >= blueprint.stages.length) {
    nextRun.status = "completed";
    return { run: nextRun, action: { kind: "completed" } };
  }

  const stage = blueprint.stages[nextRun.currentStageIndex];
  const stageState = nextRun.stages[nextRun.currentStageIndex];

  if (stageState.status === "awaiting_approval") {
    const gateMoment = stageState.attempt === 0 ? "before" : "after";
    nextRun.status = "awaiting_human";
    return { run: nextRun, action: { kind: "await_approval", stage, gateMoment } };
  }

  if (stageState.status === "pending" && stage.approvalGate === "before") {
    stageState.status = "awaiting_approval";
    nextRun.status = "awaiting_human";
    return { run: nextRun, action: { kind: "await_approval", stage, gateMoment: "before" } };
  }

  // Resolve model (enforces EU-Only Mode fail-closed before stage starts)
  const resolvedModel = resolveStageModel(stage, modelConfig);
  stageState.status = "running";
  stageState.attempt += 1;
  stageState.startedAt = now;
  stageState.resolvedModel = resolvedModel;
  stageState.sandboxAttached = stage.requiresSandbox;
  nextRun.status = "running";

  return {
    run: nextRun,
    action: {
      kind: "execute_stage",
      stage,
      requiresSandbox: stage.requiresSandbox,
      contextIsolation: stage.contextIsolation,
      useCodeMode: stage.useCodeMode,
    },
  };
}

/**
 * Records stage completion (including Goldfish audit verdicts & bounded automatic loop-backs).
 */
export function completeStage(
  run: BlueprintRunState,
  blueprint: FactoryBlueprint,
  params: {
    stageId: string;
    artifactPaths?: string[];
    verdict?: StageVerdict;
    now?: number;
  },
): { run: BlueprintRunState; loopedBackTo?: string; requiresHumanEscalation?: boolean } {
  const now = params.now ?? Date.now();
  const idx = blueprint.stages.findIndex((s) => s.id === params.stageId);
  if (idx === -1) throw new Error(`Stage "${params.stageId}" not found in blueprint "${blueprint.id}".`);

  const nextRun: BlueprintRunState = {
    ...run,
    stages: run.stages.map((s) => ({ ...s, artifactPaths: [...s.artifactPaths] })),
    updatedAt: now,
  };

  const stage = blueprint.stages[idx];
  const stageState = nextRun.stages[idx];
  stageState.endedAt = now;
  stageState.sandboxAttached = false;
  if (params.artifactPaths?.length) {
    stageState.artifactPaths = [...new Set([...stageState.artifactPaths, ...params.artifactPaths])];
  }
  if (params.verdict) {
    stageState.verdict = params.verdict;
  }

  // Handle Goldfish / Critic audit requesting changes -> loop back to target stage if budget remains
  if (params.verdict?.outcome === "changes_requested" && stage.onChangesRequestedStageId) {
    if (nextRun.auditLoopbacksUsed < nextRun.maxAuditLoopbacks) {
      const targetIdx = blueprint.stages.findIndex((s) => s.id === stage.onChangesRequestedStageId);
      if (targetIdx !== -1) {
        nextRun.auditLoopbacksUsed += 1;
        stageState.status = "changes_requested";
        for (let i = targetIdx; i <= idx; i++) {
          if (!nextRun.disabledStageIds.includes(blueprint.stages[i].id)) {
            nextRun.stages[i].status = "pending";
          }
        }
        nextRun.currentStageIndex = targetIdx;
        nextRun.status = "running";
        return { run: nextRun, loopedBackTo: stage.onChangesRequestedStageId };
      }
    }
    // Loopback budget exhausted -> escalate to human
    stageState.status = "awaiting_approval";
    nextRun.status = "awaiting_human";
    return { run: nextRun, requiresHumanEscalation: true };
  }

  if (params.verdict?.outcome === "escalate_human") {
    stageState.status = "awaiting_approval";
    nextRun.status = "awaiting_human";
    return { run: nextRun, requiresHumanEscalation: true };
  }

  if (stage.approvalGate === "after") {
    stageState.status = "awaiting_approval";
    nextRun.status = "awaiting_human";
    return { run: nextRun };
  }

  stageState.status = "completed";
  nextRun.currentStageIndex = idx + 1;
  if (nextRun.currentStageIndex >= blueprint.stages.length) {
    nextRun.status = "completed";
  }
  return { run: nextRun };
}

/**
 * Applies a human approval/rejection decision from the single-Captain thread.
 */
export function applyStageApproval(
  run: BlueprintRunState,
  blueprint: FactoryBlueprint,
  decision: "approve" | "request_changes" | "cancel",
  now = Date.now(),
): BlueprintRunState {
  const nextRun: BlueprintRunState = {
    ...run,
    stages: run.stages.map((s) => ({ ...s })),
    updatedAt: now,
  };
  const stage = blueprint.stages[nextRun.currentStageIndex];
  const stageState = nextRun.stages[nextRun.currentStageIndex];
  if (!stage || !stageState) return nextRun;

  if (decision === "cancel") {
    nextRun.status = "cancelled";
    return nextRun;
  }

  if (decision === "request_changes") {
    // Re-run the current stage (for an "after" gate)
    stageState.status = "pending";
    nextRun.status = "running";
    return nextRun;
  }

  // Approved:
  if (stageState.attempt === 0 && stage.approvalGate === "before") {
    // Ready to execute now; keep stage as pending-approved by transitioning to running via next planNextStep
    // Mark as running-ready by temporarily setting status to "running" with attempt 0 handled cleanly:
    stageState.status = "running";
    nextRun.status = "running";
  } else {
    stageState.status = "completed";
    nextRun.currentStageIndex += 1;
    nextRun.status = nextRun.currentStageIndex >= blueprint.stages.length ? "completed" : "running";
  }
  return nextRun;
}
