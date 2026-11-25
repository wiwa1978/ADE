import { useState } from "react"
import { CheckCircle2, CircleDashed, ExternalLink, GitMerge, GitPullRequest, Upload, Wrench, XCircle } from "lucide-react"
import { Badge, Button, useConfirm } from "../../../components/ui/index.ts"
import { useI18n } from "../../i18n/I18nContext"
import type { BranchStatus, Check, PullRequestInfo } from "./usePullRequestState"

function CheckIcon({ status }: { status: Check["status"] | PullRequestInfo["checksSummary"] }) {
  const { t } = useI18n()
  if (status === "success") return <CheckCircle2 className="size-3.5 ade-text-ok" aria-label={t("pnlx.pr.checkPassed")} />
  if (status === "failure") return <XCircle className="size-3.5 ade-text-error" aria-label={t("pnlx.pr.checkFailed")} />
  if (status === "pending") return <CircleDashed className="size-3.5 ade-text-warn ade-spin-slow" aria-label={t("pnlx.pr.checkRunning")} />
  return <CircleDashed className="size-3.5 opacity-50" aria-label={t("pnlx.pr.checkNeutral")} />
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
  const { t } = useI18n()
  const { confirm } = useConfirm()
  const [mergeMethod, setMergeMethod] = useState<"squash" | "merge" | "rebase">("squash")
  const askDisabled = Boolean(busy) || agentBusy
  const askTitle = agentBusy ? t("pnlx.pr.agentWorkingTryAgain") : undefined

  const reviewLabels: Record<string, string> = {
    APPROVED: t("pnlx.pr.reviewApproved"),
    CHANGES_REQUESTED: t("pnlx.pr.reviewChangesRequested"),
    REVIEW_REQUIRED: t("pnlx.pr.reviewRequired"),
  }

  const stateLabel = pr.state === "OPEN" ? (pr.isDraft ? t("pnlx.pr.stateDraft") : t("pnlx.pr.stateOpen")) : pr.state === "MERGED" ? t("pnlx.pr.stateMerged") : t("pnlx.pr.stateClosed")
  const stateTone = pr.state === "OPEN" ? (pr.isDraft ? "neutral" : "ok") : pr.state === "MERGED" ? "accent" : "error"

  return (
    <section className="ade-pr-card" aria-label={t("pnlx.pr.cardAria", { number: pr.number })}>
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
        <span className="ade-muted ade-xs">{t(pr.changedFiles === 1 ? "pnlx.pr.fileCountOne" : "pnlx.pr.fileCountMany", { count: pr.changedFiles })}</span>
        {pr.reviewDecision ? (
          <Badge tone={pr.reviewDecision === "APPROVED" ? "ok" : "neutral"}>
            {reviewLabels[pr.reviewDecision] ?? pr.reviewDecision}
          </Badge>
        ) : null}
      </div>
      {pr.checks.length ? (
        <div className="ade-pr-checks">
          <div className="ade-pr-checks-head"><CheckIcon status={pr.checksSummary} /> {t("pnlx.pr.checks")}</div>
          <ul>
            {pr.checks.map((check, index) => (
              <li key={`${check.name}-${index}`}>
                <CheckIcon status={check.status} />
                <span className="ade-truncate">{check.name}</span>
                {check.url ? (
                  <button type="button" className="ade-link-btn" onClick={() => onOpenExternal(check.url!)}>
                    {t("pnlx.pr.details")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="ade-muted ade-xs">{t("pnlx.pr.noChecks")}</p>
      )}
      {pr.state === "OPEN" && pr.checksSummary === "failure" && canAskAgent ? (
        <div className="ade-review-actions">
          <Button
            variant="primary"
            size="xs"
            disabled={askDisabled}
            loading={busy === "fix-ci"}
            title={askTitle ?? t("pnlx.pr.fixCiTitle")}
            onClick={onAskToFixCi}
          >
            <Wrench className="size-3.5" /> {busy === "fix-ci" ? t("pnlx.pr.readingLogs") : t("pnlx.pr.askFixCi")}
          </Button>
        </div>
      ) : null}
      <div className="ade-pr-actions">
        <Button variant="chip" size="xs" onClick={() => onOpenExternal(pr.url)}>
          <ExternalLink className="size-3" /> {t("pnlx.pr.openOnGitHub")}
        </Button>
        {pr.state === "OPEN" && status.unpushed > 0 ? (
          <Button variant="chip" size="xs" disabled={Boolean(busy)} loading={busy === "push"} onClick={() => onAct("push", "push")}>
            <Upload className="size-3" /> {busy === "push" ? t("pnlx.pr.pushing") : t(status.unpushed === 1 ? "pnlx.pr.pushCommitOne" : "pnlx.pr.pushCommitMany", { count: status.unpushed })}
          </Button>
        ) : null}
        {pr.state === "OPEN" && pr.isDraft ? (
          <Button variant="chip" size="xs" disabled={Boolean(busy)} loading={busy === "ready"} onClick={() => onAct("ready", "pr/ready")}>
            {busy === "ready" ? t("pnlx.pr.updating") : t("pnlx.pr.readyForReview")}
          </Button>
        ) : null}
      </div>
      {pr.state === "OPEN" && !pr.isDraft ? (
        <div className="ade-pr-merge">
          <select aria-label={t("pnlx.pr.mergeMethodAria")} value={mergeMethod} onChange={event => setMergeMethod(event.target.value as typeof mergeMethod)}>
            <option value="squash">{t("pnlx.pr.mergeSquash")}</option>
            <option value="merge">{t("pnlx.pr.mergeCommit")}</option>
            <option value="rebase">{t("pnlx.pr.mergeRebase")}</option>
          </select>
          <Button
            variant="primary"
            size="xs"
            disabled={Boolean(busy) || pr.mergeable === "CONFLICTING"}
            loading={busy === "merge"}
            title={pr.mergeable === "CONFLICTING" ? t("pnlx.pr.conflictingTitle") : undefined}
            onClick={() => {
              void confirm({
                title: t("pnlx.pr.mergeConfirmTitle", { number: pr.number }),
                description: t("pnlx.pr.mergeConfirmDesc", { number: pr.number, baseRefName: pr.baseRefName }),
                confirmLabel: t("pnlx.pr.merge"),
              }).then(ok => {
                if (ok) onAct("merge", "pr/merge", { method: mergeMethod })
              })
            }}
          >
            <GitMerge className="size-3.5" /> {busy === "merge" ? t("pnlx.pr.merging") : t("pnlx.pr.merge")}
          </Button>
        </div>
      ) : null}
      {pr.state === "MERGED" ? (
        <p className="ade-muted ade-xs">{t("pnlx.pr.mergedHint")}</p>
      ) : null}
    </section>
  )
}
