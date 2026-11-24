import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, GitBranch, GitMerge, GitPullRequest, MessageSquare, RefreshCw, Send, Upload, Wrench, XCircle } from "lucide-react"
import { request, requestJson } from "../../api"
import { fixCiPrompt, resolveConflictsPrompt, reviewFeedbackPrompt, type PromptFailedRun } from "../../packages/protocol/agent-prompts.ts"

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
  baseRef: string | null
  behindBase: number
  conflicts: string[]
  mergeInProgress: boolean
}

type FeedbackItem = {
  id: string
  kind: "thread" | "review" | "comment"
  author: string
  body: string
  createdAt: string
  path?: string
  line?: number | null
  resolved?: boolean
  outdated?: boolean
  replies?: Array<{ author: string; body: string; createdAt: string }>
  state?: string
}

/** Unresolved feedback is selected by default; approvals without text never show up. */
const selectedByDefault = (item: FeedbackItem) => !item.resolved && item.state !== "APPROVED"

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
  agentBusy = false,
  onAskAgent,
}: {
  sessionId: string
  sessionLabel: string
  issue?: { number: number; url: string; repository: string } | null
  draftDefault: boolean
  refreshKey: unknown
  onOpenExternal: (url: string) => void
  onOpenChanges: () => void
  onPullRequestChange?: (pr: PullRequestInfo | null) => void
  agentBusy?: boolean
  /** Hand a prompt (feedback, CI logs, conflicts) to the session's agent. */
  onAskAgent?: (text: string) => Promise<void>
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
  const [sent, setSent] = useState("")
  const [feedback, setFeedback] = useState<{ number: number; items: FeedbackItem[] } | null>(null)
  const [feedbackError, setFeedbackError] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showResolved, setShowResolved] = useState(false)

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

  const fetchedFor = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      // Fetch the base branch once per session when the panel opens, so "behind main" is current.
      request<BranchStatus>(`/api/sessions/${encodeURIComponent(sessionId)}/branch${fetchedFor.current === sessionId ? "" : "?fetch=1"}`),
      request<{ pullRequest: PullRequestInfo | null }>(`/api/sessions/${encodeURIComponent(sessionId)}/pr`).catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read the pull request from GitHub.")
        return { pullRequest: null }
      }),
    ])
      .then(([branch, pull]) => {
        if (cancelled) return
        fetchedFor.current = sessionId
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

  // Reviewer feedback for an open pull request.
  const prNumber = pr && pr.state === "OPEN" ? pr.number : null
  const loadFeedback = useCallback(() => request<{ feedback: { number: number; items: FeedbackItem[] } | null }>(`/api/sessions/${encodeURIComponent(sessionId)}/pr/feedback`)
    .then(result => {
      setFeedback(result.feedback)
      setFeedbackError("")
      setSelected(new Set((result.feedback?.items ?? []).filter(selectedByDefault).map(item => item.id)))
    })
    .catch((err: unknown) => setFeedbackError(err instanceof Error ? err.message : "Could not read the review comments.")), [sessionId])
  useEffect(() => {
    if (prNumber === null) return
    let cancelled = false
    void request<{ feedback: { number: number; items: FeedbackItem[] } | null }>(`/api/sessions/${encodeURIComponent(sessionId)}/pr/feedback`)
      .then(result => {
        if (cancelled) return
        setFeedback(result.feedback)
        setSelected(new Set((result.feedback?.items ?? []).filter(selectedByDefault).map(item => item.id)))
      })
      .catch((err: unknown) => { if (!cancelled) setFeedbackError(err instanceof Error ? err.message : "Could not read the review comments.") })
    return () => { cancelled = true }
  }, [sessionId, prNumber])

  /** Send a prompt to the agent and show a short confirmation. */
  const ask = async (name: string, build: () => Promise<string> | string, confirmation: string) => {
    if (!onAskAgent) return
    setBusy(name)
    setError("")
    setSent("")
    try {
      await onAskAgent(await build())
      setSent(confirmation)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send this to the agent.")
    } finally {
      setBusy(null)
    }
  }

  const askToFixCi = () => ask("fix-ci", async () => {
    const { runs } = await request<{ runs: PromptFailedRun[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/pr/failed-runs`)
    const failing = (pr?.checks ?? []).filter(check => check.status === "failure").map(check => check.name)
    return fixCiPrompt(runs, failing)
  }, "Sent the failing CI logs to the agent.")

  const askToAddress = () => ask("address", () => reviewFeedbackPrompt(
    (feedback?.items ?? []).filter(item => selected.has(item.id)).map(item => ({ kind: item.kind, author: item.author, body: item.body, path: item.path, line: item.line, replies: item.replies })),
    feedback?.number,
  ), "Sent the review comments to the agent.")

  const updateBranch = async () => {
    setBusy("update")
    setError("")
    setSent("")
    try {
      const result = await requestJson<{ result: "up-to-date" | "updated" | "conflicts"; baseRef: string; status: BranchStatus }>(`/api/sessions/${encodeURIComponent(sessionId)}/branch/update`, "POST")
      setStatus(result.status)
      if (result.result === "updated") setSent(`Merged the latest ${result.baseRef} into this branch.`)
      if (result.result === "up-to-date") setSent(`Already up to date with ${result.baseRef}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the branch.")
    } finally {
      setBusy(null)
    }
  }

  const finishUpdate = async () => {
    setBusy("finish")
    setError("")
    try {
      const result = await requestJson<{ status: BranchStatus }>(`/api/sessions/${encodeURIComponent(sessionId)}/branch/finish-update`, "POST")
      setStatus(result.status)
      setSent(`Finished the update from ${result.status.baseRef ?? "the base branch"}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish the update.")
    } finally {
      setBusy(null)
    }
  }

  const abortUpdate = async () => {
    setBusy("abort")
    setError("")
    try {
      const result = await requestJson<{ status: BranchStatus }>(`/api/sessions/${encodeURIComponent(sessionId)}/branch/abort-update`, "POST")
      setStatus(result.status)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not abort the update.")
    } finally {
      setBusy(null)
    }
  }

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
      const result = await requestJson<{ pullRequest?: PullRequestInfo | null }>(`/api/sessions/${encodeURIComponent(sessionId)}/${path}`, "POST", payload)
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
  const baseName = status.baseRef ?? status.baseBranch ?? "the base branch"
  const askDisabled = Boolean(busy) || agentBusy
  const askTitle = agentBusy ? "The agent is working. Try again when it is done." : undefined
  const visibleFeedback = (feedback?.items ?? []).filter(item => showResolved || !item.resolved)
  const resolvedCount = (feedback?.items ?? []).filter(item => item.resolved).length

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
      {sent ? <div className="ade-banner-ok" role="status"><CheckCircle2 className="size-3.5" /> {sent}</div> : null}

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

        {status.mergeInProgress ? (
          <section className="ade-review-section is-error" aria-label="Update stopped on conflicts">
            <header><AlertTriangle className="size-3.5" /><span>Update from {baseName} stopped on conflicts</span></header>
            {status.conflicts.length ? (
              <ul className="ade-conflict-list">{status.conflicts.map(file => <li key={file}>{file}</li>)}</ul>
            ) : <p>All conflicts are resolved.</p>}
            <p>Resolve the files (or ask the agent), then finish the update. ADE stages the resolved files and commits the merge.</p>
            <div className="ade-review-actions">
              {onAskAgent && status.conflicts.length ? (
                <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={askDisabled} title={askTitle}
                  onClick={() => void ask("conflicts", () => resolveConflictsPrompt(baseName, status.conflicts), "Asked the agent to resolve the conflicts.")}>
                  <Wrench className="size-3.5" /> {busy === "conflicts" ? "Sending…" : "Ask the agent to resolve"}
                </button>
              ) : null}
              <button type="button" className="ade-chip-btn" disabled={Boolean(busy) || agentBusy} title={agentBusy ? "Wait for the agent to finish" : "Stage the resolved files and commit the merge"} onClick={() => void finishUpdate()}>
                <GitMerge className="size-3" /> {busy === "finish" ? "Finishing…" : "Finish update"}
              </button>
              <button type="button" className="ade-chip-btn" disabled={Boolean(busy)} onClick={() => { if (confirm("Abort the update and go back to the branch as it was?")) void abortUpdate() }}>
                {busy === "abort" ? "Aborting…" : "Abort update"}
              </button>
              <button type="button" className="ade-chip-btn" onClick={onOpenChanges}>Open Changes</button>
            </div>
          </section>
        ) : status.behindBase > 0 ? (
          <section className="ade-review-section is-warn" aria-label="Branch is behind">
            <header>
              <GitBranch className="size-3.5" />
              <span>{status.behindBase} new commit{status.behindBase === 1 ? "" : "s"} on {baseName}</span>
              <button type="button" className="ade-chip-btn" disabled={Boolean(busy) || agentBusy}
                title={agentBusy ? "Wait for the agent to finish" : `Merge ${baseName} into this branch`}
                onClick={() => void updateBranch()}>
                {busy === "update" ? "Updating…" : "Update branch"}
              </button>
            </header>
            <p>Bring them in now to catch conflicts early. ADE merges {baseName} into the session’s branch; nothing is rewritten.</p>
          </section>
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
            {pr.state === "OPEN" && pr.checksSummary === "failure" && onAskAgent ? (
              <div className="ade-review-actions">
                <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={askDisabled} title={askTitle ?? "Send the failing logs to the agent and ask it to fix them"} onClick={() => void askToFixCi()}>
                  <Wrench className="size-3.5" /> {busy === "fix-ci" ? "Reading logs…" : "Ask the agent to fix CI"}
                </button>
              </div>
            ) : null}
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
        ) : null}

        {pr && pr.state === "OPEN" ? (
          <section className="ade-review-section" aria-label="Review comments">
            <header>
              <MessageSquare className="size-3.5" />
              <span>Review comments{feedback ? ` · ${feedback.items.length - resolvedCount} open` : ""}</span>
              <button type="button" className="ade-icon-btn" onClick={() => void loadFeedback()} title="Reload comments" aria-label="Reload review comments"><RefreshCw className="size-3" /></button>
            </header>
            {feedbackError ? <p>{feedbackError}</p>
              : !feedback ? <p>Loading comments…</p>
                : !feedback.items.length ? <p>No review comments yet.</p>
                  : (
                    <>
                      <ul className="ade-feedback-list">
                        {visibleFeedback.map(item => (
                          <li key={item.id} className={`ade-feedback-item ${item.resolved ? "is-resolved" : ""}`}>
                            <input
                              type="checkbox"
                              aria-label={`Include comment from ${item.author}`}
                              checked={selected.has(item.id)}
                              onChange={event => setSelected(current => {
                                const next = new Set(current)
                                if (event.target.checked) next.add(item.id); else next.delete(item.id)
                                return next
                              })}
                            />
                            <div>
                              <div className="ade-feedback-meta">
                                <strong>{item.author}</strong>
                                {item.path ? <code>{item.path}{item.line ? `:${item.line}` : ""}</code> : <span>{item.kind === "review" ? (item.state === "CHANGES_REQUESTED" ? "requested changes" : "reviewed") : "commented"}</span>}
                                {item.resolved ? <span>resolved</span> : item.outdated ? <span>outdated</span> : null}
                              </div>
                              <div className="ade-feedback-body">{item.body}</div>
                              {item.replies?.map((reply, index) => <div key={index} className="ade-feedback-reply">↳ {reply.author}: {reply.body}</div>)}
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="ade-review-actions">
                        {onAskAgent ? (
                          <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={askDisabled || selected.size === 0} title={askTitle} onClick={() => void askToAddress()}>
                            <Send className="size-3.5" /> {busy === "address" ? "Sending…" : `Ask the agent to address ${selected.size}`}
                          </button>
                        ) : null}
                        {resolvedCount ? (
                          <button type="button" className="ade-link-btn" onClick={() => setShowResolved(value => !value)}>
                            {showResolved ? "Hide resolved" : `Show ${resolvedCount} resolved`}
                          </button>
                        ) : null}
                      </div>
                    </>
                  )}
          </section>
        ) : !pr && status.hasRemote && !onBaseBranch && status.branch ? (
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
