import { useMemo, useState } from "react"
import { ArrowUpRight, CheckCircle2, Clock, ShieldCheck, XCircle } from "lucide-react"
import { useI18n } from "../i18n/I18nContext"
import {
  formatDurationShort,
  type ObservatoryTaskTrace,
  type TraceSpan,
  type TraceStageBand,
} from "./observatory-types"

export function TaskTraceTab({
  trace,
  sessions,
  selectedSessionId,
  loading,
  onSelectSession,
  onOpenSession,
}: {
  trace: ObservatoryTaskTrace | null
  sessions: Array<{ sessionId: string; title: string }>
  selectedSessionId: string | null
  loading: boolean
  onSelectSession: (sessionId: string) => void
  onOpenSession: (sessionId: string) => void
}) {
  const { t, formatDateTime } = useI18n()
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)

  const grouped = useMemo(() => {
    if (!trace) return []
    const groups: Array<{ stage: TraceStageBand | null; spans: TraceSpan[] }> = []
    if (trace.stages.length === 0) {
      return [{ stage: null, spans: trace.spans }]
    }
    const byStage = new Map<string, TraceSpan[]>()
    const unassigned: TraceSpan[] = []
    for (const span of trace.spans) {
      if (span.stageId && trace.stages.some(s => s.id === span.stageId)) {
        const list = byStage.get(span.stageId) ?? []
        list.push(span)
        byStage.set(span.stageId, list)
      } else {
        unassigned.push(span)
      }
    }
    for (const stage of trace.stages) {
      const stageSpans = byStage.get(stage.id) ?? []
      if (stageSpans.length > 0 || stage.startedAt !== null || stage.status !== "pending") {
        groups.push({ stage, spans: stageSpans })
      }
    }
    if (unassigned.length > 0) {
      groups.push({ stage: null, spans: unassigned })
    }
    return groups
  }, [trace])

  const selectedSpan = trace?.spans.find(s => s.id === selectedSpanId) ?? null
  const bdTotal = trace
    ? Math.max(1, trace.breakdown.toolsMs + trace.breakdown.modelMs + trace.breakdown.waitingMs + trace.breakdown.delegatingMs)
    : 1

  const axisStart = trace?.startedAt ?? 0
  const axisSpan = Math.max(1, (trace?.endedAt ?? axisStart + 1) - axisStart)

  return (
    <div className="ade-obs-trace">
      <div className="ade-obs-trace-top">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[12px] ade-muted" htmlFor="obs-trace-session">
              {t("obs.trace.sessionLabel")}
            </label>
            <select
              id="obs-trace-session"
              className="ade-select text-[12px]"
              value={selectedSessionId ?? ""}
              onChange={e => onSelectSession(e.target.value)}
            >
              {sessions.map(s => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.title}
                </option>
              ))}
            </select>
            {trace?.blueprintName ? (
              <span className="ade-obs-badge is-stage">{trace.blueprintName}</span>
            ) : null}
          </div>

          {selectedSessionId ? (
            <button type="button" className="ade-chip-btn" onClick={() => onOpenSession(selectedSessionId)}>
              <ArrowUpRight className="size-3" />
              {t("obs.action.openSession")}
            </button>
          ) : null}
        </div>

        {trace ? (
          <>
            <div className="flex items-center justify-between text-[11px] ade-muted">
              <span>{t("obs.trace.whereTimeWent")}</span>
              <span className="ade-mono">{t("obs.trace.total", { duration: formatDurationShort(trace.totalMs) })}</span>
            </div>
            <div className="ade-obs-breakdown-bar" role="img" aria-label={t("obs.trace.whereTimeWent")}>
              <span className="ade-obs-bd-tools" style={{ width: `${(trace.breakdown.toolsMs / bdTotal) * 100}%` }} />
              <span className="ade-obs-bd-model" style={{ width: `${(trace.breakdown.modelMs / bdTotal) * 100}%` }} />
              <span className="ade-obs-bd-sub" style={{ width: `${(trace.breakdown.delegatingMs / bdTotal) * 100}%` }} />
              <span className="ade-obs-bd-wait" style={{ width: `${(trace.breakdown.waitingMs / bdTotal) * 100}%` }} />
            </div>
            <div className="ade-obs-breakdown-legend">
              <span>
                <span className="ade-obs-dot ade-obs-bd-tools" />
                {t("obs.trace.tools")} {formatDurationShort(trace.breakdown.toolsMs)} ({Math.round((trace.breakdown.toolsMs / bdTotal) * 100)}%)
              </span>
              <span>
                <span className="ade-obs-dot ade-obs-bd-model" />
                {t("obs.trace.model")} {formatDurationShort(trace.breakdown.modelMs)} ({Math.round((trace.breakdown.modelMs / bdTotal) * 100)}%)
              </span>
              {trace.breakdown.delegatingMs > 0 ? (
                <span>
                  <span className="ade-obs-dot ade-obs-bd-sub" />
                  {t("obs.trace.delegates")} {formatDurationShort(trace.breakdown.delegatingMs)} ({Math.round((trace.breakdown.delegatingMs / bdTotal) * 100)}%)
                </span>
              ) : null}
              <span>
                <span className="ade-obs-dot ade-obs-bd-wait" />
                {t("obs.trace.waiting")} {formatDurationShort(trace.breakdown.waitingMs)} ({Math.round((trace.breakdown.waitingMs / bdTotal) * 100)}%)
              </span>
            </div>
          </>
        ) : null}
      </div>

      <div className="ade-obs-gantt">
        {loading && !trace ? (
          <div className="ade-obs-empty">{t("obs.loading")}</div>
        ) : !trace || trace.spans.length === 0 ? (
          <div className="ade-obs-empty">
            <Clock className="size-6 opacity-50" />
            <span>{t("obs.trace.empty")}</span>
          </div>
        ) : (
          <>
            {trace.foldedGaps.length > 0 ? (
              <div className="ade-obs-gap-marker">
                {t("obs.trace.foldedGaps", {
                  count: trace.foldedGaps.length,
                  duration: formatDurationShort(trace.foldedGaps.reduce((sum, g) => sum + g.durationMs, 0)),
                })}
              </div>
            ) : null}

            {grouped.map((group, gIdx) => (
              <div key={group.stage?.id ?? `unassigned-${gIdx}`} className="ade-obs-stage-group">
                <div className="ade-obs-stage-head">
                  <div className="flex items-center gap-2">
                    <span>{group.stage ? group.stage.name : t("obs.trace.unassignedStage")}</span>
                    {group.stage ? <span className="ade-obs-badge">{group.stage.status}</span> : null}
                    {group.stage?.checksOk === true ? (
                      <span className="ade-obs-badge is-ok">
                        <CheckCircle2 className="size-2.5" />
                        {t("obs.trace.checksPassed")}
                      </span>
                    ) : group.stage?.checksOk === false ? (
                      <span className="ade-obs-badge is-hot">
                        <XCircle className="size-2.5" />
                        {t("obs.trace.checksFailed")}
                      </span>
                    ) : null}
                    {group.stage?.reviewerModel ? (
                      <span className="ade-obs-badge is-stage">
                        <ShieldCheck className="size-2.5" />
                        {group.stage.reviewerModel}
                      </span>
                    ) : null}
                  </div>
                  {group.stage?.startedAt ? (
                    <span className="text-[11px] ade-muted ade-mono">
                      {formatDurationShort((group.stage.endedAt ?? trace.at) - group.stage.startedAt)}
                    </span>
                  ) : null}
                </div>

                {group.spans.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] ade-muted">{t("obs.trace.noSpansInStage")}</div>
                ) : (
                  group.spans.map(span => {
                    const leftPct = Math.min(98, Math.max(0, ((span.startedAt - axisStart) / axisSpan) * 100))
                    const widthPct = Math.max(1.2, Math.min(100 - leftPct, (span.durationMs / axisSpan) * 100))
                    return (
                      <button
                        key={span.id}
                        type="button"
                        className={`ade-obs-gantt-row${selectedSpanId === span.id ? " is-selected" : ""}`}
                        onClick={() => setSelectedSpanId(span.id)}
                      >
                        <span className="truncate ade-mono">{span.label}</span>
                        <span className="ade-mono ade-muted text-right">{formatDurationShort(span.durationMs)}</span>
                        <div className="ade-obs-gantt-track" aria-hidden="true">
                          <span
                            className={`ade-obs-gantt-bar is-${span.kind}${span.status === "error" ? " is-error" : ""}`}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          />
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {selectedSpan ? (
        <div className="px-4 py-2 border-t border-[rgb(var(--border))] bg-[rgb(var(--surface))] flex items-center justify-between gap-3 text-[11px] flex-wrap">
          <span className="ade-mono font-medium">
            {selectedSpan.label} · {selectedSpan.status}
            {selectedSpan.exitCode !== undefined && selectedSpan.exitCode !== null ? ` (exit ${selectedSpan.exitCode})` : ""}
          </span>
          <span className="ade-mono ade-muted">
            {formatDateTime(selectedSpan.startedAt)} · {formatDurationShort(selectedSpan.durationMs)}
          </span>
        </div>
      ) : null}
    </div>
  )
}
