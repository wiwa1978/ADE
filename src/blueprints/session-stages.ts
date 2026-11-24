import { t } from "../i18n"
import { useCallback, useEffect, useState } from "react"
import { request } from "../../api"

export type StageStatus = "pending" | "awaiting_approval" | "running" | "completed" | "changes_requested" | "skipped" | "failed"
export type StageVerdict = { outcome: "pass" | "changes_requested" | "escalate_human"; summary: string; findings?: { severity: "blocker" | "major" | "minor"; file?: string; message: string }[] }
export type StageCheckResult = { label: string; command: string; status: "passed" | "failed" | "skipped"; exitCode: number | null; output: string; ms: number }
/** ADE's own run of a stage's checks (build, lint, test…). */
export type StageChecksView = { source: "project" | "package" | "none"; results: StageCheckResult[]; missing: string[]; ok: boolean; at: number }
export type StageView = {
  id: string
  name: string
  description: string
  status: StageStatus
  attempt: number
  gate: "never" | "before" | "after"
  executor: "captain" | "subagent" | "parallel_subagents" | "deterministic_hook"
  goldfish: boolean
  artifactPaths: string[]
  summary: string | null
  verdict: StageVerdict | null
  checks: StageChecksView | null
  /** The independent review, for review stages. */
  review: { model: string | null; independent: boolean; status: "running" | "completed" | "failed"; report: string } | null
  startedAt: number | null
  endedAt: number | null
}
export type SessionStages = {
  blueprintId: string
  name: string
  summary: { id: string; name: string; status: string; stage?: { id: string; name: string; status: StageStatus; index: number }; done: number; total: number } | null
  stages: StageView[]
  history: Array<{ at: number; stageId: string; event: "started" | "finished" | "approved" | "changes_requested" | "looped_back" | "escalated" | "checks_passed" | "checks_failed"; note?: string }>
  /** Set after a decision when the agent couldn't be started. */
  notice?: string | null
}

/** A session's stages, reloaded whenever `refreshKey` changes (the session's summary or status). */
export function useSessionStages(sessionId: string | null, refreshKey: string) {
  const [stages, setStages] = useState<SessionStages | null>(null)
  const [prevId, setPrevId] = useState(sessionId)
  if (prevId !== sessionId) {
    setPrevId(sessionId)
    setStages(null)
  }
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void request<SessionStages>(`/api/sessions/${encodeURIComponent(sessionId)}/stages`)
      .then(result => { if (!cancelled) setStages(result) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [sessionId, refreshKey, tick])
  const reload = useCallback(() => setTick(value => value + 1), [])
  return { stages, setStages, reload }
}

/** Status names in the active language (a function, so they follow a language change). */
export const stageStatusLabel: Record<StageStatus, string> = {
  get pending() { return t("stg.status.pending") },
  get awaiting_approval() { return t("stg.status.awaiting") },
  get running() { return t("stg.status.running") },
  get completed() { return t("stg.status.completed") },
  get changes_requested() { return t("stg.status.changes") },
  get skipped() { return t("stg.status.skipped") },
  get failed() { return t("stg.status.failed") },
}

/** "Plan · waiting for your approval" for the slim bar and tags. */
export function stageStatusPhrase(status: StageStatus, attempt = 1) {
  if (status === "awaiting_approval") return attempt === 0 ? t("stg.phase.approveToStart") : t("stg.phase.waiting")
  if (status === "running") return t("stg.phase.running")
  return stageStatusLabel[status].toLowerCase()
}
