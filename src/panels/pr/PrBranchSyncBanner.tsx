import { AlertTriangle, GitBranch, GitMerge, Wrench } from "lucide-react"
import { Button, useConfirm } from "../../../components/ui/index.ts"
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
  const { confirm } = useConfirm()
  const askDisabled = Boolean(busy) || agentBusy
  const askTitle = agentBusy ? "The agent is working. Try again when it is done." : undefined

  if (status.mergeInProgress) {
    return (
      <section className="ade-review-section is-error" aria-label="Update stopped on conflicts">
        <header>
          <AlertTriangle className="size-3.5" />
          <span>Update from {baseName} stopped on conflicts</span>
        </header>
        {status.conflicts.length ? (
          <ul className="ade-conflict-list">
            {status.conflicts.map(file => <li key={file}>{file}</li>)}
          </ul>
        ) : (
          <p>All conflicts are resolved.</p>
        )}
        <p>Resolve the files (or ask the agent), then finish the update. ADE stages the resolved files and commits the merge.</p>
        <div className="ade-review-actions">
          {canAskAgent && status.conflicts.length ? (
            <Button variant="primary" size="xs" disabled={askDisabled} loading={busy === "conflicts"} title={askTitle} onClick={onResolveConflicts}>
              <Wrench className="size-3.5" /> {busy === "conflicts" ? "Sending…" : "Ask the agent to resolve"}
            </Button>
          ) : null}
          <Button
            variant="chip"
            size="xs"
            disabled={Boolean(busy) || agentBusy}
            loading={busy === "finish"}
            title={agentBusy ? "Wait for the agent to finish" : "Stage the resolved files and commit the merge"}
            onClick={onFinishUpdate}
          >
            <GitMerge className="size-3" /> {busy === "finish" ? "Finishing…" : "Finish update"}
          </Button>
          <Button
            variant="chip"
            size="xs"
            disabled={Boolean(busy)}
            loading={busy === "abort"}
            onClick={() => {
              void confirm({
                title: "Abort branch update?",
                description: "Abort the update and go back to the branch as it was?",
                confirmLabel: "Abort update",
                destructive: true,
              }).then(ok => {
                if (ok) onAbortUpdate()
              })
            }}
          >
            {busy === "abort" ? "Aborting…" : "Abort update"}
          </Button>
          <Button variant="chip" size="xs" onClick={onOpenChanges}>
            Open Changes
          </Button>
        </div>
      </section>
    )
  }

  if (status.behindBase > 0) {
    return (
      <section className="ade-review-section is-warn" aria-label="Branch is behind">
        <header>
          <GitBranch className="size-3.5" />
          <span>{status.behindBase} new commit{status.behindBase === 1 ? "" : "s"} on {baseName}</span>
          <Button
            variant="chip"
            size="xs"
            disabled={Boolean(busy) || agentBusy}
            loading={busy === "update"}
            title={agentBusy ? "Wait for the agent to finish" : `Merge ${baseName} into this branch`}
            onClick={onUpdateBranch}
          >
            {busy === "update" ? "Updating…" : "Update branch"}
          </Button>
        </header>
        <p>Bring them in now to catch conflicts early. ADE merges {baseName} into the session’s branch; nothing is rewritten.</p>
      </section>
    )
  }

  return null
}
