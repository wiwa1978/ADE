import { Circle, Eye, GitMerge, GitPullRequest, Loader2, MessageCircle, ShieldQuestion, Stamp, TriangleAlert, XCircle, type LucideIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { request } from "../api"

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

/** Label, tone (dot color), and a one-line hint for each state. */
export const sessionStateInfo: Record<SessionState, { label: string; tone: "running" | "waiting" | "failed" | "ok" | "review" | "merged" | "idle"; hint: string }> = {
  "working": { label: "Working", tone: "running", hint: "The agent is working." },
  "stage-approval": { label: "Approve stage", tone: "waiting", hint: "A blueprint stage is ready for your review: approve it or ask for changes." },
  "needs-approval": { label: "Needs approval", tone: "waiting", hint: "A command is waiting for you to allow or deny it." },
  "failed": { label: "Failed", tone: "failed", hint: "The last turn ended with an error." },
  "checks-failing": { label: "Checks failing", tone: "failed", hint: "The pull request's checks are failing." },
  "ready-to-review": { label: "Ready to review", tone: "review", hint: "There are changes to review, commit, or open as a pull request." },
  "pr-open": { label: "PR open", tone: "ok", hint: "A pull request is open." },
  "replied": { label: "Replied", tone: "ok", hint: "The agent replied and is waiting for you." },
  "merged": { label: "Merged", tone: "merged", hint: "The pull request was merged. You can archive this session." },
  "idle": { label: "Idle", tone: "idle", hint: "Nothing is happening." },
}

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
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/seen`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    } catch {
      // Not critical: the session will simply stay in the inbox until the next visit.
    }
  }, [])

  return { entries, refresh, markSeen }
}

export function relativeTime(timestamp: number | null | undefined) {
  if (!timestamp) return ""
  const minutes = Math.round((Date.now() - timestamp) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
