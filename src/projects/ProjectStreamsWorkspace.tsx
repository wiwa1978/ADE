import { useState } from "react"
import type { Conversation } from "../../app-types"
import type { FeatureAgent } from "../../FeatureAgents"
import { BUILTIN_BLUEPRINTS } from "../../packages/blueprints/index.ts"
import type { Project, ProjectActivity } from "../../ProjectsView"
import { FactoryKanban } from "../factory/FactoryKanban"
import { FactoryIssuesList, type ProjectGitHubIssue } from "../factory/FactoryIssuesList"
import type { FactoryRunDetail } from "../factory/types"
import type { InboxEntry } from "../session-state"
import { ProjectAutomationsTab } from "./ProjectAutomationsTab"
import { ProjectPullRequests } from "./ProjectPullRequests"
import { ProjectSessionList } from "./ProjectSessionList"
import { ProjectSubagentsTab } from "./ProjectSubagentsTab"
import { ProjectStreamsGrid } from "./streams/ProjectStreamsGrid"
import { ProjectWorkspaceHeader, type ProjectTab, type StreamLayout } from "./streams/ProjectWorkspaceHeader"

export interface ProjectStreamsWorkspaceProps {
  project: Project; sessions: Conversation[]; archivedSessions: Conversation[]; factoryRuns: FactoryRunDetail[]
  openStreamIds: string[]; focusedStreamId: string | null; activity: ProjectActivity | null; activityError: string
  filesOpen?: boolean; settingsOpen: boolean; onToggleFiles?: () => void; onToggleSettings: () => void
  onFocusStream: (streamId: string) => void; onCloseStreamPane: (streamId: string) => void; onOpenStreamPane: (streamId: string) => void
  onMaximizeSession: (sessionId: string) => void; onOpenStartedSession?: (sessionId: string) => Promise<void>
  onMaximizeFactoryRun: (runId: string) => void; onQuickStartStream: (prompt: string) => Promise<void>
  onSendQuickMessage: (session: Conversation, text: string) => Promise<void>
  onStartFactoryRun: (opts?: { issueNumber?: number; issueTitle?: string; issueBody?: string }) => Promise<void>
  onFactoryRunAction: (runId: string, action: "step" | "approve" | "pause" | "steer", note?: string) => Promise<void>
  onUnarchiveSession: (sessionId: string) => void; onDeleteSession: (session: Conversation) => void
  onOpenAgent: (sessionId: string, agent: FeatureAgent) => void
  onStartSessionFromIssue?: (issue: ProjectGitHubIssue) => Promise<void>
  onOpenExternal?: (url: string) => void; onSessionContextMenu?: (session: Conversation, x: number, y: number) => void
  inboxEntries?: Record<string, InboxEntry>
}

