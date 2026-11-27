import { useEffect, useMemo, useState } from "react"
import { Activity, AlertTriangle, ArrowUpRight, Bot, Clock, GitBranch, Layers, Wrench, XCircle } from "lucide-react"
import { useI18n } from "../i18n/I18nContext"
import {
  formatDurationShort,
  formatTokensCompact,
  type AgentHealth,
  type FleetSession,
  type FleetSubagent,
  type ObservatoryLiveSnapshot,
} from "./observatory-types"

type Selection =
  | { kind: "session"; sessionId: string }
  | { kind: "subagent"; sessionId: string; subagentId: string }

function healthLabel(health: AgentHealth, since: number | null, now: number, t: ReturnType<typeof useI18n>["t"]): { text: string; tone: "ok" | "warn" | "hot" } | null {
  const age = since ? formatDurationShort(Math.max(0, now - since)) : ""
  if (health === "stalled") return { text: t("obs.health.stalled", { age }), tone: "warn" }
  if (health === "slow-tool") return { text: t("obs.health.slowTool", { age }), tone: "warn" }
  if (health === "quiet") return { text: t("obs.health.quiet", { age }), tone: "warn" }
  if (health === "delegating") return { text: t("obs.health.delegating"), tone: "ok" }
  return null
}

export function FleetLiveTab({
  snapshot,
  onOpenSession,
  onOpenTrace,
}: {
  snapshot: ObservatoryLiveSnapshot
  onOpenSession: (sessionId: string) => void
  onOpenTrace: (sessionId: string) => void
}) {
  const { t, formatCurrency } = useI18n()
  const [selection, setSelection] = useState<Selection | null>(() =>
    snapshot.sessions[0] ? { kind: "session", sessionId: snapshot.sessions[0].sessionId } : null,
  )

  const resolvedSelection = useMemo<Selection | null>(() => {
    if (!selection) {
      return snapshot.sessions[0] ? { kind: "session", sessionId: snapshot.sessions[0].sessionId } : null
    }
    const found = snapshot.sessions.find(s => s.sessionId === selection.sessionId)
    if (!found) {
      return snapshot.sessions[0] ? { kind: "session", sessionId: snapshot.sessions[0].sessionId } : null
    }
    if (selection.kind === "subagent" && !found.subagents.some(sub => sub.id === selection.subagentId)) {
      return { kind: "session", sessionId: found.sessionId }
    }
    return selection
  }, [selection, snapshot.sessions])

  // Keyboard shortcuts: `n` jump to next needs-you, `w` open Trace, `Enter` open session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "n") {
        const needy = snapshot.sessions.filter(s => s.needsYou)
        if (!needy.length) return
        e.preventDefault()
        const curIdx = needy.findIndex(s => s.sessionId === resolvedSelection?.sessionId)
        const next = needy[(curIdx + 1) % needy.length]
        setSelection({ kind: "session", sessionId: next.sessionId })
      } else if (e.key === "w" && resolvedSelection) {
        e.preventDefault()
        onOpenTrace(resolvedSelection.sessionId)
      } else if (e.key === "Enter" && resolvedSelection) {
        e.preventDefault()
        onOpenSession(resolvedSelection.sessionId)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [snapshot.sessions, resolvedSelection, onOpenSession, onOpenTrace])

  const selectedSession: FleetSession | null = resolvedSelection
    ? snapshot.sessions.find(s => s.sessionId === resolvedSelection.sessionId) ?? null
    : null
  const selectedSubagent: FleetSubagent | null =
    resolvedSelection?.kind === "subagent" && selectedSession
      ? selectedSession.subagents.find(sub => sub.id === resolvedSelection.subagentId) ?? null
      : null

  const { kpis } = snapshot
  const maxSpark = Math.max(1, ...kpis.toolsSparkline)
  const windowStart = snapshot.at - snapshot.windowMin * 60_000
  const windowSpan = Math.max(1, snapshot.windowMin * 60_000)
  const stalledOrSlow = kpis.stalledCount + kpis.slowToolsCount

  return (
    <>
      <div className="ade-obs-kpis" role="region" aria-label={t("obs.kpiAria")}>
        <div className="ade-obs-kpi">
          <span className="ade-obs-kpi-label">{t("obs.kpi.active")}</span>
          <span className={`ade-obs-kpi-value${kpis.activeAgents === 0 ? " is-zero" : ""}`}>{kpis.activeAgents}</span>
          <span className="ade-obs-kpi-sub">
            {t("obs.kpi.sessionsShown", { count: snapshot.sessions.length })}
          </span>
        </div>

        <button
          type="button"
          className={`ade-obs-kpi text-left${kpis.needsYou > 0 ? " is-hot cursor-pointer" : ""}`}
          onClick={() => {
            const first = snapshot.sessions.find(s => s.needsYou)
            if (first) setSelection({ kind: "session", sessionId: first.sessionId })
          }}
        >
          <span className="ade-obs-kpi-label">{t("obs.kpi.needsYou")}</span>
          <span className={`ade-obs-kpi-value${kpis.needsYou === 0 ? " is-zero" : " is-hot"}`}>{kpis.needsYou}</span>
          <span className="ade-obs-kpi-sub">
            {kpis.needsYou > 0
              ? `${kpis.topNeedsYouReason ?? kpis.topNeedsYouTitle ?? ""} · ${formatDurationShort(kpis.oldestWaitMs)}`
              : t("obs.kpi.allClear")}
          </span>
        </button>

        <div className="ade-obs-kpi">
          <span className="ade-obs-kpi-label">{t("obs.kpi.toolsPerMin")}</span>
          <span className={`ade-obs-kpi-value${kpis.toolsPerMin === 0 ? " is-zero" : ""}`}>{kpis.toolsPerMin}</span>
          <div className="ade-obs-sparkline" aria-hidden="true">
            {kpis.toolsSparkline.map((v, i) => (
              <span key={i} className="ade-obs-spark-bar" style={{ height: `${Math.max(12, Math.round((v / maxSpark) * 100))}%`, opacity: v === 0 ? 0.25 : 0.9 }} />
            ))}
          </div>
        </div>

        <div className={`ade-obs-kpi${stalledOrSlow > 0 ? " is-warn" : ""}`}>
          <span className="ade-obs-kpi-label">{t("obs.kpi.stalledSlow")}</span>
          <span className={`ade-obs-kpi-value${stalledOrSlow === 0 ? " is-zero" : " is-warn"}`}>{stalledOrSlow}</span>
          <span className="ade-obs-kpi-sub">
            {stalledOrSlow > 0
              ? t("obs.kpi.stalledBreakdown", { stalled: kpis.stalledCount, slow: kpis.slowToolsCount })
              : t("obs.kpi.healthy")}
          </span>
        </div>

        <div className="ade-obs-kpi">
          <span className="ade-obs-kpi-label">{t("obs.kpi.tokensToday")}</span>
          <span className={`ade-obs-kpi-value${kpis.tokensToday === 0 ? " is-zero" : ""}`}>{formatTokensCompact(kpis.tokensToday)}</span>
          <span className="ade-obs-kpi-sub">{formatCurrency(kpis.costToday)}</span>
        </div>

        <div className={`ade-obs-kpi${kpis.failedCalls > 0 ? " is-hot" : ""}`}>
          <span className="ade-obs-kpi-label">{t("obs.kpi.failedCalls")}</span>
          <span className={`ade-obs-kpi-value${kpis.failedCalls === 0 ? " is-zero" : " is-hot"}`}>{kpis.failedCalls}</span>
          <span className="ade-obs-kpi-sub">{t("obs.kpi.inWindow", { minutes: snapshot.windowMin })}</span>
        </div>
      </div>

      <div className="ade-obs-body">
        <div className="ade-obs-fleet-list" role="list" aria-label={t("obs.fleetListAria")}>
          {snapshot.sessions.length === 0 ? (
            <div className="ade-obs-empty">
              <Activity className="size-6 opacity-50" />
              <span>{t("obs.emptyFleet")}</span>
            </div>
          ) : (
            snapshot.sessions.map(session => {
              const isSelected = resolvedSelection?.kind === "session" && resolvedSelection.sessionId === session.sessionId
              const hBadge = healthLabel(session.health, session.healthSince, snapshot.at, t)
              return (
                <div key={session.sessionId} className="flex flex-col gap-1">
                  <button
                    type="button"
                    role="listitem"
                    className={`ade-obs-row${isSelected ? " is-selected" : ""}${session.needsYou ? " is-needs-you" : ""}${session.health === "stalled" || session.health === "slow-tool" ? " is-stalled" : ""}`}
                    onClick={() => setSelection({ kind: "session", sessionId: session.sessionId })}
                    onDoubleClick={() => onOpenSession(session.sessionId)}
                  >
                    <div className="ade-obs-row-main">
                      <div className="ade-obs-row-top">
                        <span className="ade-obs-row-title">{session.title}</span>
                        {session.needsYou ? (
                          <span className="ade-obs-badge is-hot">{t("obs.badge.needsYou")}</span>
                        ) : null}
                        {hBadge ? (
                          <span className={`ade-obs-badge is-${hBadge.tone}`}>{hBadge.text}</span>
                        ) : null}
                        {session.blueprint ? (
                          <span className="ade-obs-badge is-stage">
                            <Layers className="size-2.5" />
                            {session.blueprint.stageName}
                          </span>
                        ) : null}
                      </div>
                      <div className="ade-obs-row-meta">
                        {session.projectName ? <span>{session.projectName}</span> : null}
                        {session.model ? <span className="ade-mono">{session.model}</span> : null}
                        {session.currentTool ? (
                          <span className="ade-mono">
                            {session.currentTool.program ?? session.currentTool.name} · {formatDurationShort(snapshot.at - session.currentTool.startedAt)}
                          </span>
                        ) : session.waitingReason ? (
                          <span>{session.waitingReason}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="ade-obs-lane" aria-hidden="true">
                      {session.lane.map((ev, idx) => {
                        const pct = Math.min(99, Math.max(0, ((ev.t - windowStart) / windowSpan) * 100))
                        return (
                          <span
                            key={idx}
                            className={`ade-obs-lane-tick is-${ev.cat}${ev.failed ? " is-failed" : ""}`}
                            style={{ left: `${pct}%` }}
                          />
                        )
                      })}
                    </div>

                    <div className="flex items-center gap-2 text-[11px] ade-muted ade-mono">
                      {session.recentFailures.length > 0 ? (
                        <span className="text-[var(--danger)]">{session.recentFailures.length} ✕</span>
                      ) : null}
                      <span>{session.lastActivityAt ? formatDurationShort(snapshot.at - session.lastActivityAt) : "—"}</span>
                    </div>
                  </button>

                  {session.subagents.map(sub => {
                    const subSelected = resolvedSelection?.kind === "subagent" && resolvedSelection.sessionId === session.sessionId && resolvedSelection.subagentId === sub.id
                    const subHealth = healthLabel(sub.health, sub.healthSince, snapshot.at, t)
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        className={`ade-obs-row is-subagent${subSelected ? " is-selected" : ""}${sub.health === "stalled" || sub.health === "slow-tool" ? " is-stalled" : ""}`}
                        onClick={() => setSelection({ kind: "subagent", sessionId: session.sessionId, subagentId: sub.id })}
                      >
                        <div className="ade-obs-row-main">
                          <div className="ade-obs-row-top">
                            <Bot className="size-3 shrink-0 ade-muted" />
                            <span className="ade-obs-row-title text-[12px]">{sub.name}</span>
                            <span className="ade-obs-badge">{sub.role}</span>
                            {subHealth ? <span className={`ade-obs-badge is-${subHealth.tone}`}>{subHealth.text}</span> : null}
                          </div>
                          <div className="ade-obs-row-meta">
                            <span>{sub.status}</span>
                            {sub.model ? <span className="ade-mono">{sub.model}</span> : null}
                            {sub.currentTool ? (
                              <span className="ade-mono">{sub.currentTool.program ?? sub.currentTool.name}</span>
                            ) : null}
                          </div>
                        </div>

                        <div className="ade-obs-lane" aria-hidden="true">
                          {sub.lane.map((ev, idx) => {
                            const pct = Math.min(99, Math.max(0, ((ev.t - windowStart) / windowSpan) * 100))
                            return (
                              <span
                                key={idx}
                                className={`ade-obs-lane-tick is-${ev.cat}${ev.failed ? " is-failed" : ""}`}
                                style={{ left: `${pct}%` }}
                              />
                            )
                          })}
                        </div>

                        <span className="text-[11px] ade-muted ade-mono">
                          {sub.startedAt ? formatDurationShort((sub.endedAt ?? snapshot.at) - sub.startedAt) : "—"}
                        </span>
                      </button>
                    )
                  })}

                  {session.foldedSubagentsCount > 0 ? (
                    <div className="ml-6 text-[11px] ade-muted py-0.5">
                      ┄ {t("obs.foldedSubagents", { count: session.foldedSubagentsCount })}
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </div>

        <aside className="ade-obs-inspector" aria-label={t("obs.inspectorAria")}>
          {selectedSession ? (
            <>
              <div className="ade-obs-section">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-semibold">
                      {selectedSubagent ? selectedSubagent.name : selectedSession.title}
                    </div>
                    <div className="text-[11px] ade-muted mt-0.5">
                      {selectedSubagent
                        ? `${selectedSubagent.role} · ${selectedSubagent.harness}${selectedSubagent.model ? ` · ${selectedSubagent.model}` : ""}`
                        : [selectedSession.projectName, selectedSession.model, selectedSession.engine].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>

                <div className="ade-obs-actions mt-2">
                  <button type="button" className="ade-chip-btn" onClick={() => onOpenSession(selectedSession.sessionId)}>
                    <ArrowUpRight className="size-3" />
                    {t("obs.action.openSession")}
                  </button>
                  <button type="button" className="ade-chip-btn" onClick={() => onOpenTrace(selectedSession.sessionId)}>
                    <Clock className="size-3" />
                    {t("obs.action.viewTrace")}
                  </button>
                </div>
              </div>

              {selectedSession.waitingReason && !selectedSubagent ? (
                <div className="ade-obs-section">
                  <span className="ade-obs-section-title">{t("obs.detail.waiting")}</span>
                  <div className="ade-obs-failure-item">
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="size-3.5 text-[var(--danger)] shrink-0" />
                      {selectedSession.waitingReason}
                    </span>
                    <span className="ade-mono ade-muted">
                      {selectedSession.waitingSince ? formatDurationShort(snapshot.at - selectedSession.waitingSince) : ""}
                    </span>
                  </div>
                </div>
              ) : null}

              {selectedSession.blueprint && !selectedSubagent ? (
                <div className="ade-obs-section">
                  <span className="ade-obs-section-title">{t("obs.detail.blueprint")}</span>
                  <div className="text-[12px] flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium">
                      <GitBranch className="size-3.5 ade-muted" />
                      {selectedSession.blueprint.name}
                    </span>
                    <span className="ade-mono text-[11px] ade-muted">
                      {selectedSession.blueprint.done}/{selectedSession.blueprint.total}
                    </span>
                  </div>
                  <div className="text-[11px] ade-muted">
                    {selectedSession.blueprint.stageName} · {selectedSession.blueprint.stageStatus}
                  </div>
                </div>
              ) : null}

              {(selectedSubagent?.currentTool ?? selectedSession.currentTool) ? (
                <div className="ade-obs-section">
                  <span className="ade-obs-section-title">{t("obs.detail.runningTool")}</span>
                  {(() => {
                    const tool = selectedSubagent ? selectedSubagent.currentTool : selectedSession.currentTool
                    if (!tool) return null
                    return (
                      <div className="flex items-center justify-between text-[12px] ade-mono">
                        <span className="flex items-center gap-1.5">
                          <Wrench className="size-3.5 ade-muted" />
                          {tool.program ? `${tool.name} (${tool.program})` : tool.name}
                        </span>
                        <span className={tool.slow ? "text-[var(--warn)] font-semibold" : "ade-muted"}>
                          {formatDurationShort(snapshot.at - tool.startedAt)}
                        </span>
                      </div>
                    )
                  })()}
                </div>
              ) : null}

              {!selectedSubagent ? (
                <div className="ade-obs-section">
                  <span className="ade-obs-section-title">{t("obs.detail.usage")}</span>
                  <div className="text-[12px] flex items-center justify-between ade-mono">
                    <span>{formatTokensCompact(selectedSession.tokens.input + selectedSession.tokens.output)} tok</span>
                    <span>{formatCurrency(selectedSession.tokens.cost)}</span>
                  </div>
                </div>
              ) : null}

              <div className="ade-obs-section">
                <span className="ade-obs-section-title">{t("obs.detail.recentFailures")}</span>
                {(() => {
                  const failures = selectedSubagent ? selectedSubagent.recentFailures : selectedSession.recentFailures
                  if (!failures.length) return <span className="text-[11px] ade-muted">{t("obs.detail.noFailures")}</span>
                  return (
                    <div className="flex flex-col gap-1.5">
                      {failures.map(f => (
                        <div key={f.id} className="ade-obs-failure-item">
                          <span className="flex items-center gap-1.5 ade-mono truncate">
                            <XCircle className="size-3 text-[var(--danger)] shrink-0" />
                            {f.program ?? f.toolName}
                            {f.exitCode !== null ? ` (exit ${f.exitCode})` : ""}
                          </span>
                          <span className="ade-mono ade-muted shrink-0">
                            {formatDurationShort(snapshot.at - f.at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </>
          ) : (
            <div className="ade-obs-empty">{t("obs.detail.pickOne")}</div>
          )}
        </aside>
      </div>
    </>
  )
}
