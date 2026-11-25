import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  GitHubIssue, Conversation, Screen, SessionArtifact, WorkspaceTab } from "./app-types"
import type { SettingsCategory } from "./SettingsView"
import { ConfirmProvider } from "./components/ui/index.ts"
import { useConnections } from "./useConnections"
import { useSettings } from "./useSettings"
import { useWorktrees } from "./useWorktrees"
import { EventStreamProvider } from "./src/hooks/EventStreamContext"
import { useEventStream } from "./src/hooks/useEventStream"
import { useEnvironments } from "./src/hooks/useEnvironments"
import { useGlobalKeybindings } from "./src/hooks/useGlobalKeybindings"
import { useModelSelection } from "./src/hooks/useModelSelection"
import { useProjects } from "./src/hooks/useProjects"
import { useRuntimeStream } from "./src/hooks/useRuntimeStream"
import { useDesktopNotifications, useSessions } from "./src/hooks/useSessions"
import { AppSidebar } from "./src/sidebar/AppSidebar"
import type { SidebarSelection } from "./src/sidebar/Sidebar"
import { useInbox } from "./src/session-state"
import type { ContextMenuTarget } from "./src/sidebar/SidebarContextMenu"
import { AppMainColumn } from "./src/layout/AppMainColumn"
import { AppOverlays } from "./src/layout/AppOverlays"
import type { AddProjectSource } from "./src/projects/AddProjectWizard"
import { resolveKeybindings } from "./src/keybindings"
import { MobileAuthGate, type MobileSessionState } from "./src/mobile/MobileAuthGate"
import { MobileAppShell } from "./src/mobile/MobileAppShell"
import { useIsMobile } from "./src/mobile/useIsMobile"
import { I18nProvider } from "./src/i18n/I18nProvider"
import { useI18n } from "./src/i18n/I18nContext"
import { request } from "./api"

type LastView = { screen?: Screen; activeSessionId?: string; selectedProjectId?: string | null; expandedProjects?: string[] }

/** The view to reopen after a reload, unless "Reopen last view" is turned off in Settings → General. */
function readLastView(): LastView {
  try {
    const settings = JSON.parse(localStorage.getItem("ade-settings-v1") ?? "{}")
    if (settings?.restoreLastView === false) return {}
    const saved = JSON.parse(localStorage.getItem("ade.last-view") ?? "{}")
    return saved && typeof saved === "object" ? saved : {}
  } catch {
    return {}
  }
}

export default function App() {
  const settingsHook = useSettings()
  return (
    <I18nProvider
      language={settingsHook.settings.language}
      dateFormat={settingsHook.settings.dateFormat}
      timeFormat={settingsHook.settings.timeFormat}
      currency={settingsHook.settings.currency}
      onChangeLanguage={language => settingsHook.update({ language })}
    >
      <ConfirmProvider>
        <EventStreamProvider>
          <AppInner settingsHook={settingsHook} />
        </EventStreamProvider>
      </ConfirmProvider>
    </I18nProvider>
  )
}

