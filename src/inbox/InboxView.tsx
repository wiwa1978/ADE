import { useState } from "react"
import { Archive, ExternalLink, GitBranch, Inbox, Plus } from "lucide-react"
import type { Conversation } from "../app-types"
import type { Project } from "../ProjectsView"
import { relativeTime, sessionStateInfo, type InboxEntry, type SessionState } from "../session-state"
import { ActiveThreadSpinner } from "../sidebar/ActiveThreadSpinner"
import { budgetState, formatCost, useUsage } from "../usage/usage-data"
import { useI18n } from "../i18n/I18nContext"
import { InboxBrief } from "./InboxBrief"
import "./inbox-brief.css"

const urgency: SessionState[] = ["stage-approval", "needs-approval", "failed", "checks-failing", "replied", "ready-to-review", "pr-open", "working", "merged", "idle"]

/**
 * Every coding session across projects, grouped by what it needs from you. This is the home
 * screen for running several agents at once.
 */
export function InboxView({
  sessions,
  projects,
  entries,
  onOpenSession,
  onOpenExternal,
  onArchive,
  onNewSession,
  monthlyBudget = 0,
  onOpenUsage,
}: {
  sessions: Conversation[]
  projects: Project[]
  entries: Record<string, InboxEntry>
  onOpenSession: (session: Conversation) => void
  onOpenExternal: (url: string) => void
  onArchive: (sessionId: string) => void
  onNewSession: () => void
  monthlyBudget?: number
  onOpenUsage?: () => void
}) {
  const { t } = useI18n()
  const { report } = useUsage()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const budget = budgetState(report, monthlyBudget)
  const rows = sessions
    .filter(session => !session.archivedAt && session.id !== "coding" && session.id !== "personal")
    .map(session => ({ session, entry: entries[session.id] }))
    .sort((a, b) => {
      const ua = urgency.indexOf(a.entry?.state ?? "idle")
      const ub = urgency.indexOf(b.entry?.state ?? "idle")
      return ua - ub || (b.session.updatedAt ?? 0) - (a.session.updatedAt ?? 0)
    })
  // The summary shows the picked session, or the one that needs you most until you pick.
  const selected = rows.find(row => row.session.id === selectedId) ?? rows[0] ?? null
  const needsYou = rows.filter(row => row.entry?.needsYou)
  const working = rows.filter(row => !row.entry?.needsYou && (row.entry?.state === "working" || row.session.status === "working"))
  const rest = rows.filter(row => !needsYou.includes(row) && !working.includes(row))
  const merged = rest.filter(row => row.entry?.state === "merged")

  const group = (title: string, items: typeof rows, empty?: string) => (
    <section className="ade-inbox-group" aria-label={title}>
      <h2>{title} <span>{items.length}</span></h2>
      {items.length === 0 ? (empty ? <p className="ade-inbox-empty">{empty}</p> : null) : (
        <ul>
          {items.map(({ session, entry }) => {
            const state: SessionState = entry?.state === "needs-approval"
              ? "needs-approval"
              : session.status === "working"
                ? "working"
                : (entry?.state ?? "idle")
            const info = sessionStateInfo[state]
            const project = projects.find(p => p.id === session.projectId)
            return (
              <li key={session.id} className={selected?.session.id === session.id ? "is-selected" : ""}>
                <button type="button" className="ade-inbox-row" aria-pressed={selected?.session.id === session.id} onClick={() => setSelectedId(session.id)} onDoubleClick={() => onOpenSession(session)}>
                  <span className={`ade-state-dot is-${info.tone}`} aria-hidden="true" />
                  <span className="ade-inbox-main">
                    <strong className="ade-truncate">{session.label}</strong>
                    <small className="ade-truncate">
                      {project ? project.name : session.chatThread ? t("inbox.chat") : t("inbox.noProject")}
                      {session.workspace?.branch ? <> · <GitBranch className="inline size-3" /> {session.workspace.branch}</> : null}
                      {entry?.uncommitted ? ` · ${t("inbox.uncommitted", { count: entry.uncommitted })}` : ""}
                      {entry?.pendingApprovals ? ` · ${t("inbox.waitingApproval", { count: entry.pendingApprovals })}` : ""}
                    </small>
                  </span>
                  <span className={`ade-row-tag is-${info.tone}`} title={info.hint}>
                    {state === "working" ? <ActiveThreadSpinner size={12} decorative /> : null}
                    {info.label}
                  </span>
                  <span className="ade-inbox-time">{relativeTime(session.updatedAt)}</span>
                </button>
                {entry?.pullRequest ? (
                  <button type="button" className="ade-icon-btn" title={t("inbox.openPrTitle", { number: entry.pullRequest.number })} aria-label={t("inbox.openPrAria", { number: entry.pullRequest.number })} onClick={() => onOpenExternal(entry.pullRequest!.url)}>
                    <ExternalLink className="size-3.5" />
                  </button>
                ) : null}
                {state === "merged" ? (
                  <button type="button" className="ade-icon-btn" title={t("inbox.archiveSession")} aria-label={t("inbox.archiveSessionAria", { label: session.label })} onClick={() => onArchive(session.id)}>
                    <Archive className="size-3.5" />
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  return (
    <main className={`ade-inbox ${selected ? "has-brief" : ""}`}>
      <header className="ade-inbox-head">
        <div>
          <h1><Inbox className="size-5" /> {t("inbox.title")}</h1>
          <p>{t("inbox.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          {merged.length > 0 ? (
            <button type="button" className="sf-btn-secondary" onClick={() => merged.forEach(row => onArchive(row.session.id))}>
              <Archive className="size-3.5" /> {t("inbox.archiveMerged", { count: merged.length })}
            </button>
          ) : null}
          <button type="button" className="sf-btn-primary" onClick={onNewSession}><Plus className="size-3.5" /> {t("inbox.newSession")}</button>
        </div>
      </header>
      {budget ? (
        <div className={`ade-budget-banner ${budget.reached ? "is-error" : ""}`} role="status">
          <span>
            {budget.reached
              ? t("inbox.budgetReached", { spent: formatCost(budget.spent), budget: formatCost(budget.budget) })
              : t("inbox.budgetRatio", { percent: Math.round(budget.ratio * 100), budget: formatCost(budget.budget), spent: formatCost(budget.spent) })}
          </span>
          {onOpenUsage ? <button type="button" className="ade-chip-btn" onClick={onOpenUsage}>{t("inbox.seeUsage")}</button> : null}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="ade-inbox-zero">
          <Inbox className="size-8 opacity-40" />
          <p>{t("inbox.emptyDesc")}</p>
          <button type="button" className="sf-btn-primary" onClick={onNewSession}><Plus className="size-3.5" /> {t("inbox.newSession")}</button>
        </div>
      ) : (
        <div className="ade-inbox-cols">
          <div className="ade-inbox-list">
            {group(t("inbox.needsYou"), needsYou, t("inbox.needsYouEmpty"))}
            {group(t("inbox.working"), working, t("inbox.workingEmpty"))}
            {group(t("inbox.everythingElse"), rest)}
          </div>
          {selected ? <InboxBrief sessionId={selected.session.id} title={selected.session.label} refreshKey={`${selected.entry?.state ?? ""}:${selected.session.updatedAt ?? 0}:${selected.entry?.pendingApprovals ?? 0}`} onOpen={() => onOpenSession(selected.session)} /> : null}
        </div>
      )}
    </main>
  )
}
