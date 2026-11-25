import { AlertTriangle, GitBranch, GitMerge, Wrench } from "lucide-react"
import { Button, useConfirm } from "../../../components/ui/index.ts"
import { useI18n } from "../../i18n/I18nContext"
import type { BranchStatus } from "./usePullRequestState"

interface PrBranchSyncBannerProps {
  status: BranchStatus
  baseName: string
  busy: string | null
  agentBusy: boolean
  canAskAgent: boolean
  onResolveConflicts: () => void
  onFinishUpdate: () => void
  onAbortUpdate: () => void
  onUpdateBranch: () => void
  onOpenChanges: () => void
}

export function PrBranchSyncBanner({
  status,
  baseName,
  busy,
  agentBusy,
  canAskAgent,
  onResolveConflicts,
  onFinishUpdate,
  onAbortUpdate,
  onUpdateBranch,
  onOpenChanges,
}: PrBranchSyncBannerProps) {
  const { t } = useI18n()
  const { confirm } = useConfirm()
  const askDisabled = Boolean(busy) || agentBusy
  const askTitle = agentBusy ? t("pnlx.pr.agentWorkingTryAgain") : undefined

  if (status.mergeInProgress) {
    return (
      <section className="ade-review-section is-error" aria-label={t("pnlx.pr.conflictsAria")}>
        <header>
          <AlertTriangle className="size-3.5" />
          <span>{t("pnlx.pr.conflictsHeader", { baseName })}</span>
        </header>
        {status.conflicts.length ? (
          <ul className="ade-conflict-list">
            {status.conflicts.map(file => <li key={file}>{file}</li>)}
          </ul>
        ) : (
          <p>{t("pnlx.pr.allConflictsResolved")}</p>
        )}
        <p>{t("pnlx.pr.resolveInstructions")}</p>
        <div className="ade-review-actions">
          {canAskAgent && status.conflicts.length ? (
            <Button variant="primary" size="xs" disabled={askDisabled} loading={busy === "conflicts"} title={askTitle} onClick={onResolveConflicts}>
              <Wrench className="size-3.5" /> {busy === "conflicts" ? t("pnlx.pr.sending") : t("pnlx.pr.askResolve")}
            </Button>
          ) : null}
          <Button
            variant="chip"
            size="xs"
            disabled={Boolean(busy) || agentBusy}
            loading={busy === "finish"}
            title={agentBusy ? t("pnlx.pr.waitForAgent") : t("pnlx.pr.finishUpdateTitle")}
            onClick={onFinishUpdate}
          >
            <GitMerge className="size-3" /> {busy === "finish" ? t("pnlx.pr.finishing") : t("pnlx.pr.finishUpdate")}
          </Button>
          <Button
            variant="chip"
            size="xs"
            disabled={Boolean(busy)}
            loading={busy === "abort"}
            onClick={() => {
              void confirm({
                title: t("pnlx.pr.abortTitle"),
                description: t("pnlx.pr.abortDesc"),
                confirmLabel: t("pnlx.pr.abortConfirm"),
                destructive: true,
              }).then(ok => {
                if (ok) onAbortUpdate()
              })
            }}
          >
            {busy === "abort" ? t("pnlx.pr.aborting") : t("pnlx.pr.abortConfirm")}
          </Button>
          <Button variant="chip" size="xs" onClick={onOpenChanges}>
            {t("pnlx.pr.openChanges")}
          </Button>
        </div>
      </section>
    )
  }

  if (status.behindBase > 0) {
    return (
      <section className="ade-review-section is-warn" aria-label={t("pnlx.pr.behindAria")}>
        <header>
          <GitBranch className="size-3.5" />
          <span>{t(status.behindBase === 1 ? "pnlx.pr.newCommitOne" : "pnlx.pr.newCommitMany", { count: status.behindBase, baseName })}</span>
          <Button
            variant="chip"
            size="xs"
            disabled={Boolean(busy) || agentBusy}
            loading={busy === "update"}
            title={agentBusy ? t("pnlx.pr.waitForAgent") : t("pnlx.pr.mergeIntoTitle", { baseName })}
            onClick={onUpdateBranch}
          >
            {busy === "update" ? t("pnlx.pr.updating") : t("pnlx.pr.updateBranch")}
          </Button>
        </header>
        <p>{t("pnlx.pr.behindDesc", { baseName })}</p>
      </section>
    )
  }

  return null
}
