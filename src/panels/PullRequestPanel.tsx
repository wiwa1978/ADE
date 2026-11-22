import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, GitBranch, GitMerge, GitPullRequest, RefreshCw, Upload, XCircle } from "lucide-react"
import { request } from "../../api"

type BranchStatus = {
  branch: string | null
  base: string | null
  baseBranch: string | null
  commitsAhead: number
  upstream: string | null
  unpushed: number
  behindUpstream: number
  hasRemote: boolean
  uncommitted: number
}

type Check = { name: string; status: "pending" | "success" | "failure" | "neutral"; url: string | null }

export type PullRequestInfo = {
  number: number
  url: string
  title: string
  state: "OPEN" | "CLOSED" | "MERGED"
  isDraft: boolean
  reviewDecision: string | null
  mergeable: string | null
  baseRefName: string
  headRefName: string
  additions: number
  deletions: number
  changedFiles: number
  checks: Check[]
  checksSummary: "none" | "pending" | "success" | "failure"
}

const reviewLabels: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
}

function CheckIcon({ status }: { status: Check["status"] | PullRequestInfo["checksSummary"] }) {
  if (status === "success") return <CheckCircle2 className="size-3.5 ade-text-ok" aria-label="Passed" />
  if (status === "failure") return <XCircle className="size-3.5 ade-text-error" aria-label="Failed" />
  if (status === "pending") return <CircleDashed className="size-3.5 ade-text-warn ade-spin-slow" aria-label="Running" />
  return <CircleDashed className="size-3.5 opacity-50" aria-label="Neutral" />
}

