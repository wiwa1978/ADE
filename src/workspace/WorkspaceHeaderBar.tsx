import {
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
  onOpenExternalBrowser,
  onOpenSubagent,
  onOpenFiles,
  onOpenDiff,
  onOpenTerminal,
  onOpenPullRequest,
  onOpenBrowser,
  onOpenArtifact,
  onOpenProcesses,
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
  onOpenExternalBrowser: (url: string) => Promise<void>
  onOpenSubagent: (id: string) => void
  onOpenFiles: () => void
  onOpenDiff: () => void
  onOpenTerminal: () => void
  onOpenPullRequest: () => void
  onOpenBrowser: () => void
  onOpenArtifact: () => void
  onOpenProcesses: () => void
}) {
  return (
    <header className="ade-workspace-header">
      <div className="ade-workspace-header-left">
        <span className={`ade-dot ade-dot-${isBusy ? "running" : approvals.length > 0 ? "waiting" : "completed"}`} />
        <h2 className="ade-workspace-title ade-truncate" title={session.label}>{session.label}</h2>
        {session.workspace?.branch ? (
          <span className="ade-pill ade-mono"><GitBranch className="size-3" /> {session.workspace.branch}</span>
        ) : null}
        {session.workspace?.kind === "worktree" ? (
          <span className="ade-pill">worktree</span>
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
        {subagents.length > 0 ? (
          <button
            type="button"
            className={`ade-header-tool-btn ${activeBesideTab?.kind === "subagent" ? "is-active" : ""}`}
            onClick={() => onOpenSubagent(subagents[subagents.length - 1].id)}
            title="Open Subagents beside lead"
          >
            <Bot className="size-3.5" />
            <span>Subagents</span>
            <span className={`ade-count-badge ${runningSubagentsCount > 0 ? "is-accent" : ""}`}>
              {runningSubagentsCount > 0 ? `${runningSubagentsCount}/${subagents.length}` : subagents.length}
            </span>
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
              className={`ade-header-tool-btn ${activeBesideTab?.kind === "terminal" ? "is-active" : ""}`}
              onClick={onOpenTerminal}
              title="Interactive Terminal"
            >
              <Terminal className="size-3.5" />
              <span>Terminal</span>
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
          className={`ade-header-tool-btn ${activeBesideTab?.kind === "browser" ? "is-active" : ""}`}
          onClick={onOpenBrowser}
          title="Built-in Browser"
        >
          <Globe className="size-3.5" />
          <span>Browser</span>
          {browserState.agentDriving ? <span className="ade-dot ade-dot-running" /> : null}
        </button>

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
