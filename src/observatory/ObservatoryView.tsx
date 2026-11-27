import { useCallback, useEffect, useState } from "react"
import { Activity, Clock, RefreshCw } from "lucide-react"
import { request } from "../api"
import { usePolling } from "../hooks/usePolling"
import { useI18n } from "../i18n/I18nContext"
import { FleetLiveTab } from "./FleetLiveTab"
import { TaskTraceTab } from "./TaskTraceTab"
import type { ObservatoryLiveSnapshot, ObservatoryTaskTrace } from "./observatory-types"
import "./observatory.css"

const WINDOWS = [15, 30, 60, 180] as const

export function ObservatoryView({
  onOpenSession,
  initialTab = "live",
  initialSessionId = null,
}: {
  onOpenSession: (sessionId: string) => void
  initialTab?: "live" | "trace"
  initialSessionId?: string | null
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState<"live" | "trace">(initialTab)
  const [scope, setScope] = useState<"all" | "active" | "needs-you">("all")
  const [windowMin, setWindowMin] = useState<number>(30)
  const [live, setLive] = useState<ObservatoryLiveSnapshot | null>(null)
  const [liveError, setLiveError] = useState<string>("")
  const [traceSessionId, setTraceSessionId] = useState<string | null>(initialSessionId)
  const [trace, setTrace] = useState<ObservatoryTaskTrace | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)

  const fetchLive = useCallback(async () => {
    try {
      const data = await request<ObservatoryLiveSnapshot>(
        `/api/observatory/live?windowMin=${windowMin}&scope=${scope}`,
      )
      setLive(data)
      setLiveError("")
      setTraceSessionId(prev => prev ?? data.sessions[0]?.sessionId ?? null)
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : t("obs.loadError"))
    }
  }, [windowMin, scope, t])

  const fetchTrace = useCallback(async (sessionId: string) => {
    try {
      const data = await request<ObservatoryTaskTrace>(`/api/observatory/trace/${encodeURIComponent(sessionId)}`)
      setTrace(data)
    } catch {
      setTrace(null)
    } finally {
      setTraceLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void request<ObservatoryLiveSnapshot>(`/api/observatory/live?windowMin=${windowMin}&scope=${scope}`)
      .then(data => {
        if (cancelled) return
        setLive(data)
        setLiveError("")
        setTraceSessionId(prev => prev ?? data.sessions[0]?.sessionId ?? null)
      })
      .catch(error => {
        if (cancelled) return
        setLiveError(error instanceof Error ? error.message : t("obs.loadError"))
      })
    return () => { cancelled = true }
  }, [windowMin, scope, t])

  useEffect(() => {
    if (tab !== "trace" || !traceSessionId) return
    let cancelled = false
    void request<ObservatoryTaskTrace>(`/api/observatory/trace/${encodeURIComponent(traceSessionId)}`)
      .then(data => {
        if (cancelled) return
        setTrace(data)
        setTraceLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setTrace(null)
        setTraceLoading(false)
      })
    return () => { cancelled = true }
  }, [tab, traceSessionId])

  usePolling(() => { void fetchLive() }, 3_000, { enabled: tab === "live", immediate: false })
  usePolling(
    () => { if (traceSessionId) void fetchTrace(traceSessionId) },
    4_000,
    { enabled: tab === "trace" && Boolean(traceSessionId), immediate: false },
  )

  const handleOpenTrace = useCallback((sessionId: string) => {
    setTraceLoading(true)
    setTraceSessionId(sessionId)
    setTab("trace")
  }, [])

  return (
    <div className="ade-obs">
      <header className="ade-obs-header">
        <div className="ade-obs-title-row">
          <Activity className="size-4 text-[var(--accent)]" />
          <h1 className="ade-obs-title">{t("obs.title")}</h1>
          <div className="ade-obs-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "live"}
              className={`ade-obs-tab${tab === "live" ? " is-active" : ""}`}
              onClick={() => setTab("live")}
            >
              <Activity className="size-3.5" />
              {t("obs.tab.live")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "trace"}
              className={`ade-obs-tab${tab === "trace" ? " is-active" : ""}`}
              onClick={() => setTab("trace")}
            >
              <Clock className="size-3.5" />
              {t("obs.tab.trace")}
            </button>
          </div>
        </div>

        <div className="ade-obs-controls">
          {tab === "live" ? (
            <>
              <div className="ade-obs-pill-group" role="group" aria-label={t("obs.scopeAria")}>
                {(["all", "active", "needs-you"] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`ade-obs-pill${scope === s ? " is-active" : ""}`}
                    onClick={() => setScope(s)}
                  >
                    {s === "all" ? t("obs.scope.all") : s === "active" ? t("obs.scope.active") : t("obs.scope.needsYou")}
                  </button>
                ))}
              </div>

              <div className="ade-obs-pill-group" role="group" aria-label={t("obs.windowAria")}>
                {WINDOWS.map(w => (
                  <button
                    key={w}
                    type="button"
                    className={`ade-obs-pill${windowMin === w ? " is-active" : ""}`}
                    onClick={() => setWindowMin(w)}
                  >
                    {w >= 60 ? `${w / 60}h` : `${w}m`}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <button
            type="button"
            className="ade-chip-btn"
            onClick={() => {
              if (tab === "live") void fetchLive()
              else if (traceSessionId) void fetchTrace(traceSessionId)
            }}
            title={t("obs.refresh")}
          >
            <RefreshCw className="size-3" />
            {t("obs.refresh")}
          </button>
        </div>
      </header>

      {liveError ? (
        <div className="ade-banner-error rounded-none border-x-0 border-t-0">{liveError}</div>
      ) : null}

      {tab === "live" ? (
        live ? (
          <FleetLiveTab
            snapshot={live}
            onOpenSession={onOpenSession}
            onOpenTrace={handleOpenTrace}
          />
        ) : (
          <div className="ade-obs-empty">{t("obs.loading")}</div>
        )
      ) : (
        <TaskTraceTab
          trace={trace}
          sessions={(live?.sessions ?? []).map(s => ({ sessionId: s.sessionId, title: s.title }))}
          selectedSessionId={traceSessionId}
          loading={traceLoading}
          onSelectSession={setTraceSessionId}
          onOpenSession={onOpenSession}
        />
      )}
    </div>
  )
}
