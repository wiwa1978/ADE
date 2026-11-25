import { useCallback, useEffect, useRef, useState } from "react"
import { request } from "../../api"
import { usePolling } from "../../hooks/usePolling"
import {
  fixCiPrompt,
  resolveConflictsPrompt,
  reviewFeedbackPrompt,
  type PromptFailedRun,
} from "../../../packages/protocol/agent-prompts.ts"

export type BranchStatus = {
  branch: string | null; base: string | null; baseBranch: string | null; commitsAhead: number
  upstream: string | null; unpushed: number; behindUpstream: number; hasRemote: boolean
  uncommitted: number; baseRef: string | null; behindBase: number; conflicts: string[]; mergeInProgress: boolean
}

export type FeedbackItem = {
  id: string; kind: "thread" | "review" | "comment"; author: string; body: string; createdAt: string
  path?: string; line?: number | null; resolved?: boolean; outdated?: boolean
  replies?: Array<{ author: string; body: string; createdAt: string }>; state?: string
}

export type Check = { name: string; status: "pending" | "success" | "failure" | "neutral"; url: string | null }

export type PullRequestInfo = {
  number: number; url: string; title: string; state: "OPEN" | "CLOSED" | "MERGED"; isDraft: boolean
  reviewDecision: string | null; mergeable: string | null; baseRefName: string; headRefName: string
  additions: number; deletions: number; changedFiles: number; checks: Check[]
  checksSummary: "none" | "pending" | "success" | "failure"
}

const selectedByDefault = (item: FeedbackItem) => !item.resolved && item.state !== "APPROVED"
const postJson = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const errMsg = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

