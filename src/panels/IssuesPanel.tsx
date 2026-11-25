import { useEffect, useState } from "react"
import { CircleDot, ExternalLink, Play, RefreshCw, Search } from "lucide-react"
import { request } from "../api"
import type { GitHubIssue } from "../app-types"

type IssueRow = Pick<GitHubIssue, "repository" | "number" | "title" | "state" | "url" | "body">

/**
 * Issues: the project's open GitHub issues beside the session. "Start session" opens New session
 * with the issue linked and the task filled in.
 */
export function IssuesPanel({
  projectId,
  linkedIssueNumber,
  onStartSession,
  onOpenExternal,
}: {
  projectId: string | null
  /** The issue this session works on, if any (shown first). */
  linkedIssueNumber?: number | null
  onStartSession: (issue: GitHubIssue) => void
  onOpenExternal?: (url: string) => void
}) {
  const [issues, setIssues] = useState<IssueRow[] | null>(null)
  const [unlinked, setUnlinked] = useState(false)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void request<{ issues: IssueRow[]; unlinked?: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/issues?state=open`)
      .then(result => {
        if (cancelled) return
        setIssues(Array.isArray(result?.issues) ? result.issues : [])
        setUnlinked(Boolean(result?.unlinked))
        setError("")
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the issues.") })
    return () => { cancelled = true }
  }, [projectId, tick])

  if (!projectId) return <div className="ade-pane-empty"><p>This session isn't part of a project, so there are no issues to show.</p></div>
  if (unlinked) return <div className="ade-pane-empty"><p>Link this project to a GitHub repository in its settings to see its issues here.</p></div>

  const q = query.trim().toLowerCase()
  const shown = (issues ?? [])
    .filter(issue => !q || issue.title.toLowerCase().includes(q) || String(issue.number).includes(q.replace(/^#/, "")))
    .sort((a, b) => Number(b.number === linkedIssueNumber) - Number(a.number === linkedIssueNumber))

  return (
    <div className="ade-pane-body ade-issues">
      <div className="ade-issues-head">
        <label className="ade-issues-search">
          <Search className="size-3.5 opacity-60" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter open issues" aria-label="Filter issues" />
        </label>
        <button type="button" className="ade-icon-btn" onClick={() => setTick(value => value + 1)} title="Reload" aria-label="Reload issues">
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      {error ? <p className="ade-error-text ade-xs" role="alert">{error}</p> : null}
      {issues === null && !error ? <p className="ade-muted ade-xs">Loading issues…</p> : null}
      {issues && !shown.length ? <p className="ade-muted ade-xs">{q ? "No open issues match." : "No open issues."}</p> : null}
      <ul className="ade-issue-list">
        {shown.map(issue => (
          <li key={`${issue.repository}#${issue.number}`} className={`ade-issue ${issue.number === linkedIssueNumber ? "is-linked" : ""}`}>
            <CircleDot className="size-4 ade-issue-icon" />
            <div className="ade-issue-text">
              <strong title={issue.title}>{issue.title}</strong>
              <span className="ade-muted ade-xs">#{issue.number}{issue.number === linkedIssueNumber ? " · this session works on it" : ""}</span>
            </div>
            <div className="ade-issue-actions">
              <button type="button" className="ade-chip-btn" onClick={() => onStartSession({ ...issue, body: issue.body ?? "", truncated: false })} title="Start a new session on this issue">
                <Play className="size-3" /> Start session
              </button>
              {onOpenExternal ? (
                <button type="button" className="ade-icon-btn" onClick={() => onOpenExternal(issue.url)} title="Open on GitHub" aria-label={`Open issue ${issue.number} on GitHub`}>
                  <ExternalLink className="size-3.5" />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
