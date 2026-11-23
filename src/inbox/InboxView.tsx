import { Archive, ExternalLink, GitBranch, Inbox, Plus } from "lucide-react"
import type { Conversation } from "../../app-types"
import type { Project } from "../../ProjectsView"
import { relativeTime, sessionStateInfo, type InboxEntry, type SessionState } from "../session-state"
import { budgetState, formatCost, useUsage } from "../usage/usage-data"

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
  const { report } = useUsage()
  const budget = budgetState(report, monthlyBudget)
  const rows = sessions
    .filter(session => !session.archivedAt && session.id !== "coding" && session.id !== "personal")
    .map(session => ({ session, entry: entries[session.id] }))
    .sort((a, b) => {
      const ua = urgency.indexOf(a.entry?.state ?? "idle")
      const ub = urgency.indexOf(b.entry?.state ?? "idle")
      return ua - ub || (b.session.updatedAt ?? 0) - (a.session.updatedAt ?? 0)
    })
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
            const state = entry?.state ?? (session.status === "working" ? "working" : "idle")
            const info = sessionStateInfo[state]
            const project = projects.find(p => p.id === session.projectId)
            return (
              <li key={session.id}>
                <button type="button" className="ade-inbox-row" onClick={() => onOpenSession(session)}>
                  <span className={`ade-state-dot is-${info.tone}`} aria-hidden="true" />
                  <span className="ade-inbox-main">
                    <strong className="ade-truncate">{session.label}</strong>
                    <small className="ade-truncate">
                      {project ? project.name : session.chatThread ? "Chat" : "No project"}
                      {session.workspace?.branch ? <> · <GitBranch className="inline size-3" /> {session.workspace.branch}</> : null}
                      {entry?.uncommitted ? ` · ${entry.uncommitted} uncommitted` : ""}
                      {entry?.pendingApprovals ? ` · ${entry.pendingApprovals} waiting for approval` : ""}
                    </small>
                  </span>
                  <span className={`ade-row-tag is-${info.tone}`} title={info.hint}>{info.label}</span>
                  <span className="ade-inbox-time">{relativeTime(session.updatedAt)}</span>
                </button>
                {entry?.pullRequest ? (
                  <button type="button" className="ade-icon-btn" title={`Open pull request #${entry.pullRequest.number} on GitHub`} aria-label={`Open pull request #${entry.pullRequest.number}`} onClick={() => onOpenExternal(entry.pullRequest!.url)}>
                    <ExternalLink className="size-3.5" />
                  </button>
                ) : null}
                {state === "merged" ? (
                  <button type="button" className="ade-icon-btn" title="Archive this session" aria-label={`Archive ${session.label}`} onClick={() => onArchive(session.id)}>
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
    <main className="ade-inbox">
      <header className="ade-inbox-head">
        <div>
          <h1><Inbox className="size-5" /> Inbox</h1>
          <p>Every session across your projects, sorted by what needs you first.</p>
        </div>
        <div className="flex gap-2">
          {merged.length > 0 ? (
            <button type="button" className="sf-btn-secondary" onClick={() => merged.forEach(row => onArchive(row.session.id))}>
              <Archive className="size-3.5" /> Archive {merged.length} merged
            </button>
          ) : null}
          <button type="button" className="sf-btn-primary" onClick={onNewSession}><Plus className="size-3.5" /> New session</button>
        </div>
      </header>
      {budget ? (
        <div className={`ade-budget-banner ${budget.reached ? "is-error" : ""}`} role="status">
          <span>
            {budget.reached
              ? `This month's agent spend (${formatCost(budget.spent)}) has reached your ${formatCost(budget.budget)} budget.`
              : `This month's agent spend is at ${Math.round(budget.ratio * 100)}% of your ${formatCost(budget.budget)} budget (${formatCost(budget.spent)}).`}
          </span>
          {onOpenUsage ? <button type="button" className="ade-chip-btn" onClick={onOpenUsage}>See usage</button> : null}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="ade-inbox-zero">
          <Inbox className="size-8 opacity-40" />
          <p>No sessions yet. Start one to put an agent to work on a branch of its own.</p>
          <button type="button" className="sf-btn-primary" onClick={onNewSession}><Plus className="size-3.5" /> New session</button>
        </div>
      ) : <>
        {group("Needs you", needsYou, "Nothing needs you right now.")}
        {group("Working", working, "No agent is working.")}
        {group("Everything else", rest)}
      </>}
    </main>
  )
}
