import { useCallback, useEffect, useState } from "react"
import { useConfirm } from "../../components/ui/index.ts"
import { usePolling } from "../hooks/usePolling"
import { TimelineView } from "../timeline/TimelineView"
import { AmbientTracksBar } from "../composer/AmbientTracksBar"
import { CaptainStatusLine } from "./CaptainStatusLine"
import { SIMPLE_PANEL_KINDS, useViewMode } from "../view-mode"
import { ComposerDock } from "../composer/ComposerDock"
import { request } from "../api"
import type { RunStatus } from "../panels/RunPanel"
import { getRestoreConfirmOptions, restoreCheckpoint, type CheckpointInfo } from "../panels/checkpoint-actions"
import { WorkspaceHeaderBar } from "./WorkspaceHeaderBar"
import { useSessionStages } from "../blueprints/session-stages"
import { BesidePane } from "./BesidePane"
import { ConversationLayout } from "./ConversationLayout"
import { DEFAULT_KEYBINDINGS, matchesChord } from "../keybindings"
import { useResizableSplit } from "./split/useResizableSplit"
import { useBesideTabs } from "./split/useBesideTabs"
import { WorkspaceBottomDrawer } from "./split/WorkspaceBottomDrawer"
import { useSessionToolsPublisher } from "./split/useSessionToolsPublisher"
import type { SplitWorkspaceProps } from "./split/types"