export function PullRequestPanel({
  sessionId,
  sessionLabel,
  issue,
  draftDefault,
  refreshKey,
  onOpenExternal,
  onOpenChanges,
  onPullRequestChange,
}: {
  sessionId: string
  sessionLabel: string
  issue?: { number: number; url: string; repository: string } | null
  draftDefault: boolean
  refreshKey: unknown
  onOpenExternal: (url: string) => void
  onOpenChanges: () => void
  onPullRequestChange?: (pr: PullRequestInfo | null) => void
}) {
  const [status, setStatus] = useState<BranchStatus | null>(null)
  const [pr, setPr] = useState<PullRequestInfo | null | undefined>(undefined)
  const [title, setTitle] = useState(sessionLabel)
  const [body, setBody] = useState(issue ? `Closes #${issue.number}\n` : "")
  const [draft, setDraft] = useState(draftDefault)
  const [base, setBase] = useState("")
  const [mergeMethod, setMergeMethod] = useState<"squash" | "merge" | "rebase">("squash")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const [branch, pull] = await Promise.all([
        request<BranchStatus>(`/api/sessions/${encodeURIComponent(sessionId)}/branch`),
        request<{ pullRequest: PullRequestInfo | null }>(`/api/sessions/${encodeURIComponent(sessionId)}/pr`).catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Could not read the pull request from GitHub.")
          return { pullRequest: null }
        }),
      ])
      setStatus(branch)
      setPr(pull.pullRequest)
      onPullRequestChange?.(pull.pullRequest)
      setBase(current => current || branch.baseBranch || "")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the branch status.")
      setPr(null)
    }
  }, [sessionId, onPullRequestChange])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      request<BranchStatus>(`/api/sessions/${encodeURIComponent(sessionId)}/branch`),
      request<{ pullRequest: PullRequestInfo | null }>(`/api/sessions/${encodeURIComponent(sessionId)}/pr`).catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read the pull request from GitHub.")
        return { pullRequest: null }
      }),
    ])
      .then(([branch, pull]) => {
        if (cancelled) return
        setStatus(branch)
        setPr(pull.pullRequest)
        onPullRequestChange?.(pull.pullRequest)
        setBase(current => current || branch.baseBranch || "")
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Could not read the branch status.")
        setPr(null)
      })
    return () => { cancelled = true }
  }, [sessionId, onPullRequestChange, refreshKey])

  // Keep checks fresh while they are running.
  useEffect(() => {
    if (!pr || pr.state !== "OPEN" || pr.checksSummary !== "pending") return
    const timer = window.setInterval(() => void load(), 20_000)
    return () => window.clearInterval(timer)
  }, [pr, load])

  const act = async (name: string, path: string, payload: unknown = {}) => {
    setBusy(name)
    setError("")
    try {
      const result = await request<{ pullRequest?: PullRequestInfo | null }>(`/api/sessions/${encodeURIComponent(sessionId)}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (result && "pullRequest" in result) {
        setPr(result.pullRequest ?? null)
        onPullRequestChange?.(result.pullRequest ?? null)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "The GitHub action failed.")
    } finally {
      setBusy(null)
    }
  }

  if (!status || pr === undefined) {
    return <div className="ade-pane-empty"><p>Checking the branch and pull request…</p></div>
  }

  const onBaseBranch = Boolean(status.branch && status.baseBranch && status.branch === status.baseBranch)

  return (
    <div className="ade-pane-body ade-pr-panel">
      <div className="ade-pane-toolbar">
        <div className="ade-diff-header-meta">
          <span className="ade-pill ade-mono"><GitBranch className="size-3" /> {status.branch ?? "detached HEAD"}</span>
          {status.baseBranch ? <span className="ade-muted ade-xs">into {status.baseBranch}</span> : null}
        </div>
        <button type="button" className="ade-icon-btn" onClick={() => void load()} title="Refresh" aria-label="Refresh pull request status">
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {error ? <div className="ade-banner-error" role="alert">{error}</div> : null}

      <div className="ade-pr-body">
        <section className="ade-pr-facts" aria-label="Branch status">
          <div><strong>{status.commitsAhead}</strong><span>commit{status.commitsAhead === 1 ? "" : "s"} on this branch</span></div>
          <div><strong>{status.unpushed}</strong><span>not pushed</span></div>
          <div className={status.uncommitted ? "is-warn" : ""}><strong>{status.uncommitted}</strong><span>uncommitted</span></div>
        </section>

        {!status.hasRemote ? (
          <p className="ade-pr-note"><AlertTriangle className="size-3.5" /> This repository has no <code>origin</code> remote, so it can’t be pushed or opened as a pull request.</p>
        ) : onBaseBranch ? (
          <p className="ade-pr-note"><AlertTriangle className="size-3.5" /> This session works directly on <code>{status.branch}</code>. Start a worktree session to get its own branch and pull request.</p>
        ) : null}

        {status.uncommitted > 0 ? (
          <p className="ade-pr-note">
            <AlertTriangle className="size-3.5" /> {status.uncommitted} uncommitted change{status.uncommitted === 1 ? "" : "s"} won’t be included until committed.
            <button type="button" className="ade-link-btn" onClick={onOpenChanges}>Review in Changes</button>
          </p>
        ) : null}

        {pr ? (
          <section className="ade-pr-card" aria-label={`Pull request #${pr.number}`}>
            <header>
              <GitPullRequest className="size-4" />
              <div className="ade-pr-title">
                <strong>{pr.title}</strong>
                <span className="ade-muted ade-xs">#{pr.number} · {pr.headRefName} → {pr.baseRefName}</span>
              </div>
              <span className={`ade-pr-state is-${pr.state === "OPEN" && pr.isDraft ? "draft" : pr.state.toLowerCase()}`}>
                {pr.state === "OPEN" ? (pr.isDraft ? "Draft" : "Open") : pr.state === "MERGED" ? "Merged" : "Closed"}
              </span>
            </header>
            <div className="ade-pr-meta">
              <span className="ade-diff-add">+{pr.additions}</span>
              <span className="ade-diff-del">-{pr.deletions}</span>
              <span className="ade-muted ade-xs">{pr.changedFiles} file{pr.changedFiles === 1 ? "" : "s"}</span>
              {pr.reviewDecision ? <span className={`ade-pill ${pr.reviewDecision === "APPROVED" ? "ade-pill-ok" : ""}`}>{reviewLabels[pr.reviewDecision] ?? pr.reviewDecision}</span> : null}
            </div>
            {pr.checks.length ? (
              <div className="ade-pr-checks">
                <div className="ade-pr-checks-head"><CheckIcon status={pr.checksSummary} /> Checks</div>
                <ul>
                  {pr.checks.map((check, index) => (
                    <li key={`${check.name}-${index}`}>
                      <CheckIcon status={check.status} />
                      <span className="ade-truncate">{check.name}</span>
                      {check.url ? <button type="button" className="ade-link-btn" onClick={() => onOpenExternal(check.url!)}>Details</button> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p className="ade-muted ade-xs">No checks reported for this pull request.</p>}
            <div className="ade-pr-actions">
              <button type="button" className="ade-chip-btn" onClick={() => onOpenExternal(pr.url)}><ExternalLink className="size-3" /> Open on GitHub</button>
              {pr.state === "OPEN" && status.unpushed > 0 ? (
                <button type="button" className="ade-chip-btn" disabled={Boolean(busy)} onClick={() => void act("push", "push")}>
                  <Upload className="size-3" /> {busy === "push" ? "Pushing…" : `Push ${status.unpushed} commit${status.unpushed === 1 ? "" : "s"}`}
                </button>
              ) : null}
              {pr.state === "OPEN" && pr.isDraft ? (
                <button type="button" className="ade-chip-btn" disabled={Boolean(busy)} onClick={() => void act("ready", "pr/ready")}>{busy === "ready" ? "Updating…" : "Ready for review"}</button>
              ) : null}
            </div>
            {pr.state === "OPEN" && !pr.isDraft ? (
              <div className="ade-pr-merge">
                <select aria-label="Merge method" value={mergeMethod} onChange={event => setMergeMethod(event.target.value as typeof mergeMethod)}>
                  <option value="squash">Squash and merge</option>
                  <option value="merge">Create a merge commit</option>
                  <option value="rebase">Rebase and merge</option>
                </select>
                <button
                  type="button"
                  className="ade-btn ade-btn-primary ade-btn-xs"
                  disabled={Boolean(busy) || pr.mergeable === "CONFLICTING"}
                  title={pr.mergeable === "CONFLICTING" ? "This branch has conflicts with the base branch" : undefined}
                  onClick={() => {
                    if (confirm(`Merge pull request #${pr.number} into ${pr.baseRefName}? This updates the repository on GitHub.`)) void act("merge", "pr/merge", { method: mergeMethod })
                  }}
                >
                  <GitMerge className="size-3.5" /> {busy === "merge" ? "Merging…" : "Merge"}
                </button>
              </div>
            ) : null}
            {pr.state === "MERGED" ? <p className="ade-muted ade-xs">Merged. You can archive this session to clean up its worktree.</p> : null}
          </section>
        ) : status.hasRemote && !onBaseBranch && status.branch ? (
          <form
            className="ade-pr-form"
            onSubmit={event => {
              event.preventDefault()
              void act("create", "pr", { title, body, draft, base })
            }}
          >
            <h3>Open a pull request</h3>
            {status.commitsAhead === 0 ? <p className="ade-muted ade-xs">There are no commits on this branch yet. Commit changes first.</p> : null}
            <label>Title<input value={title} onChange={event => setTitle(event.target.value)} maxLength={256} required /></label>
            <label>Description<textarea value={body} onChange={event => setBody(event.target.value)} rows={6} placeholder="What changed and why" /></label>
            <div className="ade-pr-form-row">
              <label className="ade-pr-base">Base branch<input value={base} onChange={event => setBase(event.target.value)} placeholder="main" /></label>
              <label className="ade-pr-draft"><input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} /> Draft</label>
            </div>
            <div className="ade-pr-actions">
              <button type="submit" className="ade-btn ade-btn-primary ade-btn-xs" disabled={Boolean(busy) || status.commitsAhead === 0 || !title.trim()}>
                <GitPullRequest className="size-3.5" /> {busy === "create" ? "Pushing and opening…" : draft ? "Push and open draft PR" : "Push and open PR"}
              </button>
              {status.unpushed > 0 ? (
                <button type="button" className="ade-chip-btn" disabled={Boolean(busy)} onClick={() => void act("push", "push")}>
                  <Upload className="size-3" /> {busy === "push" ? "Pushing…" : "Push only"}
                </button>
              ) : null}
            </div>
          </form>
        ) : null}
      </div>
    </div>
  )
}
