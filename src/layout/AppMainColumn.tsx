import { useMemo, type RefObject } from "react"
import { Sparkles } from "lucide-react"
import { useViewMode } from "../view-mode"
import { InboxView } from "../inbox/InboxView"
import { ObservatoryView } from "../observatory/ObservatoryView"
import { sessionStateInfo, type InboxEntry } from "../session-state"
import { request, requestJson } from "../api"
import type { Conversation, EnvironmentDirectory, GitHubIssue, StartFrom, ProviderCatalogEntry, RuntimeHealth, Screen, SessionArtifact, WorkspaceTab } from "../app-types"
import { ProjectsView, type Project, type ProjectActivity, type ProjectInput } from "../ProjectsView"
import { SettingsView, type SettingsCategory } from "../SettingsView"
import { WorktreeDiagnostics } from "../WorktreeDiagnostics"
import type { useConnections } from "../useConnections"
import type { Settings } from "../useSettings"
import type { useWorktrees } from "../useWorktrees"
import type { useRuntimeStream } from "../hooks/useRuntimeStream"
import { SplitWorkspace } from "../workspace/SplitWorkspace"
import { NewSessionView } from "../workspace/NewSessionView"
import { ProjectStreamsWorkspace } from "../projects/ProjectStreamsWorkspace"
import { AttemptsView } from "../attempts/AttemptsView"
import { resolveKeybindings } from "../keybindings"
import { ProjectRightInspector, type ProjectRightPaneMode } from "./ProjectRightInspector"