function AppInner({ settingsHook }: { settingsHook: ReturnType<typeof useSettings> }) {
  const { t } = useI18n()
  const [lastView] = useState(readLastView)
  const { settings, error: settingsError, resolved, update } = settingsHook
  const [screen, setScreen] = useState<Screen>(() => lastView.screen === "project" || lastView.screen === "work" ? lastView.screen : String(lastView.screen) === "factory" ? "project" : "inbox")
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  // Set when New session is opened from an issue (Issues panel): linked and filled in.
  const [newSessionIssue, setNewSessionIssue] = useState<GitHubIssue | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    try {
      const param = new URLSearchParams(window.location.search).get("session")
      return param || (typeof lastView.activeSessionId === "string" ? lastView.activeSessionId : "") || "coding"
    } catch {
      return "coding"
    }
  })
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() =>
    typeof lastView.selectedProjectId === "string" ? lastView.selectedProjectId : null,
  )
  const [expandedProjects, setExpandedProjects] = useState<string[]>(() =>
    Array.isArray(lastView.expandedProjects) ? lastView.expandedProjects.filter(id => typeof id === "string") : [],
  )
  const [projectRightPane, setProjectRightPane] = useState<"files" | "artifacts" | "settings" | null>("files")
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general")
  const [settingsAutoOpenAddEnv, setSettingsAutoOpenAddEnv] = useState(false)
  const [envPaletteOpen, setEnvPaletteOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [addProjectInitialSource, setAddProjectInitialSource] = useState<AddProjectSource>("menu")
  const [createWorktreeOpen, setCreateWorktreeOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null)
  const [externalOpenRequest, setExternalOpenRequest] = useState<WorkspaceTab | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState("")
  const isMobile = useIsMobile()
  const [mobileSession, setMobileSession] = useState<MobileSessionState | null>(null)
  const [pairedToastDismissed, setPairedToastDismissed] = useState(false)
  const [urlFlags] = useState(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      return { paired: sp.get("paired") === "1", pairError: sp.get("pairError") }
    } catch {
      return { paired: false, pairError: null as string | null }
    }
  })

  useEffect(() => {
    let cancelled = false
    void request<MobileSessionState>("/api/mobile/session")
      .then(res => {
        if (cancelled) return
        if (typeof res?.mobileBridge === "boolean") setMobileSession(res)
        if (urlFlags.paired && typeof window !== "undefined") {
          try {
            const cleaned = new URL(window.location.href)
            cleaned.searchParams.delete("paired")
            cleaned.searchParams.delete("pairError")
            window.history.replaceState({}, "", cleaned.pathname + cleaned.search + cleaned.hash)
          } catch {
            // Ignore history restrictions.
          }
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [urlFlags.paired])

  const previousScreen = useRef<Screen>("work")
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const env = useEnvironments()
  const eventStream = useEventStream()
  const lastEnvVersion = useRef(env.environmentVersion)
  useEffect(() => {
    if (lastEnvVersion.current !== env.environmentVersion) {
      lastEnvVersion.current = env.environmentVersion
      eventStream.reconnect()
    }
  }, [env.environmentVersion, eventStream])
  const model = useModelSelection({ settings, environmentVersion: env.environmentVersion, screen })
  const connections = useConnections(screen, model.setRuntime, env.environmentVersion)
  const worktrees = useWorktrees()

  const handleClearSelectedProject = useCallback(() => {
    setSelectedProjectId(null)
    setScreen(prev => (prev === "project" ? "projects" : prev))
  }, [])

  const proj = useProjects({
    screen,
    selectedProjectId,
    environmentVersion: env.environmentVersion,
    onClearSelectedProject: handleClearSelectedProject,
  })

  const [attemptsGroup, setAttemptsGroup] = useState<string | null>(null)
  const openAttempts = useCallback((group: string) => {
    setAttemptsGroup(group)
    setNewSessionOpen(false)
    setScreen("attempts")
  }, [])

  const openSessionInWork = useCallback((id: string) => {
    setActiveSessionId(id)
    setNewSessionOpen(false)
    setScreen("work")
  }, [])

  const expandProject = useCallback((projectId: string) => {
    setExpandedProjects(prev => (prev.includes(projectId) ? prev : [...prev, projectId]))
  }, [])

  const handleSessionArchived = useCallback(() => setActiveSessionId("coding"), [])
  const handleProjectArchived = useCallback(() => {
    setSelectedProjectId(null)
    setScreen("work")
  }, [])

  const sess = useSessions({
    activeSessionId,
    selectedProjectId,
    activeEnvironmentId: env.activeEnvironmentId,
    environmentVersion: env.environmentVersion,
    projects: proj.projects,
    settings,
    effectiveProvider: model.effectiveProvider,
    selectedModel: model.selectedModel,
    modelReady: model.modelReady,
    modelSetupMessage: model.modelSetupMessage,
    onLoadProjects: proj.loadProjects,
    onOpenSession: openSessionInWork,
    onSessionArchived: handleSessionArchived,
    onProjectArchived: handleProjectArchived,
    onExpandProject: expandProject,
    onOpenAttempts: openAttempts,
    onOpenStreamPane: proj.openStreamPane,
    onError: model.setRuntimeError,
  })

  const stream = useRuntimeStream({
    sessionId: screen === "work" && !newSessionOpen ? sess.activeSession.id : null,
    hasWorkspace: sess.hasWorkspace,
    isCodingTask: sess.isCodingTask,
    environmentVersion: env.environmentVersion,
    onSessionsChanged: () => void sess.loadSessions(),
    onAgentBrowserDriving: () => setExternalOpenRequest({ id: "browser", kind: "browser", title: "Browser" }),
    onArtifactUpdated: artifactId => setExternalOpenRequest({ id: "artifact", kind: "artifact", title: "Artifact", artifactId }),
  })

  const inbox = useInbox(sess.sessions)
  const markSeen = inbox.markSeen
  const clearUnread = sess.clearUnread
  /** Open any session or chat in the session view (marks it seen in the Inbox). */
  const openSession = useCallback((target: Conversation) => {
    clearUnread(target.id)
    void markSeen(target.id)
    if (target.projectId) {
      setSelectedProjectId(target.projectId)
      expandProject(target.projectId)
    }
    openSessionInWork(target.id)
  }, [clearUnread, markSeen, expandProject, openSessionInWork])

  // The session on screen counts as seen, including when its state changes while you watch it.
  const activeEntry = inbox.entries[activeSessionId]
  useEffect(() => {
    if (screen === "work" && !newSessionOpen && activeEntry?.needsYou && activeEntry.state !== "needs-approval" && document.hasFocus()) void markSeen(activeSessionId)
  }, [screen, newSessionOpen, activeSessionId, activeEntry?.needsYou, activeEntry?.state, markSeen])

  useDesktopNotifications({
    sessions: sess.sessions,
    approvals: stream.approvals,
    notifyOnFinish: settings.notifyOnFinish,
    notifyOnApproval: settings.notifyOnApproval,
    onOpenSession: openSessionInWork,
  })

  // Persist last-viewed screen/session/project across reloads.
  useEffect(() => {
    try {
      if (!settings.restoreLastView) {
        localStorage.removeItem("ade.last-view")
        return
      }
      const view: LastView = { screen, activeSessionId, selectedProjectId, expandedProjects }
      localStorage.setItem("ade.last-view", JSON.stringify(view))
    } catch {
      // Storage can be unavailable in private mode; restoring the view is a convenience only.
    }
  }, [settings.restoreLastView, screen, activeSessionId, selectedProjectId, expandedProjects])

  const keybindings = useMemo(() => resolveKeybindings(settings.keybindings), [settings.keybindings])

  useGlobalKeybindings({
    keybindings,
    customKeybindings: settings.customKeybindings,
    screen,
    selectedProjectId,
    activeSessionId: sess.activeSession?.id,
    resolvedTheme: resolved,
    onToggleCommandCenter: () => setCommandOpen(v => !v),
    onFocusComposer: () => composerRef.current?.focus(),
    onOpenAddProject: () => { setAddProjectInitialSource("menu"); setAddProjectOpen(true) },
    onOpenCreateWorktree: () => setCreateWorktreeOpen(true),
    onOpenInbox: () => setScreen("inbox"),
    onToggleEnvironmentPalette: () => setEnvPaletteOpen(v => !v),
    onToggleSettings: () => {
      setScreen(prev => {
        if (prev === "settings") return previousScreen.current === "settings" ? "work" : previousScreen.current
        previousScreen.current = prev
        return "settings"
      })
    },
    onTogglePin: sess.togglePin,
    onNewSession: () => { setNewSessionOpen(true); setScreen("work") },
    onNewChat: () => void sess.createChatThread("coding"),
    onToggleTheme: next => update({ theme: next }),
    onRunSlashCommand: cmd => {
      setNewSessionOpen(false)
      setScreen("work")
      void sess.sendMessage(cmd, id => void stream.refreshTimeline(id))
    },
    onOpenPanel: tab => {
      setNewSessionOpen(false)
      setScreen("work")
      setExternalOpenRequest(tab)
    },
  })

  const openSettingsSection = useCallback((category: SettingsCategory, autoOpenAdd = false) => {
    previousScreen.current = screen
    setSettingsCategory(category)
    setSettingsAutoOpenAddEnv(autoOpenAdd)
    setScreen("settings")
  }, [screen])

  const setProjectsError = proj.setProjectsError
  const openProject = useCallback((projectId: string, openSettings = false) => {
    setProjectsError("")
    setSelectedProjectId(projectId)
    expandProject(projectId)
    setProjectRightPane(openSettings ? "settings" : "files")
    setScreen("project")
  }, [setProjectsError, expandProject])

  const handleReviewArtifact = useCallback(async (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => {
    await stream.reviewArtifact(artifact.id, decision, feedback)
    const msg = decision === "approved"
      ? `I have approved the artifact "${artifact.title}". Please proceed with the implementation.`
      : `Changes requested on artifact "${artifact.title}": ${feedback || "Please revise."}`
    if (sess.activeSession.status === "working" || stream.timeline?.busy) {
      await sess.steerSession(msg, "follow-up")
    } else {
      await sess.sendMessage(msg, id => void stream.refreshTimeline(id))
    }
  }, [stream, sess])

  // Memoized derived sidebar & project selectors so unrelated state changes don't rebuild lists
  const visibleProjects = useMemo(() => {
    const archivedSet = new Set(sess.archivedIds)
    return proj.projects
      .filter(p => !archivedSet.has(`project:${p.id}`))
      .sort((a, b) => {
        const aIdx = sess.pinnedIds.indexOf(`project:${a.id}`)
        const bIdx = sess.pinnedIds.indexOf(`project:${b.id}`)
        const aPinned = aIdx !== -1
        const bPinned = bIdx !== -1
        if (aPinned && bPinned) return aIdx - bIdx
        if (aPinned) return -1
        if (bPinned) return 1
        return 0
      })
  }, [proj.projects, sess.archivedIds, sess.pinnedIds])

  const codingTasks = useMemo(
    () => sess.sessions.filter(s => s.id !== "coding" && s.id !== "personal" && !s.chatThread),
    [sess.sessions],
  )

  const sidebarChats = useMemo(() => {
    const archivedSet = new Set(sess.archivedIds)
    const pinnedSet = new Set(sess.pinnedIds)
    const sortPinned = (list: Conversation[]) =>
      list.sort((a, b) => Number(pinnedSet.has(b.id)) - Number(pinnedSet.has(a.id)))
    const general = sortPinned(
      sess.sessions.filter(s => (s.id === "coding" || (s.chatThread && s.mode === "coding")) && !archivedSet.has(s.id)),
    )
    const personal = sortPinned(
      sess.sessions.filter(s => s.mode === "personal" && !archivedSet.has(s.id)),
    )
    return [...general, ...personal]
  }, [sess.sessions, sess.archivedIds, sess.pinnedIds])

  const archivedProjects = useMemo(() => proj.projects.filter(p => p.archivedAt), [proj.projects])
  const archivedSessions = useMemo(() => sess.sessions.filter(s => s.archivedAt), [sess.sessions])

  const ungroupedTasks = useMemo(() => {
    const archivedSet = new Set(sess.archivedIds)
    const pinnedSet = new Set(sess.pinnedIds)
    return codingTasks
      .filter(s => !s.projectId && !archivedSet.has(s.id))
      .sort((a, b) => Number(pinnedSet.has(b.id)) - Number(pinnedSet.has(a.id)))
  }, [codingTasks, sess.archivedIds, sess.pinnedIds])

  const selectedProject = useMemo(
    () => proj.projects.find(p => p.id === selectedProjectId) ?? null,
    [proj.projects, selectedProjectId],
  )

  const inboxCount = useMemo(() => {
    const archivedSet = new Set(sess.archivedIds)
    return Object.values(inbox.entries).filter(entry => entry.needsYou && !archivedSet.has(entry.sessionId)).length
  }, [inbox.entries, sess.archivedIds])

  const sidebarSelection = useMemo<SidebarSelection>(
    () =>
      screen === "inbox" ? { kind: "inbox" }
        : screen === "settings" ? { kind: "settings" }
          : screen === "project" && selectedProjectId ? { kind: "project", projectId: selectedProjectId }
            : screen === "work" && newSessionOpen ? { kind: "new-session" }
              : screen === "work" ? { kind: "session", sessionId: sess.activeSession.id }
                : { kind: "other" },
    [screen, selectedProjectId, newSessionOpen, sess.activeSession.id],
  )

  // Stable callbacks for React.memo(AppSidebar)
  const handleCancelRename = useCallback(() => setRenamingId(null), [])
  const renameSession = sess.renameSession
  const handleSubmitRename = useCallback(async (s: Conversation) => {
    setRenamingId(null)
    await renameSession(s, renameText)
  }, [renameSession, renameText])
  const handleOpenNewSession = useCallback((projectId?: string, issue?: GitHubIssue) => {
    if (projectId) setSelectedProjectId(projectId)
    setNewSessionIssue(issue ?? null)
    setNewSessionOpen(true)
    setScreen("work")
  }, [])
  const handleOpenCreateWorktree = useCallback(() => setCreateWorktreeOpen(true), [])
  const handleOpenCommandCenter = useCallback(() => setCommandOpen(true), [])
  const handleOpenInbox = useCallback(() => setScreen("inbox"), [])
  const handleOpenAddProject = useCallback((src?: AddProjectSource) => {
    setAddProjectInitialSource(src ?? "menu")
    setAddProjectOpen(true)
  }, [])
  const markAllRead = sess.markAllRead
  const handleMarkAllRead = useCallback(() => {
    markAllRead()
    for (const entry of Object.values(inbox.entries)) {
      if (entry.needsYou) void markSeen(entry.sessionId)
    }
  }, [markAllRead, inbox.entries, markSeen])
  const toggleArchive = sess.toggleArchive
  const handleClearCompleted = useCallback(() => {
    const archivedSet = new Set(sess.archivedIds)
    const idleTasks = codingTasks.filter(s => s.status !== "working" && !archivedSet.has(s.id))
    for (const t of idleTasks) void toggleArchive(t.id, false)
  }, [codingTasks, sess.archivedIds, toggleArchive])
  const handleOpenProjectSidebar = useCallback((projectId: string) => openProject(projectId, false), [openProject])
  const handleToggleExpandProject = useCallback((id: string) => {
    setExpandedProjects(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }, [])
  const createChatThread = sess.createChatThread
  const handleCreateChatThread = useCallback((mode: "coding" | "personal") => {
    void createChatThread(mode)
  }, [createChatThread])
  const handleToggleArchive = useCallback((id: string, archivedNow?: boolean) => {
    void toggleArchive(id, archivedNow)
  }, [toggleArchive])
  const handleOpenSettings = useCallback(() => {
    previousScreen.current = screen
    setScreen("settings")
  }, [screen])
  const handleOpenMobilePairing = useMemo(
    () => (mobileSession?.mobileBridge ? undefined : () => openSettingsSection("mobile", false)),
    [mobileSession?.mobileBridge, openSettingsSection],
  )
  const handleOpenEnvPalette = useCallback(() => setEnvPaletteOpen(true), [])

  if (mobileSession?.mobileBridge && !mobileSession.paired) {
    return (
      <MobileAuthGate
        hostName={mobileSession.hostName}
        pairError={urlFlags.pairError}
        onPaired={() => window.location.replace("/?paired=1")}
      />
    )
  }

  if (isMobile) {
    return (
      <>
        {mobileSession?.mobileBridge && mobileSession.paired && urlFlags.paired && !pairedToastDismissed ? (
          <div className="ade-mobile-paired-toast" role="status">
            <span>{t("wsx.app.connectedTo")} <strong>{mobileSession.hostName}</strong>{mobileSession.device?.name ? ` · ${mobileSession.device.name}` : ""}</span>
            <button type="button" className="ade-chip-btn" onClick={() => setPairedToastDismissed(true)}>{t("wsx.app.done")}</button>
          </div>
        ) : null}
        <MobileAppShell
          mobileSession={mobileSession}
          hostName={mobileSession?.hostName || env.activeEnvironmentName}
          runtimeOnline={Boolean(model.runtime?.online)}
          sseConnected={stream.sseConnected}
          resolvedTheme={resolved}
          onToggleTheme={() => update({ theme: resolved === "dark" ? "light" : "dark" })}
          sessions={sess.sessions}
          activeSession={sess.activeSession}
          projects={visibleProjects}
          pinnedIds={sess.pinnedIds}
          unreadIds={sess.unreadIds}
          archivedIds={sess.archivedIds}
          inboxEntries={inbox.entries}
          inboxCount={inboxCount}
          timeline={stream.timeline}
          subagents={stream.subagents}
          approvals={stream.approvals}
          approvalPolicy={stream.approvalPolicy}
          artifacts={stream.artifacts}
          gitSummary={stream.gitSummary}
          skillsCatalog={stream.skillsCatalog}
          modelCatalog={model.effectiveCatalog}
          selectedProvider={model.effectiveProvider}
          selectedModel={model.selectedModel}
          reasoning={settings.reasoning}
          draft={sess.draft}
          attachments={sess.attachments}
          creatingSession={sess.creatingSession}
          launchError={sess.launchError}
          composerRef={composerRef}
          onSelectSession={openSession}
          onSelectModel={(provider, id) => update({ provider, model: id })}
          onSelectReasoning={level => update({ reasoning: level })}
          onChangeApprovalPolicy={p => void stream.setApprovalPolicy(p, sess.activeSession.id)}
          onDraftChange={sess.setDraft}
          onAttachFiles={files => void sess.attachFiles(files)}
          onRemoveAttachment={id => sess.setAttachments(prev => prev.filter(a => a.id !== id))}
          onSendMessage={text => void sess.sendMessage(text, id => void stream.refreshTimeline(id))}
          onAskAgent={text => sess.askAgent(text, id => void stream.refreshTimeline(id))}
          onSteerSession={(text, mode) => void sess.steerSession(text, mode)}
          onAbortSession={() => void sess.abortSession()}
          onCompactSession={() => void sess.compactSession()}
          onResolveApproval={stream.resolveApproval}
          onReviewArtifact={handleReviewArtifact}
          onRefreshGit={() => void stream.refreshGit(sess.activeSession.id)}
          onRefreshSessions={sess.loadSessions}
          onCreateChatThread={handleCreateChatThread}
          onStartNewSession={sess.startNewSession}
          onOpenExternalBrowser={url => void stream.openExternalBrowser(url)}
        />
      </>
    )
  }

  return (
    <div className="ade-app-shell">
      {mobileSession?.mobileBridge && mobileSession.paired && urlFlags.paired && !pairedToastDismissed ? (
        <div className="ade-mobile-paired-toast" role="status">
          <span>{t("wsx.app.connectedTo")} <strong>{mobileSession.hostName}</strong>{mobileSession.device?.name ? ` · ${mobileSession.device.name}` : ""}</span>
          <button type="button" className="ade-chip-btn" onClick={() => setPairedToastDismissed(true)}>{t("wsx.app.done")}</button>
        </div>
      ) : null}
      {/* Settings take over the window (they have their own navigation and a Back button). */}
      {screen === "settings" ? null : (
        <AppSidebar
          selection={sidebarSelection}
          expandedProjects={expandedProjects}
          visibleProjects={visibleProjects}
          codingTasks={codingTasks}
          ungroupedTasks={ungroupedTasks}
          chats={sidebarChats}
          archivedProjects={archivedProjects}
          archivedSessions={archivedSessions}
          archivedIds={sess.archivedIds}
          pinnedIds={sess.pinnedIds}
          unreadIds={sess.unreadIds}
          inbox={inbox.entries}
          inboxCount={inboxCount}
          runtime={model.runtime}
          activeEnvironmentName={env.activeEnvironmentName}
          sseConnected={stream.sseConnected}
          keybindings={keybindings}
          renamingId={renamingId}
          renameText={renameText}
          onChangeRenameText={setRenameText}
          onCancelRename={handleCancelRename}
          onSubmitRename={handleSubmitRename}
          onOpenNewSession={handleOpenNewSession}
          onOpenCreateWorktree={handleOpenCreateWorktree}
          onOpenCommandCenter={handleOpenCommandCenter}
          onOpenInbox={handleOpenInbox}
          onOpenAddProject={handleOpenAddProject}
          onMarkAllRead={handleMarkAllRead}
          onClearCompleted={handleClearCompleted}
          onOpenProject={handleOpenProjectSidebar}
          onToggleExpandProject={handleToggleExpandProject}
          onOpenSession={openSession}
          onCreateChatThread={handleCreateChatThread}
          onToggleArchive={handleToggleArchive}
          onOpenContextMenu={setContextMenu}
          onOpenSettings={handleOpenSettings}
          onOpenMobilePairing={handleOpenMobilePairing}
          onOpenEnvironmentPalette={handleOpenEnvPalette}
        />
      )}

      <AppMainColumn
        screen={screen}
        newSessionOpen={newSessionOpen}
        settings={settings}
        resolved={resolved}
        settingsError={settingsError}
        runtimeError={model.runtimeError}
        runtime={model.runtime}
        matchingRuntime={model.matchingRuntime}
        providerName={model.providerName}
        selectedModel={model.selectedModel}
        effectiveProvider={model.effectiveProvider}
        effectiveCatalog={model.effectiveCatalog}
        sending={sess.sending}
        sessions={sess.sessions}
        activeSession={sess.activeSession}
        codingTasks={codingTasks}
        archivedIds={sess.archivedIds}
        projects={proj.projects}
        visibleProjects={visibleProjects}
        projectsError={proj.projectsError}
        selectedProjectId={selectedProjectId}
        selectedProject={selectedProject}
        projectDrafts={proj.projectDrafts}
        projectActivity={proj.projectActivity}
        projectActivityError={proj.projectActivityError}
        projectRightPane={projectRightPane}
        openStreamIdsByProject={proj.openStreamIdsByProject}
        focusedStreamId={proj.focusedStreamId}
        connections={connections}
        worktrees={worktrees}
        stream={stream}
        activeEnvironmentId={env.activeEnvironmentId}
        activeEnvironmentName={env.activeEnvironmentName}
        settingsCategory={settingsCategory}
        settingsAutoOpenAddEnv={settingsAutoOpenAddEnv}
        creatingSession={sess.creatingSession}
        launchError={sess.launchError}
        draft={sess.draft}
        attachments={sess.attachments}
        externalOpenRequest={externalOpenRequest}
        composerRef={composerRef}
        update={update}
        onModelsChanged={() => { void model.loadModelCatalog(); void model.loadHealth() }}
        onBackFromSettings={() => { setSettingsAutoOpenAddEnv(false); setScreen(previousScreen.current === "settings" ? "work" : previousScreen.current) }}
        onBackFromWorktrees={() => setScreen(previousScreen.current === "worktrees" ? "work" : previousScreen.current)}
        onOpenScreen={setScreen}
        onOpenSettingsSection={openSettingsSection}
        onEnvironmentChanged={env.handleEnvironmentChanged}
        onSelectProject={setSelectedProjectId}
        onOpenProject={openProject}
        onProjectSaved={proj.upsertProject}
        onSaveProject={proj.saveProject}
        onSetProjectDraft={(projectId, draftInput) => proj.setProjectDrafts(prev => ({ ...prev, [projectId]: draftInput }))}
        onSetProjectRightPane={setProjectRightPane}
        onToggleProjectSettings={() => setProjectRightPane(v => (v === "settings" ? null : "settings"))}
        onToggleProjectFiles={() => setProjectRightPane(v => (v === "files" ? null : "files"))}
        onCloseProjectSettings={() => setProjectRightPane(null)}
        onFocusStream={proj.setFocusedStreamId}
        onCloseStreamPane={proj.closeStreamPane}
        onOpenStreamPane={proj.openStreamPane}
        onOpenSession={openSessionInWork}
        onClearUnread={sess.clearUnread}
        onOpenNewSession={handleOpenNewSession}
        onOpenAddProject={() => setAddProjectOpen(true)}
        onOpenEnvironmentPalette={handleOpenEnvPalette}
        newSessionIssue={newSessionIssue}
        onQuickStartStream={sess.quickStartStream}
        onSendQuickMessage={sess.sendQuickStreamMessage}
        onUnarchiveSession={id => void sess.toggleArchive(id, true)}
        onStartNewSession={sess.startNewSession}
        onDeleteSession={s => void sess.deleteSession(s)}
        onOpenExternalRequest={setExternalOpenRequest}
        onClearExternalOpenRequest={() => setExternalOpenRequest(null)}
        onDraftChange={sess.setDraft}
        onAttachFiles={files => void sess.attachFiles(files)}
        onRemoveAttachment={id => sess.setAttachments(prev => prev.filter(a => a.id !== id))}
        onSendMessage={text => void sess.sendMessage(text, id => void stream.refreshTimeline(id))}
        onAskAgent={text => sess.askAgent(text, id => void stream.refreshTimeline(id))}
        onSteerSession={(text, mode) => void sess.steerSession(text, mode)}
        onAbortSession={() => void sess.abortSession()}
        onCompactSession={() => void sess.compactSession()}
        onReviewArtifact={handleReviewArtifact}
        inboxEntries={inbox.entries}
        onOpenSessionConversation={openSession}
        onArchiveSession={id => void sess.toggleArchive(id, false)}
        attemptsGroup={attemptsGroup}
        onOpenAttempts={openAttempts}
        onBackFromAttempts={() => setScreen("inbox")}
        onReloadSessions={sess.loadSessions}
        onArchiveAttempt={id => sess.toggleArchive(id, false)}
        onSessionContextMenu={(session, x, y) => setContextMenu({ kind: "session", session, x, y })}
      />

      <AppOverlays
        commandOpen={commandOpen}
        addProjectOpen={addProjectOpen}
        addProjectInitialSource={addProjectInitialSource}
        createWorktreeOpen={createWorktreeOpen}
        selectedProjectId={selectedProjectId}
        activeEnvironmentName={env.activeEnvironmentName}
        creatingSession={sess.creatingSession}
        launchError={sess.launchError}
        envPaletteOpen={envPaletteOpen}
        contextMenu={contextMenu}
        projects={proj.projects}
        visibleProjects={visibleProjects}
        sessions={sess.sessions}
        subagents={stream.subagents}
        hasActiveWorkspace={sess.hasWorkspace}
        githubLogin={connections.githubConnection?.login ?? null}
        environmentDirectory={env.environmentDirectory}
        activeEnvironmentId={env.activeEnvironmentId}
        pinnedIds={sess.pinnedIds}
        unreadIds={sess.unreadIds}
        archivedIds={sess.archivedIds}
        keybindings={keybindings}
        onCloseCommand={() => setCommandOpen(false)}
        onCloseAddProject={() => setAddProjectOpen(false)}
        onCloseCreateWorktree={() => setCreateWorktreeOpen(false)}
        onOpenAddProjectFromModal={() => { setAddProjectInitialSource("menu"); setAddProjectOpen(true) }}
        onCreateWorktree={sess.startNewSession}
        onCloseEnvPalette={() => setEnvPaletteOpen(false)}
        onCloseContextMenu={() => setContextMenu(null)}
        onSelectProjectFromCommand={id => { setSelectedProjectId(id); setProjectRightPane("settings"); setScreen("project") }}
        onSelectSession={openSessionInWork}
        onNewSession={projectId => { if (projectId) setSelectedProjectId(projectId); setNewSessionOpen(true); setScreen("work") }}
        onOpenPanel={tab => { setNewSessionOpen(false); setScreen("work"); setExternalOpenRequest(tab) }}
        onOpenExternalBrowser={url => void stream.openExternalBrowser(url)}
        onOpenSettings={handleOpenSettings}
        onOpenSettingsSection={openSettingsSection}
        onProjectCreated={(saved, opts) => { proj.upsertProject(saved); openProject(saved.id, Boolean(opts?.openSettings)) }}
        onSelectEnvironment={env.selectEnvironment}
        onOpenSplitView={s => {
          sess.clearUnread(s.id)
          if (s.projectId) {
            openProject(s.projectId, false)
            proj.openStreamPane(s.projectId, s.id)
          } else {
            openSessionInWork(s.id)
            setExternalOpenRequest({ id: "diff", kind: "diff", title: "Diff" })
          }
        }}
        onOpenExternalApp={(app, path) => void sess.openExternalApp(app, path)}
        onTogglePin={sess.togglePin}
        onToggleUnread={sess.toggleUnread}
        onShowSessionArtifacts={s => {
          sess.clearUnread(s.id)
          openSessionInWork(s.id)
          setExternalOpenRequest({ id: "artifact", kind: "artifact", title: "Artefacts" })
        }}
        onRenameSession={s => { setRenamingId(s.id); setRenameText(s.label) }}
        onStopSession={s => void sess.abortSession(s.id)}
        onDeleteSession={s => void sess.deleteSession(s)}
        onShowProjectArtifacts={project => {
          setSelectedProjectId(project.id)
          expandProject(project.id)
          setNewSessionOpen(false)
          setScreen("project")
          setProjectRightPane("artifacts")
        }}
        onOpenProjectSettings={project => openProject(project.id, true)}
        onToggleArchiveProject={project => void sess.toggleArchive(`project:${project.id}`)}
        onDeleteProject={project => void proj.deleteProject(project)}
      />
    </div>
  )
}
