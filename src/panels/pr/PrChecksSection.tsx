import { useState } from "react"
import { CheckCircle2, CircleDashed, ExternalLink, GitMerge, GitPullRequest, Upload, Wrench, XCircle } from "lucide-react"
import { Badge, Button, useConfirm } from "../../../components/ui/index.ts"
import type { BranchStatus, Check, PullRequestInfo } from "./usePullRequestState"

const REVIEW_LABELS: Record<string, string> = {
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

interface PrChecksSectionProps {
  pr: PullRequestInfo
  status: BranchStatus
  busy: string | null
  agentBusy: boolean
  canAskAgent: boolean
  onOpenExternal: (url: string) => void
  onAskToFixCi: () => void
  onAct: (name: string, path: string, payload?: unknown) => void
}

export function PrChecksSection({
  pr,
  status,
  busy,
  agentBusy,
  canAskAgent,
  onOpenExternal,
  onAskToFixCi,
  onAct,
}: PrChecksSectionProps) {
  const { confirm } = useConfirm()
  const [mergeMethod, setMergeMethod] = useState<"squash" | "merge" | "rebase">("squash")
  const askDisabled = Boolean(busy) || agentBusy
  const askTitle = agentBusy ? "The agent is working. Try again when it is done." : undefined

  const stateLabel = pr.state === "OPEN" ? (pr.isDraft ? "Draft" : "Open") : pr.state === "MERGED" ? "Merged" : "Closed"
  const stateTone = pr.state === "OPEN" ? (pr.isDraft ? "neutral" : "ok") : pr.state === "MERGED" ? "accent" : "error"

  return (
    <section className="ade-pr-card" aria-label={`Pull request #${pr.number}`}>
      <header>
        <GitPullRequest className="size-4" />
        <div className="ade-pr-title">
          <strong>{pr.title}</strong>
          <span className="ade-muted ade-xs">#{pr.number} · {pr.headRefName} → {pr.baseRefName}</span>
        </div>
        <Badge tone={stateTone} size="sm">{stateLabel}</Badge>
      </header>
      <div className="ade-pr-meta">
        <span className="ade-diff-add">+{pr.additions}</span>
        <span className="ade-diff-del">-{pr.deletions}</span>
        <span className="ade-muted ade-xs">{pr.changedFiles} file{pr.changedFiles === 1 ? "" : "s"}</span>
        {pr.reviewDecision ? (
          <Badge tone={pr.reviewDecision === "APPROVED" ? "ok" : "neutral"}>
            {REVIEW_LABELS[pr.reviewDecision] ?? pr.reviewDecision}
          </Badge>
        ) : null}
      </div>
      {pr.checks.length ? (
        <div className="ade-pr-checks">
          <div className="ade-pr-checks-head"><CheckIcon status={pr.checksSummary} /> Checks</div>
          <ul>
            {pr.checks.map((check, index) => (
              <li key={`${check.name}-${index}`}>
                <CheckIcon status={check.status} />
                <span className="ade-truncate">{check.name}</span>
                {check.url ? (
                  <button type="button" className="ade-link-btn" onClick={() => onOpenExternal(check.url!)}>
                    Details
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="ade-muted ade-xs">No checks reported for this pull request.</p>
      )}
      {pr.state === "OPEN" && pr.checksSummary === "failure" && canAskAgent ? (
        <div className="ade-review-actions">
          <Button
            variant="primary"
            size="xs"
            disabled={askDisabled}
            loading={busy === "fix-ci"}
            title={askTitle ?? "Send the failing logs to the agent and ask it to fix them"}
            onClick={onAskToFixCi}
          >
            <Wrench className="size-3.5" /> {busy === "fix-ci" ? "Reading logs…" : "Ask the agent to fix CI"}
          </Button>
        </div>
      ) : null}
      <div className="ade-pr-actions">
        <Button variant="chip" size="xs" onClick={() => onOpenExternal(pr.url)}>
          <ExternalLink className="size-3" /> Open on GitHub
        </Button>
        {pr.state === "OPEN" && status.unpushed > 0 ? (
          <Button variant="chip" size="xs" disabled={Boolean(busy)} loading={busy === "push"} onClick={() => onAct("push", "push")}>
            <Upload className="size-3" /> {busy === "push" ? "Pushing…" : `Push ${status.unpushed} commit${status.unpushed === 1 ? "" : "s"}`}
          </Button>
        ) : null}
        {pr.state === "OPEN" && pr.isDraft ? (
          <Button variant="chip" size="xs" disabled={Boolean(busy)} loading={busy === "ready"} onClick={() => onAct("ready", "pr/ready")}>
            {busy === "ready" ? "Updating…" : "Ready for review"}
          </Button>
        ) : null}
      </div>
      {pr.state === "OPEN" && !pr.isDraft ? (
        <div className="ade-pr-merge">
          <select aria-label="Merge method" value={mergeMethod} onChange={event => setMergeMethod(event.target.value as typeof mergeMethod)}>
            <option value="squash">Squash and merge</option>
            <option value="merge">Create a merge commit</option>
            <option value="rebase">Rebase and merge</option>
          </select>
          <Button
            variant="primary"
            size="xs"
            disabled={Boolean(busy) || pr.mergeable === "CONFLICTING"}
            loading={busy === "merge"}
            title={pr.mergeable === "CONFLICTING" ? "This branch has conflicts with the base branch" : undefined}
            onClick={() => {
              void confirm({
                title: `Merge pull request #${pr.number}?`,
                description: `Merge pull request #${pr.number} into ${pr.baseRefName}? This updates the repository on GitHub.`,
                confirmLabel: "Merge",
              }).then(ok => {
                if (ok) onAct("merge", "pr/merge", { method: mergeMethod })
              })
            }}
          >
            <GitMerge className="size-3.5" /> {busy === "merge" ? "Merging…" : "Merge"}
          </Button>
        </div>
      ) : null}
      {pr.state === "MERGED" ? (
        <p className="ade-muted ade-xs">Merged. You can archive this session to clean up its worktree.</p>
      ) : null}
    </section>
  )
}
