import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, CircleDashed, ExternalLink, GitPullRequest, RefreshCw, Settings2, XCircle } from "lucide-react"
import { request } from "../../api"
import type { Project } from "../../ProjectsView"
import { useI18n, type I18nContextValue } from "../i18n/I18nContext"

type PullRequestRow = {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  author: string
  headRefName: string
  baseRefName: string
  updatedAt: string
  reviewDecision: string | null
  checksSummary: "none" | "pending" | "success" | "failure"
}

const stateFilters = [
  { id: "open", labelKey: "prjx.list.pr.filterOpen" },
  { id: "merged", labelKey: "prjx.list.pr.filterMerged" },
  { id: "closed", labelKey: "prjx.list.pr.filterClosed" },
  { id: "all", labelKey: "prjx.list.pr.filterAll" },
] as const

const emptyStateKeys = {
  all: "prjx.list.pr.emptyAll",
  open: "prjx.list.pr.emptyOpen",
  merged: "prjx.list.pr.emptyMerged",
  closed: "prjx.list.pr.emptyClosed",
} as const

const checksAriaKeys = {
  none: "prjx.list.pr.checksNone",
  pending: "prjx.list.pr.checksPending",
  success: "prjx.list.pr.checksSuccess",
  failure: "prjx.list.pr.checksFailure",
} as const

function relativeTime(iso: string, t: I18nContextValue["t"]) {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return ""
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return t("prjx.pr.minutesAgo", { count: Math.max(1, minutes) })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return t("prjx.pr.hoursAgo", { count: hours })
  return t("prjx.pr.daysAgo", { count: Math.round(hours / 24) })
}

/** Pull requests of the project's linked GitHub repository, read through the host's GitHub CLI. */
export function ProjectPullRequests({
  project,
  sessionBranches,
  onOpenExternal,
  onOpenSession,
  onOpenProjectSettings,
}: {
  project: Project
  /** Branch name → session id, so PRs opened from ADE sessions link back to them. */
  sessionBranches: Record<string, string>
  onOpenExternal: (url: string) => void
  onOpenSession: (sessionId: string) => void
  onOpenProjectSettings: () => void
}) {
  const { t } = useI18n()
  const [state, setState] = useState<(typeof stateFilters)[number]["id"]>("open")
  const [rows, setRows] = useState<PullRequestRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const fetchKey = `${project.id}:${project.githubUrl ?? ""}:${state}`
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey)

  if (fetchKey !== prevFetchKey) {
    setPrevFetchKey(fetchKey)
    if (project.githubUrl) {
      setLoading(true)
      setError("")
    }
  }

  const load = useCallback(async () => {
    if (!project.githubUrl) return
    setLoading(true)
    setError("")
    try {
      const res = await request<{ pullRequests: PullRequestRow[] }>(`/api/projects/${encodeURIComponent(project.id)}/pulls?state=${state}`)
      setRows(res.pullRequests)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("prjx.list.pr.loadError"))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [project.id, project.githubUrl, state, t])

  useEffect(() => {
    if (!project.githubUrl) return
    let cancelled = false
    void request<{ pullRequests: PullRequestRow[] }>(`/api/projects/${encodeURIComponent(project.id)}/pulls?state=${state}`)
      .then(res => {
        if (!cancelled) {
          setRows(res.pullRequests)
          setError("")
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("prjx.list.pr.loadError"))
          setRows([])
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [project.id, project.githubUrl, state, t])

  if (!project.githubUrl) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <GitPullRequest className="size-8 opacity-40" />
        <div className="text-sm font-semibold">{t("prjx.list.issues.noRepoTitle", { project: project.name })}</div>
        <button type="button" className="sf-btn-primary" onClick={onOpenProjectSettings}>
          <Settings2 className="size-3.5" /> {t("prjx.list.pr.linkRepo")}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[rgb(var(--border)/0.75)]">
        <div className="ade-segmented" role="tablist" aria-label={t("prjx.list.pr.stateAria")}>
          {stateFilters.map(filter => (
            <button key={filter.id} type="button" role="tab" aria-selected={state === filter.id} className={state === filter.id ? "is-active" : ""} onClick={() => setState(filter.id)}>
              {t(filter.labelKey)}
            </button>
          ))}
        </div>
        <button type="button" className="sf-btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> {t("prjx.list.pr.refresh")}
        </button>
      </div>
      {error ? <div className="m-4 ade-banner-error">{error}</div> : null}
      <div className="flex-1 overflow-y-auto divide-y divide-[rgb(var(--border)/0.65)]">
        {rows === null || (loading && rows.length === 0) ? (
          <div className="p-8 text-center text-xs opacity-65">{t("prjx.list.pr.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs opacity-65">{t(emptyStateKeys[state])}</div>
        ) : rows.map(pr => {
          const sessionId = sessionBranches[pr.headRefName]
          const stateLabel = pr.state === "MERGED"
            ? t("prjx.list.pr.stateMerged")
            : pr.state === "CLOSED"
              ? t("prjx.list.pr.stateClosed")
              : pr.state.toLowerCase()
          return (
            <div key={pr.number} className="px-5 py-3 flex items-center gap-4 hover:bg-[rgb(var(--surface)/0.6)]">
              <span className="shrink-0" aria-label={t(checksAriaKeys[pr.checksSummary])}>
                {pr.checksSummary === "success" ? <CheckCircle2 className="size-4 ade-text-ok" />
                  : pr.checksSummary === "failure" ? <XCircle className="size-4 ade-text-error" />
                    : pr.checksSummary === "pending" ? <CircleDashed className="size-4 ade-text-warn" />
                      : <GitPullRequest className="size-4 opacity-50" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="font-mono text-xs opacity-60">#{pr.number}</span>
                  <span className="truncate">{pr.title}</span>
                  {pr.isDraft ? <span className="sf-badge sf-badge-muted">{t("prjx.list.pr.draft")}</span> : null}
                  {pr.state !== "OPEN" ? <span className="sf-badge sf-badge-muted">{stateLabel}</span> : null}
                </div>
                <div className="text-[11.5px] opacity-60 mt-0.5 truncate">
                  {pr.author ? `${pr.author} · ` : ""}<span className="font-mono">{pr.headRefName}</span> → {pr.baseRefName} · {relativeTime(pr.updatedAt, t)}
                  {pr.reviewDecision === "APPROVED" ? t("prjx.list.pr.approved") : pr.reviewDecision === "CHANGES_REQUESTED" ? t("prjx.list.pr.changesRequested") : ""}
                </div>
              </div>
              {sessionId ? <button type="button" className="sf-btn-secondary shrink-0" onClick={() => onOpenSession(sessionId)}>{t("prjx.list.pr.openSession")}</button> : null}
              <button type="button" className="ade-icon-btn shrink-0" title={t("prjx.list.issues.openOnGithub")} aria-label={t("prjx.list.pr.openOnGithubAria", { number: pr.number })} onClick={() => onOpenExternal(pr.url)}>
                <ExternalLink className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
