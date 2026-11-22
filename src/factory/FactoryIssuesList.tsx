import { useCallback, useEffect, useState } from "react"
import { ExternalLink, GitPullRequest, Play, RefreshCw, Settings2 } from "lucide-react"
import { request } from "../../api"
import type { Project } from "../../ProjectsView"

export type ProjectGitHubIssue = {
  repository: string
  number: number
  title: string
  body: string
  state: "open" | "closed"
  url: string
  labels: string[]
  updatedAt: string
}

export function FactoryIssuesList({
  project,
  onOpenProjectSettings,
  onStartFromIssue,
  onStartSessionFromIssue,
}: {
  project: Project | null
  onOpenProjectSettings: () => void
  onStartFromIssue: (issue: ProjectGitHubIssue) => Promise<void>
  /** Start a regular agent session (worktree + chat) for the issue. */
  onStartSessionFromIssue?: (issue: ProjectGitHubIssue) => Promise<void>
}) {
  const [issues, setIssues] = useState<ProjectGitHubIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [startingNumber, setStartingNumber] = useState<number | null>(null)
  const [error, setError] = useState("")
  const projectKey = `${project?.id ?? ""}:${project?.githubUrl ?? ""}`
  const [prevProjectKey, setPrevProjectKey] = useState(projectKey)

  if (projectKey !== prevProjectKey) {
    setPrevProjectKey(projectKey)
    setError("")
    if (!project || !project.githubUrl) {
      setIssues([])
      setLoading(false)
    } else {
      setLoading(true)
    }
  }

  const load = useCallback(async () => {
    if (!project || !project.githubUrl) {
      setIssues([])
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await request<{ issues: ProjectGitHubIssue[] }>(
        `/api/projects/${encodeURIComponent(project.id)}/issues?state=open`,
      )
      setIssues(res.issues)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load GitHub issues via gh CLI.")
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    if (!project || !project.githubUrl) return
    let cancelled = false
    void request<{ issues: ProjectGitHubIssue[] }>(
      `/api/projects/${encodeURIComponent(project.id)}/issues?state=open`,
    )
      .then(res => {
        if (!cancelled) {
          setIssues(res.issues)
          setError("")
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load GitHub issues via gh CLI.")
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [project])

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm opacity-70">
        Select or create a project first to browse its GitHub issues.
      </div>
    )
  }

  if (!project.githubUrl) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <GitPullRequest className="size-8 opacity-40" />
        <div className="text-sm font-semibold">No GitHub repository linked to {project.name}</div>
        <p className="text-xs opacity-70 max-w-md">
          Link a GitHub repository in Project Settings (or auto-detect from your local Git checkout) to pull open public or private issues here.
        </p>
        <button type="button" className="sf-btn-primary" onClick={onOpenProjectSettings}>
          <Settings2 className="size-3.5" /> Link GitHub Repository
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[rgb(var(--border)/0.75)]">
        <div className="text-xs">
          <span className="font-semibold">{project.githubUrl.replace(/^https:\/\/github\.com\//i, "")}</span>
          <span className="opacity-65"> · {issues.length} open issues</span>
        </div>
        <button type="button" className="sf-btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh Issues
        </button>
      </div>

      {error ? <div className="m-4 ade-banner-error">{error}</div> : null}

      <div className="flex-1 overflow-y-auto divide-y divide-[rgb(var(--border)/0.65)]">
        {loading && issues.length === 0 ? (
          <div className="p-8 text-center text-xs opacity-65">Loading open issues via GitHub CLI…</div>
        ) : issues.length === 0 ? (
          <div className="p-8 text-center text-xs opacity-65">No open issues found in this repository.</div>
        ) : (
          issues.map(issue => (
            <div
              key={issue.number}
              className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[rgb(var(--surface)/0.6)] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="font-mono text-xs opacity-60">#{issue.number}</span>
                  <span className="truncate">{issue.title}</span>
                  {issue.url ? (
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer"
                      className="opacity-50 hover:opacity-100"
                      title="Open on GitHub"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
                {issue.labels.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {issue.labels.map(label => (
                      <span key={label} className="sf-badge sf-badge-muted">{label}</span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 gap-2">
                {onStartSessionFromIssue ? (
                  <button
                    type="button"
                    className="sf-btn-primary"
                    disabled={startingNumber !== null}
                    onClick={async () => {
                      setStartingNumber(issue.number)
                      setError("")
                      try {
                        await onStartSessionFromIssue(issue)
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not start a session for this issue.")
                      } finally {
                        setStartingNumber(null)
                      }
                    }}
                  >
                    <Play className="size-3.5" />
                    {startingNumber === issue.number ? "Starting…" : "Start session"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={onStartSessionFromIssue ? "sf-btn-secondary" : "sf-btn-primary"}
                  disabled={startingNumber !== null}
                  onClick={async () => {
                    setStartingNumber(issue.number)
                    try {
                      await onStartFromIssue(issue)
                    } finally {
                      setStartingNumber(null)
                    }
                  }}
                >
                  {onStartSessionFromIssue ? null : <Play className="size-3.5" />}
                  Factory run
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