type AppMainColumnProps = {
  screen: Screen
  newSessionOpen: boolean
  settings: Settings
  resolved: "light" | "dark"
  settingsError: string
  runtimeError: string
  runtime: RuntimeHealth | null
  matchingRuntime: RuntimeHealth | null
  providerName: string
  selectedModel: string
  effectiveProvider: string
  effectiveCatalog: ProviderCatalogEntry[]
  sending: boolean
  sessions: Conversation[]
  activeSession: Conversation
  codingTasks: Conversation[]
  archivedIds: string[]
  projects: Project[]
  visibleProjects: Project[]
  projectsError: string
  selectedProjectId: string | null
  selectedProject: Project | null
  projectDrafts: Record<string, ProjectInput>
  projectActivity: ProjectActivity | null
  projectActivityError: string
  projectRightPane: ProjectRightPaneMode
  openStreamIdsByProject: Record<string, string[]>
  focusedStreamId: string | null
  connections: ReturnType<typeof useConnections>
  worktrees: ReturnType<typeof useWorktrees>
  stream: ReturnType<typeof useRuntimeStream>
  activeEnvironmentId: string
  activeEnvironmentName: string
  settingsCategory: SettingsCategory
  settingsAutoOpenAddEnv: boolean
  creatingSession: boolean
  launchError: string
  draft: string
  attachments: { id: string; name: string; content: string }[]
  externalOpenRequest: WorkspaceTab | null
  composerRef: RefObject<HTMLTextAreaElement | null>
  update: (patch: Partial<Settings>) => void
  onModelsChanged: () => void
  onBackFromSettings: () => void
  onBackFromWorktrees: () => void
  onOpenScreen: (screen: Screen) => void
  onOpenSettingsSection: (category: SettingsCategory, autoOpenAdd?: boolean) => void
  onEnvironmentChanged: (id: string, name: string, dir: EnvironmentDirectory) => void
  onSelectProject: (id: string | null) => void
  onOpenProject: (id: string, openSettings?: boolean) => void
  onProjectSaved: (saved: Project) => void
  onSaveProject: (input: ProjectInput, existingId?: string) => Promise<Project>
  onSetProjectDraft: (projectId: string, draftInput: ProjectInput) => void
  onSetProjectRightPane: (pane: ProjectRightPaneMode) => void
  onToggleProjectFiles: () => void
  onToggleProjectSettings: () => void
  onCloseProjectSettings: () => void
  onFocusStream: (streamId: string | null) => void
  onCloseStreamPane: (projectId: string, streamId: string) => void
  onOpenStreamPane: (projectId: string, streamId: string) => void
  onOpenSession: (id: string) => void
  onClearUnread: (id: string) => void
  onOpenNewSession: (projectId?: string, issue?: GitHubIssue) => void
  newSessionIssue?: GitHubIssue | null
  onOpenAddProject: () => void
  onOpenEnvironmentPalette: () => void
  onQuickStartStream: (project: Project, prompt: string) => Promise<void>
  onSendQuickMessage: (sess: Conversation, text: string) => Promise<void>
  onUnarchiveSession: (id: string) => void
  onStartNewSession: (input: { projectId: string | null; kind: "none" | "checkout" | "worktree"; repository: string; prompt: string; githubIssue?: GitHubIssue; engine?: import("@ade/protocol").SessionEngineId; interactionMode?: "chat" | "terminal"; startFrom?: StartFrom; title?: string; attempts?: Array<import("@ade/protocol").SessionEngineId>; runOn?: "local" | "docker" | "wsl" | "ssh" | "boat" | "cloud"; blueprintId?: string }) => Promise<string | null | void>
  onDeleteSession: (sess: Conversation) => void
  onOpenExternalRequest: (tab: WorkspaceTab) => void
  onClearExternalOpenRequest: () => void
  onDraftChange: (value: string) => void
  onAttachFiles: (files: FileList | null) => void
  onRemoveAttachment: (id: string) => void
  onSendMessage: (text: string) => void
  onAskAgent: (text: string) => Promise<void>
  onSteerSession: (text: string, mode: "steer" | "follow-up") => void
  onAbortSession: () => void
  onCompactSession: () => void
  onReviewArtifact: (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => Promise<void>
  inboxEntries: Record<string, InboxEntry>
  onOpenSessionConversation: (session: Conversation) => void
  onArchiveSession: (sessionId: string) => void
  attemptsGroup: string | null
  onOpenAttempts: (group: string) => void
  onBackFromAttempts: () => void
  onReloadSessions: () => Promise<void>
  onArchiveAttempt: (sessionId: string) => Promise<void>
  onSessionContextMenu?: (session: Conversation, x: number, y: number) => void
}

export function AppMainColumn(props: AppMainColumnProps) {
  const {
    screen, newSessionOpen, settings, resolved, settingsError, runtimeError, runtime, matchingRuntime,
    providerName, selectedModel, effectiveProvider, effectiveCatalog, sending, sessions, activeSession,
    codingTasks, archivedIds, projects, visibleProjects, projectsError, selectedProjectId, selectedProject,
    projectDrafts, projectActivity, projectActivityError, projectRightPane: chosenRightPane, openStreamIdsByProject,
    focusedStreamId, connections, worktrees, stream, activeEnvironmentId, activeEnvironmentName, settingsCategory,
    settingsAutoOpenAddEnv, creatingSession, launchError, draft, attachments, externalOpenRequest, composerRef, update,
  } = props

  const resolvedKeybindings = useMemo(() => resolveKeybindings(settings.keybindings), [settings.keybindings])
  // Simple view keeps the project's right panel to Settings; Files and Artefacts come with Full view.
  const projectRightPane = useViewMode() === "simple" && chosenRightPane !== "settings" ? null : chosenRightPane
  const activeProject = useMemo(
    () => projects.find(p => p.id === activeSession.projectId),
    [projects, activeSession.projectId],
  )
  const activeEntry = props.inboxEntries[activeSession.id]
  const activeStateLabel = activeEntry && activeEntry.state !== "idle" && activeEntry.state !== "replied"
    ? sessionStateInfo[activeEntry.state]
    : undefined

  return (
    <div className="ade-main-column">
      {runtimeError && screen !== "settings" && screen !== "inbox" ? (
        <div className="ade-banner-error rounded-none border-x-0 border-t-0">
          <Sparkles className="size-3.5 shrink-0" />
          <span className="flex-1">{runtimeError}</span>
          <button type="button" className="ade-chip-btn" onClick={() => props.onOpenSettingsSection("models")}>Open Settings</button>
        </div>
      ) : null}

      {screen === "inbox" ? (
        <InboxView
          sessions={sessions} projects={projects} entries={props.inboxEntries}
          onOpenSession={props.onOpenSessionConversation}
          onOpenExternal={url => void stream.openExternalBrowser(url)}
          onArchive={props.onArchiveSession}
          onNewSession={() => props.onOpenNewSession()}
          monthlyBudget={settings.monthlyBudget}
          onOpenUsage={() => props.onOpenSettingsSection("usage")}
        />
      ) : screen === "observatory" ? (
        <ObservatoryView onOpenSession={props.onOpenSession} />
      ) : screen === "settings" ? (
        <SettingsView
          sessionLabels={Object.fromEntries(sessions.map(item => [item.id, item.label]))}
          settings={settings} resolved={resolved} error={settingsError} runtimeError={runtimeError}
          runtime={runtime} matchingRuntime={matchingRuntime} providerName={providerName}
          selectedModel={selectedModel} selectedProvider={effectiveProvider} modelCatalog={effectiveCatalog}
          onModelsChanged={props.onModelsChanged} sending={sending}
          credentialChangesBlocked={sessions.some(s => s.status === "working")}
          connections={connections} projects={projects} activeEnvironmentName={activeEnvironmentName}
          initialCategory={settingsCategory} autoOpenAddEnvironment={settingsAutoOpenAddEnv}
          update={update} onBack={props.onBackFromSettings}
          onOpenProjects={() => props.onOpenScreen("projects")}
          onWorktreeDiagnostics={() => props.onOpenScreen("worktrees")}
          onEnvironmentChanged={props.onEnvironmentChanged}
          mcpServers={stream.mcpServers} approvalPolicy={stream.approvalPolicy} approvalRules={stream.approvalRules}
          browserState={stream.browserState} skillsCatalog={stream.skillsCatalog}
          onRefreshMcp={() => void stream.refreshMcp()}
          onChangeApprovalPolicy={p => stream.setApprovalPolicy(p)}
          onDeleteApprovalRule={stream.deleteApprovalRule} onAddApprovalRule={stream.addApprovalRule}
        />
      ) : screen === "attempts" && props.attemptsGroup ? (
        <AttemptsView
          group={props.attemptsGroup} sessions={sessions} entries={props.inboxEntries}
          onOpenSession={props.onOpenSessionConversation} onArchive={props.onArchiveAttempt}
          onBack={props.onBackFromAttempts}
        />
      ) : screen === "worktrees" ? (
        <WorktreeDiagnostics state={worktrees} onBack={props.onBackFromWorktrees} />
      ) : screen === "project" && selectedProject ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <ProjectStreamsWorkspace
            project={selectedProject}
            sessions={codingTasks.filter(t => t.projectId === selectedProject.id && !archivedIds.includes(t.id))}
            archivedSessions={codingTasks.filter(t => t.projectId === selectedProject.id && archivedIds.includes(t.id))}
            openStreamIds={openStreamIdsByProject[selectedProject.id] ?? []}
            focusedStreamId={focusedStreamId} activity={projectActivity} activityError={projectActivityError}
            filesOpen={projectRightPane === "files"} settingsOpen={projectRightPane === "settings"}
            onToggleFiles={props.onToggleProjectFiles} onToggleSettings={props.onToggleProjectSettings}
            onFocusStream={props.onFocusStream}
            onCloseStreamPane={streamId => props.onCloseStreamPane(selectedProject.id, streamId)}
            onOpenStreamPane={streamId => props.onOpenStreamPane(selectedProject.id, streamId)}
            onMaximizeSession={id => { props.onClearUnread(id); props.onOpenSession(id) }}
            onOpenStartedSession={async id => { await props.onReloadSessions(); props.onOpenSession(id) }}
            onQuickStartStream={async prompt => {
              if (!prompt.trim()) { props.onOpenNewSession(selectedProject.id); return }
              await props.onQuickStartStream(selectedProject, prompt)
            }}
            onSendQuickMessage={props.onSendQuickMessage}
            onUnarchiveSession={props.onUnarchiveSession}
            inboxEntries={props.inboxEntries}
            onSessionContextMenu={props.onSessionContextMenu}
            onOpenExternal={url => void stream.openExternalBrowser(url)}
            onStartAgentTask={async (task, prompt) => {
              if (task.claimedSession && codingTasks.some(item => item.id === task.claimedSession)) {
                props.onOpenSession(task.claimedSession)
                await request(`/api/projects/${encodeURIComponent(selectedProject.id)}/agent-tasks/claim`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ path: task.path, sessionId: task.claimedSession }),
                })
                return
              }
              const kind = selectedProject.repository ? settings.defaultWorkspaceKind : "none"
              const sessionId = await props.onStartNewSession({
                projectId: selectedProject.id,
                kind,
                repository: kind === "none" ? "" : selectedProject.repository || "",
                title: task.title,
                prompt,
              })
              if (!sessionId) throw new Error("The session did not start.")
              await request(`/api/projects/${encodeURIComponent(selectedProject.id)}/agent-tasks/claim`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ path: task.path, sessionId }),
              })
            }}
            onStartSessionFromIssue={async issue => {
              const kind = selectedProject.repository ? settings.defaultWorkspaceKind : "none"
              await props.onStartNewSession({
                projectId: selectedProject.id,
                kind,
                repository: kind === "none" ? "" : selectedProject.repository || "",
                prompt: `Work on GitHub issue #${issue.number}: ${issue.title}\n\n${(issue.body ?? "").slice(0, 6000)}`.trim(),
                githubIssue: { url: issue.url, repository: issue.repository, number: issue.number, title: issue.title.slice(0, 300), state: issue.state, body: (issue.body ?? "").slice(0, 5000), truncated: (issue.body ?? "").length > 5000 },
              })
            }}
            onDeleteSession={props.onDeleteSession}
            onOpenAgent={(sessionId, agent) => {
              props.onOpenSession(sessionId)
              props.onOpenExternalRequest({ id: `subagent:${agent.id}`, kind: "subagent", title: agent.name, subagentId: agent.id })
            }}
          />
          <ProjectRightInspector
            project={selectedProject}
            pane={projectRightPane}
            activeEnvironmentName={activeEnvironmentName}
            initialDraft={projectDrafts[selectedProject.id]}
            githubConnection={connections.githubConnection}
            githubStatusError={connections.githubStatusError}
            onSetPane={props.onSetProjectRightPane}
            onClose={props.onCloseProjectSettings}
            onClearUnread={props.onClearUnread}
            onOpenSession={props.onOpenSession}
            onOpenGitHubSettings={draftInput => {
              props.onSetProjectDraft(selectedProject.id, draftInput)
              props.onOpenSettingsSection("github", false)
            }}
            onSaveProject={input => props.onSaveProject(input, selectedProject.id)}
          />
        </div>
      ) : screen === "projects" ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <ProjectsView
            projects={visibleProjects} project={null} features={[]} error={projectsError}
            activity={null} activityError=""
            onSelect={id => props.onOpenProject(id, false)}
            onBack={() => { props.onSelectProject(null); props.onOpenScreen("projects") }}
            onOpenFeature={props.onOpenSession}
            onOpenAgent={(sessionId, agent) => {
              props.onOpenSession(sessionId)
              props.onOpenExternalRequest({ id: `subagent:${agent.id}`, kind: "subagent", title: agent.name, subagentId: agent.id })
            }}
          />
        </div>
      ) : newSessionOpen ? (
        <NewSessionView
          initialIssue={props.newSessionIssue ?? null} projects={visibleProjects}
          selectedProjectId={selectedProjectId} onSelectProject={props.onSelectProject}
          onAddProject={props.onOpenAddProject}
          onConfigureProject={projectId => props.onOpenProject(projectId, true)}
          onOpenEnvironmentPalette={props.onOpenEnvironmentPalette}
          environmentName={activeEnvironmentName} keybindings={resolvedKeybindings}
          modelCatalog={effectiveCatalog} selectedProvider={effectiveProvider} selectedModel={selectedModel}
          onSelectModel={(provider, id) => update({ provider, model: id })}
          reasoning={settings.reasoning} onSelectReasoning={level => update({ reasoning: level })}
          approvalPolicy={stream.approvalPolicy} onChangeApprovalPolicy={p => void stream.setApprovalPolicy(p)}
          skillsCatalog={stream.skillsCatalog} onOpenSettings={() => props.onOpenSettingsSection("models")}
          starting={creatingSession} error={launchError} onStart={props.onStartNewSession}
          onLookupIssue={async (projectId, url) => {
            const res = await requestJson<{ issue: GitHubIssue }>("/api/github/issues/lookup", "POST", { projectId, url })
            return res.issue
          }}
        />
      ) : (
        <SplitWorkspace
          onStartFromIssue={issue => props.onOpenNewSession(activeSession.projectId ?? undefined, issue)}
          session={activeSession}
          projectName={activeProject?.name}
          blueprintLocked={Boolean(activeProject?.blueprintLocked)}
          onOpenProject={activeSession.projectId ? () => props.onOpenProject(activeSession.projectId!, false) : undefined}
          onOpenProjectSettings={activeSession.projectId ? () => props.onOpenProject(activeSession.projectId!, true) : undefined}
          stateLabel={activeStateLabel}
          timeline={stream.timeline} subagentTimelines={stream.subagentTimelines} subagents={stream.subagents}
          approvals={stream.approvals} approvalPolicy={stream.approvalPolicy} processes={stream.processes}
          gitSummary={stream.gitSummary} artifacts={stream.artifacts} tasks={stream.tasks}
          skillsCatalog={stream.skillsCatalog} browserState={stream.browserState}
          onBrowserStateChange={stream.setBrowserState} modelCatalog={effectiveCatalog}
          selectedProvider={effectiveProvider} selectedModel={selectedModel}
          onSelectModel={(provider, id) => update({ provider, model: id })}
          reasoning={settings.reasoning} onSelectReasoning={level => update({ reasoning: level })}
          onOpenSettings={() => props.onOpenSettingsSection("models")}
          draft={draft} onDraftChange={props.onDraftChange} attachments={attachments}
          onAttachFiles={props.onAttachFiles} onRemoveAttachment={props.onRemoveAttachment}
          onSendMessage={props.onSendMessage} onAskAgent={props.onAskAgent} onOpenAttempts={props.onOpenAttempts}
          onSteerSession={props.onSteerSession} onAbortSession={props.onAbortSession}
          onCompactSession={props.onCompactSession} onResolveApproval={stream.resolveApproval}
          onChangeApprovalPolicy={p => void stream.setApprovalPolicy(p, activeSession.id)}
          onKillProcess={stream.killProcess}
          onRefreshProcesses={() => void stream.refreshProcesses(activeSession.id)}
          onRefreshGit={() => void stream.refreshGit(activeSession.id)}
          onMessageSubagent={stream.messageSubagent} onStopSubagent={stream.stopSubagent}
          onOpenExternalBrowser={stream.openExternalBrowser} onReviewArtifact={props.onReviewArtifact}
          terminalFontSize={settings.terminalFontSize} terminalScrollback={settings.terminalScrollback}
          terminalAutoStart={settings.terminalAutoStart} prDraftDefault={settings.prDraft}
          environmentId={activeEnvironmentId} externalOpenRequest={externalOpenRequest}
          onClearExternalOpenRequest={props.onClearExternalOpenRequest} textareaRef={composerRef}
          keybindings={resolvedKeybindings}
        />
      )}
    </div>
  )
}
