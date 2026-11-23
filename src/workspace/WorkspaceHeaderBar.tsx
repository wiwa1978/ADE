import { clock, useSessionHold } from "../subagents/session-hold"
import {
  Play,
  ScrollText,
  Activity,
  Bot,
  ExternalLink,
  FileDiff,
  FileText,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Globe,
  Terminal,
} from "lucide-react"
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
  hasWorkspace,
  approvals,
  subagents,
  gitSummary,
  browserState,
  artifacts,
  runningSubagentsCount,
  runningProcessesCount,
  pullRequest,
  activeBesideTab,
  bottomTerminalOpen = false,
  terminalShortcut = "⌘J",
  onOpenExternalBrowser,
  onOpenSubagent,
  onOpenFiles,
  onOpenDiff,
  onOpenTerminal,
  onOpenPullRequest,
  onOpenBrowser,
  onOpenArtifact,
  onOpenProcesses,
  onOpenRun,
  onOpenTranscript,
  onOpenProgress,
  progressCount,
  runStatus,
  projectName,
  onOpenProject,
  stateLabel,
  onOpenAttempts,
}: {
  session: Conversation
  isBusy: boolean
  hasWorkspace: boolean
  approvals: PendingApproval[]
  subagents: SubagentInfo[]
  gitSummary: WorkspaceGitSummary
  browserState: BrowserState
  artifacts: SessionArtifact[]
  runningSubagentsCount: number
  runningProcessesCount: number
  pullRequest: PullRequestInfo | null
  activeBesideTab: WorkspaceTab | null
  bottomTerminalOpen?: boolean
  terminalShortcut?: string
  onOpenExternalBrowser: (url: string) => Promise<void>
  onOpenSubagent: (id: string) => void
  onOpenFiles: () => void
  onOpenDiff: () => void
  onOpenTerminal: () => void
  onOpenPullRequest: () => void
  onOpenBrowser: () => void
  onOpenArtifact: () => void
  onOpenProcesses: () => void
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

      <div className="ade-workspace-header-tools">
        {onOpenProgress && (subagents.length > 0 || (progressCount?.total ?? 0) > 1) ? (
          <button
            type="button"
            className={`ade-header-tool-btn ${activeBesideTab?.kind === "progress" || activeBesideTab?.kind === "subagent" ? "is-active" : ""}`}
            onClick={onOpenProgress}
            title="Progress: every agent this session started and what each has done"
          >
            <Bot className="size-3.5" />
            <span>Progress</span>
            {progressCount ? (
              <span className={`ade-count-badge ${runningSubagentsCount > 0 ? "is-accent" : ""}`}>{progressCount.done}/{progressCount.total}</span>
            ) : null}
          </button>
        ) : subagents.length > 0 ? (
          <button
            type="button"
            className={`ade-header-tool-btn ${activeBesideTab?.kind === "subagent" ? "is-active" : ""}`}
            onClick={() => onOpenSubagent(subagents[subagents.length - 1].id)}
            title="Open Subagents beside lead"
          >
            <Bot className="size-3.5" />
            <span>Subagents</span>
          </button>
        ) : null}

        {hasWorkspace ? (
          <>
            <button
              type="button"
              className={`ade-header-tool-btn ${activeBesideTab?.kind === "files" ? "is-active" : ""}`}
              onClick={onOpenFiles}
              title="Workspace Files"
            >
              <FolderTree className="size-3.5" />
              <span>Files</span>
            </button>
            <button
              type="button"
              className={`ade-header-tool-btn ${activeBesideTab?.kind === "diff" ? "is-active" : ""}`}
              onClick={onOpenDiff}
              title="Git Changes & Diff Review"
            >
              <FileDiff className="size-3.5" />
              <span>Changes</span>
              {gitSummary.files.length > 0 ? (
                <span className="ade-count-badge">{gitSummary.files.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              className={`ade-header-tool-btn ${activeBesideTab?.kind === "run" ? "is-active" : ""}`}
              onClick={onOpenRun}
              title="Run the app with the project's run script"
            >
              <Play className="size-3.5" />
              <span>Run</span>
              {runStatus?.run === "running" ? <span className="ade-state-dot is-running" aria-label="App running" /> : null}
            </button>
            {session.workspace?.kind !== "none" ? (
              <button
                type="button"
                className={`ade-header-tool-btn ${activeBesideTab?.kind === "pr" ? "is-active" : ""}`}
                onClick={onOpenPullRequest}
                title="Push, open and merge a pull request"
              >
                <GitPullRequest className="size-3.5" />
                <span>{pullRequest ? `PR #${pullRequest.number}` : "Pull request"}</span>
                {pullRequest ? (
                  <span
                    className={`ade-pr-dot is-${
                      pullRequest.state === "OPEN"
                        ? pullRequest.checksSummary === "failure"
                          ? "failure"
                          : pullRequest.checksSummary === "pending"
                            ? "pending"
                            : pullRequest.isDraft
                              ? "draft"
                              : "open"
                        : pullRequest.state.toLowerCase()
                    }`}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            ) : null}
          </>
        ) : null}

        <button
          type="button"
          className={`ade-header-tool-btn ${bottomTerminalOpen || activeBesideTab?.kind === "terminal" ? "is-active" : ""}`}
          onClick={onOpenTerminal}
          title={terminalShortcut ? `Toggle Terminal Drawer (${terminalShortcut})` : "Toggle Terminal Drawer"}
        >
          <Terminal className="size-3.5" />
          <span>Terminal</span>
        </button>

        <button
          type="button"
          className={`ade-header-tool-btn ${activeBesideTab?.kind === "browser" ? "is-active" : ""}`}
          onClick={onOpenBrowser}
          title="Built-in Browser"
        >
          <Globe className="size-3.5" />
          <span>Browser</span>
          {browserState.agentDriving ? <span className="ade-dot ade-dot-running" /> : null}
        </button>

        {onOpenTranscript ? (
          <button
            type="button"
            className={`ade-header-tool-btn ${activeBesideTab?.kind === "transcript" ? "is-active" : ""}`}
            onClick={onOpenTranscript}
            title="Transcript: step through what the agent did, or export the session"
            aria-label="Transcript"
          >
            <ScrollText className="size-3.5" />
          </button>
        ) : null}

        {artifacts.length > 0 ? (
          <button
            type="button"
            className={`ade-header-tool-btn ${activeBesideTab?.kind === "artifact" ? "is-active" : ""}`}
            onClick={onOpenArtifact}
            title="Artifacts & Plans"
          >
            <FileText className="size-3.5" />
            <span>Artifacts</span>
            <span className="ade-count-badge">{artifacts.length}</span>
          </button>
        ) : null}

        {runningProcessesCount > 0 ? (
          <button
            type="button"
            className={`ade-header-tool-btn ${activeBesideTab?.kind === "processes" ? "is-active" : ""}`}
            onClick={onOpenProcesses}
            title="Agent Background Processes"
          >
            <Activity className="size-3.5" />
            <span className="ade-count-badge is-accent">{runningProcessesCount}</span>
          </button>
        ) : null}
      </div>
    </header>
  )
}
