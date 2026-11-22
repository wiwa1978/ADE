import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, CircleDashed, ExternalLink, GitPullRequest, RefreshCw, Settings2, XCircle } from "lucide-react"
import { request } from "../../api"
import type { Project } from "../../ProjectsView"

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
  { id: "open", label: "Open" },
  { id: "merged", label: "Merged" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
] as const

function relativeTime(iso: string) {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return ""
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
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
  const [state, setState] = useState<(typeof stateFilters)[number]["id"]>("open")
  const [rows, setRows] = useState<PullRequestRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    if (!project.githubUrl) return
    setLoading(true)
    setError("")
    try {
      const res = await request<{ pullRequests: PullRequestRow[] }>(`/api/projects/${encodeURIComponent(project.id)}/pulls?state=${state}`)
      setRows(res.pullRequests)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load pull requests via GitHub CLI.")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [project.id, project.githubUrl, state])

  useEffect(() => {
    void load()
  }, [load])

  if (!project.githubUrl) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <GitPullRequest className="size-8 opacity-40" />
        <div className="text-sm font-semibold">No GitHub repository linked to {project.name}</div>
        <button type="button" className="sf-btn-primary" onClick={onOpenProjectSettings}>
          <Settings2 className="size-3.5" /> Link GitHub repository
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[rgb(var(--border)/0.75)]">
        <div className="ade-segmented" role="tablist" aria-label="Pull request state">
          {stateFilters.map(filter => (
            <button key={filter.id} type="button" role="tab" aria-selected={state === filter.id} className={state === filter.id ? "is-active" : ""} onClick={() => setState(filter.id)}>
              {filter.label}
            </button>
          ))}
        </div>
        <button type="button" className="sf-btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {error ? <div className="m-4 ade-banner-error">{error}</div> : null}
      <div className="flex-1 overflow-y-auto divide-y divide-[rgb(var(--border)/0.65)]">
        {rows === null || (loading && rows.length === 0) ? (
          <div className="p-8 text-center text-xs opacity-65">Loading pull requests via GitHub CLI…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs opacity-65">No {state === "all" ? "" : `${state} `}pull requests in this repository.</div>
        ) : rows.map(pr => {
          const sessionId = sessionBranches[pr.headRefName]
          return (
            <div key={pr.number} className="px-5 py-3 flex items-center gap-4 hover:bg-[rgb(var(--surface)/0.6)]">
              <span className="shrink-0" aria-label={`Checks ${pr.checksSummary}`}>
                {pr.checksSummary === "success" ? <CheckCircle2 className="size-4 ade-text-ok" />
                  : pr.checksSummary === "failure" ? <XCircle className="size-4 ade-text-error" />
                    : pr.checksSummary === "pending" ? <CircleDashed className="size-4 ade-text-warn" />
                      : <GitPullRequest className="size-4 opacity-50" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="font-mono text-xs opacity-60">#{pr.number}</span>
                  <span className="truncate">{pr.title}</span>
                  {pr.isDraft ? <span className="sf-badge sf-badge-muted">Draft</span> : null}
                  {pr.state !== "OPEN" ? <span className="sf-badge sf-badge-muted">{pr.state.toLowerCase()}</span> : null}
                </div>
                <div className="text-[11.5px] opacity-60 mt-0.5 truncate">
                  {pr.author ? `${pr.author} · ` : ""}<span className="font-mono">{pr.headRefName}</span> → {pr.baseRefName} · {relativeTime(pr.updatedAt)}
                  {pr.reviewDecision === "APPROVED" ? " · approved" : pr.reviewDecision === "CHANGES_REQUESTED" ? " · changes requested" : ""}
                </div>
              </div>
              {sessionId ? <button type="button" className="sf-btn-secondary shrink-0" onClick={() => onOpenSession(sessionId)}>Open session</button> : null}
              <button type="button" className="ade-icon-btn shrink-0" title="Open on GitHub" aria-label={`Open pull request #${pr.number} on GitHub`} onClick={() => onOpenExternal(pr.url)}>
                <ExternalLink className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
