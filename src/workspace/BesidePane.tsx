import { useI18n } from "../i18n/I18nContext"
import {
  Activity,
  Bot,
  CircleDot,
  Columns2,
  FileCode2,
  FileDiff,
  FileText,
  FolderTree,
  GitPullRequest,
  Globe,
  LayoutGrid,
  Network,
  PanelRightClose,
  Plus,
  Terminal,
  Users,
  X,
} from "lucide-react"
import { useSessionHold } from "../subagents/session-hold"
import { SidePanelMenu, type SidePanelItem } from "./SidePanelMenu"
import { IssuesPanel } from "../panels/IssuesPanel"
import { AgentsView } from "../agents/AgentsView"
import { useAgentsWork } from "../agents/agent-summary"
import { FlowView } from "../flow/FlowView"
import { useTeamState } from "../flow/team-state"
import { SwarmView } from "../swarm/SwarmView"
import { useSessionStages } from "../blueprints/session-stages"
import type {
  GitHubIssue,
  BrowserState,
  Conversation,
  ConversationTimelineSnapshot,
  ManagedProcessSummary,
  SessionArtifact,
  SessionTaskItem,
  SubagentInfo,
  TimelineItem,
  TimelineToolCall,
  WorkspaceGitSummary,
  WorkspaceTab,
} from "../../app-types"
import { TerminalPanel } from "../../TerminalPanel"
import { SubagentPanel } from "../panels/SubagentPanel"
import { FilesPanel } from "../panels/FilesPanel"
import { FileViewerPanel } from "../panels/FileViewerPanel"
import { DiffPanel } from "../panels/DiffPanel"
import { BrowserPanel } from "../panels/BrowserPanel"
import { ArtifactPanel } from "../panels/ArtifactPanel"
import { ProcessesPanel } from "../panels/ProcessesPanel"
import { RunPanel, type RunStatus } from "../panels/RunPanel"
import { TranscriptPanel } from "../panels/TranscriptPanel"
import { ProgressPanel } from "../panels/ProgressPanel"
import { PullRequestPanel, type PullRequestInfo } from "../panels/PullRequestPanel"

