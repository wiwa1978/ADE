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
