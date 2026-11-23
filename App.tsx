import { useCallback, useEffect, useRef, useState } from "react"
import type {
  GitHubIssue, Conversation, Screen, SessionArtifact, WorkspaceTab } from "./app-types"
import type { SettingsCategory } from "./SettingsView"
import { useConnections } from "./useConnections"
import { useSettings } from "./useSettings"
import { useWorktrees } from "./useWorktrees"
import { EventStreamProvider } from "./src/hooks/EventStreamContext"
import { useEventStream } from "./src/hooks/useEventStream"
import { useEnvironments } from "./src/hooks/useEnvironments"
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
import { isEditableTarget, matchesChord, resolveKeybindings } from "./src/keybindings"

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
  return (
    <EventStreamProvider>
      <AppInner />
    </EventStreamProvider>
  )
}

function AppInner() {
  const [lastView] = useState(readLastView)
  const { settings, error: settingsError, resolved, update } = useSettings()
  const [screen, setScreen] = useState<Screen>(() => lastView.screen === "project" || lastView.screen === "factory" || lastView.screen === "work" ? lastView.screen : "inbox")
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
    onError: model.setRuntimeError,
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
    onSessionArchived: () => setActiveSessionId("coding"),
    onProjectArchived: () => { setSelectedProjectId(null); setScreen("work") },
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
  /** Open any session or chat in the session view (marks it seen in the Inbox). */
  const openSession = useCallback((target: Conversation) => {
    sess.clearUnread(target.id)
    void markSeen(target.id)
    if (target.projectId) {
      setSelectedProjectId(target.projectId)
      expandProject(target.projectId)
    }
    openSessionInWork(target.id)
  }, [sess, markSeen, expandProject, openSessionInWork])

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

  const keybindings = resolveKeybindings(settings.keybindings)

  // Dynamic global keyboard shortcuts (built-in + user-defined custom keybindings).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const editing = isEditableTarget(e.target)
      const hasModifier = e.metaKey || e.ctrlKey || e.altKey

      if (matchesChord(e, keybindings.commandCenter)) {
        e.preventDefault()
        setCommandOpen(v => !v)
        return
      }
      if (matchesChord(e, keybindings.focusComposer)) {
        e.preventDefault()
        composerRef.current?.focus()
        return
      }
      if (matchesChord(e, keybindings.addProject)) {
        e.preventDefault()
        setAddProjectInitialSource("menu")
        setAddProjectOpen(true)
        return
      }
      if (!e.shiftKey && !e.altKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        setCreateWorktreeOpen(true)
        return
      }
      if (matchesChord(e, keybindings.openInbox)) {
        e.preventDefault()
        setScreen("inbox")
        return
      }
      if (matchesChord(e, keybindings.switchEnvironment)) {
        e.preventDefault()
        setEnvPaletteOpen(v => !v)
        return
      }
      if (matchesChord(e, keybindings.openSettings)) {
        e.preventDefault()
        setScreen(prev => {
          if (prev === "settings") return previousScreen.current === "settings" ? "work" : previousScreen.current
          previousScreen.current = prev
          return "settings"
        })
        return
      }
      if (matchesChord(e, keybindings.pinSession)) {
        e.preventDefault()
        if (screen === "project" && selectedProjectId) {
          sess.togglePin(`project:${selectedProjectId}`)
        } else if (sess.activeSession?.id) {
          sess.togglePin(sess.activeSession.id)
        }
        return
      }

      // User-defined custom shortcuts
      for (const custom of settings.customKeybindings) {
        if (!custom.chord) continue
        if (editing && !hasModifier) continue
        if (!matchesChord(e, custom.chord)) continue
        e.preventDefault()
        if (custom.action === "new-session") {
          setNewSessionOpen(true)
          setScreen("work")
        } else if (custom.action === "new-chat") {
          void sess.createChatThread("coding")
        } else if (custom.action === "toggle-theme") {
          update({ theme: resolved === "dark" ? "light" : "dark" })
        } else if (custom.action === "slash") {
          const cmd = (custom.arg || "/plan").trim()
          if (cmd) {
            setNewSessionOpen(false)
            setScreen("work")
            void sess.sendMessage(cmd, id => void stream.refreshTimeline(id))
          }
        } else if (custom.action.startsWith("panel:")) {
          const kind = custom.action.slice("panel:".length) as WorkspaceTab["kind"]
          const title = kind === "pr" ? "Pull Request" : kind[0].toUpperCase() + kind.slice(1)
          setNewSessionOpen(false)
          setScreen("work")
          setExternalOpenRequest({ id: kind, kind, title })
        }
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [keybindings, settings.customKeybindings, screen, selectedProjectId, sess, stream, resolved, update])

  const openSettingsSection = useCallback((category: SettingsCategory, autoOpenAdd = false) => {
    previousScreen.current = screen
    setSettingsCategory(category)
    setSettingsAutoOpenAddEnv(autoOpenAdd)
    setScreen("settings")
  }, [screen])

  const openProject = useCallback((projectId: string, openSettings = false) => {
    proj.setProjectsError("")
    setSelectedProjectId(projectId)
    expandProject(projectId)
    setProjectRightPane(openSettings ? "settings" : "files")
    setScreen("project")
  }, [proj, expandProject])

  const handleReviewArtifact = async (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => {
    await stream.reviewArtifact(artifact.id, decision, feedback)
    const msg = decision === "approved"
      ? `I have approved the artifact "${artifact.title}". Please proceed with the implementation.`
      : `Changes requested on artifact "${artifact.title}": ${feedback || "Please revise."}`
    if (sess.activeSession.status === "working" || stream.timeline?.busy) {
      await sess.steerSession(msg, "follow-up")
    } else {
      await sess.sendMessage(msg, id => void stream.refreshTimeline(id))
    }
  }

  const sortPinnedFirst = (list: Conversation[]) =>
    [...list].sort((a, b) => Number(sess.pinnedIds.includes(b.id)) - Number(sess.pinnedIds.includes(a.id)))

  const visibleProjects = [...proj.projects.filter(p => !sess.archivedIds.includes(`project:${p.id}`))].sort((a, b) => {
    const aIdx = sess.pinnedIds.indexOf(`project:${a.id}`)
    const bIdx = sess.pinnedIds.indexOf(`project:${b.id}`)
    const aPinned = aIdx !== -1
    const bPinned = bIdx !== -1
    if (aPinned && bPinned) return aIdx - bIdx
    if (aPinned) return -1
    if (bPinned) return 1
    return 0
  })
  const codingTasks = sess.sessions.filter(s => s.id !== "coding" && s.id !== "personal" && !s.chatThread)
  const personalChats = sortPinnedFirst(sess.sessions.filter(s => s.mode === "personal" && !sess.archivedIds.includes(s.id)))
  const generalChats = sortPinnedFirst(sess.sessions.filter(s => (s.id === "coding" || (s.chatThread && s.mode === "coding")) && !sess.archivedIds.includes(s.id)))
  const archivedProjects = proj.projects.filter(p => p.archivedAt)
  const archivedSessions = sess.sessions.filter(s => s.archivedAt)
  const ungroupedTasks = sortPinnedFirst(codingTasks.filter(s => !s.projectId && !sess.archivedIds.includes(s.id)))
  const selectedProject = proj.projects.find(p => p.id === selectedProjectId) ?? null
  const inboxCount = Object.values(inbox.entries).filter(entry => entry.needsYou && !sess.archivedIds.includes(entry.sessionId)).length
  const sidebarSelection: SidebarSelection =
    screen === "inbox" ? { kind: "inbox" }
      : screen === "settings" ? { kind: "settings" }
        : screen === "project" && selectedProjectId ? { kind: "project", projectId: selectedProjectId }
          : screen === "work" && newSessionOpen ? { kind: "new-session" }
            : screen === "work" ? { kind: "session", sessionId: sess.activeSession.id }
              : { kind: "other" }

  return (
    <div className="ade-app-shell">
      {/* Settings take over the window (they have their own navigation and a Back button). */}
      {screen === "settings" ? null : (
        <AppSidebar
          selection={sidebarSelection}
          expandedProjects={expandedProjects}
          visibleProjects={visibleProjects}
          codingTasks={codingTasks}
          ungroupedTasks={ungroupedTasks}
          chats={[...generalChats, ...personalChats]}
          archivedProjects={archivedProjects}
          archivedSessions={archivedSessions}
          archivedIds={sess.archivedIds}
          pinnedIds={sess.pinnedIds}
          unreadIds={sess.unreadIds}
          factoryRuns={proj.factoryRuns}
          inbox={inbox.entries}
          inboxCount={inboxCount}
          runtime={model.runtime}
          activeEnvironmentName={env.activeEnvironmentName}
          sseConnected={stream.sseConnected}
          keybindings={keybindings}
          renamingId={renamingId}
          renameText={renameText}
          onChangeRenameText={setRenameText}
          onCancelRename={() => setRenamingId(null)}
          onSubmitRename={async s => { setRenamingId(null); await sess.renameSession(s, renameText) }}
          onOpenNewSession={(projectId?: string, issue?: GitHubIssue) => { if (projectId) setSelectedProjectId(projectId); setNewSessionIssue(issue ?? null); setNewSessionOpen(true); setScreen("work") }}
          onOpenCreateWorktree={() => setCreateWorktreeOpen(true)}
          onOpenCommandCenter={() => setCommandOpen(true)}
          onOpenInbox={() => setScreen("inbox")}
          onOpenAddProject={src => { setAddProjectInitialSource(src ?? "menu"); setAddProjectOpen(true) }}
          onMarkAllRead={() => {
            sess.markAllRead()
            for (const entry of Object.values(inbox.entries)) {
              if (entry.needsYou) void markSeen(entry.sessionId)
            }
          }}
          onClearCompleted={() => {
            const idleTasks = codingTasks.filter(s => s.status !== "working" && !sess.archivedIds.includes(s.id))
            for (const t of idleTasks) void sess.toggleArchive(t.id, false)
          }}
          onOpenProject={projectId => openProject(projectId, false)}
          onToggleExpandProject={id => setExpandedProjects(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))}
          onOpenSession={openSession}
          onOpenFactoryRun={(projectId, runId) => {
            setSelectedProjectId(projectId)
            proj.openStreamPane(projectId, `factory:${runId}`)
            setScreen("project")
          }}
          onCreateChatThread={mode => void sess.createChatThread(mode)}
          onToggleArchive={(id, archivedNow) => void sess.toggleArchive(id, archivedNow)}
          onOpenContextMenu={setContextMenu}
          onOpenSettings={() => { previousScreen.current = screen; setScreen("settings") }}
          onOpenEnvironmentPalette={() => setEnvPaletteOpen(true)}
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
        factoryRuns={proj.factoryRuns}
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
        onOpenNewSession={(projectId?: string, issue?: GitHubIssue) => { if (projectId) setSelectedProjectId(projectId); setNewSessionIssue(issue ?? null); setNewSessionOpen(true); setScreen("work") }}
        onOpenAddProject={() => setAddProjectOpen(true)}
        onOpenEnvironmentPalette={() => setEnvPaletteOpen(true)}
        newSessionIssue={newSessionIssue}
        onQuickStartStream={sess.quickStartStream}
        onSendQuickMessage={sess.sendQuickStreamMessage}
        onStartFactoryRun={proj.startFactoryRunForProject}
        onFactoryRunAction={proj.factoryRunAction}
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
        onOpenSettings={() => { previousScreen.current = screen; setScreen("settings") }}
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
