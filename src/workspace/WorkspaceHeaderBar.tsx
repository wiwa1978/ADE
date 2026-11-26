import { harnessLabel } from "@ade/protocol"
import { clock, useSessionHold } from "../subagents/session-hold"
import { ExternalLink, GitBranch, Terminal } from "lucide-react"
import type {
  BrowserState,
  Conversation,
  ConversationTimelineSnapshot,
  PendingApproval,
  SessionArtifact,
  SubagentInfo,
  WorkspaceGitSummary,
  WorkspaceTab,
} from "../app-types"
import type { PullRequestInfo } from "../panels/PullRequestPanel"
import { useI18n } from "../i18n/I18nContext"
import { SessionCapabilitiesChip } from "./SessionCapabilitiesChip"

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
  timeline,
  onOpenCapabilitiesSettings,
}: {
  session: Conversation
  isBusy: boolean
  hasWorkspace?: boolean
  approvals: PendingApproval[]
  timeline?: ConversationTimelineSnapshot | null
  onOpenCapabilitiesSettings?: () => void
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
  const { t } = useI18n()
  const hold = useSessionHold(session.workspace ? session.id : null, isBusy)
  return (
    <header className="ade-workspace-header">
      <div className="ade-workspace-header-left">
        {projectName ? (
          <>
            <button type="button" className="ade-breadcrumb" onClick={onOpenProject} title={t("workspace.openProject", { name: projectName })}>{projectName}</button>
            <span className="ade-breadcrumb-sep" aria-hidden="true">/</span>
          </>
        ) : null}
        <h2 className="ade-workspace-title ade-truncate" title={session.label}>{session.label}</h2>
        {stateLabel ? <span className={`ade-row-tag is-${stateLabel.tone}`} title={stateLabel.hint}>{stateLabel.label}</span>
          : isBusy ? <span className="ade-row-tag is-running">{t("session.state.working.label")}</span>
            : approvals.length > 0 ? <span className="ade-row-tag is-waiting">{t("session.state.needsApproval.label")}</span> : null}
        {!isBusy && hold.usageWait ? (
          <span className="ade-row-tag is-waiting" title={hold.usageWait.reason}>{hold.usageWait.fallback ? t("workspace.usageLimitFallback", { fallback: hold.usageWait.fallback }) : t("workspace.usageLimitContinues", { time: clock(hold.usageWait.until) })}</span>
        ) : !isBusy && hold.stop ? (
          <span className="ade-row-tag is-failed" title={hold.stop.reason}>{hold.stop.kind === "day" ? t("workspace.stoppedDaily") : hold.stop.kind === "cost" ? t("workspace.stoppedCost") : t("workspace.stoppedTime")}</span>
        ) : null}
        {hold.queued.length ? <span className="ade-row-tag is-idle">{t("workspace.queuedCount", { count: hold.queued.length })}</span> : null}
        {session.attemptGroup && onOpenAttempts ? (
          <button type="button" className="ade-row-tag is-review" onClick={() => onOpenAttempts(session.attemptGroup!)}>
            {session.label.match(/ · ([A-D])$/) ? t("workspace.attemptPrefix", { letter: session.label.match(/ · ([A-D])$/)![1] }) : ""}{t("workspace.compare")}
          </button>
        ) : null}
        {runStatus?.docker ? (
          <button type="button" className={`ade-row-tag is-${runStatus.docker === "running" ? "review" : runStatus.docker === "failed" ? "failed" : runStatus.docker === "preparing" ? "running" : "idle"}`} onClick={onOpenRun}>
            {(() => {
              const name = runStatus.target === "ssh" ? "SSH" : runStatus.target === "boat" ? "Boat.dev" : runStatus.target === "wsl" ? "WSL2" : "Docker"
              return runStatus.docker === "preparing" ? `${name}: ${t("common.loading")}` : runStatus.docker === "failed" ? `${name}: ${t("common.unavailable")}` : runStatus.docker === "running" ? name : `${name}: ${t("common.disabled")}`
            })()}
          </button>
        ) : null}
        {runStatus?.setup === "running" ? <button type="button" className="ade-row-tag is-running" onClick={onOpenRun}>{t("workspace.settingUp")}</button>
          : runStatus?.setup === "failed" ? <button type="button" className="ade-row-tag is-failed" onClick={onOpenRun}>{t("workspace.setupFailed")}</button> : null}
        {runStatus?.check === "running" ? <button type="button" className="ade-row-tag is-running" onClick={onOpenRun}>{t("workspace.checking")}</button>
          : runStatus?.check === "failed" ? <button type="button" className="ade-row-tag is-failed" onClick={onOpenRun}>{t("workspace.checkFailed")}</button>
            : runStatus?.check === "succeeded" ? <button type="button" className="ade-row-tag is-ok" onClick={onOpenRun}>{t("workspace.checkPassed")}</button> : null}
        {session.interactionMode === "terminal" && session.engine ? (
          <span className="ade-pill">
            <Terminal className="size-3" /> {harnessLabel(session.engine)}
          </span>
        ) : null}
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
        <SessionCapabilitiesChip
          projectId={session.projectId}
          timeline={timeline}
          onOpenSettings={onOpenCapabilitiesSettings}
        />
      </div>

    </header>
  )
}