export function ProjectStreamsWorkspace(props: ProjectStreamsWorkspaceProps) {
  const { project, sessions, archivedSessions, factoryRuns, openStreamIds, focusedStreamId, inboxEntries = {} } = props
  const [activeTab, setActiveTab] = useState<ProjectTab>("sessions")
  const [layout, setLayout] = useState<StreamLayout>("split")
  const [sessionView, setSessionView] = useState<"list" | "side">("list")
  const [quickPrompt, setQuickPrompt] = useState("")
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState("")

  const blueprint = !project.blueprintId || project.blueprintId === "vibe"
    ? { id: "vibe", name: "Vibe coding" }
    : BUILTIN_BLUEPRINTS.find(b => b.id === project.blueprintId) ?? { id: project.blueprintId, name: project.blueprintId }
  const repoSlug = project.githubUrl?.replace(/^https:\/\/github\.com\//i, "") ?? null

  const sessionMap = new Map(sessions.map(s => [s.id, s]))
  const runMap = new Map(factoryRuns.map(r => [`factory:${r.run.runId}`, r]))
  const allStreamIds = [...sessions.map(s => s.id), ...factoryRuns.map(r => `factory:${r.run.runId}`)]
  const activePaneIds = openStreamIds.filter(id => sessionMap.has(id) || runMap.has(id))
  const visiblePaneIds = activePaneIds.length > 0
    ? layout === "single"
      ? [focusedStreamId && activePaneIds.includes(focusedStreamId) ? focusedStreamId : activePaneIds[0]]
      : activePaneIds
    : allStreamIds.slice(0, layout === "single" ? 1 : 4)
  const hiddenStreamIds = allStreamIds.filter(id => !visiblePaneIds.includes(id))

  const factorySubagents = factoryRuns.flatMap(detail =>
    detail.subagents.map(sa => ({
      ...sa,
      runId: detail.run.runId,
      runTitle: detail.run.issueRef?.title || detail.taskPrompt || detail.run.runId.slice(0, 8),
    })),
  )
  const totalSubagentsCount = (props.activity?.agents.length ?? 0) + factorySubagents.length

  async function handleQuickLaunch() {
    const trimmed = quickPrompt.trim()
    if (!trimmed || launching) return
    setLaunching(true)
    setLaunchError("")
    try {
      await props.onQuickStartStream(trimmed)
      setQuickPrompt("")
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Could not start the session.")
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="ade-project-shell">
      <ProjectWorkspaceHeader
        project={project}
        blueprintName={blueprint.name}
        repoSlug={repoSlug}
        sessionsCount={sessions.length}
        factoryRunsCount={factoryRuns.length}
        totalSubagentsCount={totalSubagentsCount}
        activeTab={activeTab}
        sessionView={sessionView}
        layout={layout}
        visiblePaneCount={visiblePaneIds.length}
        hiddenStreamCount={hiddenStreamIds.length}
        filesOpen={props.filesOpen ?? false}
        settingsOpen={props.settingsOpen}
        onSelectTab={setActiveTab}
        onSelectSessionView={setSessionView}
        onSelectLayout={setLayout}
        onOpenNextHiddenPane={() => { if (hiddenStreamIds[0]) props.onOpenStreamPane(hiddenStreamIds[0]) }}
        onStartFactoryRun={() => void props.onStartFactoryRun()}
        onNewSession={() => { setActiveTab("sessions"); void props.onQuickStartStream("") }}
        onToggleFiles={props.onToggleFiles}
        onToggleSettings={props.onToggleSettings}
      />

      {activeTab === "sessions" && sessionView === "list" ? (
        <div className="ade-streams-canvas">
          <ProjectSessionList
            projectName={project.name}
            sessions={sessions}
            factoryRuns={factoryRuns}
            entries={inboxEntries}
            onOpenSession={props.onMaximizeSession}
            onOpenFactoryRun={runId => { props.onOpenStreamPane(`factory:${runId}`); setSessionView("side") }}
            onQuickStart={props.onQuickStartStream}
            onSessionContextMenu={props.onSessionContextMenu}
          />
        </div>
      ) : null}

      {activeTab === "sessions" && sessionView === "side" ? (
        <ProjectStreamsGrid
          projectName={project.name}
          layout={layout}
          visiblePaneIds={visiblePaneIds}
          sessionMap={sessionMap}
          runMap={runMap}
          archivedSessions={archivedSessions}
          focusedStreamId={focusedStreamId}
          quickPrompt={quickPrompt}
          launching={launching}
          launchError={launchError}
          onQuickPromptChange={setQuickPrompt}
          onQuickLaunch={() => void handleQuickLaunch()}
          onStartFactoryRun={() => void props.onStartFactoryRun()}
          onBrowseIssues={() => setActiveTab("issues")}
          onFocusStream={props.onFocusStream}
          onCloseStreamPane={props.onCloseStreamPane}
          onMaximizeSession={props.onMaximizeSession}
          onMaximizeFactoryRun={props.onMaximizeFactoryRun}
          onSendQuickMessage={props.onSendQuickMessage}
          onFactoryRunAction={props.onFactoryRunAction}
          onUnarchiveSession={props.onUnarchiveSession}
          onDeleteSession={props.onDeleteSession}
        />
      ) : null}

      {activeTab === "kanban" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <FactoryKanban
            runs={factoryRuns}
            selectedRunId={null}
            onSelectRun={props.onMaximizeFactoryRun}
            onAutoRun={runId => void props.onFactoryRunAction(runId, "step")}
            onNewRun={() => void props.onStartFactoryRun()}
          />
        </div>
      ) : null}

      {activeTab === "issues" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <FactoryIssuesList
            project={project}
            onStartFromIssue={async issue => {
              await props.onStartFactoryRun({ issueNumber: issue.number, issueTitle: issue.title, issueBody: issue.body })
              setActiveTab("kanban")
            }}
            onStartSessionFromIssue={props.onStartSessionFromIssue}
            onOpenProjectSettings={props.onToggleSettings}
          />
        </div>
      ) : null}

      {activeTab === "pulls" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <ProjectPullRequests
            project={project}
            sessionBranches={Object.fromEntries([...sessions, ...archivedSessions].filter(s => s.workspace?.branch).map(s => [s.workspace!.branch!, s.id]))}
            onOpenExternal={url => (props.onOpenExternal ? props.onOpenExternal(url) : void window.open(url, "_blank", "noopener"))}
            onOpenSession={props.onMaximizeSession}
            onOpenProjectSettings={props.onToggleSettings}
          />
        </div>
      ) : null}

      {activeTab === "automations" ? (
        <ProjectAutomationsTab
          projectId={project.id}
          hasGitHub={Boolean(project.githubUrl)}
          hasCheckout={Boolean(project.repository)}
          onOpenSession={id => void (props.onOpenStartedSession ? props.onOpenStartedSession(id) : props.onMaximizeSession(id))}
        />
      ) : null}

      {activeTab === "subagents" ? (
        <ProjectSubagentsTab
          factorySubagents={factorySubagents}
          activity={props.activity}
          activityError={props.activityError}
          onMaximizeFactoryRun={props.onMaximizeFactoryRun}
          onOpenAgent={props.onOpenAgent}
        />
      ) : null}
    </div>
  )
}