export function SplitWorkspace(props: SplitWorkspaceProps) {
  const {
    session, timeline, subagentTimelines, subagents, approvals, approvalPolicy, processes, gitSummary,
    artifacts, tasks, skillsCatalog, browserState, onBrowserStateChange, modelCatalog, selectedProvider,
    selectedModel, onSelectModel, reasoning, onSelectReasoning, onOpenSettings, draft, onDraftChange,
    attachments, onAttachFiles, onRemoveAttachment, onSendMessage, onAskAgent, onOpenAttempts,
    onSteerSession, onAbortSession, onCompactSession, onResolveApproval, onChangeApprovalPolicy,
    onKillProcess, onRefreshProcesses, onRefreshGit, onMessageSubagent, onStopSubagent,
    onOpenExternalBrowser, onReviewArtifact, terminalFontSize, terminalScrollback,
    terminalAutoStart = true, prDraftDefault = true, projectName, blueprintLocked = false,
    onStartFromIssue, onOpenProject, onOpenProjectSettings, stateLabel, environmentId,
    externalOpenRequest, onClearExternalOpenRequest, textareaRef, keybindings = DEFAULT_KEYBINDINGS,
  } = props

  const { confirm, alert } = useConfirm()
  const split = useResizableSplit()

  const [bottomTerminalOpen, setBottomTerminalOpen] = useState(false)
  const [bottomTerminalMounted, setBottomTerminalMounted] = useState(false)
  const [drawerTab, setDrawerTab] = useState<"stages" | "terminal">(session.blueprint ? "stages" : "terminal")
  const [terminalStarted, setTerminalStarted] = useState(false)

  const hasWorkspace = Boolean(session.workspace?.path && session.workspace.status === "ready")
  const workspacePath = session.workspace?.path ?? null
  const terminalCwd = workspacePath ?? "~"
  const isBusy = session.status === "working" || Boolean(timeline?.busy)
  const blueprint = session.blueprint ?? null
  const { stages, setStages } = useSessionStages(hasWorkspace ? session.id : null, `${JSON.stringify(blueprint)}:${session.status}`)

  const showStagesTab = Boolean(blueprint) || (drawerTab === "stages" && Boolean(stages))
  const activeDrawerTab = showStagesTab ? drawerTab : "terminal"
  if (activeDrawerTab === "terminal" && bottomTerminalOpen && !terminalStarted) setTerminalStarted(true)

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

  const openStagesDrawer = useCallback(() => {
    setBottomTerminalMounted(true)
    setBottomTerminalOpen(true)
    setDrawerTab("stages")
  }, [])
  const closeBottomDrawer = useCallback(() => setBottomTerminalOpen(false), [])
  const toggleBottomTerminal = useCallback(() => {
    setBottomTerminalMounted(true)
    setBottomTerminalOpen(v => !v)
  }, [])

  const beside = useBesideTabs({
    sessionId: session.id,
    hasWorkspace,
    subagents,
    artifacts,
    externalOpenRequest,
    onClearExternalOpenRequest,
    onCloseBottomDrawer: closeBottomDrawer,
    onWidenForSwarm: split.widenForSwarm,
    onWidenForTeam: split.widenForTeam,
  })

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

  const [runStatus, setRunStatus] = useState<RunStatus | null>(null)
  const pollRunStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const [result, runOn] = await Promise.all([
        request<{ setup: { status: RunStatus["setup"] }; run: { status: RunStatus["run"]; url: string | null }; check?: { status: RunStatus["run"] } }>(
          `/api/sessions/${encodeURIComponent(session.id)}/scripts`,
          { signal },
        ),
        request<{ target: NonNullable<RunStatus["target"]>; state: NonNullable<RunStatus["docker"]> }>(
          `/api/sessions/${encodeURIComponent(session.id)}/run-on`,
          { signal },
        ).catch(() => null),
      ])
      if (!signal?.aborted) {
        setRunStatus({
          setup: result.setup.status,
          run: result.run.status,
          check: result.check?.status,
          url: result.run.url,
          docker: runOn && runOn.target !== "local" ? runOn.state : null,
          target: runOn?.target,
        })
      }
    } catch {
      if (!signal?.aborted) setRunStatus(null)
    }
  }, [session.id])

  useEffect(() => {
    if (!hasWorkspace) return
    const controller = new AbortController()
    void Promise.resolve().then(() => pollRunStatus(controller.signal))
    return () => controller.abort()
  }, [hasWorkspace, pollRunStatus])

  usePolling(pollRunStatus, 4_000, { enabled: hasWorkspace, immediate: false })

  const rewindTo = useCallback(async (content: string) => {
    try {
      const { checkpoints } = await request<{ checkpoints: CheckpointInfo[] }>(`/api/sessions/${encodeURIComponent(session.id)}/checkpoints`)
      const label = content.replace(/\s+/g, " ").trim().slice(0, 160)
      const match = checkpoints.find(item => item.label === label)
      if (!match) {
        beside.openDiff("history")
        return
      }
      if (match.filesChanged === 0) {
        await alert({ title: "Already at this checkpoint", description: "The files are already the same as before this message." })
        return
      }
      if (!(await confirm(getRestoreConfirmOptions(match)))) return
      await restoreCheckpoint(session.id, match)
      onRefreshGit()
    } catch (cause) {
      await alert({ title: "Could not rewind", description: cause instanceof Error ? cause.message : "Could not rewind." })
    }
  }, [session.id, beside, onRefreshGit, confirm, alert])

  const simple = useViewMode() === "simple"
  // Simple view keeps only the panels that show who is working; the rest wait for Full view.
  const showBeside = beside.showBeside && (!simple || (beside.activeBesideTab !== null && SIMPLE_PANEL_KINDS.has(beside.activeBesideTab.kind)))
  const activeKind = showBeside ? beside.activeBesideTab?.kind ?? null : null
  const stagesActive = bottomTerminalOpen && activeDrawerTab === "stages"

  // Pause: stop the Captain's turn and every subagent that is still running.
  const pauseAll = useCallback(() => {
    onAbortSession()
    for (const sub of subagents) if (sub.status === "running" || sub.status === "waiting") void onStopSubagent(sub.id)
  }, [onAbortSession, subagents, onStopSubagent])

  const hideBeside = useCallback(() => beside.setBesideHidden(true), [beside])
  const closeToolsTab = useCallback(() => beside.closeBesideTab("tools"), [beside])
  const openDefaultDiff = useCallback(() => beside.openDiff(), [beside])
  const openDefaultTerminal = useCallback(() => beside.openTerminal(false), [beside])
  const openDefaultBrowser = useCallback(() => beside.openBrowser(), [beside])
  const openDefaultArtifact = useCallback(() => beside.openArtifact(), [beside])

  const sidePanelItems = useSessionToolsPublisher({
    session, timeline, subagents, tasks, artifacts, processes, gitSummary, browserState,
    blueprint, runStatus, pullRequest: beside.pullRequest, hasWorkspace, isBusy,
    activeKind, stagesActive,
    keybindings, onCloseBottomDrawer: closeBottomDrawer, onHideBeside: hideBeside,
    onOpenStagesDrawer: openStagesDrawer, onCloseToolsTab: closeToolsTab,
    openSwarm: beside.openSwarm, openTeam: beside.openTeam, openAgents: beside.openAgents,
    openProgress: beside.openProgress, openFiles: beside.openFiles, openDiff: openDefaultDiff,
    openRun: beside.openRun, openIssues: beside.openIssues, openPullRequest: beside.openPullRequest,
    openTerminal: openDefaultTerminal, openBrowser: openDefaultBrowser,
    openArtifact: openDefaultArtifact, openTranscript: beside.openTranscript,
    openProcesses: beside.openProcesses,
  })

  return (
    <ConversationLayout
      containerRef={split.containerRef}
      primaryWidth={showBeside ? `${split.splitRatio}%` : "100%"}
      header={
        <WorkspaceHeaderBar
          session={session} isBusy={isBusy} approvals={approvals} runStatus={hasWorkspace ? runStatus : null}
          projectName={projectName} onOpenProject={onOpenProject} stateLabel={stateLabel}
          onOpenAttempts={onOpenAttempts} onOpenExternalBrowser={onOpenExternalBrowser} onOpenRun={beside.openRun}
        />
      }
      aboveComposer={simple ? (
        <CaptainStatusLine
          sessionId={session.id}
          busy={isBusy}
          subagents={subagents}
          blueprint={blueprint}
          onOpenAgents={beside.openAgents}
          onPause={pauseAll}
          onTakeOver={() => { pauseAll(); textareaRef?.current?.focus() }}
        />
      ) : (
        <AmbientTracksBar
          subagents={subagents} gitSummary={gitSummary} tasks={tasks} artifacts={artifacts} processes={processes}
          approvals={approvals} approvalPolicy={approvalPolicy} hasWorkspace={hasWorkspace}
          onOpenSubagent={beside.openSubagent} onStopSubagent={id => void onStopSubagent(id)}
          onOpenDiff={openDefaultDiff} onOpenArtifact={beside.openArtifact}
          onOpenProcesses={beside.openProcesses} onChangeApprovalPolicy={onChangeApprovalPolicy}
          usage={timeline?.usage} onOpenProgress={beside.openProgress}
        />
      )}
      composer={
        <ComposerDock
          draft={draft} onDraftChange={onDraftChange} busy={isBusy} modelCatalog={modelCatalog}
          selectedProvider={selectedProvider} selectedModel={selectedModel} onSelectModel={onSelectModel}
          reasoning={reasoning} onSelectReasoning={onSelectReasoning} approvalPolicy={approvalPolicy}
          onChangeApprovalPolicy={onChangeApprovalPolicy} onOpenSettings={onOpenSettings}
          attachments={attachments} onAttachFiles={onAttachFiles} onRemoveAttachment={onRemoveAttachment}
          skillsCatalog={skillsCatalog} hasWorkspace={hasWorkspace}
          onSubmit={text => {
            if (hasWorkspace && /^\s*\/swarm\b/i.test(text)) beside.openSwarm()
            onSendMessage(text)
          }}
          onSteer={onSteerSession} onAbort={onAbortSession} onCompact={onCompactSession}
          onQuickOpenPanel={simple ? undefined : panel => {
            if (panel === "files") beside.openFiles()
            else if (panel === "diff") beside.openDiff()
            else if (panel === "browser") beside.openBrowser()
            else if (panel === "terminal") toggleBottomTerminal()
            else if (panel === "pr") beside.openPullRequest()
          }}
          textareaRef={textareaRef} sendChord={keybindings.sendMessage} newLineChord={keybindings.newLine}
          engineLabel={session.engine === "claude-code" ? "Claude Code" : session.engine === "codex" ? "Codex" : undefined}
          sessionId={session.id}
        />
      }
      beside={
        showBeside && beside.activeBesideTab ? (
          <>
            <div className="ade-split-divider" role="separator" aria-orientation="vertical" onPointerDown={split.startSplitDrag} title="Drag to resize split panes" />
            <BesidePane
              projectName={projectName} menuItems={sidePanelItems} onOpenMenu={beside.openSideMenu}
              onStartFromIssue={onStartFromIssue} agentsWide={split.agentsWide} onToggleAgentsWide={split.toggleAgentsWide}
              onOpenStagesDrawer={openStagesDrawer} splitRatio={split.splitRatio} session={session}
              workspacePath={workspacePath} hasWorkspace={hasWorkspace} besideTabs={beside.besideTabs}
              activeBesideTab={beside.activeBesideTab} subagents={subagents} subagentTimelines={subagentTimelines}
              gitSummary={gitSummary} browserState={browserState} artifacts={artifacts} processes={processes}
              draft={draft} terminalFontSize={terminalFontSize} terminalScrollback={terminalScrollback}
              terminalAutoStart={terminalAutoStart} prDraftDefault={prDraftDefault} environmentId={environmentId}
              textareaRef={textareaRef} onSelectTab={beside.setActiveBesideId} onCloseTab={beside.closeBesideTab}
              onCloseAll={beside.closeAllBeside} onOpenBeside={beside.openBeside} onOpenTerminal={beside.openTerminal}
              onOpenSubagent={beside.openSubagent} onOpenFile={beside.openFile} onOpenDiff={openDefaultDiff}
              onOpenBrowser={beside.openBrowser} agentBusy={isBusy} onAskAgent={onAskAgent}
              timelineItems={timeline?.items ?? []} leadLiveTools={timeline?.liveTools ?? []} tasks={tasks}
              onRewind={hasWorkspace ? content => void rewindTo(content) : undefined} diffMode={beside.diffMode}
              onRunStatusChange={status => setRunStatus(previous => ({ ...status, docker: previous?.docker ?? null, target: previous?.target }))}
              onOpenProjectSettings={onOpenProjectSettings} onOpenExternalBrowser={onOpenExternalBrowser}
              onBrowserStateChange={onBrowserStateChange} onMessageSubagent={onMessageSubagent}
              onStopSubagent={onStopSubagent} onDraftChange={onDraftChange} onRefreshGit={onRefreshGit}
              onReviewArtifact={onReviewArtifact} onKillProcess={onKillProcess} onRefreshProcesses={onRefreshProcesses}
              onPullRequestChange={beside.setPullRequest}
            />
          </>
        ) : null
      }
      footer={
        <WorkspaceBottomDrawer
          sessionId={session.id} environmentId={environmentId} hasWorkspace={hasWorkspace}
          terminalCwd={terminalCwd} isBusy={isBusy} blueprint={blueprint} blueprintLocked={blueprintLocked}
          stages={stages} onStagesChange={setStages} mounted={bottomTerminalMounted} open={bottomTerminalOpen}
          height={split.bottomTerminalHeight} showStagesTab={showStagesTab} activeDrawerTab={activeDrawerTab}
          terminalStarted={terminalStarted} terminalAutoStart={terminalAutoStart} terminalFontSize={terminalFontSize}
          terminalScrollback={terminalScrollback} onSelectTab={setDrawerTab} onStartResize={split.startBottomDrag}
          onOpenStagesDrawer={openStagesDrawer} onOpenTerminalSidePane={openDefaultTerminal}
          onClose={closeBottomDrawer} onOpenFile={beside.openFile} onOpenProgress={beside.openProgress}
        />
      }
    >
      <TimelineView
        timeline={timeline} fallbackMessages={session.messages} approvals={approvals} subagents={subagents}
        busy={isBusy} workspacePath={workspacePath} emptyTitle={session.label}
        emptySubtitle={hasWorkspace
          ? `The agent works on ${session.workspace?.branch ? `branch ${session.workspace.branch}` : "the project folder"}. Describe a task below. Review its work in Changes, run it with Run or Terminal, and ship it from Pull request.`
          : session.workspace?.removed
            ? "This session was archived and its worktree removed. Restore it from Archived in the sidebar to continue."
            : "Ask anything, plan work with /plan, or preview web pages in the built-in browser."}
        onResolveApproval={onResolveApproval} onOpenFile={hasWorkspace ? beside.openFile : undefined}
        onOpenSubagent={beside.openSubagent} onOpenBrowser={beside.openBrowser}
        onOpenExternalBrowser={onOpenExternalBrowser} onOpenArtifact={beside.openArtifact}
        onRewind={hasWorkspace ? content => void rewindTo(content) : undefined}
      />
    </ConversationLayout>
  )
}
