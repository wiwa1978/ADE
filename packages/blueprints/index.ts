import type { BlueprintStage, FactoryBlueprint } from "../protocol/index.ts";
import { automatedFactoryBlueprint } from "./automated-factory.ts";
import { openSpecBlueprint } from "./openspec.ts";
import { specKitBlueprint } from "./speckit.ts";
import { egmBlueprint } from "./egm.ts";
import { squadBlueprint } from "./squad.ts";

export {
  automatedFactoryBlueprint,
  openSpecBlueprint,
  specKitBlueprint,
  egmBlueprint,
  squadBlueprint,
};

export const BUILTIN_BLUEPRINTS: readonly FactoryBlueprint[] = [
  automatedFactoryBlueprint,
  openSpecBlueprint,
  specKitBlueprint,
  egmBlueprint,
  squadBlueprint,
];

const BLUEPRINT_MAP = new Map<string, FactoryBlueprint>(
  BUILTIN_BLUEPRINTS.map((bp) => [bp.id, bp]),
);

export function listBlueprints(): FactoryBlueprint[] {
  return [...BUILTIN_BLUEPRINTS];
}

export function getBlueprint(id: string): FactoryBlueprint | undefined {
  return BLUEPRINT_MAP.get(id);
}

export type BlueprintValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validateBlueprint(blueprint: FactoryBlueprint): BlueprintValidationResult {
  const errors: string[] = [];
  if (!blueprint.id || !/^[a-z0-9][a-z0-9-_]*$/i.test(blueprint.id)) {
    errors.push("Blueprint id must be a non-empty slug.");
  }
  if (!blueprint.name?.trim()) {
    errors.push("Blueprint name is required.");
  }
  if (!Array.isArray(blueprint.stages) || blueprint.stages.length === 0) {
    errors.push("Blueprint must define at least one stage.");
  } else {
    const ids = new Set<string>();
    for (const stage of blueprint.stages) {
      if (!stage.id) errors.push("Every stage must have a non-empty id.");
      if (ids.has(stage.id)) errors.push(`Duplicate stage id: "${stage.id}".`);
      ids.add(stage.id);
    }
    for (const stage of blueprint.stages) {
      if (stage.onChangesRequestedStageId && !ids.has(stage.onChangesRequestedStageId)) {
        errors.push(
          `Stage "${stage.id}" references unknown loopback stage "${stage.onChangesRequestedStageId}".`,
        );
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export type ProjectBlueprintOverride = {
  baseBlueprintId: string;
  stageOverrides?: Record<string, Partial<BlueprintStage>>;
  disabledStageIds?: string[];
};

/**
 * Merges a repo-local `.ade/blueprint.json` override on top of a built-in blueprint
 * without mutating the shared definition.
 */
export function resolveProjectBlueprint(
  override: ProjectBlueprintOverride,
): { blueprint: FactoryBlueprint; disabledStageIds: string[] } {
  const base = getBlueprint(override.baseBlueprintId);
  if (!base) {
    throw new Error(`Unknown base blueprint "${override.baseBlueprintId}".`);
  }
  const stages = base.stages.map((stage) => {
    const patch = override.stageOverrides?.[stage.id];
    return patch ? { ...stage, ...patch, id: stage.id } : { ...stage };
  });
  const merged: FactoryBlueprint = { ...base, stages };
  const validation = validateBlueprint(merged);
  if (!validation.valid) {
    throw new Error(`Invalid blueprint override: ${validation.errors.join("; ")}`);
  }
  return {
    blueprint: merged,
    disabledStageIds: [...new Set(override.disabledStageIds ?? [])],
  };
}

/**
 * Vibe coding: the way of working without stages. A session on Vibe is a free conversation with
 * the main agent (subagents, checks, diff and PR when you choose). It's offered for sessions only;
 * the stage engine never runs it.
 */
export const VIBE_BLUEPRINT_ID = "vibe";

export type SessionBlueprintOption = {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  stages: { id: string; name: string; approvalGate: FactoryBlueprint["stages"][number]["approvalGate"] }[];
};

const BEST_FOR: Record<string, string> = {
  fast: "bug fixes and small or medium features",
  brownfield: "changes to an existing codebase",
  greenfield: "new projects and new features from scratch",
  enterprise: "complex or regulated systems",
};

/** Ways of working a session can use: Vibe first, then the built-in blueprints. */
export function sessionBlueprintOptions(): SessionBlueprintOption[] {
  return [
    {
      id: VIBE_BLUEPRINT_ID,
      name: "Vibe coding",
      description: "No stages: you and the agent decide the work as you go.",
      bestFor: "exploring, prototypes and anything that doesn't fit a recipe",
      stages: [],
    },
    ...BUILTIN_BLUEPRINTS.map((blueprint) => ({
      id: blueprint.id,
      name: blueprint.name,
      description: blueprint.description,
      bestFor: BEST_FOR[blueprint.bestFor] ?? blueprint.bestFor,
      stages: blueprint.stages.map((stage) => ({ id: stage.id, name: stage.name, approvalGate: stage.approvalGate })),
    })),
  ];
}

export function isSessionBlueprint(id: string) {
  return id === VIBE_BLUEPRINT_ID || BLUEPRINT_MAP.has(id);
}
