import { useCallback, useEffect, useRef, useState } from "react"
import { Activity, Bot, CircleDot, Columns2, ListChecks, Users, FileDiff, FileText, FolderTree, GitPullRequest, Globe, Play, ScrollText, Terminal, Workflow, X } from "lucide-react"
import type { SidePanelItem } from "./SidePanelMenu"
import { publishSessionTools } from "../layout/session-tools"
import { TerminalPanel } from "../../TerminalPanel"
import type {
  GitHubIssue,
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
import { tabsForNextSession } from "./side-panel-tabs"
import { StagesPanel, WayOfWorkingSelect } from "../blueprints/StagesPanel"
import { StageBar } from "../blueprints/StageBar"
import { useSessionStages } from "../blueprints/session-stages"
import { BesidePane } from "./BesidePane"
import { ConversationLayout } from "./ConversationLayout"
import { DEFAULT_KEYBINDINGS, formatShortcut, matchesChord, type KeybindingMap } from "../keybindings"

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
  onOpenAttempts,
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
  blueprintLocked = false,
  onStartFromIssue,
  onOpenProject,
  onOpenProjectSettings,
  stateLabel,
  environmentId,
  externalOpenRequest,
  onClearExternalOpenRequest,
  textareaRef,
  keybindings = DEFAULT_KEYBINDINGS,
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
  onOpenAttempts?: (group: string) => void
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
  /** The project fixes the way of working for its sessions. */
  blueprintLocked?: boolean
  /** Open New session on an issue (from the Issues panel). */
  onStartFromIssue?: (issue: GitHubIssue) => void
  onOpenProject?: () => void
  onOpenProjectSettings?: () => void
  /** Attention state from the inbox (e.g. "Ready to review"). */
  stateLabel?: { label: string; tone: string; hint: string }
  environmentId: string
  externalOpenRequest: WorkspaceTab | null
  onClearExternalOpenRequest: () => void
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  keybindings?: KeybindingMap
}) {
  const [besideTabs, setBesideTabs] = useState<WorkspaceTab[]>([])
  const [besideHidden, setBesideHidden] = useState(false)
  const [activeBesideId, setActiveBesideId] = useState<string | null>(null)
  const [bottomTerminalOpen, setBottomTerminalOpen] = useState(false)
  const [bottomTerminalMounted, setBottomTerminalMounted] = useState(false)
  // The drawer has two tabs in a blueprint session: Stages and Terminal. The terminal starts the
  // first time its tab is shown, and stays mounted after that so its shell survives.
  const [drawerTab, setDrawerTab] = useState<"stages" | "terminal">(session.blueprint ? "stages" : "terminal")
  const [terminalStarted, setTerminalStarted] = useState(false)
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
  const blueprint = session.blueprint ?? null
  const { stages, setStages } = useSessionStages(hasWorkspace ? session.id : null, `${JSON.stringify(blueprint)}:${session.status}`)
  // Stages stays visible right after switching to Vibe, so the panel can say what happened.
  const showStagesTab = Boolean(blueprint) || (drawerTab === "stages" && Boolean(stages))
  const activeDrawerTab = showStagesTab ? drawerTab : "terminal"
  if (activeDrawerTab === "terminal" && bottomTerminalOpen && !terminalStarted) setTerminalStarted(true)
  // Open the drawer on Stages by itself when a stage starts waiting for you (not on other changes).
  const waitingKey = blueprint?.stage?.status === "awaiting_approval" ? `${session.id}:${blueprint.stage.id}` : null
  const [prevWaitingKey, setPrevWaitingKey] = useState(waitingKey)
  if (prevWaitingKey !== waitingKey) {
    setPrevWaitingKey(waitingKey)
    if (waitingKey) {
      setBottomTerminalMounted(true)
      setBottomTerminalOpen(true)
      setDrawerTab("stages")
    }
  }
  const openStagesDrawer = () => {
    setBottomTerminalMounted(true)
    setBottomTerminalOpen(true)
    setDrawerTab("stages")
  }

  const openBeside = useCallback((tab: WorkspaceTab) => {
    setBesideHidden(false)
    setBesideTabs(prevTabs => {
      // Picking something from the menu replaces the menu tab.
      const prev = tab.kind === "tools" ? prevTabs : prevTabs.filter(t => t.kind !== "tools")
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

  // Switching sessions keeps the side panel open: the same tabs, now about the new session.
  if (session.id !== prevSessionId) {
    setPrevSessionId(session.id)
    const next = tabsForNextSession(besideTabs, activeBesideId, hasWorkspace)
    setBesideTabs(next.tabs)
    setActiveBesideId(next.activeId)
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
        const tab: WorkspaceTab = { id: "agents", kind: "agents", title: "Agents", closable: true }
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

  // Dynamic keyboard shortcut (default Cmd+J / Ctrl+`) toggles bottom terminal drawer
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchesChord(e, keybindings.toggleTerminal) || (e.ctrlKey && e.key === "`")) {
        e.preventDefault()
        setBottomTerminalMounted(true)
        setBottomTerminalOpen(v => !v)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [keybindings.toggleTerminal])

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
  const openTranscript = useCallback(() => openBeside({ id: "transcript", kind: "transcript", title: "Transcript" }), [openBeside])
  const openProgress = useCallback(() => openBeside({ id: "progress", kind: "progress", title: "Progress" }), [openBeside])
  const openAgents = useCallback(() => openBeside({ id: "agents", kind: "agents", title: "Agents" }), [openBeside])
  // The Team view wants room: it opens wide, the chat keeps a narrow column ("Wider" in Agents switches back).
  const openTeam = () => {
    openBeside({ id: "team", kind: "team", title: "Team" })
    if (narrowRatio === null) { setNarrowRatio(splitRatio); setSplitRatio(30) }
  }
  // "Wider" in the Agents view gives the side panel most of the room (and back).
  const [narrowRatio, setNarrowRatio] = useState<number | null>(null)
  const toggleAgentsWide = () => {
    if (narrowRatio !== null) { setSplitRatio(narrowRatio); setNarrowRatio(null) }
    else { setNarrowRatio(splitRatio); setSplitRatio(30) }
  }
  const openIssues = useCallback(() => openBeside({ id: "issues", kind: "issues", title: "Issues" }), [openBeside])
  const openSideMenu = useCallback(() => openBeside({ id: "tools", kind: "tools", title: "Open…" }), [openBeside])
  const progressCount = {
    done: (timeline?.items.length && !isBusy && session.lastTurnStatus !== "failed" ? 1 : 0) + subagents.filter(sub => sub.status === "completed").length + tasks.filter(task => task.status === "done").length,
    total: 1 + subagents.length + tasks.length,
  }

  // Setup/run status for the header, polled lightly while the session has a workspace.
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null)
  useEffect(() => {
    if (!hasWorkspace) return
    let active = true
    const poll = async () => {
      try {
        const [result, runOn] = await Promise.all([
          request<{ setup: { status: RunStatus["setup"] }; run: { status: RunStatus["run"]; url: string | null }; check?: { status: RunStatus["run"] } }>(`/api/sessions/${encodeURIComponent(session.id)}/scripts`),
          request<{ target: NonNullable<RunStatus["target"]>; state: NonNullable<RunStatus["docker"]> }>(`/api/sessions/${encodeURIComponent(session.id)}/run-on`).catch(() => null),
        ])
        if (active) setRunStatus({ setup: result.setup.status, run: result.run.status, check: result.check?.status, url: result.run.url, docker: runOn && runOn.target !== "local" ? runOn.state : null, target: runOn?.target })
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
    const art = artifactId ? artifacts.find(a => a.id === artifactId) : undefined
    openBeside({ id: "artifact", kind: "artifact", title: art?.title || "Artefacts", artifactId: art?.id })
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
  const showBeside = besideTabs.length > 0 && activeBesideTab !== null && !besideHidden
  const runningSubagentsCount = subagents.filter(s => s.status === "running" || s.status === "waiting").length
  const runningProcessesCount = processes.filter(p => p.status === "running").length
  // Everything the side panel can open, with live status (the panel's menu lists these).
  const is = (kind: WorkspaceTab["kind"]) => showBeside && activeBesideTab?.kind === kind
  const sidePanelItems: SidePanelItem[] = [
    ...(hasWorkspace ? [{ id: "team", label: "Team", description: "Under the hood: who takes part, the data flow between them and the latest flows, live", icon: Users, onOpen: openTeam, live: isBusy || runningSubagentsCount > 0, active: is("team") }] : []),
    ...(subagents.length ? [{ id: "agents", label: "Agents", description: "Every agent side by side: what each is doing, thinking and changed", icon: Bot, onOpen: openAgents, badge: runningSubagentsCount || undefined, live: runningSubagentsCount > 0, active: is("agents") || is("subagent") }] : []),
    ...(subagents.length || progressCount.total > 1 ? [{ id: "progress", label: "Progress", description: "A table of every agent and task and how far each is", icon: ListChecks, onOpen: openProgress, badge: `${progressCount.done}/${progressCount.total}`, active: is("progress"), menuOnly: true }] : []),
    ...(blueprint ? [{ id: "stages", label: "Stages", description: `${blueprint.name.replace(/\s*\(.*\)$/, "")}: where the work is and what waits for you`, icon: Workflow, onOpen: () => { closeBesideTab("tools"); openStagesDrawer() }, badge: `${blueprint.done}/${blueprint.total}`, attention: blueprint.stage?.status === "awaiting_approval", active: bottomTerminalOpen && activeDrawerTab === "stages" }] : []),
    ...(hasWorkspace ? [
      { id: "files", label: "Files", description: "Browse and open the workspace's files", icon: FolderTree, onOpen: openFiles, active: is("files") },
      { id: "changes", label: "Changes", description: "Review the agent's changes and the branch diff", icon: FileDiff, onOpen: () => openDiff(), badge: gitSummary.files.length || undefined, active: is("diff") },
      { id: "run", label: "Run", description: "Start the app with the project's run script", icon: Play, onOpen: openRun, live: runStatus?.run === "running", active: is("run") },
      ...(session.projectId ? [{ id: "issues", label: "Issues", description: "The project's open GitHub issues; start a session on one", icon: CircleDot, onOpen: openIssues, active: is("issues") }] : []),
      ...(session.workspace?.kind !== "none" ? [{ id: "pr", label: pullRequest ? `Pull request #${pullRequest.number}` : "Pull request", description: "Push, open and merge a pull request", icon: GitPullRequest, onOpen: openPullRequest, active: is("pr") }] : []),
    ] : []),
    { id: "terminal", label: "Terminal", description: `A shell in the workspace (${keybindings.toggleTerminal ? formatShortcut(keybindings.toggleTerminal) : "⌘J"} opens it in the drawer)`, icon: Terminal, onOpen: () => openTerminal(false), active: is("terminal") },
    { id: "browser", label: "Browser", description: "The built-in browser the agent can drive", icon: Globe, onOpen: () => openBrowser(), live: browserState.agentDriving, active: is("browser") },
    ...(artifacts.length || hasWorkspace ? [{ id: "artifacts", label: "Artefacts", description: "Session artefacts: files, plans and images", icon: FileText, onOpen: () => openArtifact(), badge: artifacts.length || undefined, active: is("artifact") }] : []),
    { id: "transcript", label: "Transcript", description: "Step through what the agent did, or export the session", icon: ScrollText, onOpen: openTranscript, active: is("transcript") },
    ...(runningProcessesCount ? [{ id: "processes", label: "Processes", description: "Commands the agent left running", icon: Activity, onOpen: openProcesses, badge: runningProcessesCount, live: true, active: is("processes") }] : []),
  ]
  // The activity bar on the far left shows the same tools; clicking the open one hides it again.
  useEffect(() => {
    publishSessionTools(sidePanelItems.map(item => item.active
      ? { ...item, onOpen: item.id === "stages" ? () => setBottomTerminalOpen(false) : () => setBesideHidden(true) }
      : item))
  })
  useEffect(() => () => publishSessionTools([]), [])

  return (
    <ConversationLayout
      containerRef={containerRef}
      primaryWidth={showBeside ? `${splitRatio}%` : "100%"}
      header={
      <WorkspaceHeaderBar
        session={session}
        isBusy={isBusy}
        approvals={approvals}
        runStatus={hasWorkspace ? runStatus : null}
        projectName={projectName}
        onOpenProject={onOpenProject}
        stateLabel={stateLabel}
        onOpenAttempts={onOpenAttempts}
        onOpenExternalBrowser={onOpenExternalBrowser}
        onOpenRun={openRun}
      />
      }
      aboveComposer={
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
          onOpenProgress={openProgress}
        />
      }
      composer={
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
          sendChord={keybindings.sendMessage}
          newLineChord={keybindings.newLine}
          engineLabel={session.engine === "claude-code" ? "Claude Code" : session.engine === "codex" ? "Codex" : undefined}
          sessionId={session.id}
        />
      }
      beside={
        showBeside && activeBesideTab ? (
          <>
            <div
              className="ade-split-divider"
              role="separator"
              aria-orientation="vertical"
              onPointerDown={() => { draggingRef.current = true }}
              title="Drag to resize split panes"
            />
            <BesidePane
              projectName={projectName}
              menuItems={sidePanelItems}
              onOpenMenu={openSideMenu}
              onStartFromIssue={onStartFromIssue}
              agentsWide={narrowRatio !== null}
              onToggleAgentsWide={toggleAgentsWide}
              onOpenStagesDrawer={openStagesDrawer}
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
              timelineItems={timeline?.items ?? []}
              tasks={tasks}
              onRewind={hasWorkspace ? content => void rewindTo(content) : undefined}
              diffMode={diffMode}
              onRunStatusChange={status => setRunStatus(previous => ({ ...status, docker: previous?.docker ?? null, target: previous?.target }))}
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
        ) : null
      }
      footer={<>
        {bottomTerminalMounted ? (
        <section
          className="ade-bottom-drawer"
          style={{ height: `${bottomTerminalHeight}px` }}
          hidden={!bottomTerminalOpen}
          aria-label="Stages and terminal"
        >
          <div
            className="ade-bottom-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            onPointerDown={() => { bottomDraggingRef.current = true }}
            title="Drag to resize terminal"
          />
          <div className="ade-bottom-drawer-head">
            <div className="flex items-center gap-1 min-w-0" role="tablist" aria-label="Drawer">
              {showStagesTab ? (
                <button type="button" role="tab" aria-selected={activeDrawerTab === "stages"} className={`ade-drawer-tab ${activeDrawerTab === "stages" ? "is-active" : ""}`} onClick={() => setDrawerTab("stages")}>
                  <Workflow className="size-3.5" /> Stages
                  {blueprint?.stage?.status === "awaiting_approval" ? <span className="ade-drawer-tab-dot" aria-label="Waiting for you" /> : null}
                </button>
              ) : null}
              <button type="button" role="tab" aria-selected={activeDrawerTab === "terminal"} className={`ade-drawer-tab ${activeDrawerTab === "terminal" ? "is-active" : ""}`} onClick={() => setDrawerTab("terminal")}>
                <Terminal className="size-3.5" /> Terminal
              </button>
              {activeDrawerTab === "terminal" ? <span className="ade-pill ade-mono ade-truncate">{terminalCwd}</span> : null}
            </div>
            <div className="flex items-center gap-1.5">
              {!blueprint && stages && hasWorkspace ? (
                <WayOfWorkingSelect sessionId={session.id} current={stages.blueprintId} currentName={stages.name} locked={blueprintLocked} busy={isBusy} onChanged={next => { setStages(next); setDrawerTab("stages") }} />
              ) : null}
              {activeDrawerTab === "terminal" ? (
                <button type="button" className="ade-chip-btn" onClick={() => openTerminal(false)} title="Open terminal in a side-by-side split pane">
                  <Columns2 className="size-3" /> Side pane
                </button>
              ) : null}
              <button type="button" className="ade-icon-btn" onClick={() => setBottomTerminalOpen(false)} aria-label="Close drawer" title="Close drawer (Cmd+J)">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          {activeDrawerTab === "stages" && stages ? (
            <div className="ade-drawer-body">
              <StagesPanel
                sessionId={session.id}
                stages={stages}
                busy={isBusy}
                locked={blueprintLocked}
                onChanged={setStages}
                onOpenFile={hasWorkspace ? openFile : undefined}
                onOpenProgress={openProgress}
              />
            </div>
          ) : null}
          {terminalStarted ? (
            <div className="ade-terminal-pane-wrap" hidden={activeDrawerTab !== "terminal"}>
              <TerminalPanel
                environmentId={environmentId}
                workspaceKey={`${session.id}:bottom`}
                cwd={terminalCwd}
                visible={bottomTerminalOpen && activeDrawerTab === "terminal"}
                autoStart={terminalAutoStart}
                fontSize={terminalFontSize}
                scrollback={terminalScrollback}
              />
            </div>
          ) : null}
        </section>
      ) : null}
        {/* When the drawer is closed, a blueprint session keeps its current stage in view. */}
        {blueprint && !bottomTerminalOpen ? <StageBar blueprint={blueprint} onOpen={openStagesDrawer} /> : null}
      </>}
    >
      <TimelineView
        timeline={timeline}
        fallbackMessages={session.messages}
        approvals={approvals}
        subagents={subagents}
        busy={isBusy}
        workspacePath={workspacePath}
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
    </ConversationLayout>
  )
}
