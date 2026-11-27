import { isSessionBlueprint } from "./index.ts";

const VIBE_ID = "vibe";

export type StarterRecipeCategory = "bugs" | "quality" | "security" | "maintenance";

export type StarterRecipeTrigger =
  | { type: "manual" }
  | { type: "schedule"; every: "hourly" | "daily" | "weekdays" | "weekly"; at: string; day?: number }
  | { type: "issue-label"; label: string };

export type StarterRecipe = {
  id: string;
  name: string;
  summary: string;
  category: StarterRecipeCategory;
  blueprintId: string;
  prompt: string;
  automationPrompt?: string;
  suggestedTrigger: StarterRecipeTrigger;
  requiresGitHub?: boolean;
};

export const STARTER_RECIPES: readonly StarterRecipe[] = [
  {
    id: "bug-repro",
    name: "Reproduce bug with failing test",
    summary: "Write a minimal failing regression test for a bug first, verify it fails, then implement and verify the fix.",
    category: "bugs",
    blueprintId: "automated-factory",
    prompt:
      "Reproduce the reported bug with a minimal failing automated test first. Confirm the test fails for the right reason, then implement the smallest clean fix, re-run the full test suite, and summarize root cause and verification.",
    automationPrompt:
      "Reproduce the bug described in {{issue}} with a minimal failing automated test first. Confirm it fails for the right reason, then implement the smallest clean fix, verify all checks pass, and prepare a PR.",
    suggestedTrigger: { type: "issue-label", label: "bug" },
    requiresGitHub: true,
  },
  {
    id: "pr-audit",
    name: "Independent PR & drift audit",
    summary: "Audit branch or PR changes for regressions, security edge cases, and spec drift using an independent reviewer.",
    category: "quality",
    blueprintId: "egm",
    prompt:
      "Audit the current branch diff against main for logic bugs, security regressions, missing edge-case tests, and drift from docs/specs. Produce a structured findings report ranked by severity with exact file and line references.",
    suggestedTrigger: { type: "manual" },
  },
  {
    id: "test-coverage",
    name: "Nightly test coverage sweep",
    summary: "Find high-risk uncovered modules from recent changes, add focused unit tests, and open a clean PR.",
    category: "quality",
    blueprintId: "automated-factory",
    prompt:
      "Inspect recently modified source files for untested branches, error paths, and edge cases. Add focused, deterministic unit tests for the highest-risk gaps, verify lint/typecheck/tests pass, and summarize the added coverage.",
    suggestedTrigger: { type: "schedule", every: "weekdays", at: "02:00" },
  },
  {
    id: "cve-patch",
    name: "Dependency & CVE reachability patch",
    summary: "Audit vulnerable dependencies, verify whether each CVE is reachable in this codebase, and apply safe upgrades.",
    category: "security",
    blueprintId: "automated-factory",
    prompt:
      "Audit project dependencies for known security vulnerabilities (CVEs). For each finding, determine whether the vulnerable code path is reachable in this repo, apply minimal safe upgrades, run build/lint/tests, and report reachability and changes.",
    suggestedTrigger: { type: "schedule", every: "weekly", day: 1, at: "07:00" },
  },
  {
    id: "changelog-sync",
    name: "Changelog & release notes sync",
    summary: "Review commits and merged PRs since the last tag and update CHANGELOG.md with grouped user-facing notes.",
    category: "maintenance",
    blueprintId: VIBE_ID,
    prompt:
      "Review commits since the latest git tag (or the last 30 commits if untagged), group user-facing features, fixes, and breaking changes, and update CHANGELOG.md clearly without inventing unverified changes.",
    suggestedTrigger: { type: "schedule", every: "weekly", day: 5, at: "16:00" },
  },
];

const RECIPE_MAP = new Map<string, StarterRecipe>(
  STARTER_RECIPES.map((recipe) => [recipe.id, recipe]),
);

export function listStarterRecipes(): StarterRecipe[] {
  return [...STARTER_RECIPES];
}

export function getStarterRecipe(id: string): StarterRecipe | undefined {
  return RECIPE_MAP.get(id);
}

export function validateStarterRecipes(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const recipe of STARTER_RECIPES) {
    if (!recipe.id || !/^[a-z0-9-]+$/.test(recipe.id)) {
      errors.push(`Invalid recipe id "${recipe.id}".`);
    }
    if (ids.has(recipe.id)) errors.push(`Duplicate recipe id "${recipe.id}".`);
    ids.add(recipe.id);
    if (!recipe.name.trim()) errors.push(`Recipe "${recipe.id}" is missing a name.`);
    if (!recipe.prompt.trim()) errors.push(`Recipe "${recipe.id}" is missing a prompt.`);
    if (!isSessionBlueprint(recipe.blueprintId)) {
      errors.push(`Recipe "${recipe.id}" references unknown blueprint "${recipe.blueprintId}".`);
    }
  }
  return { valid: errors.length === 0, errors };
}
