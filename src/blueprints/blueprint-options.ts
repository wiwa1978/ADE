import { t } from "../i18n"
import { useEffect, useState } from "react"
import { request } from "../api"

export type GateMode = "never" | "before" | "after"
export type BlueprintOption = {
  id: string
  name: string
  description: string
  bestFor: string
  stages: { id: string; name: string; approvalGate: GateMode }[]
}

export const VIBE_ID = "vibe"

let cached: BlueprintOption[] | null = null
let pending: Promise<BlueprintOption[]> | null = null

function load() {
  pending ??= request<{ blueprints: BlueprintOption[] }>("/api/blueprints/session-options")
    .then(result => {
      const list = Array.isArray(result?.blueprints) ? result.blueprints : []
      if (list.length) cached = list
      return list
    })
    .finally(() => { pending = null })
  return pending
}

/** The ways of working a session can use: Vibe coding first, then the blueprints. */
export function useBlueprintOptions() {
  const [options, setOptions] = useState<BlueprintOption[]>(cached ?? [])
  useEffect(() => {
    if (cached) return
    let cancelled = false
    void load().then(result => { if (!cancelled) setOptions(result) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  return options
}

/** "Spec Kit (Greenfield)" → "Spec Kit": the short name for pills and bars. */
export function shortBlueprintName(name: string) {
  return name.replace(/\s*\(.*\)\s*$/, "")
}

export type StarterRecipeTrigger =
  | { type: "manual" }
  | { type: "schedule"; every: "hourly" | "daily" | "weekdays" | "weekly"; at: string; day?: number }
  | { type: "issue-label"; label: string }

export type StarterRecipeOption = {
  id: string
  name: string
  summary: string
  category: "bugs" | "quality" | "security" | "maintenance"
  blueprintId: string
  prompt: string
  automationPrompt?: string
  suggestedTrigger: StarterRecipeTrigger
  requiresGitHub?: boolean
}

let cachedRecipes: StarterRecipeOption[] | null = null
let pendingRecipes: Promise<StarterRecipeOption[]> | null = null

function loadRecipes() {
  pendingRecipes ??= request<{ recipes: StarterRecipeOption[] }>("/api/recipes")
    .then(result => {
      const list = Array.isArray(result?.recipes) ? result.recipes : []
      if (list.length) cachedRecipes = list
      return list
    })
    .finally(() => { pendingRecipes = null })
  return pendingRecipes
}

/** Task-shaped starter recipes built on top of blueprints and automations. */
export function useStarterRecipes() {
  const [recipes, setRecipes] = useState<StarterRecipeOption[]>(cachedRecipes ?? [])
  useEffect(() => {
    if (cachedRecipes) return
    let cancelled = false
    void loadRecipes().then(result => { if (!cancelled) setRecipes(result) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  return recipes
}

/** "7 stages · you approve 2" */
export function stagesLine(option: BlueprintOption) {
  if (!option.stages.length) return t("stg.noStagesShort")
  const gates = option.stages.filter(stage => stage.approvalGate !== "never").length
  return `${option.stages.length} stages${gates ? ` · you approve ${gates}` : ""}`
}
