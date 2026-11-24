import { Circle, Eye, GitMerge, GitPullRequest, Loader2, MessageCircle, ShieldQuestion, Stamp, TriangleAlert, XCircle, type LucideIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { request, requestJson } from "../api"
import { t, type TranslationKey } from "./i18n"

/** Mirrors runtime/inbox.ts. One vocabulary for session status everywhere in the UI. */
export type SessionState =
  | "working"
  | "stage-approval"
  | "needs-approval"
  | "failed"
  | "checks-failing"
  | "ready-to-review"
  | "pr-open"
  | "replied"
  | "merged"
  | "idle"

export type InboxEntry = {
  sessionId: string
  state: SessionState
  needsYou: boolean
  pendingApprovals: number
  uncommitted: number
  commitsAhead: number
  pullRequest: { number: number; url: string; state: "OPEN" | "CLOSED" | "MERGED"; isDraft: boolean; checksSummary: "none" | "pending" | "success" | "failure"; reviewDecision: string | null } | null
  updatedAt: number | null
  /** The blueprint stage waiting for your approval, if any. */
  stage?: string
}

/** Compact icon per state, for narrow places like the sidebar (the label is its tooltip). */
export const sessionStateIcon: Record<SessionState, LucideIcon> = {
  "working": Loader2,
  "stage-approval": Stamp,
  "needs-approval": ShieldQuestion,
  "failed": XCircle,
  "checks-failing": TriangleAlert,
  "ready-to-review": Eye,
  "pr-open": GitPullRequest,
  "replied": MessageCircle,
  "merged": GitMerge,
  "idle": Circle,
}

type SessionStateTone = "running" | "waiting" | "failed" | "ok" | "review" | "merged" | "idle"
type SessionStateSpec = { labelKey: TranslationKey; tone: SessionStateTone; hintKey: TranslationKey }

const sessionStateSpecs: Record<SessionState, SessionStateSpec> = {
  "working": { labelKey: "session.state.working.label", tone: "running", hintKey: "session.state.working.hint" },
  "stage-approval": { labelKey: "session.state.stageApproval.label", tone: "waiting", hintKey: "session.state.stageApproval.hint" },
  "needs-approval": { labelKey: "session.state.needsApproval.label", tone: "waiting", hintKey: "session.state.needsApproval.hint" },
  "failed": { labelKey: "session.state.failed.label", tone: "failed", hintKey: "session.state.failed.hint" },
  "checks-failing": { labelKey: "session.state.checksFailing.label", tone: "failed", hintKey: "session.state.checksFailing.hint" },
  "ready-to-review": { labelKey: "session.state.readyToReview.label", tone: "review", hintKey: "session.state.readyToReview.hint" },
  "pr-open": { labelKey: "session.state.prOpen.label", tone: "ok", hintKey: "session.state.prOpen.hint" },
  "replied": { labelKey: "session.state.replied.label", tone: "ok", hintKey: "session.state.replied.hint" },
  "merged": { labelKey: "session.state.merged.label", tone: "merged", hintKey: "session.state.merged.hint" },
  "idle": { labelKey: "session.state.idle.label", tone: "idle", hintKey: "session.state.idle.hint" },
}

/** Label, tone (dot color), and a one-line hint for each state (localized dynamically). */
export const sessionStateInfo: Record<SessionState, { label: string; tone: SessionStateTone; hint: string }> = new Proxy(
  {} as Record<SessionState, { label: string; tone: SessionStateTone; hint: string }>,
  {
    get(_target, prop: string) {
      const spec = sessionStateSpecs[prop as SessionState]
      if (!spec) return undefined
      return { label: t(spec.labelKey), tone: spec.tone, hint: t(spec.hintKey) }
    },
  },
)

/** Polls the host's inbox; refreshes immediately when `refreshKey` changes (e.g. a session update). */
export function useInbox(refreshKey: unknown, enabled = true) {
  const [entries, setEntries] = useState<Record<string, InboxEntry>>({})
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const result = await request<{ entries: InboxEntry[] }>("/api/inbox")
      setEntries(Object.fromEntries(result.entries.map(entry => [entry.sessionId, entry])))
    } catch {
      // The runtime may be restarting; keep the last known state.
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const tick = () => {
      void request<{ entries: InboxEntry[] }>("/api/inbox")
        .then(result => { if (!cancelled) setEntries(Object.fromEntries(result.entries.map(entry => [entry.sessionId, entry]))) })
        .catch(() => { /* The runtime may be restarting; keep the last known state. */ })
    }
    tick()
    const timer = window.setInterval(tick, 8000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [enabled, refreshKey])

  const markSeen = useCallback(async (sessionId: string) => {
    setEntries(prev => prev[sessionId] ? { ...prev, [sessionId]: { ...prev[sessionId], needsYou: prev[sessionId].state === "needs-approval" || prev[sessionId].state === "stage-approval" || prev[sessionId].state === "checks-failing" } } : prev)
    try {
      await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/seen`, "POST")
    } catch {
      // Not critical: the session will simply stay in the inbox until the next visit.
    }
  }, [])

  return { entries, refresh, markSeen }
}

export function relativeTime(timestamp: number | null | undefined) {
  if (!timestamp) return ""
  const minutes = Math.round((Date.now() - timestamp) / 60000)
  if (minutes < 1) return t("common.justNow")
  if (minutes < 60) return t("common.minutesAgo", { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return t("common.hoursAgo", { count: hours })
  return t("common.daysAgo", { count: Math.round(hours / 24) })
}
