import {
  Activity,
  Columns2,
  FileCode2,
  FileDiff,
  FileText,
  FolderTree,
  GitPullRequest,
  Globe,
  PanelRightClose,
  Plus,
  Terminal,
  X,
} from "lucide-react"
import { useSessionHold } from "../subagents/session-hold"
import type {
  BrowserState,
  Conversation,
  ConversationTimelineSnapshot,
  ManagedProcessSummary,
  SessionArtifact,
  SessionTaskItem,
  SubagentInfo,
  TimelineItem,
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
  session,
  workspacePath,
  hasWorkspace,
  besideTabs,
  activeBesideTab,
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
  tasks = [],
  onRewind,
  diffMode = "working",
  onRunStatusChange,
  onOpenProjectSettings,
}: {
  splitRatio: number
  session: Conversation
  workspacePath: string | null
  hasWorkspace: boolean
  besideTabs: WorkspaceTab[]
  activeBesideTab: WorkspaceTab
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
  tasks?: SessionTaskItem[]
  onRewind?: (content: string) => void
  diffMode?: "working" | "branch" | "history"
  onRunStatusChange?: (status: RunStatus) => void
  onOpenProjectSettings?: () => void
}) {
  const hold = useSessionHold(activeBesideTab?.kind === "progress" ? session.id : null, agentBusy)
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
      default: return <Columns2 className="size-3.5" />
    }
  }

  return (
    <section className="ade-pane ade-pane-beside" style={{ width: `${100 - splitRatio}%` }}>
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
                aria-label={`Close ${tab.title}`}
                onClick={e => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {activeBesideTab.kind === "terminal" ? (
            <button type="button" className="ade-tab-add" title="New terminal" aria-label="New terminal" onClick={() => onOpenTerminal(true)}>
              <Plus className="size-3.5" />
            </button>
          ) : null}
          {subagents.some(s => !besideTabs.some(t => t.subagentId === s.id)) ? (
            <button
              type="button"
              className="ade-tab-add"
              title="Open next subagent tab"
              onClick={() => {
                const nextSub = subagents.find(s => !besideTabs.some(t => t.subagentId === s.id))
                if (nextSub) onOpenSubagent(nextSub.id)
              }}
            >
              <Plus className="size-3.5" />
            </button>
          ) : null}
        </div>
        <button type="button" className="ade-icon-btn" title="Close beside pane" onClick={onCloseAll}>
          <PanelRightClose className="size-3.5" />
        </button>
      </div>

      <div className="ade-beside-content">
        {activeBesideTab.kind === "subagent" && activeBesideTab.subagentId ? (() => {
          const sub = subagents.find(s => s.id === activeBesideTab.subagentId)
          if (!sub) return <div className="ade-pane-empty"><p>Subagent not found.</p></div>
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
            artifacts={artifacts}
            activeArtifactId={activeBesideTab.artifactId}
            onSelectArtifact={(id) => onOpenBeside({ ...activeBesideTab, artifactId: id })}
            onReview={onReviewArtifact}
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
