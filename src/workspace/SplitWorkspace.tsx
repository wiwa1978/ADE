import { useCallback, useEffect, useRef, useState } from "react"
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
  const [pullRequest, setPullRequest] = useState<PullRequestInfo | null>(null)
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

  useEffect(() => {
    if (!externalOpenRequest) return
    openBeside(externalOpenRequest)
    onClearExternalOpenRequest()
  }, [externalOpenRequest, openBeside, onClearExternalOpenRequest])

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

  useEffect(() => {
    setBesideTabs(prev => prev.filter(t => t.kind === "browser"))
    setActiveBesideId(prev => (prev === "browser" ? "browser" : null))
    setPullRequest(null)
  }, [session.id])

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
    openBeside({ id: `subagent:${subagentId}`, kind: "subagent", title: found?.name || "Subagent", subagentId })
  }, [subagents, openBeside])

  const openFile = useCallback((filePath: string) => {
    const shortName = filePath.split("/").pop() || filePath
    openBeside({ id: `file:${filePath}`, kind: "file", title: shortName, filePath })
  }, [openBeside])

  const openFiles = useCallback(() => openBeside({ id: "files", kind: "files", title: "Files" }), [openBeside])
  const openDiff = useCallback(() => openBeside({ id: "diff", kind: "diff", title: "Changes" }), [openBeside])
  const openBrowser = useCallback((url?: string) => {
    openBeside({ id: "browser", kind: "browser", title: "Browser", ...(url ? { initialUrl: url } : {}) })
  }, [openBeside])
  const openArtifact = useCallback((artifactId?: string) => {
    const art = artifacts.find(a => a.id === artifactId) ?? artifacts[0]
    openBeside({ id: "artifact", kind: "artifact", title: art?.title || "Artifacts", artifactId: art?.id })
  }, [artifacts, openBeside])
  const openTerminal = useCallback((another = false) => {
    if (!another) {
      const existing = [...besideTabs].reverse().find(t => t.kind === "terminal")
      openBeside(existing ?? { id: "terminal", kind: "terminal", title: "Terminal" })
      return
    }
    const count = besideTabs.filter(t => t.kind === "terminal").length
    openBeside({ id: `terminal:${Date.now()}`, kind: "terminal", title: `Terminal ${count + 1}` })
  }, [besideTabs, openBeside])
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
        onOpenExternalBrowser={onOpenExternalBrowser}
        onOpenSubagent={openSubagent}
        onOpenFiles={openFiles}
        onOpenDiff={openDiff}
        onOpenTerminal={() => openTerminal()}
        onOpenPullRequest={openPullRequest}
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
              onQuickOpenPanel={panel => {
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
              onOpenDiff={openDiff}
              onOpenBrowser={openBrowser}
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
    </div>
  )
}
