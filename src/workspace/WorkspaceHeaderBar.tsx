import { clock, useSessionHold } from "../subagents/session-hold"
import { ExternalLink, GitBranch } from "lucide-react"
import type {
  BrowserState,
  Conversation,
  PendingApproval,
  SessionArtifact,
  SubagentInfo,
  WorkspaceGitSummary,
  WorkspaceTab,
} from "../../app-types"
import type { PullRequestInfo } from "../panels/PullRequestPanel"

export function WorkspaceHeaderBar({
  session,
  isBusy,
  approvals,
  onOpenExternalBrowser,
  onOpenRun,
  runStatus,
  projectName,
  onOpenProject,
  stateLabel,
  onOpenAttempts,
}: {
  session: Conversation
  isBusy: boolean
  hasWorkspace?: boolean
  approvals: PendingApproval[]
  subagents?: SubagentInfo[]
  gitSummary?: WorkspaceGitSummary
  browserState?: BrowserState
  artifacts?: SessionArtifact[]
  runningSubagentsCount?: number
  runningProcessesCount?: number
  pullRequest?: PullRequestInfo | null
  activeBesideTab?: WorkspaceTab | null
  bottomTerminalOpen?: boolean
  terminalShortcut?: string
  onOpenExternalBrowser: (url: string) => Promise<void>
  onOpenSubagent?: (id: string) => void
  onOpenFiles?: () => void
  onOpenDiff?: () => void
  onOpenTerminal?: () => void
  onOpenPullRequest?: () => void
  onOpenBrowser?: () => void
  onOpenArtifact?: () => void
  onOpenProcesses?: () => void
  onOpenRun: () => void
  onOpenTranscript?: () => void
  onOpenProgress?: () => void
  /** Agents and tasks done out of the total, for the Progress button. */
  progressCount?: { done: number; total: number }
  runStatus: { setup: string; run: string; check?: string; url: string | null; docker?: string | null; target?: string } | null
  /** Breadcrumb back to the session's project. */
  projectName?: string
  onOpenProject?: () => void
  /** Attention state from the inbox (e.g. "Ready to review"). */
  stateLabel?: { label: string; tone: string; hint: string }
  /** For parallel attempts: open the comparison. */
  onOpenAttempts?: (group: string) => void
}) {
  const hold = useSessionHold(session.workspace ? session.id : null, isBusy)
  return (
    <header className="ade-workspace-header">
      <div className="ade-workspace-header-left">
        {projectName ? (
          <>
            <button type="button" className="ade-breadcrumb" onClick={onOpenProject} title={`Open ${projectName}`}>{projectName}</button>
            <span className="ade-breadcrumb-sep" aria-hidden="true">/</span>
          </>
        ) : null}
        <h2 className="ade-workspace-title ade-truncate" title={session.label}>{session.label}</h2>
        {stateLabel ? <span className={`ade-row-tag is-${stateLabel.tone}`} title={stateLabel.hint}>{stateLabel.label}</span>
          : isBusy ? <span className="ade-row-tag is-running">Working</span>
            : approvals.length > 0 ? <span className="ade-row-tag is-waiting">Needs approval</span> : null}
        {!isBusy && hold.usageWait ? (
          <span className="ade-row-tag is-waiting" title={hold.usageWait.reason}>{hold.usageWait.fallback ? `Usage limit · on ${hold.usageWait.fallback}` : `Usage limit · continues ${clock(hold.usageWait.until)}`}</span>
        ) : !isBusy && hold.stop ? (
          <span className="ade-row-tag is-failed" title={`${hold.stop.reason} Continue the session to go on; change limits in Settings → Agents & permissions.`}>{hold.stop.kind === "day" ? "Stopped: daily limit" : hold.stop.kind === "cost" ? "Stopped: cost limit" : "Stopped: time limit"}</span>
        ) : null}
        {hold.queued.length ? <span className="ade-row-tag is-idle" title="Claude Code and Codex subagents start as this machine has room">{hold.queued.length} queued</span> : null}
        {session.attemptGroup && onOpenAttempts ? (
          <button type="button" className="ade-row-tag is-review" onClick={() => onOpenAttempts(session.attemptGroup!)} title="This session is one of several attempts at the same task">
            {session.label.match(/ · ([A-D])$/) ? `Attempt ${session.label.match(/ · ([A-D])$/)![1]} · ` : ""}Compare
          </button>
        ) : null}
        {runStatus?.docker ? (
          <button type="button" className={`ade-row-tag is-${runStatus.docker === "running" ? "review" : runStatus.docker === "failed" ? "failed" : runStatus.docker === "preparing" ? "running" : "idle"}`} onClick={onOpenRun}
            title="This session's commands, terminals, scripts and agents don't run on this computer. Open Run to manage where they run.">
            {(() => {
              const name = runStatus.target === "ssh" ? "SSH" : runStatus.target === "boat" ? "Boat.dev" : runStatus.target === "wsl" ? "WSL2" : "Docker"
              return runStatus.docker === "preparing" ? `${name}: starting…` : runStatus.docker === "failed" ? `${name} unavailable` : runStatus.docker === "running" ? name : `${name}: stopped`
            })()}
          </button>
        ) : null}
        {runStatus?.setup === "running" ? <button type="button" className="ade-row-tag is-running" onClick={onOpenRun} title="The project's setup script is running in this worktree">Setting up…</button>
          : runStatus?.setup === "failed" ? <button type="button" className="ade-row-tag is-failed" onClick={onOpenRun} title="The setup script failed; open Run to see its output">Setup failed</button> : null}
        {runStatus?.check === "running" ? <button type="button" className="ade-row-tag is-running" onClick={onOpenRun} title="The project's check runs after each agent turn">Checking…</button>
          : runStatus?.check === "failed" ? <button type="button" className="ade-row-tag is-failed" onClick={onOpenRun} title="The project's check failed after the last turn; open Run to see why">Check failed</button>
            : runStatus?.check === "succeeded" ? <button type="button" className="ade-row-tag is-ok" onClick={onOpenRun} title="The project's check passed after the last turn">Check passed</button> : null}
        {session.workspace?.branch ? (
          <span className="ade-pill ade-mono"><GitBranch className="size-3" /> {session.workspace.branch}</span>
        ) : null}

        {session.githubIssue ? (
          <button
            type="button"
            className="ade-pill ade-pill-link"
            onClick={() => void onOpenExternalBrowser(session.githubIssue!.url)}
            title={session.githubIssue.title}
          >
            #{session.githubIssue.number} <ExternalLink className="size-2.5" />
          </button>
        ) : null}
      </div>

    </header>
  )
}
