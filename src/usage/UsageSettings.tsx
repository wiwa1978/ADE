import { useState } from "react"
import type { Project } from "../../ProjectsView"
import { formatCost, formatTokens, formatUsage, useUsage } from "./usage-data"

/** Settings → Usage: this month's spend, a monthly budget, and where the tokens went. */
export function UsageSettings({
  budget,
  onBudgetChange,
  projects,
  sessionLabels,
}: {
  budget: number
  onBudgetChange: (value: number) => void
  projects: Project[]
  sessionLabels: Record<string, string>
}) {
  const { report, error } = useUsage()
  const [draft, setDraft] = useState(budget ? String(budget) : "")
  const projectName = (id: string) => id ? projects.find(project => project.id === id)?.name ?? "Removed project" : "No project"
  const spent = report?.monthTotal.cost ?? 0
  const ratio = budget > 0 ? spent / budget : 0
  const tone = ratio >= 1 ? "is-error" : ratio >= 0.8 ? "is-warn" : ""
  const topSessions = report
    ? Object.entries(report.sessions)
      .map(([id, totals]) => ({ id, ...totals }))
      .sort((a, b) => b.cost - a.cost || (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
      .slice(0, 8)
    : []
  const dayValue = (totals: { cost: number; inputTokens: number; outputTokens: number }) => totals.cost || (totals.inputTokens + totals.outputTokens) / 1e6
  const maxDay = Math.max(1e-9, ...(report?.days ?? []).map(day => dayValue(day.totals)))
  const monthName = report ? new Date(`${report.month}-01T12:00:00`).toLocaleString(undefined, { month: "long", year: "numeric" }) : ""

  const saveBudget = () => {
    const value = Number(draft.replace(/[$,\s]/g, ""))
    onBudgetChange(Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0)
  }

  return (
    <>
      <section className="st-section">
        <h2>{monthName || "This month"}</h2>
        <p className="st-section-desc">What agents used across all sessions. Cost shows when the agent reports a price; Claude Code and Codex on a subscription report tokens only.</p>
        <div className="st-card">
          {error ? <div className="st-row"><span className="st-error">{error}</span></div> : null}
          <div className="st-row">
            <div className="st-row-text">
              <span className="st-row-title">Spent this month</span>
              <p>{report ? `${formatTokens(report.monthTotal.inputTokens)} input and ${formatTokens(report.monthTotal.outputTokens)} output tokens` : "Loading…"}</p>
            </div>
            <div className="st-row-control">
              {/* Subscriptions report tokens only; show those rather than a misleading $0. */}
              {!spent && !budget && report && (report.monthTotal.inputTokens || report.monthTotal.outputTokens)
                ? <strong className="ade-usage-big">{formatTokens(report.monthTotal.inputTokens + report.monthTotal.outputTokens)} tokens</strong>
                : <><strong className={`ade-usage-big ${tone}`}>{formatCost(spent)}</strong>{budget ? <span className="ade-usage-of">of {formatCost(budget)}</span> : null}</>}
            </div>
          </div>
          {budget ? (
            <div className="ade-usage-meter" role="meter" aria-label="Budget used" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={spent}>
              <span className={tone} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
            </div>
          ) : null}
          {report ? (
            <div className="ade-usage-days" aria-label="Usage over the last 30 days">
              {report.days.map(day => {
                const value = dayValue(day.totals)
                return <span key={day.day} title={`${day.day}: ${value ? formatUsage(day.totals) : "nothing"}`} style={{ height: `${Math.max(4, (value / maxDay) * 100)}%` }} className={value ? "" : "is-empty"} />
              })}
            </div>
          ) : null}
          <div className="st-row">
            <div className="st-row-text">
              <label htmlFor="usage-budget">Monthly budget</label>
              <p>ADE warns in the Inbox at 80% and when the budget is reached. It never stops an agent.</p>
            </div>
            <div className="st-row-control">
              <input
                id="usage-budget"
                className="st-input is-narrow"
                inputMode="decimal"
                placeholder="No budget"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onBlur={saveBudget}
                onKeyDown={event => { if (event.key === "Enter") saveBudget() }}
              />
              <span className="ade-usage-of">USD</span>
            </div>
          </div>
        </div>
      </section>

      <section className="st-section">
        <h2>By project</h2>
        <div className="st-card">
          {report && report.projects.length ? report.projects.map(item => (
            <div className="st-row" key={item.projectId || "none"}>
              <div className="st-row-text"><span className="st-row-title">{projectName(item.projectId)}</span></div>
              <div className="st-row-control ade-usage-value">{formatUsage(item.totals)}</div>
            </div>
          )) : <div className="st-row"><div className="st-row-text"><p>No usage recorded this month yet.</p></div></div>}
        </div>
      </section>

      <section className="st-section">
        <h2>Biggest sessions</h2>
        <div className="st-card">
          {topSessions.length ? topSessions.map(item => (
            <div className="st-row" key={item.id}>
              <div className="st-row-text">
                <span className="st-row-title">{sessionLabels[item.id] ?? "Deleted session"}</span>
                <p>{projectName(item.projectId)}</p>
              </div>
              <div className="st-row-control ade-usage-value">{formatUsage(item)}</div>
            </div>
          )) : <div className="st-row"><div className="st-row-text"><p>Sessions show up here once an agent has worked in them.</p></div></div>}
        </div>
      </section>
    </>
  )
}
