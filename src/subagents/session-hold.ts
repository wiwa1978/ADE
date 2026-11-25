import { useEffect, useState } from "react"
import { request } from "../../api"
import { formatTime } from "../i18n"

export type UsageWait = { until: number; reason: string; tries: number; fallback?: string }
export type SessionHold = {
  /** Stopped by a time or cost limit. */
  stop: { at: number; reason: string; kind: "time" | "cost" | "day" } | null
  /** Waiting for the main agent's usage limit to reset. */
  usageWait: UsageWait | null
  usageWaits: Array<UsageWait & { subagentId: string }>
  /** Claude Code / Codex subagents waiting for room on this machine. */
  queued: Array<{ subagentId: string; position: number }>
}

const EMPTY: SessionHold = { stop: null, usageWait: null, usageWaits: [], queued: [] }

export function clock(at: number) {
  return formatTime(at)
}

/** Why a session's agents aren't running by themselves right now; refreshed while the session is open. */
export function useSessionHold(sessionId: string | null | undefined, busy: boolean) {
  const [hold, setHold] = useState<SessionHold>(EMPTY)
  const [prevId, setPrevId] = useState(sessionId)
  if (prevId !== sessionId) {
    setPrevId(sessionId)
    setHold(EMPTY)
  }
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    const load = () => {
      void request<SessionHold>(`/api/sessions/${encodeURIComponent(sessionId)}/hold`)
        .then(result => { if (!cancelled) setHold({ ...EMPTY, ...result }) })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId, busy])
  return hold
}
