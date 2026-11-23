import { useCallback, useEffect, useState } from "react"
import { request } from "../../api"

export type StageStatus = "pending" | "awaiting_approval" | "running" | "completed" | "changes_requested" | "skipped" | "failed"
export type StageVerdict = { outcome: "pass" | "changes_requested" | "escalate_human"; summary: string; findings?: { severity: "blocker" | "major" | "minor"; file?: string; message: string }[] }
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
  startedAt: number | null
  endedAt: number | null
}
export type SessionStages = {
  blueprintId: string
  name: string
  summary: { id: string; name: string; status: string; stage?: { id: string; name: string; status: StageStatus; index: number }; done: number; total: number } | null
  stages: StageView[]
  history: Array<{ at: number; stageId: string; event: "started" | "finished" | "approved" | "changes_requested" | "looped_back" | "escalated"; note?: string }>
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

export const stageStatusLabel: Record<StageStatus, string> = {
  pending: "Not started",
  awaiting_approval: "Waiting for you",
  running: "In progress",
  completed: "Done",
  changes_requested: "Changes requested",
  skipped: "Skipped",
  failed: "Failed",
}

/** "Plan · waiting for your approval" for the slim bar and tags. */
export function stageStatusPhrase(status: StageStatus, attempt = 1) {
  if (status === "awaiting_approval") return attempt === 0 ? "approve to start" : "waiting for your approval"
  if (status === "running") return "in progress"
  return stageStatusLabel[status].toLowerCase()
}
