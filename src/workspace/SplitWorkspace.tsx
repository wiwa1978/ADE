import { useCallback, useEffect, useRef, useState } from "react"
import { Columns2, Terminal, X } from "lucide-react"
import { TerminalPanel } from "../../TerminalPanel"
import type {
  ApprovalPolicy,
  BrowserState,
  Conversation,
  ConversationTimelineSnapshot,
  ManagedProcessSummary,
  PendingApproval,
  ProviderCatalogEntry,
  SessionArtifact,
  SessionTaskItem,
  SkillsAndRulesCatalog,
  SubagentInfo,
  WorkspaceGitSummary,
  WorkspaceTab,
} from "../../app-types"
import { TimelineView } from "../timeline/TimelineView"
import { AmbientTracksBar } from "../composer/AmbientTracksBar"
import { ComposerDock } from "../composer/ComposerDock"
import { request } from "../../api"
import type { RunStatus } from "../panels/RunPanel"
import { confirmRestore, restoreCheckpoint, type CheckpointInfo } from "../panels/checkpoint-actions"
import type { PullRequestInfo } from "../panels/PullRequestPanel"
import { WorkspaceHeaderBar } from "./WorkspaceHeaderBar"
import { BesidePane } from "./BesidePane"

export function SplitWorkspace({
  session,
  timeline,
  subagentTimelines,
  subagents,
  approvals,
  approvalPolicy,
  processes,
  gitSummary,
  artifacts,
  tasks,
  skillsCatalog,
  browserState,
  onBrowserStateChange,
  modelCatalog,
  selectedProvider,
  selectedModel,
  onSelectModel,
  reasoning,
  onSelectReasoning,
  onOpenSettings,
  draft,
  onDraftChange,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  onSendMessage,
  onAskAgent,
  onSteerSession,
  onAbortSession,
  onCompactSession,
  onResolveApproval,
  onChangeApprovalPolicy,
  onKillProcess,
  onRefreshProcesses,
  onRefreshGit,
  onMessageSubagent,
  onStopSubagent,
  onOpenExternalBrowser,
  onReviewArtifact,
  terminalFontSize,
  terminalScrollback,
  terminalAutoStart = true,
  prDraftDefault = true,
  projectName,
  onOpenProject,
  onOpenProjectSettings,
  stateLabel,
  environmentId,
  externalOpenRequest,
  onClearExternalOpenRequest,
  textareaRef,
}: {
  session: Conversation
  timeline: ConversationTimelineSnapshot | null
  subagentTimelines: Record<string, ConversationTimelineSnapshot>
  subagents: SubagentInfo[]
  approvals: PendingApproval[]
  approvalPolicy: ApprovalPolicy
  processes: ManagedProcessSummary[]
  gitSummary: WorkspaceGitSummary
  artifacts: SessionArtifact[]
  tasks: SessionTaskItem[]
  skillsCatalog: SkillsAndRulesCatalog
  browserState: BrowserState
  onBrowserStateChange: (state: BrowserState) => void
  modelCatalog: ProviderCatalogEntry[]
  selectedProvider: string
  selectedModel: string
  onSelectModel: (provider: string, id: string) => void
  reasoning: string
  onSelectReasoning: (level: string) => void
  onOpenSettings?: () => void
  draft: string
  onDraftChange: (value: string) => void
  attachments: { id: string; name: string; content: string }[]
  onAttachFiles?: (files: FileList | null) => void
  onRemoveAttachment?: (id: string) => void
  onSendMessage: (text: string) => void
  onAskAgent: (text: string) => Promise<void>
  onSteerSession: (text: string, mode: "steer" | "follow-up") => void
  onAbortSession: () => void
  onCompactSession: () => void
  onResolveApproval: (id: string, decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => Promise<void>
  onChangeApprovalPolicy: (policy: ApprovalPolicy) => void
  onKillProcess: (id: string) => Promise<void>
  onRefreshProcesses: () => void
  onRefreshGit: () => void
  onMessageSubagent: (subagentId: string, message: string, mode: "steer" | "follow-up") => Promise<void>
  onStopSubagent: (subagentId: string) => Promise<void>
  onOpenExternalBrowser: (url: string) => Promise<void>
  onReviewArtifact: (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => Promise<void>
  terminalFontSize: number
  terminalScrollback: number
  terminalAutoStart?: boolean
  prDraftDefault?: boolean
  /** Breadcrumb back to the session's project. */
  projectName?: string
  onOpenProject?: () => void
  onOpenProjectSettings?: () => void
  /** Attention state from the inbox (e.g. "Ready to review"). */
  stateLabel?: { label: string; tone: string; hint: string }
  environmentId: string
  externalOpenRequest: WorkspaceTab | null
  onClearExternalOpenRequest: () => void
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [besideTabs, setBesideTabs] = useState<WorkspaceTab[]>([])
  const [activeBesideId, setActiveBesideId] = useState<string | null>(null)
  const [bottomTerminalOpen, setBottomTerminalOpen] = useState(false)
  const [bottomTerminalMounted, setBottomTerminalMounted] = useState(false)
  const [bottomTerminalHeight, setBottomTerminalHeight] = useState(() => {
    const saved = Number(localStorage.getItem("ade.terminal-height"))
    return saved >= 140 && saved <= 520 ? saved : 240
  })
  const [pullRequest, setPullRequest] = useState<PullRequestInfo | null>(null)
  const [prevSessionId, setPrevSessionId] = useState(session.id)
  const [prevExternalRequest, setPrevExternalRequest] = useState<WorkspaceTab | null>(null)
  const [prevSubCount, setPrevSubCount] = useState(subagents.length)
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = Number(localStorage.getItem("ade.split-ratio"))
    return saved >= 30 && saved <= 75 ? saved : 52
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const bottomDraggingRef = useRef(false)

  const hasWorkspace = Boolean(session.workspace?.path && session.workspace.status === "ready")
  const workspacePath = session.workspace?.path ?? null
  const terminalCwd = workspacePath ?? "~"
  const isBusy = session.status === "working" || Boolean(timeline?.busy)

  const openBeside = useCallback((tab: WorkspaceTab) => {
    setBesideTabs(prev => {
      const existing = prev.find(t => t.id === tab.id)
      if (existing) return prev.map(t => (t.id === tab.id ? { ...t, ...tab } : t))
      return [...prev, { ...tab, closable: true }]
    })
    setActiveBesideId(tab.id)
  }, [])

  const closeBesideTab = useCallback((id: string) => {
    setBesideTabs(prev => {
      const idx = prev.findIndex(t => t.id === id)
      const next = prev.filter(t => t.id !== id)
      setActiveBesideId(curr => {
        if (curr !== id) return curr
        if (next.length === 0) return null
        return next[Math.min(idx, next.length - 1)].id
      })
      return next
    })
  }, [])

  if (session.id !== prevSessionId) {
    setPrevSessionId(session.id)
    setBesideTabs(prev => prev.filter(t => t.kind === "browser"))
    setActiveBesideId(prev => (prev === "browser" ? "browser" : null))
    setPullRequest(null)
  }

  if (externalOpenRequest && externalOpenRequest !== prevExternalRequest) {
    setPrevExternalRequest(externalOpenRequest)
    setBesideTabs(prev => {
      const existing = prev.find(t => t.id === externalOpenRequest.id)
      if (existing) return prev.map(t => (t.id === externalOpenRequest.id ? { ...t, ...externalOpenRequest } : t))
      return [...prev, { ...externalOpenRequest, closable: true }]
    })
    setActiveBesideId(externalOpenRequest.id)
  } else if (!externalOpenRequest && prevExternalRequest !== null) {
    setPrevExternalRequest(null)
  }

  useEffect(() => {
    if (!externalOpenRequest) return
    onClearExternalOpenRequest()
  }, [externalOpenRequest, onClearExternalOpenRequest])

  if (subagents.length !== prevSubCount) {
    const grew = subagents.length > prevSubCount
    setPrevSubCount(subagents.length)
    if (grew) {
      const newest = subagents[subagents.length - 1]
      if (newest && newest.status === "running" && besideTabs.length === 0) {
        const tab: WorkspaceTab = { id: `subagent:${newest.id}`, kind: "subagent", title: newest.name, subagentId: newest.id, closable: true }
        setBesideTabs([tab])
        setActiveBesideId(tab.id)
      }
    }
  }

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        if (!rect.width) return
        const pct = Math.min(75, Math.max(30, ((e.clientX - rect.left) / rect.width) * 100))
        setSplitRatio(pct)
        localStorage.setItem("ade.split-ratio", String(Math.round(pct)))
      }
      if (bottomDraggingRef.current) {
        const next = Math.min(520, Math.max(140, window.innerHeight - e.clientY))
        setBottomTerminalHeight(next)
        localStorage.setItem("ade.terminal-height", String(Math.round(next)))
      }
    }
    const onUp = () => {
      draggingRef.current = false
      bottomDraggingRef.current = false
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [])

  // Keyboard shortcut: Cmd+J or Ctrl+` toggles bottom terminal drawer
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") || (e.ctrlKey && e.key === "`")) {
        e.preventDefault()
        setBottomTerminalMounted(true)
        setBottomTerminalOpen(v => !v)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const openSubagent = useCallback((subagentId: string) => {
    const found = subagents.find(s => s.id === subagentId)
    openBeside({ id: `subagent:${subagentId}`, kind: "subagent", title: found?.name || "Subagent", subagentId })
  }, [subagents, openBeside])

  const openFile = useCallback((filePath: string) => {
    const shortName = filePath.split("/").pop() || filePath
    openBeside({ id: `file:${filePath}`, kind: "file", title: shortName, filePath })
  }, [openBeside])

  const openFiles = useCallback(() => openBeside({ id: "files", kind: "files", title: "Files" }), [openBeside])
  const [diffMode, setDiffMode] = useState<"working" | "branch" | "history">("working")
  const openDiff = useCallback((mode: "working" | "branch" | "history" = "working") => {
    setDiffMode(mode)
    openBeside({ id: "diff", kind: "diff", title: "Changes" })
  }, [openBeside])
  const openRun = useCallback(() => openBeside({ id: "run", kind: "run", title: "Run" }), [openBeside])

  // Setup/run status for the header, polled lightly while the session has a workspace.
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null)
  useEffect(() => {
    if (!hasWorkspace) return
    let active = true
    const poll = async () => {
      try {
        const result = await request<{ setup: { status: RunStatus["setup"] }; run: { status: RunStatus["run"]; url: string | null } }>(`/api/sessions/${encodeURIComponent(session.id)}/scripts`)
        if (active) setRunStatus({ setup: result.setup.status, run: result.run.status, url: result.run.url })
      } catch {
        if (active) setRunStatus(null)
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [session.id, hasWorkspace])

  /** "Rewind files to here" on a message: find the checkpoint saved just before it was sent. */
  const rewindTo = useCallback(async (content: string) => {
    try {
      const { checkpoints } = await request<{ checkpoints: CheckpointInfo[] }>(`/api/sessions/${encodeURIComponent(session.id)}/checkpoints`)
      const label = content.replace(/\s+/g, " ").trim().slice(0, 160)
      const match = checkpoints.find(item => item.label === label)
      if (!match) {
        openDiff("history")
        return
      }
      if (match.filesChanged === 0) {
        alert("The files are already the same as before this message.")
        return
      }
      if (!confirmRestore(match)) return
      await restoreCheckpoint(session.id, match)
      onRefreshGit()
    } catch (cause) {
      alert(cause instanceof Error ? cause.message : "Could not rewind.")
    }
  }, [session.id, openDiff, onRefreshGit])
  const openBrowser = useCallback((url?: string) => {
    openBeside({ id: "browser", kind: "browser", title: "Browser", ...(url ? { initialUrl: url } : {}) })
  }, [openBeside])
  const openArtifact = useCallback((artifactId?: string) => {
    const art = artifacts.find(a => a.id === artifactId) ?? artifacts[0]
    openBeside({ id: "artifact", kind: "artifact", title: art?.title || "Artifacts", artifactId: art?.id })
  }, [artifacts, openBeside])
  const openTerminal = useCallback((another = false) => {
    setBottomTerminalOpen(false)
    if (!another) {
      const existing = [...besideTabs].reverse().find(t => t.kind === "terminal")
      openBeside(existing ?? { id: "terminal", kind: "terminal", title: "Terminal" })
      return
    }
    const count = besideTabs.filter(t => t.kind === "terminal").length
    openBeside({ id: `terminal:${Date.now()}`, kind: "terminal", title: `Terminal ${count + 1}` })
  }, [besideTabs, openBeside])
  const toggleBottomTerminal = useCallback(() => {
    setBottomTerminalMounted(true)
    setBottomTerminalOpen(v => !v)
  }, [])
  const openPullRequest = useCallback(() => openBeside({ id: "pr", kind: "pr", title: "Pull request" }), [openBeside])
  const openProcesses = useCallback(() => openBeside({ id: "processes", kind: "processes", title: "Processes" }), [openBeside])

  const activeBesideTab = besideTabs.find(t => t.id === activeBesideId) ?? null
  const showBeside = besideTabs.length > 0 && activeBesideTab !== null
  const runningSubagentsCount = subagents.filter(s => s.status === "running" || s.status === "waiting").length
  const runningProcessesCount = processes.filter(p => p.status === "running").length

  return (
    <div className="ade-workspace-shell">
      <WorkspaceHeaderBar
        session={session}
        isBusy={isBusy}
        hasWorkspace={hasWorkspace}
        approvals={approvals}
        subagents={subagents}
        gitSummary={gitSummary}
        browserState={browserState}
        artifacts={artifacts}
        runningSubagentsCount={runningSubagentsCount}
        runningProcessesCount={runningProcessesCount}
        pullRequest={pullRequest}
        activeBesideTab={activeBesideTab}
        bottomTerminalOpen={bottomTerminalOpen}
        onOpenExternalBrowser={onOpenExternalBrowser}
        onOpenSubagent={openSubagent}
        onOpenFiles={openFiles}
        onOpenDiff={() => openDiff()}
        onOpenTerminal={toggleBottomTerminal}
        onOpenPullRequest={openPullRequest}
        onOpenRun={openRun}
        runStatus={hasWorkspace ? runStatus : null}
        projectName={projectName}
        onOpenProject={onOpenProject}
        stateLabel={stateLabel}
        onOpenBrowser={() => openBrowser()}
        onOpenArtifact={() => openArtifact()}
        onOpenProcesses={openProcesses}
      />

      <div className="ade-split-container" ref={containerRef}>
        <section className="ade-pane ade-pane-primary" style={showBeside ? { width: `${splitRatio}%` } : { width: "100%" }}>
          <div className="ade-pane-scroll ade-lead-scroll">
            <TimelineView
              timeline={timeline}
              fallbackMessages={session.messages}
              approvals={approvals}
              subagents={subagents}
              busy={isBusy}
              emptyTitle={session.label}
              emptySubtitle={hasWorkspace
                ? `The agent works on ${session.workspace?.branch ? `branch ${session.workspace.branch}` : "the project folder"}. Describe a task below. Review its work in Changes, run it with Run or Terminal, and ship it from Pull request.`
                : session.workspace?.removed
                  ? "This session was archived and its worktree removed. Restore it from Archived in the sidebar to continue."
                  : "Ask anything, plan work with /plan, or preview web pages in the built-in browser."}
              onResolveApproval={onResolveApproval}
              onOpenFile={hasWorkspace ? openFile : undefined}
              onOpenSubagent={openSubagent}
              onOpenBrowser={openBrowser}
              onOpenExternalBrowser={onOpenExternalBrowser}
              onOpenArtifact={openArtifact}
              onRewind={hasWorkspace ? content => void rewindTo(content) : undefined}
            />
          </div>

          <div className="ade-composer-anchor">
            <AmbientTracksBar
              subagents={subagents}
              gitSummary={gitSummary}
              tasks={tasks}
              artifacts={artifacts}
              processes={processes}
              approvals={approvals}
              approvalPolicy={approvalPolicy}
              hasWorkspace={hasWorkspace}
              onOpenSubagent={openSubagent}
              onStopSubagent={id => void onStopSubagent(id)}
              onOpenDiff={() => openDiff()}
              onOpenArtifact={openArtifact}
              onOpenProcesses={openProcesses}
              onChangeApprovalPolicy={onChangeApprovalPolicy}
              usage={timeline?.usage}
            />

            <ComposerDock
              draft={draft}
              onDraftChange={onDraftChange}
              busy={isBusy}
              modelCatalog={modelCatalog}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onSelectModel={onSelectModel}
              reasoning={reasoning}
              onSelectReasoning={onSelectReasoning}
              approvalPolicy={approvalPolicy}
              onChangeApprovalPolicy={onChangeApprovalPolicy}
              onOpenSettings={onOpenSettings}
              attachments={attachments}
              onAttachFiles={onAttachFiles}
              onRemoveAttachment={onRemoveAttachment}
              skillsCatalog={skillsCatalog}
              hasWorkspace={hasWorkspace}
              onSubmit={onSendMessage}
              onSteer={onSteerSession}
              onAbort={onAbortSession}
              onCompact={onCompactSession}
              onQuickOpenPanel={panel => {
                if (panel === "files") openFiles()
                else if (panel === "diff") openDiff()
                else if (panel === "browser") openBrowser()
                else if (panel === "terminal") toggleBottomTerminal()
                else if (panel === "pr") openPullRequest()
              }}
              textareaRef={textareaRef}
              engineLabel={session.engine === "claude-code" ? "Claude Code" : session.engine === "codex" ? "Codex" : undefined}
              sessionId={session.id}
            />
          </div>
        </section>

        {showBeside && activeBesideTab ? (
          <>
            <div
              className="ade-split-divider"
              role="separator"
              aria-orientation="vertical"
              onPointerDown={() => { draggingRef.current = true }}
              title="Drag to resize split panes"
            />
            <BesidePane
              splitRatio={splitRatio}
              session={session}
              workspacePath={workspacePath}
              hasWorkspace={hasWorkspace}
              besideTabs={besideTabs}
              activeBesideTab={activeBesideTab}
              subagents={subagents}
              subagentTimelines={subagentTimelines}
              gitSummary={gitSummary}
              browserState={browserState}
              artifacts={artifacts}
              processes={processes}
              draft={draft}
              terminalFontSize={terminalFontSize}
              terminalScrollback={terminalScrollback}
              terminalAutoStart={terminalAutoStart}
              prDraftDefault={prDraftDefault}
              environmentId={environmentId}
              textareaRef={textareaRef}
              onSelectTab={setActiveBesideId}
              onCloseTab={closeBesideTab}
              onCloseAll={() => { setBesideTabs([]); setActiveBesideId(null) }}
              onOpenBeside={openBeside}
              onOpenTerminal={openTerminal}
              onOpenSubagent={openSubagent}
              onOpenFile={openFile}
              onOpenDiff={() => openDiff()}
              onOpenBrowser={openBrowser}
              agentBusy={isBusy}
              onAskAgent={onAskAgent}
              diffMode={diffMode}
              onRunStatusChange={setRunStatus}
              onOpenProjectSettings={onOpenProjectSettings}
              onOpenExternalBrowser={onOpenExternalBrowser}
              onBrowserStateChange={onBrowserStateChange}
              onMessageSubagent={onMessageSubagent}
              onStopSubagent={onStopSubagent}
              onDraftChange={onDraftChange}
              onRefreshGit={onRefreshGit}
              onReviewArtifact={onReviewArtifact}
              onKillProcess={onKillProcess}
              onRefreshProcesses={onRefreshProcesses}
              onPullRequestChange={setPullRequest}
            />
          </>
        ) : null}
      </div>

      {/* Bottom-Docked Resizable Terminal Drawer (stays mounted once opened so the shell session persists when collapsed) */}
      {bottomTerminalMounted ? (
        <section
          className="ade-bottom-drawer"
          style={{ height: `${bottomTerminalHeight}px` }}
          hidden={!bottomTerminalOpen}
          aria-label="Terminal drawer"
        >
          <div
            className="ade-bottom-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            onPointerDown={() => { bottomDraggingRef.current = true }}
            title="Drag to resize terminal"
          />
          <div className="ade-bottom-drawer-head">
            <div className="flex items-center gap-2 min-w-0">
              <Terminal className="size-3.5 text-[rgb(var(--primary))]" />
              <strong>Terminal</strong>
              <span className="ade-pill ade-mono ade-truncate">{terminalCwd}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className="ade-chip-btn" onClick={() => openTerminal(false)} title="Open terminal in a side-by-side split pane">
                <Columns2 className="size-3" /> Side pane
              </button>
              <button type="button" className="ade-icon-btn" onClick={() => setBottomTerminalOpen(false)} aria-label="Close terminal drawer" title="Close terminal drawer (Cmd+J)">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          <div className="ade-terminal-pane-wrap">
            <TerminalPanel
              environmentId={environmentId}
              workspaceKey={`${session.id}:bottom`}
              cwd={terminalCwd}
              visible={bottomTerminalOpen}
              autoStart={terminalAutoStart}
              fontSize={terminalFontSize}
              scrollback={terminalScrollback}
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
