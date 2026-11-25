import { useEffect, useRef } from "react"
import type { Conversation, PendingApproval } from "../../../app-types"

export function useDesktopNotifications(params: {
  sessions: Conversation[]
  approvals: PendingApproval[]
  notifyOnFinish: boolean
  notifyOnApproval: boolean
  onOpenSession: (id: string) => void
}) {
  const { sessions, approvals, notifyOnFinish, notifyOnApproval, onOpenSession } = params
  const previousStatuses = useRef<Map<string, string>>(new Map())
  const notifiedApprovals = useRef<Set<string>>(new Set())

  useEffect(() => {
    const canNotify = typeof Notification !== "undefined" && Notification.permission === "granted" && !document.hasFocus()
    for (const sess of sessions) {
      const before = previousStatuses.current.get(sess.id)
      if (canNotify && notifyOnFinish && before === "working" && sess.status === "idle") {
        const last = [...sess.messages].reverse().find(m => m.role !== "user")
        const notification = new Notification(`${sess.label} finished`, {
          body: last?.role === "error" ? `Error: ${last.content.slice(0, 140)}` : "The agent is waiting for your next message.",
          tag: `finish-${sess.id}`,
        })
        notification.onclick = () => { window.focus(); onOpenSession(sess.id) }
      }
      previousStatuses.current.set(sess.id, sess.status)
    }
  }, [sessions, notifyOnFinish, onOpenSession])

  useEffect(() => {
    for (const approval of approvals) {
      if (notifiedApprovals.current.has(approval.id)) continue
      notifiedApprovals.current.add(approval.id)
      if (!notifyOnApproval || typeof Notification === "undefined" || Notification.permission !== "granted" || document.hasFocus()) continue
      const label = sessions.find(s => s.id === approval.sessionId)?.label
      const notification = new Notification(label ? `${label} needs approval` : "An agent needs approval", {
        body: approval.command ?? approval.summary ?? "Open ADE to allow or deny the request.",
        tag: `approval-${approval.id}`,
      })
      notification.onclick = () => { window.focus(); onOpenSession(approval.sessionId) }
    }
  }, [approvals, notifyOnApproval, sessions, onOpenSession])
}