export function BesidePane({
  splitRatio,
  projectName,
  session,
  workspacePath,
  hasWorkspace,
  besideTabs,
  activeBesideTab,
  menuItems,
  onOpenMenu,
  onStartFromIssue,
  agentsWide = false,
  onToggleAgentsWide,
  onOpenStagesDrawer,
  subagents,
  subagentTimelines,
  gitSummary,
  browserState,
  artifacts,
  processes,
  draft,
  terminalFontSize,
  terminalScrollback,
  terminalAutoStart,
  prDraftDefault,
  environmentId,
  textareaRef,
  onSelectTab,
  onCloseTab,
  onCloseAll,
  onOpenBeside,
  onOpenTerminal,
  onOpenSubagent,
  onOpenFile,
  onOpenDiff,
  onOpenBrowser,
  onOpenExternalBrowser,
  onBrowserStateChange,
  onMessageSubagent,
  onStopSubagent,
  onDraftChange,
  onRefreshGit,
  onReviewArtifact,
  onKillProcess,
  onRefreshProcesses,
  onPullRequestChange,
  agentBusy = false,
  onAskAgent,
  timelineItems = [],
  leadLiveTools = [],
  tasks = [],
  onRewind,
  diffMode = "working",
  onRunStatusChange,
  onOpenProjectSettings,
}: {
  splitRatio: number
  /** The session's project, shown above the tabs with the session. */
  projectName?: string
  session: Conversation
  workspacePath: string | null
  hasWorkspace: boolean
  besideTabs: WorkspaceTab[]
  activeBesideTab: WorkspaceTab
  /** What the side panel's menu offers. */
  menuItems: SidePanelItem[]
  onOpenMenu: () => void
  onStartFromIssue?: (issue: GitHubIssue) => void
  agentsWide?: boolean
  onToggleAgentsWide?: () => void
  onOpenStagesDrawer?: () => void
  subagents: SubagentInfo[]
  subagentTimelines: Record<string, ConversationTimelineSnapshot>
  gitSummary: WorkspaceGitSummary
  browserState: BrowserState
  artifacts: SessionArtifact[]
  processes: ManagedProcessSummary[]
  draft: string
  terminalFontSize: number
  terminalScrollback: number
  terminalAutoStart: boolean
  prDraftDefault: boolean
  environmentId: string
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onCloseAll: () => void
  onOpenBeside: (tab: WorkspaceTab) => void
  onOpenTerminal: (another?: boolean) => void
  onOpenSubagent: (id: string) => void
  onOpenFile: (path: string) => void
  onOpenDiff: () => void
  onOpenBrowser: (url?: string) => void
  onOpenExternalBrowser: (url: string) => Promise<void>
  onBrowserStateChange: (state: BrowserState) => void
  onMessageSubagent: (subagentId: string, message: string, mode: "steer" | "follow-up") => Promise<void>
  onStopSubagent: (subagentId: string) => Promise<void>
  onDraftChange: (value: string) => void
  onRefreshGit: () => void
  onReviewArtifact: (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => Promise<void>
  onKillProcess: (id: string) => Promise<void>
  onRefreshProcesses: () => void
  onPullRequestChange: (pr: PullRequestInfo | null) => void
  agentBusy?: boolean
  onAskAgent?: (text: string) => Promise<void>
  timelineItems?: TimelineItem[]
  leadLiveTools?: TimelineToolCall[]
  tasks?: SessionTaskItem[]
  onRewind?: (content: string) => void
  diffMode?: "working" | "branch" | "history"
  onRunStatusChange?: (status: RunStatus) => void
  onOpenProjectSettings?: () => void
}) {
  const { t } = useI18n()
  const hold = useSessionHold(activeBesideTab?.kind === "progress" || activeBesideTab?.kind === "agents" || activeBesideTab?.kind === "team" || activeBesideTab?.kind === "swarm" ? session.id : null, agentBusy)
  const { stages: progressStages } = useSessionStages((activeBesideTab?.kind === "progress" || activeBesideTab?.kind === "team") && session.blueprint ? session.id : null, `${JSON.stringify(session.blueprint ?? null)}:${agentBusy}`)
  const teamWork = useAgentsWork(activeBesideTab?.kind === "team" ? session.id : null, subagents.map(sub => `${sub.id}:${sub.status}`).join(","))
  const stageNames = new Map((progressStages?.stages ?? []).map(stage => [stage.id, stage.name]))
  const { team: teamBoard, reload: reloadTeam } = useTeamState(activeBesideTab?.kind === "team" || activeBesideTab?.kind === "swarm" ? session.id : null)
  const tabIcon = (tab: WorkspaceTab) => {
    switch (tab.kind) {
      case "subagent": {
        const sub = subagents.find(s => s.id === tab.subagentId)
        return <span className={`ade-dot ade-dot-${sub?.status ?? "unknown"}`} />
      }
      case "files": return <FolderTree className="size-3.5" />
      case "file": return <FileCode2 className="size-3.5" />
      case "diff": return <FileDiff className="size-3.5" />
      case "browser": return <Globe className="size-3.5" />
      case "artifact": return <FileText className="size-3.5" />
      case "terminal": return <Terminal className="size-3.5" />
      case "processes": return <Activity className="size-3.5" />
      case "pr": return <GitPullRequest className="size-3.5" />
      case "tools": return <LayoutGrid className="size-3.5" />
      case "issues": return <CircleDot className="size-3.5" />
      case "agents": return <Bot className="size-3.5" />
      case "team": return <Users className="size-3.5" />
      case "swarm": return <Network className="size-3.5" />
      default: return <Columns2 className="size-3.5" />
    }
  }

  return (
    <section className="ade-pane ade-pane-beside" style={{ width: `${100 - splitRatio}%` }}>
      {/* Everything in this panel is about this session; it lights up briefly when you switch. */}
      <div key={session.id} className="ade-beside-context" title={t("beside.contextTitle")}>
        <span className="ade-beside-context-label">{t("beside.session")}</span>
        {projectName ? <span className="ade-beside-context-project ade-truncate">{projectName} /</span> : null}
        <strong className="ade-truncate">{session.label}</strong>
        {session.workspace?.branch ? <span className="ade-beside-context-branch ade-mono ade-truncate">{session.workspace.branch}</span> : null}
      </div>
      <div className="ade-tab-bar">
        <div className="ade-tab-list" role="tablist">
          {besideTabs.map(tab => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeBesideTab.id}
              className={`ade-tab ${tab.id === activeBesideTab.id ? "is-active" : ""}`}
              onClick={() => onSelectTab(tab.id)}
            >
              {tabIcon(tab)}
              <span className="ade-truncate">{tab.title}</span>
              <button
                type="button"
                className="ade-tab-close"
                aria-label={t("beside.close", { title: tab.title })}
                onClick={e => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {activeBesideTab.kind !== "tools" ? (
            <button type="button" className="ade-tab-add" title={t("beside.openSomething")} aria-label={t("beside.openSomethingAria")} onClick={onOpenMenu}>
              <Plus className="size-3.5" />
            </button>
          ) : null}
          {activeBesideTab.kind === "terminal" ? (
            <button type="button" className="ade-tab-add" title={t("beside.newTerminal")} aria-label={t("beside.newTerminal")} onClick={() => onOpenTerminal(true)}>
              <Plus className="size-3.5" />
            </button>
          ) : null}
        </div>
        <button type="button" className="ade-icon-btn" title={t("beside.closePane")} onClick={onCloseAll}>
          <PanelRightClose className="size-3.5" />
        </button>
      </div>

      <div className="ade-beside-content">
        {activeBesideTab.kind === "tools" ? <SidePanelMenu items={menuItems} /> : null}
        {activeBesideTab.kind === "swarm" ? (
          <SwarmView
            session={session}
            leadBusy={agentBusy}
            leadItems={timelineItems}
            leadLiveTools={leadLiveTools}
            subagents={subagents}
            subagentTimelines={subagentTimelines}
            tasks={tasks}
            queued={hold.queued.map(item => item.subagentId)}
            team={teamBoard}
            onTeamChanged={reloadTeam}
            onOpenAgent={onOpenSubagent}
            onMessageSubagent={onMessageSubagent}
            onStopSubagent={onStopSubagent}
            onAskAgent={onAskAgent}
            onOpenFile={hasWorkspace ? onOpenFile : undefined}
            onOpenBrowser={onOpenBrowser}
            onOpenExternalBrowser={onOpenExternalBrowser}
          />
        ) : null}
        {activeBesideTab.kind === "team" ? (
          <FlowView
            session={session}
            leadBusy={agentBusy}
            leadItems={timelineItems}
            subagents={subagents}
            subagentTimelines={subagentTimelines}
            tasks={tasks}
            stageHistory={(progressStages?.history ?? []).map(entry => ({ ...entry, stageName: stageNames.get(entry.stageId) ?? entry.stageId }))}
            blueprintName={session.blueprint ? session.blueprint.name.replace(/\s*\(.*\)$/, "") : null}
            waitingStage={session.blueprint?.stage?.status === "awaiting_approval" ? session.blueprint.stage.name : null}
            queued={hold.queued.map(item => item.subagentId)}
            cost={teamWork ? teamWork.lead.cost + teamWork.agents.reduce((sum, item) => sum + (item.cost ?? 0), 0) : null}
            onOpenAgent={onOpenSubagent}
            onOpenPart={part => { if (part === "stages") onOpenStagesDrawer?.(); else if (part === "changes") onOpenDiff() }}
            team={teamBoard}
            onTeamChanged={reloadTeam}
          />
        ) : null}
        {activeBesideTab.kind === "agents" ? (
          <AgentsView
            sessionId={session.id}
            leadBusy={agentBusy}
            leadItems={timelineItems}
            subagents={subagents}
            subagentTimelines={subagentTimelines}
            hold={hold}
            wide={agentsWide}
            onToggleWide={() => onToggleAgentsWide?.()}
            onMessage={onMessageSubagent}
            onStop={onStopSubagent}
            onOpenFile={hasWorkspace ? onOpenFile : undefined}
            onOpenBrowser={onOpenBrowser}
            onOpenExternalBrowser={onOpenExternalBrowser}
          />
        ) : null}
        {activeBesideTab.kind === "issues" ? (
          <IssuesPanel
            projectId={session.projectId ?? null}
            linkedIssueNumber={session.githubIssue?.number ?? null}
            onStartSession={issue => onStartFromIssue?.(issue)}
            onOpenExternal={url => void onOpenExternalBrowser(url)}
          />
        ) : null}
        {activeBesideTab.kind === "subagent" && activeBesideTab.subagentId ? (() => {
          const sub = subagents.find(s => s.id === activeBesideTab.subagentId)
          if (!sub) return <div className="ade-pane-empty"><p>{t("beside.subagentMissing")}</p></div>
          return (
            <SubagentPanel
              subagent={sub}
              liveTimeline={subagentTimelines[sub.id]}
              onMessage={onMessageSubagent}
              onStop={onStopSubagent}
              onOpenFile={hasWorkspace ? onOpenFile : undefined}
              onOpenBrowser={onOpenBrowser}
              onOpenExternalBrowser={onOpenExternalBrowser}
            />
          )
        })() : null}

        {activeBesideTab.kind === "files" ? (
          <FilesPanel sessionId={session.id} workspacePath={workspacePath} onOpenFile={onOpenFile} />
        ) : null}

        {activeBesideTab.kind === "file" && activeBesideTab.filePath ? (
          <FileViewerPanel
            sessionId={session.id}
            filePath={activeBesideTab.filePath}
            onMentionInChat={(path) => {
              onDraftChange(`${draft ? `${draft} ` : ""}\`${path}\` `)
              textareaRef?.current?.focus()
            }}
            onSaved={onRefreshGit}
          />
        ) : null}

        {activeBesideTab.kind === "diff" ? (
          <DiffPanel sessionId={session.id} summary={gitSummary} onRefresh={onRefreshGit} onOpenFile={onOpenFile} agentBusy={agentBusy} initialMode={diffMode} onAskAgent={onAskAgent} />
        ) : null}

        {activeBesideTab.kind === "browser" ? (
          <BrowserPanel
            browserState={browserState}
            initialUrl={activeBesideTab.initialUrl}
            onStateChange={onBrowserStateChange}
            onOpenExternal={onOpenExternalBrowser}
          />
        ) : null}

        {activeBesideTab.kind === "artifact" ? (
          <ArtifactPanel
            sessionId={session.id}
            workspacePath={workspacePath}
            artifacts={artifacts}
            activeArtifactId={activeBesideTab.artifactId}
            gitSummary={gitSummary}
            timelineItems={timelineItems}
            onSelectArtifact={(id) => onOpenBeside({ ...activeBesideTab, artifactId: id })}
            onReview={onReviewArtifact}
            onOpenFileTab={hasWorkspace ? onOpenFile : undefined}
            onMentionInChat={(path) => {
              onDraftChange(`${draft ? `${draft} ` : ""}\`${path}\` `)
              textareaRef?.current?.focus()
            }}
            onSaved={onRefreshGit}
          />
        ) : null}

        {activeBesideTab.kind === "processes" ? (
          <ProcessesPanel processes={processes} onKill={onKillProcess} onRefresh={onRefreshProcesses} />
        ) : null}

        {activeBesideTab.kind === "progress" ? (
          <ProgressPanel
            leadLabel={session.label}
            leadBusy={agentBusy}
            leadFailed={session.lastTurnStatus === "failed"}
            leadItems={timelineItems}
            subagents={subagents}
            subagentTimelines={subagentTimelines}
            tasks={tasks}
            hold={hold}
            stages={progressStages}
            onOpenSubagent={onOpenSubagent}
          />
        ) : null}

        {activeBesideTab.kind === "transcript" ? (
          <TranscriptPanel sessionId={session.id} items={timelineItems} onRewind={onRewind} workspacePath={workspacePath || undefined} />
        ) : null}

        {activeBesideTab.kind === "run" ? (
          <RunPanel
            sessionId={session.id}
            onOpenUrl={url => onOpenBrowser(url)}
            onOpenExternal={url => void onOpenExternalBrowser(url)}
            onOpenProjectSettings={onOpenProjectSettings}
            onStatusChange={onRunStatusChange}
            onAskAgent={onAskAgent}
            agentBusy={agentBusy}
          />
        ) : null}

        {activeBesideTab.kind === "pr" ? (
          <PullRequestPanel
            sessionId={session.id}
            sessionLabel={session.label}
            issue={session.githubIssue ?? null}
            draftDefault={prDraftDefault}
            refreshKey={gitSummary}
            onOpenExternal={url => void onOpenExternalBrowser(url)}
            onOpenChanges={onOpenDiff}
            onPullRequestChange={onPullRequestChange}
            agentBusy={agentBusy}
            onAskAgent={onAskAgent}
          />
        ) : null}

        {/* Terminals stay mounted while hidden so the shell view and keystrokes are never lost when switching tabs. */}
        {besideTabs.filter(tab => tab.kind === "terminal").map(tab => (
          <div key={tab.id} className="ade-terminal-pane-wrap" hidden={tab.id !== activeBesideTab.id}>
            <TerminalPanel
              environmentId={environmentId}
              workspaceKey={tab.id === "terminal" ? session.id : `${session.id}:${tab.id}`}
              cwd={workspacePath ?? "~"}
              visible={true}
              autoStart={terminalAutoStart}
              fontSize={terminalFontSize}
              scrollback={terminalScrollback}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