export function usePullRequestState({
  sessionId,
  refreshKey,
  onPullRequestChange,
  onAskAgent,
}: {
  sessionId: string
  refreshKey: unknown
  onPullRequestChange?: (pr: PullRequestInfo | null) => void
  onAskAgent?: (text: string) => Promise<void>
}) {
  const [status, setStatus] = useState<BranchStatus | null>(null)
  const [pr, setPr] = useState<PullRequestInfo | null | undefined>(undefined)
  const [base, setBase] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [sent, setSent] = useState("")
  const [feedback, setFeedback] = useState<{ number: number; items: FeedbackItem[] } | null>(null)
  const [feedbackError, setFeedbackError] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const basePath = `/api/sessions/${encodeURIComponent(sessionId)}`

  const load = useCallback(async () => {
    try {
      const [branch, pull] = await Promise.all([
        request<BranchStatus>(`${basePath}/branch`),
        request<{ pullRequest: PullRequestInfo | null }>(`${basePath}/pr`).catch((err: unknown) => {
          setError(errMsg(err, "Could not read the pull request from GitHub."))
          return { pullRequest: null }
        }),
      ])
      setStatus(branch)
      setPr(pull.pullRequest)
      onPullRequestChange?.(pull.pullRequest)
      setBase(current => current || branch.baseBranch || "")
    } catch (err) {
      setError(errMsg(err, "Could not read the branch status."))
      setPr(null)
    }
  }, [basePath, onPullRequestChange])

  const fetchedFor = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      request<BranchStatus>(`${basePath}/branch${fetchedFor.current === sessionId ? "" : "?fetch=1"}`),
      request<{ pullRequest: PullRequestInfo | null }>(`${basePath}/pr`).catch((err: unknown) => {
        if (!cancelled) setError(errMsg(err, "Could not read the pull request from GitHub."))
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
        setError(errMsg(err, "Could not read the branch status."))
        setPr(null)
      })
    return () => { cancelled = true }
  }, [sessionId, basePath, onPullRequestChange, refreshKey])

  const prNumber = pr && pr.state === "OPEN" ? pr.number : null
  const loadFeedback = useCallback(
    () =>
      request<{ feedback: { number: number; items: FeedbackItem[] } | null }>(`${basePath}/pr/feedback`)
        .then(result => {
          setFeedback(result.feedback)
          setFeedbackError("")
          setSelected(new Set((result.feedback?.items ?? []).filter(selectedByDefault).map(item => item.id)))
        })
        .catch((err: unknown) => setFeedbackError(errMsg(err, "Could not read the review comments."))),
    [basePath],
  )

  useEffect(() => {
    if (prNumber === null) return
    let cancelled = false
    void request<{ feedback: { number: number; items: FeedbackItem[] } | null }>(`${basePath}/pr/feedback`)
      .then(result => {
        if (cancelled) return
        setFeedback(result.feedback)
        setSelected(new Set((result.feedback?.items ?? []).filter(selectedByDefault).map(item => item.id)))
      })
      .catch((err: unknown) => {
        if (!cancelled) setFeedbackError(errMsg(err, "Could not read the review comments."))
      })
    return () => { cancelled = true }
  }, [basePath, prNumber])

  usePolling(
    () => load(),
    20_000,
    { enabled: Boolean(pr && pr.state === "OPEN" && pr.checksSummary === "pending"), immediate: false },
  )

  const runBusy = async (name: string, fallbackErr: string, fn: () => Promise<void>) => {
    setBusy(name)
    setError("")
    try { await fn() } catch (err) { setError(errMsg(err, fallbackErr)) } finally { setBusy(null) }
  }

  const ask = (name: string, build: () => Promise<string> | string, confirmation: string) => {
    if (!onAskAgent) return Promise.resolve()
    setSent("")
    return runBusy(name, "Could not send this to the agent.", async () => {
      await onAskAgent(await build())
      setSent(confirmation)
    })
  }

  const askToFixCi = () => ask("fix-ci", async () => {
    const { runs } = await request<{ runs: PromptFailedRun[] }>(`${basePath}/pr/failed-runs`)
    const failing = (pr?.checks ?? []).filter(check => check.status === "failure").map(check => check.name)
    return fixCiPrompt(runs, failing)
  }, "Sent the failing CI logs to the agent.")

  const askToAddress = () => ask("address", () =>
    reviewFeedbackPrompt(
      (feedback?.items ?? [])
        .filter(item => selected.has(item.id))
        .map(item => ({ kind: item.kind, author: item.author, body: item.body, path: item.path, line: item.line, replies: item.replies })),
      feedback?.number,
    ),
    "Sent the review comments to the agent.",
  )

  const askToResolveConflicts = (baseName: string, conflicts: string[]) =>
    ask("conflicts", () => resolveConflictsPrompt(baseName, conflicts), "Asked the agent to resolve the conflicts.")

  const updateBranch = () => {
    setSent("")
    return runBusy("update", "Could not update the branch.", async () => {
      const result = await request<{ result: "up-to-date" | "updated" | "conflicts"; baseRef: string; status: BranchStatus }>(`${basePath}/branch/update`, postJson({}))
      setStatus(result.status)
      if (result.result === "updated") setSent(`Merged the latest ${result.baseRef} into this branch.`)
      if (result.result === "up-to-date") setSent(`Already up to date with ${result.baseRef}.`)
    })
  }

  const finishUpdate = () => runBusy("finish", "Could not finish the update.", async () => {
    const result = await request<{ status: BranchStatus }>(`${basePath}/branch/finish-update`, postJson({}))
    setStatus(result.status)
    setSent(`Finished the update from ${result.status.baseRef ?? "the base branch"}.`)
  })

  const abortUpdate = () => runBusy("abort", "Could not abort the update.", async () => {
    const result = await request<{ status: BranchStatus }>(`${basePath}/branch/abort-update`, postJson({}))
    setStatus(result.status)
  })

  const act = (name: string, path: string, payload: unknown = {}) => runBusy(name, "The GitHub action failed.", async () => {
    const result = await request<{ pullRequest?: PullRequestInfo | null }>(`${basePath}/${path}`, postJson(payload))
    if (result && "pullRequest" in result) {
      setPr(result.pullRequest ?? null)
      onPullRequestChange?.(result.pullRequest ?? null)
    }
    await load()
  })

  return {
    status, pr, base, setBase, busy, error, sent,
    feedback, feedbackError, selected, setSelected,
    load, loadFeedback, askToFixCi, askToAddress, askToResolveConflicts,
    updateBranch, finishUpdate, abortUpdate, act,
  }
}
