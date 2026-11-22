import { useCallback, useEffect, useRef, useState } from "react"
import {
  Activity,
  Bot,
  Columns2,
  ExternalLink,
  FileCode2,
  FileDiff,
  FileText,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Globe,
  PanelRightClose,
  Plus,
  Terminal,
  X,
} from "lucide-react"
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
import { TerminalPanel } from "../../TerminalPanel"
import { TimelineView } from "../timeline/TimelineView"
import { AmbientTracksBar } from "../composer/AmbientTracksBar"
import { ComposerDock } from "../composer/ComposerDock"
import { SubagentPanel } from "../panels/SubagentPanel"
import { FilesPanel } from "../panels/FilesPanel"
import { FileViewerPanel } from "../panels/FileViewerPanel"
import { DiffPanel } from "../panels/DiffPanel"
import { BrowserPanel } from "../panels/BrowserPanel"
import { ArtifactPanel } from "../panels/ArtifactPanel"
import { ProcessesPanel } from "../panels/ProcessesPanel"
import { PullRequestPanel, type PullRequestInfo } from "../panels/PullRequestPanel"

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
  environmentId: string
  externalOpenRequest: WorkspaceTab | null
  onClearExternalOpenRequest: () => void
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [besideTabs, setBesideTabs] = useState<WorkspaceTab[]>([])
  const [activeBesideId, setActiveBesideId] = useState<string | null>(null)
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = Number(localStorage.getItem("ade.split-ratio"))
    return saved >= 30 && saved <= 75 ? saved : 52
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const hasWorkspace = Boolean(session.workspace?.path && session.workspace.status === "ready")
  const workspacePath = session.workspace?.path ?? null
  const isBusy = session.status === "working" || Boolean(timeline?.busy)

  const openBeside = useCallback((tab: WorkspaceTab) => {
    setBesideTabs(prev => {
      const existing = prev.find(t => t.id === tab.id)
      if (existing) {
        return prev.map(t => t.id === tab.id ? { ...t, ...tab } : t)
      }
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

  // Handle external requests (e.g., from Cmd+K, SSE agent driving browser, or new artifact)
  useEffect(() => {
    if (!externalOpenRequest) return
    openBeside(externalOpenRequest)
    onClearExternalOpenRequest()
  }, [externalOpenRequest, openBeside, onClearExternalOpenRequest])

  // Auto-open live subagents tab beside when a subagent starts running if beside pane is empty
  const prevSubCount = useRef(subagents.length)
  useEffect(() => {
    if (subagents.length > prevSubCount.current) {
      const newest = subagents[subagents.length - 1]
      if (newest && newest.status === "running" && besideTabs.length === 0) {
        openBeside({ id: `subagent:${newest.id}`, kind: "subagent", title: newest.name, subagentId: newest.id })
      }
    }
    prevSubCount.current = subagents.length
  }, [subagents, besideTabs.length, openBeside])

  // Reset session-scoped tabs on session switch (keep browser tab if open)
  useEffect(() => {
    setBesideTabs(prev => prev.filter(t => t.kind === "browser"))
    setActiveBesideId(prev => prev === "browser" ? "browser" : null)
  }, [session.id])

  // Split pane drag resize
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (!rect.width) return
      const pct = Math.min(75, Math.max(30, ((e.clientX - rect.left) / rect.width) * 100))
      setSplitRatio(pct)
      localStorage.setItem("ade.split-ratio", String(Math.round(pct)))
    }
    const onUp = () => { draggingRef.current = false }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [])

  const openSubagent = useCallback((subagentId: string) => {
    const found = subagents.find(s => s.id === subagentId)
    openBeside({
      id: `subagent:${subagentId}`,
      kind: "subagent",
      title: found?.name || "Subagent",
      subagentId,
    })
  }, [subagents, openBeside])

  const openFile = useCallback((filePath: string) => {
    const shortName = filePath.split("/").pop() || filePath
    openBeside({
      id: `file:${filePath}`,
      kind: "file",
      title: shortName,
      filePath,
    })
  }, [openBeside])

  const openFiles = useCallback(() => {
    openBeside({ id: "files", kind: "files", title: "Files" })
  }, [openBeside])

  const openDiff = useCallback(() => {
    openBeside({ id: "diff", kind: "diff", title: "Changes" })
  }, [openBeside])

  const openBrowser = useCallback((url?: string) => {
    openBeside({ id: "browser", kind: "browser", title: "Browser", ...(url ? { initialUrl: url } : {}) })
  }, [openBeside])

  const openArtifact = useCallback((artifactId?: string) => {
    const art = artifacts.find(a => a.id === artifactId) ?? artifacts[0]
    openBeside({ id: "artifact", kind: "artifact", title: art?.title || "Artifacts", artifactId: art?.id })
  }, [artifacts, openBeside])

  const openTerminal = useCallback((another = false) => {
    if (!another) {
      // Focus the most recent terminal tab if one exists, otherwise open the first.
      const existing = [...besideTabs].reverse().find(t => t.kind === "terminal")
      openBeside(existing ?? { id: "terminal", kind: "terminal", title: "Terminal" })
      return
    }
    const count = besideTabs.filter(t => t.kind === "terminal").length
    openBeside({ id: `terminal:${Date.now()}`, kind: "terminal", title: `Terminal ${count + 1}` })
  }, [besideTabs, openBeside])

  const openPullRequest = useCallback(() => {
    openBeside({ id: "pr", kind: "pr", title: "Pull request" })
  }, [openBeside])
  const [pullRequest, setPullRequest] = useState<PullRequestInfo | null>(null)
  useEffect(() => { setPullRequest(null) }, [session.id])

  const openProcesses = useCallback(() => {
    openBeside({ id: "processes", kind: "processes", title: "Processes" })
  }, [openBeside])

  const activeBesideTab = besideTabs.find(t => t.id === activeBesideId) ?? null
  const showBeside = besideTabs.length > 0 && activeBesideTab !== null

  const runningSubagentsCount = subagents.filter(s => s.status === "running" || s.status === "waiting").length
  const runningProcessesCount = processes.filter(p => p.status === "running").length

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
    <div className="ade-workspace-shell">
      {/* Paseo-style Workspace Action Bar */}
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
              onClick={() => openSubagent(subagents[subagents.length - 1].id)}
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
                onClick={openFiles}
                title="Workspace Files"
              >
                <FolderTree className="size-3.5" />
                <span>Files</span>
              </button>
              <button
                type="button"
                className={`ade-header-tool-btn ${activeBesideTab?.kind === "diff" ? "is-active" : ""}`}
                onClick={openDiff}
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
                onClick={() => openTerminal()}
                title="Interactive Terminal"
              >
                <Terminal className="size-3.5" />
                <span>Terminal</span>
              </button>
              {session.workspace?.kind !== "none" ? (
                <button
                  type="button"
                  className={`ade-header-tool-btn ${activeBesideTab?.kind === "pr" ? "is-active" : ""}`}
                  onClick={openPullRequest}
                  title="Push, open and merge a pull request"
                >
                  <GitPullRequest className="size-3.5" />
                  <span>{pullRequest ? `PR #${pullRequest.number}` : "Pull request"}</span>
                  {pullRequest ? (
                    <span className={`ade-pr-dot is-${pullRequest.state === "OPEN" ? (pullRequest.checksSummary === "failure" ? "failure" : pullRequest.checksSummary === "pending" ? "pending" : pullRequest.isDraft ? "draft" : "open") : pullRequest.state.toLowerCase()}`} aria-hidden="true" />
                  ) : null}
                </button>
              ) : null}
            </>
          ) : null}

          <button
            type="button"
            className={`ade-header-tool-btn ${activeBesideTab?.kind === "browser" ? "is-active" : ""}`}
            onClick={() => openBrowser()}
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
              onClick={() => openArtifact()}
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
              onClick={openProcesses}
              title="Agent Background Processes"
            >
              <Activity className="size-3.5" />
              <span className="ade-count-badge is-accent">{runningProcessesCount}</span>
            </button>
          ) : null}
        </div>
      </header>

      {/* Resizable Split Panes */}
      <div className="ade-split-container" ref={containerRef}>
        <section
          className="ade-pane ade-pane-primary"
          style={showBeside ? { width: `${splitRatio}%` } : { width: "100%" }}
        >
          <div className="ade-pane-scroll ade-lead-scroll">
            <TimelineView
              timeline={timeline}
              fallbackMessages={session.messages}
              approvals={approvals}
              subagents={subagents}
              busy={isBusy}
              emptyTitle={session.label}
              emptySubtitle={hasWorkspace
                ? `Connected to ${workspacePath}. Use /plan for an approval plan, /subagent to spin up parallel workers, or open Browser/Files/Diff beside this chat.`
                : "Ask anything, create structured plans (/plan), or preview web pages in the built-in browser."}
              onResolveApproval={onResolveApproval}
              onOpenFile={hasWorkspace ? openFile : undefined}
              onOpenSubagent={openSubagent}
              onOpenBrowser={openBrowser}
              onOpenExternalBrowser={onOpenExternalBrowser}
              onOpenArtifact={openArtifact}
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
              onOpenDiff={openDiff}
              onOpenArtifact={openArtifact}
              onOpenProcesses={openProcesses}
              onChangeApprovalPolicy={onChangeApprovalPolicy}
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
              onQuickOpenPanel={(panel) => {
                if (panel === "files") openFiles()
                else if (panel === "diff") openDiff()
                else if (panel === "browser") openBrowser()
                else if (panel === "terminal") openTerminal()
                else if (panel === "pr") openPullRequest()
              }}
              textareaRef={textareaRef}
            />
          </div>
        </section>

        {showBeside ? (
          <>
            <div
              className="ade-split-divider"
              role="separator"
              aria-orientation="vertical"
              onPointerDown={() => { draggingRef.current = true }}
              title="Drag to resize split panes"
            />

            <section className="ade-pane ade-pane-beside" style={{ width: `${100 - splitRatio}%` }}>
              <div className="ade-tab-bar">
                <div className="ade-tab-list" role="tablist">
                  {besideTabs.map(tab => (
                    <div
                      key={tab.id}
                      role="tab"
                      aria-selected={tab.id === activeBesideTab.id}
                      className={`ade-tab ${tab.id === activeBesideTab.id ? "is-active" : ""}`}
                      onClick={() => setActiveBesideId(tab.id)}
                    >
                      {tabIcon(tab)}
                      <span className="ade-truncate">{tab.title}</span>
                      <button
                        type="button"
                        className="ade-tab-close"
                        aria-label={`Close ${tab.title}`}
                        onClick={e => {
                          e.stopPropagation()
                          closeBesideTab(tab.id)
                        }}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  {activeBesideTab.kind === "terminal" && workspacePath ? (
                    <button type="button" className="ade-tab-add" title="New terminal" aria-label="New terminal" onClick={() => openTerminal(true)}>
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
                        if (nextSub) openSubagent(nextSub.id)
                      }}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="ade-icon-btn"
                  title="Close beside pane"
                  onClick={() => {
                    setBesideTabs([])
                    setActiveBesideId(null)
                  }}
                >
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
                      onOpenFile={hasWorkspace ? openFile : undefined}
                      onOpenBrowser={openBrowser}
                      onOpenExternalBrowser={onOpenExternalBrowser}
                    />
                  )
                })() : null}

                {activeBesideTab.kind === "files" ? (
                  <FilesPanel sessionId={session.id} workspacePath={workspacePath} onOpenFile={openFile} />
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
                  <DiffPanel
                    sessionId={session.id}
                    summary={gitSummary}
                    onRefresh={onRefreshGit}
                    onOpenFile={openFile}
                  />
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
                    onSelectArtifact={(id) => openBeside({ ...activeBesideTab, artifactId: id })}
                    onReview={onReviewArtifact}
                  />
                ) : null}

                {activeBesideTab.kind === "processes" ? (
                  <ProcessesPanel
                    processes={processes}
                    onKill={onKillProcess}
                    onRefresh={onRefreshProcesses}
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
                    onOpenChanges={openDiff}
                    onPullRequestChange={setPullRequest}
                  />
                ) : null}

                {/* Terminals stay mounted while hidden so the shell view and keystrokes are never lost when switching tabs. */}
                {workspacePath ? besideTabs.filter(tab => tab.kind === "terminal").map(tab => (
                  <div key={tab.id} className="ade-terminal-pane-wrap" hidden={tab.id !== activeBesideTab.id}>
                    <TerminalPanel
                      environmentId={environmentId}
                      workspaceKey={tab.id === "terminal" ? session.id : `${session.id}:${tab.id}`}
                      cwd={workspacePath}
                      visible={true}
                      autoStart={terminalAutoStart}
                      fontSize={terminalFontSize}
                      scrollback={terminalScrollback}
                    />
                  </div>
                )) : null}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}
