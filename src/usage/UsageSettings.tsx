import { useState } from "react"
import type { Project } from "../../ProjectsView"
import { useI18n } from "../i18n/I18nContext"
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
  const { t, formatDate, formatDay } = useI18n()
  const { report, error } = useUsage()
  const [draft, setDraft] = useState(budget ? String(budget) : "")
  const projectName = (id: string) => id ? projects.find(project => project.id === id)?.name ?? t("stx.usage.removedProject") : t("stx.usage.noProject")
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
  const monthName = report ? formatDate(new Date(`${report.month}-01T12:00:00`), { month: "long", year: "numeric" }) : ""

  const saveBudget = () => {
    const value = Number(draft.replace(/[$,\s]/g, ""))
    onBudgetChange(Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0)
  }

  return (
    <>
      <section className="st-section">
        <h2>{monthName || t("stx.usage.thisMonth")}</h2>
        <p className="st-section-desc">{t("stx.usage.desc")}</p>
        <div className="st-card">
          {error ? <div className="st-row"><span className="st-error">{error}</span></div> : null}
          <div className="st-row">
            <div className="st-row-text">
              <span className="st-row-title">{t("stx.usage.spentThisMonth")}</span>
              <p>{report ? t("stx.usage.tokenSummary", { input: formatTokens(report.monthTotal.inputTokens), output: formatTokens(report.monthTotal.outputTokens) }) : t("stx.usage.loading")}</p>
            </div>
            <div className="st-row-control">
              {/* Subscriptions report tokens only; show those rather than a misleading $0. */}
              {!spent && !budget && report && (report.monthTotal.inputTokens || report.monthTotal.outputTokens)
                ? <strong className="ade-usage-big">{t("stx.usage.tokensCount", { count: formatTokens(report.monthTotal.inputTokens + report.monthTotal.outputTokens) })}</strong>
                : <><strong className={`ade-usage-big ${tone}`}>{formatCost(spent)}</strong>{budget ? <span className="ade-usage-of">{t("stx.usage.ofBudget", { budget: formatCost(budget) })}</span> : null}</>}
            </div>
          </div>
          {budget ? (
            <div className="ade-usage-meter" role="meter" aria-label={t("stx.usage.budgetUsed")} aria-valuemin={0} aria-valuemax={budget} aria-valuenow={spent}>
              <span className={tone} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
            </div>
          ) : null}
          {report ? (
            <div className="ade-usage-days" aria-label={t("stx.usage.last30Days")}>
              {report.days.map(day => {
                const value = dayValue(day.totals)
                return <span key={day.day} title={`${formatDay(`${day.day}T12:00:00`)}: ${value ? formatUsage(day.totals) : t("stx.usage.nothing")}`} style={{ height: `${Math.max(4, (value / maxDay) * 100)}%` }} className={value ? "" : "is-empty"} />
              })}
            </div>
          ) : null}
          <div className="st-row">
            <div className="st-row-text">
              <label htmlFor="usage-budget">{t("stx.usage.monthlyBudget")}</label>
              <p>{t("stx.usage.monthlyBudgetDesc")}</p>
            </div>
            <div className="st-row-control">
              <input
                id="usage-budget"
                className="st-input is-narrow"
                inputMode="decimal"
                placeholder={t("stx.usage.noBudget")}
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
        <h2>{t("stx.usage.byProject")}</h2>
        <div className="st-card">
          {report && report.projects.length ? report.projects.map(item => (
            <div className="st-row" key={item.projectId || "none"}>
              <div className="st-row-text"><span className="st-row-title">{projectName(item.projectId)}</span></div>
              <div className="st-row-control ade-usage-value">{formatUsage(item.totals)}</div>
            </div>
          )) : <div className="st-row"><div className="st-row-text"><p>{t("stx.usage.noUsageYet")}</p></div></div>}
        </div>
      </section>

      <section className="st-section">
        <h2>{t("stx.usage.biggestSessions")}</h2>
        <div className="st-card">
          {topSessions.length ? topSessions.map(item => (
            <div className="st-row" key={item.id}>
              <div className="st-row-text">
                <span className="st-row-title">{sessionLabels[item.id] ?? t("stx.usage.deletedSession")}</span>
                <p>{projectName(item.projectId)}</p>
              </div>
              <div className="st-row-control ade-usage-value">{formatUsage(item)}</div>
            </div>
          )) : <div className="st-row"><div className="st-row-text"><p>{t("stx.usage.sessionsHint")}</p></div></div>}
        </div>
      </section>
    </>
  )
}
