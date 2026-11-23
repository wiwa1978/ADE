import { useEffect, useState } from "react"
import { request } from "../../api"

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

/** "7 stages · you approve 2" */
export function stagesLine(option: BlueprintOption) {
  if (!option.stages.length) return "No stages"
  const gates = option.stages.filter(stage => stage.approvalGate !== "never").length
  return `${option.stages.length} stages${gates ? ` · you approve ${gates}` : ""}`
}
