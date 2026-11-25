import { AlertTriangle, GitBranch, RefreshCw } from "lucide-react"
import { Badge, Banner, ConfirmProvider, EmptyState, IconButton, Spinner } from "../../components/ui/index.ts"
import { CreatePullRequestForm } from "./pr/CreatePullRequestForm"
import { PrBranchSyncBanner } from "./pr/PrBranchSyncBanner"
import { PrChecksSection } from "./pr/PrChecksSection"
import { PrFeedbackSection } from "./pr/PrFeedbackSection"
import { usePullRequestState, type PullRequestInfo } from "./pr/usePullRequestState"

export type { PullRequestInfo }

interface PullRequestPanelProps {
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
}

function PullRequestPanelContent({
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
}: PullRequestPanelProps) {
  const state = usePullRequestState({ sessionId, refreshKey, onPullRequestChange, onAskAgent })

  if (!state.status || state.pr === undefined) {
    return (
      <EmptyState
        compact
        icon={<Spinner size="md" />}
        title="Checking the branch and pull request…"
      />
    )
  }

  const { status, pr } = state
  const onBaseBranch = Boolean(status.branch && status.baseBranch && status.branch === status.baseBranch)
  const baseName = status.baseRef ?? status.baseBranch ?? "the base branch"
  const canAskAgent = Boolean(onAskAgent)

  return (
    <div className="ade-pane-body ade-pr-panel">
      <div className="ade-pane-toolbar">
        <div className="ade-diff-header-meta">
          <Badge className="font-mono"><GitBranch className="size-3" /> {status.branch ?? "detached HEAD"}</Badge>
          {status.baseBranch ? <span className="ade-muted ade-xs">into {status.baseBranch}</span> : null}
        </div>
        <IconButton aria-label="Refresh pull request status" title="Refresh" onClick={() => void state.load()}>
          <RefreshCw className="size-3.5" />
        </IconButton>
      </div>

      {state.error ? <Banner tone="error" className="mx-3 mt-2">{state.error}</Banner> : null}
      {state.sent ? <Banner tone="ok" className="mx-3 mt-2">{state.sent}</Banner> : null}

      <div className="ade-pr-body">
        <section className="ade-pr-facts" aria-label="Branch status">
          <div><strong>{status.commitsAhead}</strong><span>commit{status.commitsAhead === 1 ? "" : "s"} on this branch</span></div>
          <div><strong>{status.unpushed}</strong><span>not pushed</span></div>
          <div className={status.uncommitted ? "is-warn" : ""}><strong>{status.uncommitted}</strong><span>uncommitted</span></div>
        </section>

        {!status.hasRemote ? (
          <Banner tone="warn">
            This repository has no <code>origin</code> remote, so it can’t be pushed or opened as a pull request.
          </Banner>
        ) : onBaseBranch ? (
          <Banner tone="warn">
            This session works directly on <code>{status.branch}</code>. Start a worktree session to get its own branch and pull request.
          </Banner>
        ) : null}

        <PrBranchSyncBanner
          status={status}
          baseName={baseName}
          busy={state.busy}
          agentBusy={agentBusy}
          canAskAgent={canAskAgent}
          onResolveConflicts={() => void state.askToResolveConflicts(baseName, status.conflicts)}
          onFinishUpdate={() => void state.finishUpdate()}
          onAbortUpdate={() => void state.abortUpdate()}
          onUpdateBranch={() => void state.updateBranch()}
          onOpenChanges={onOpenChanges}
        />

        {status.uncommitted > 0 ? (
          <p className="ade-pr-note">
            <AlertTriangle className="size-3.5" /> {status.uncommitted} uncommitted change{status.uncommitted === 1 ? "" : "s"} won’t be included until committed.
            <button type="button" className="ade-link-btn" onClick={onOpenChanges}>Review in Changes</button>
          </p>
        ) : null}

        {pr ? (
          <PrChecksSection
            pr={pr}
            status={status}
            busy={state.busy}
            agentBusy={agentBusy}
            canAskAgent={canAskAgent}
            onOpenExternal={onOpenExternal}
            onAskToFixCi={() => void state.askToFixCi()}
            onAct={(name, path, payload) => void state.act(name, path, payload)}
          />
        ) : null}

        {pr && pr.state === "OPEN" ? (
          <PrFeedbackSection
            feedback={state.feedback}
            feedbackError={state.feedbackError}
            selected={state.selected}
            busy={state.busy}
            agentBusy={agentBusy}
            canAskAgent={canAskAgent}
            onReload={() => void state.loadFeedback()}
            onToggleSelect={(id, checked) =>
              state.setSelected(current => {
                const next = new Set(current)
                if (checked) next.add(id)
                else next.delete(id)
                return next
              })
            }
            onAskToAddress={() => void state.askToAddress()}
          />
        ) : !pr && status.hasRemote && !onBaseBranch && status.branch ? (
          <CreatePullRequestForm
            initialTitle={sessionLabel}
            initialBody={issue ? `Closes #${issue.number}\n` : ""}
            draftDefault={draftDefault}
            base={state.base}
            onBaseChange={state.setBase}
            status={status}
            busy={state.busy}
            onCreate={payload => void state.act("create", "pr", payload)}
            onPush={() => void state.act("push", "push")}
          />
        ) : null}
      </div>
    </div>
  )
}

export function PullRequestPanel(props: PullRequestPanelProps) {
  return (
    <ConfirmProvider>
      <PullRequestPanelContent {...props} />
    </ConfirmProvider>
  )
}
