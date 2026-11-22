import { useCallback, useEffect, useRef, useState } from "react"
import type { Conversation, Screen, SessionArtifact, WorkspaceTab } from "./app-types"
import type { SettingsCategory } from "./SettingsView"
import { useConnections } from "./useConnections"
import { useSettings } from "./useSettings"
import { useWorktrees } from "./useWorktrees"
import { useEnvironments } from "./src/hooks/useEnvironments"
import { useModelSelection } from "./src/hooks/useModelSelection"
import { useProjects } from "./src/hooks/useProjects"
import { useRuntimeStream } from "./src/hooks/useRuntimeStream"
import { useDesktopNotifications, useSessions } from "./src/hooks/useSessions"
import { AppSidebar } from "./src/sidebar/AppSidebar"
import type { ContextMenuTarget } from "./src/sidebar/SidebarContextMenu"
import { AppMainColumn } from "./src/layout/AppMainColumn"
import { AppOverlays } from "./src/layout/AppOverlays"

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
const lastView = readLastView()

export default function App() {
  const { settings, error: settingsError, resolved, update } = useSettings()
  const [screen, setScreen] = useState<Screen>(() => lastView.screen === "project" || lastView.screen === "factory" ? lastView.screen : "work")
  const [newSessionOpen, setNewSessionOpen] = useState(false)
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
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general")
  const [settingsAutoOpenAddEnv, setSettingsAutoOpenAddEnv] = useState(false)
  const [envPaletteOpen, setEnvPaletteOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null)
  const [externalOpenRequest, setExternalOpenRequest] = useState<WorkspaceTab | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState("")

  const previousScreen = useRef<Screen>("work")
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const env = useEnvironments()
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

  // Keyboard shortcuts: Cmd+K (Command Center), Alt+L (focus composer).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setCommandOpen(v => !v)
      } else if (e.altKey && e.key.toLowerCase() === "l") {
        e.preventDefault()
        composerRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

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
    setProjectSettingsOpen(openSettings)
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

  const visibleProjects = proj.projects.filter(p => !sess.archivedIds.includes(`project:${p.id}`))
  const codingTasks = sess.sessions.filter(s => s.id !== "coding" && s.id !== "personal" && !s.chatThread)
  const personalChats = sortPinnedFirst(sess.sessions.filter(s => s.mode === "personal" && !sess.archivedIds.includes(s.id)))
  const generalChats = sortPinnedFirst(sess.sessions.filter(s => (s.id === "coding" || (s.chatThread && s.mode === "coding")) && !sess.archivedIds.includes(s.id)))
  const archivedProjects = proj.projects.filter(p => p.archivedAt)
  const archivedSessions = sess.sessions.filter(s => s.archivedAt)
  const ungroupedTasks = sortPinnedFirst(codingTasks.filter(s => !s.projectId && !sess.archivedIds.includes(s.id)))
  const selectedProject = proj.projects.find(p => p.id === selectedProjectId) ?? null

  return (
    <div className="ade-app-shell">
      <AppSidebar
        screen={screen}
        newSessionOpen={newSessionOpen}
        activeSession={sess.activeSession}
        selectedProjectId={selectedProjectId}
        expandedProjects={expandedProjects}
        projects={proj.projects}
        visibleProjects={visibleProjects}
        codingTasks={codingTasks}
        ungroupedTasks={ungroupedTasks}
        generalChats={generalChats}
        personalChats={personalChats}
        archivedProjects={archivedProjects}
        archivedSessions={archivedSessions}
        archivedIds={sess.archivedIds}
        pinnedIds={sess.pinnedIds}
        unreadIds={sess.unreadIds}
        factoryRuns={proj.factoryRuns}
        openStreamIdsByProject={proj.openStreamIdsByProject}
        focusedStreamId={proj.focusedStreamId}
        runtime={model.runtime}
        activeEnvironmentName={env.activeEnvironmentName}
        sseConnected={stream.sseConnected}
        renamingId={renamingId}
        renameText={renameText}
        onStartRename={s => { setRenamingId(s.id); setRenameText(s.label) }}
        onChangeRenameText={setRenameText}
        onCancelRename={() => setRenamingId(null)}
        onSubmitRename={async s => { setRenamingId(null); await sess.renameSession(s, renameText) }}
        onOpenNewSession={projectId => { if (projectId) setSelectedProjectId(projectId); setNewSessionOpen(true); setScreen("work") }}
        onOpenCommandCenter={() => setCommandOpen(true)}
        onOpenProjectsIndex={() => { proj.setProjectsError(""); setSelectedProjectId(null); setScreen("projects") }}
        onOpenAddProject={() => setAddProjectOpen(true)}
        onOpenProject={openProject}
        onToggleExpandProject={id => setExpandedProjects(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))}
        onSelectProjectStream={(projectId, streamId, sessionId) => {
          if (sessionId) sess.clearUnread(sessionId)
          setSelectedProjectId(projectId)
          proj.openStreamPane(projectId, streamId)
          setScreen("project")
        }}
        onMaximizeSession={id => { sess.clearUnread(id); openSessionInWork(id) }}
        onSelectSession={id => { sess.clearUnread(id); openSessionInWork(id) }}
        onCreateChatThread={mode => void sess.createChatThread(mode)}
        onToggleArchive={(id, archivedNow) => void sess.toggleArchive(id, archivedNow)}
        onOpenContextMenu={setContextMenu}
        onOpenScreen={target => { previousScreen.current = screen; setScreen(target) }}
        onOpenBrowser={() => { setNewSessionOpen(false); setScreen("work"); setExternalOpenRequest({ id: "browser", kind: "browser", title: "Browser" }) }}
        onOpenEnvironmentPalette={() => setEnvPaletteOpen(true)}
      />

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
        projectSettingsOpen={projectSettingsOpen}
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
        onToggleProjectSettings={() => setProjectSettingsOpen(v => !v)}
        onCloseProjectSettings={() => setProjectSettingsOpen(false)}
        onFocusStream={proj.setFocusedStreamId}
        onCloseStreamPane={proj.closeStreamPane}
        onOpenStreamPane={proj.openStreamPane}
        onOpenSession={openSessionInWork}
        onClearUnread={sess.clearUnread}
        onOpenNewSession={projectId => { if (projectId) setSelectedProjectId(projectId); setNewSessionOpen(true); setScreen("work") }}
        onOpenAddProject={() => setAddProjectOpen(true)}
        onOpenEnvironmentPalette={() => setEnvPaletteOpen(true)}
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
        onSteerSession={(text, mode) => void sess.steerSession(text, mode)}
        onAbortSession={() => void sess.abortSession()}
        onCompactSession={() => void sess.compactSession()}
        onReviewArtifact={handleReviewArtifact}
      />

      <AppOverlays
        commandOpen={commandOpen}
        addProjectOpen={addProjectOpen}
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
        onCloseCommand={() => setCommandOpen(false)}
        onCloseAddProject={() => setAddProjectOpen(false)}
        onCloseEnvPalette={() => setEnvPaletteOpen(false)}
        onCloseContextMenu={() => setContextMenu(null)}
        onSelectProjectFromCommand={id => { setSelectedProjectId(id); setProjectSettingsOpen(true); setScreen("project") }}
        onSelectSession={openSessionInWork}
        onNewSession={projectId => { if (projectId) setSelectedProjectId(projectId); setNewSessionOpen(true); setScreen("work") }}
        onOpenPanel={tab => { setNewSessionOpen(false); setScreen("work"); setExternalOpenRequest(tab) }}
        onOpenExternalBrowser={url => void stream.openExternalBrowser(url)}
        onOpenSettings={() => { previousScreen.current = screen; setScreen("settings") }}
        onOpenSettingsSection={openSettingsSection}
        onProjectCreated={saved => { proj.upsertProject(saved); openProject(saved.id, false) }}
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
        onRenameSession={s => { setRenamingId(s.id); setRenameText(s.label) }}
        onForkSession={s => void sess.forkSession(s)}
        onMoveToSection={(s, mode) => void sess.moveSession(s, { mode })}
        onMoveUnderProject={(s, projectId) => void sess.moveSession(s, { projectId })}
        onToggleArchiveSession={id => void sess.toggleArchive(id)}
        onDeleteSession={s => void sess.deleteSession(s)}
        onOpenProjectSettings={project => openProject(project.id, true)}
        onToggleArchiveProject={project => void sess.toggleArchive(`project:${project.id}`)}
        onDeleteProject={project => void proj.deleteProject(project)}
      />
    </div>
  )
}
