import type {
  BlueprintStage,
  FailureObservation,
  RepoMicroSkill,
  TokenSavingsReport,
  ToolDescriptor,
  ToolUsageRecord,
} from "../protocol/index.ts";

const DEFAULT_TOOL_SCHEMA_TOKENS = 180;

export type ToolPruningResult = {
  allowedTools: ToolDescriptor[];
  prunedTools: ToolDescriptor[];
  estimatedTokensSavedPerTurn: number;
};

/**
 * TokenEconomizer Mechanism 1: Stage-scoped + history-based persistent tool pruning.
 * Prevents stages from paying input tokens for irrelevant or persistently unused tool schemas.
 */
export function pruneToolsForStage(
  allTools: readonly ToolDescriptor[],
  stage: Pick<BlueprintStage, "allowedToolGroups">,
  usageHistory: readonly ToolUsageRecord[] = [],
  opts: { minSessionsBeforePrune?: number } = {},
): ToolPruningResult {
  const minSessions = opts.minSessionsBeforePrune ?? 5;
  const allowedGroupSet = new Set(stage.allowedToolGroups);
  const usageByName = new Map(usageHistory.map((u) => [u.toolName, u]));

  const allowedTools: ToolDescriptor[] = [];
  const prunedTools: ToolDescriptor[] = [];

  for (const tool of allTools) {
    const inStageScope = allowedGroupSet.has(tool.group);
    const usage = usageByName.get(tool.name);
    const persistentlyUnused =
      usage !== undefined && usage.sessionsSeen >= minSessions && usage.calls === 0;

    if (inStageScope && !persistentlyUnused) {
      allowedTools.push(tool);
    } else {
      prunedTools.push(tool);
    }
  }

  const estimatedTokensSavedPerTurn = prunedTools.reduce(
    (sum, tool) => sum + (tool.estimatedSchemaTokens ?? DEFAULT_TOOL_SCHEMA_TOKENS),
    0,
  );

  return { allowedTools, prunedTools, estimatedTokensSavedPerTurn };
}

/**
 * TokenEconomizer Mechanism 2: Repo-specific micro-skills injection.
 * Formats verified repo operational facts into a compact prompt prefix so agents skip trial-and-error.
 */
export function formatMicroSkillsContext(
  skills: readonly RepoMicroSkill[],
  maxItems = 12,
): string {
  if (!skills.length) return "";
  const ranked = [...skills]
    .sort((a, b) => b.confidence - a.confidence || b.learnedAt - a.learnedAt)
    .slice(0, maxItems);
  const lines = ranked.map((s) => `- [${s.category}] ${s.fact}`);
  return [
    "## Verified Repository Micro-Skills (Learned from Prior Runs)",
    "Follow these verified commands and quirks instead of re-discovering them:",
    ...lines,
  ].join("\n");
}

export type LoopWatchdogDecision =
  | { action: "continue"; consecutiveCount: number }
  | { action: "intervene"; consecutiveCount: number; reason: string; suggestedAction: string }
  | { action: "escalate_human"; consecutiveCount: number; reason: string };

/**
 * TokenEconomizer Mechanism 3: Failure-Loop Watchdog.
 * Detects repetitive identical command/test failures or circular edit loops before they drain
 * API tokens and sandbox VM minutes.
 */
export class FailureLoopWatchdog {
  readonly #interveneThreshold: number;
  readonly #escalateThreshold: number;
  readonly #observations = new Map<string, FailureObservation[]>();
  #interventionCount = 0;

  constructor(opts: { interveneAfter?: number; escalateAfter?: number } = {}) {
    this.#interveneThreshold = opts.interveneAfter ?? 3;
    this.#escalateThreshold = opts.escalateAfter ?? 5;
  }

  recordFailure(obs: FailureObservation): LoopWatchdogDecision {
    const key = `${obs.stageId}::${obs.subagentId}`;
    const list = this.#observations.get(key) ?? [];
    list.push(obs);
    this.#observations.set(key, list);

    let consecutive = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].signature === obs.signature) consecutive++;
      else break;
    }

    if (consecutive >= this.#escalateThreshold) {
      this.#interventionCount++;
      return {
        action: "escalate_human",
        consecutiveCount: consecutive,
        reason: `Subagent "${obs.subagentId}" hit the same failure "${obs.commandOrTool}" ${consecutive} times in a row: ${obs.errorExcerpt}`,
      };
    }

    if (consecutive >= this.#interveneThreshold) {
      this.#interventionCount++;
      return {
        action: "intervene",
        consecutiveCount: consecutive,
        reason: `Detected failure loop (${consecutive}x identical "${obs.commandOrTool}" errors).`,
        suggestedAction:
          "Pause current edit cycle, re-read the error and full file context, or switch implementation strategy before retrying.",
      };
    }

    return { action: "continue", consecutiveCount: consecutive };
  }

  recordSuccess(stageId: string, subagentId: string): void {
    this.#observations.delete(`${stageId}::${subagentId}`);
  }

  get interventionCount(): number {
    return this.#interventionCount;
  }
}

export function estimateTokenSavings(params: {
  prunedToolTokensPerTurn: number;
  turnsExecuted: number;
  loopInterventions: number;
  sandboxMinutesAvoided: number;
  blendedInputUsdPerMillion?: number;
}): TokenSavingsReport {
  const rate = params.blendedInputUsdPerMillion ?? 3.0;
  const fromToolPruning = params.prunedToolTokensPerTurn * params.turnsExecuted;
  // Conservative estimate: each prevented failure loop saves ~12k tokens of wasted retries
  const fromLoopInterventions = params.loopInterventions * 12_000;
  const estimatedTokensSaved = fromToolPruning + fromLoopInterventions;
  const estimatedUsdSaved = Number(((estimatedTokensSaved / 1_000_000) * rate).toFixed(4));

  return {
    prunedToolTokensPerTurn: params.prunedToolTokensPerTurn,
    loopInterventions: params.loopInterventions,
    sandboxMinutesAvoided: params.sandboxMinutesAvoided,
    estimatedTokensSaved,
    estimatedUsdSaved,
  };
}
