import { useState } from "react"
import { useViewMode } from "../view-mode"
import { CalendarClock,
  Archive,
  ArchiveRestore,
  Bot,
  ChevronDown,
  ChevronRight,
  Columns2,
  FolderGit2,
  FolderTree,
  GitBranch,
  GitPullRequest,
  LayoutGrid,
  ListTodo,
  Plus,
  Settings2,
  Square,
  Trash2,
} from "lucide-react"
import type { Conversation } from "../../app-types"
import type { FeatureAgent } from "../../FeatureAgents"
import { BUILTIN_BLUEPRINTS } from "../../packages/blueprints/index.ts"
import type { Project, ProjectActivity } from "../../ProjectsView"
import { ProjectIssuesList, type ProjectGitHubIssue } from "./ProjectIssuesList"
import { ProjectPullRequests } from "./ProjectPullRequests"
import { ProjectSessionList } from "./ProjectSessionList"
import type { InboxEntry } from "../session-state"
import { LiveSessionPane } from "./LiveSessionPane"
import { ProjectSubagentsTab } from "./ProjectSubagentsTab"
import { ProjectAutomationsTab } from "./ProjectAutomationsTab"

type ProjectTab = "sessions" | "issues" | "pulls" | "subagents" | "automations"
type StreamLayout = "single" | "split" | "grid"

export function ProjectStreamsWorkspace({
  project,
  sessions,
  archivedSessions,
  openStreamIds,
  focusedStreamId,
  activity,
  activityError,
  filesOpen = false,
  settingsOpen,
  onToggleFiles,
  onToggleSettings,
  onFocusStream,
  onCloseStreamPane,
  onOpenStreamPane,
  onMaximizeSession,
  onOpenStartedSession,
  onQuickStartStream,
  onSendQuickMessage,
  onUnarchiveSession,
  onDeleteSession,
  onOpenAgent,
  onStartSessionFromIssue,
  onOpenExternal,
  onSessionContextMenu,
  inboxEntries = {},
}: {
  project: Project
  sessions: Conversation[]
  archivedSessions: Conversation[]
  openStreamIds: string[]
  focusedStreamId: string | null
  activity: ProjectActivity | null
  activityError: string
  filesOpen?: boolean
  settingsOpen: boolean
  onToggleFiles?: () => void
  onToggleSettings: () => void
  onFocusStream: (streamId: string) => void
  onCloseStreamPane: (streamId: string) => void
  onOpenStreamPane: (streamId: string) => void
  onMaximizeSession: (sessionId: string) => void
  /** Open a session that was just started outside the session list (it isn't loaded yet). */
  onOpenStartedSession?: (sessionId: string) => Promise<void>
  onQuickStartStream: (prompt: string) => Promise<void>
  onSendQuickMessage: (session: Conversation, text: string) => Promise<void>
  onUnarchiveSession: (sessionId: string) => void
  onDeleteSession: (session: Conversation) => void
  onOpenAgent: (sessionId: string, agent: FeatureAgent) => void
  onStartSessionFromIssue?: (issue: ProjectGitHubIssue) => Promise<void>
  onOpenExternal?: (url: string) => void
  onSessionContextMenu?: (session: Conversation, x: number, y: number) => void
  inboxEntries?: Record<string, InboxEntry>
}) {
  const [chosenTab, setActiveTab] = useState<ProjectTab>("sessions")
  // Simple view keeps two tabs: Sessions and Agents. The others come back with Full view.
  const simple = useViewMode() === "simple"
  const activeTab: ProjectTab = simple && chosenTab !== "sessions" && chosenTab !== "subagents" ? "sessions" : chosenTab
  const [layout, setLayout] = useState<StreamLayout>("split")
  const [archivedOpen, setArchivedOpen] = useState(false)
  // "list" shows every session's status; "side" opens several live sessions next to each other.
  const [sessionView, setSessionView] = useState<"list" | "side">("list")
  const [quickPrompt, setQuickPrompt] = useState("")
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState("")

  // The project's default way of working: Vibe coding or a blueprint.
  const blueprint = !project.blueprintId || project.blueprintId === "vibe"
    ? { id: "vibe", name: "Vibe coding" }
    : BUILTIN_BLUEPRINTS.find(b => b.id === project.blueprintId) ?? { id: project.blueprintId, name: project.blueprintId }
  const repoSlug = project.githubUrl?.replace(/^https:\/\/github\.com\//i, "") ?? null

  const sessionMap = new Map(sessions.map(s => [s.id, s]))

  const allAvailableStreamIds = sessions.map(s => s.id)

  const activePaneIds = openStreamIds.filter(id => sessionMap.has(id))
  const visiblePaneIds =
    activePaneIds.length > 0
      ? layout === "single"
        ? [focusedStreamId && activePaneIds.includes(focusedStreamId) ? focusedStreamId : activePaneIds[0]]
        : activePaneIds
      : allAvailableStreamIds.slice(0, layout === "single" ? 1 : 4)

  const hiddenStreamIds = allAvailableStreamIds.filter(id => !visiblePaneIds.includes(id))

  const totalSubagentsCount = activity?.agents.length ?? 0

  async function handleQuickLaunch() {
    const trimmed = quickPrompt.trim()
    if (!trimmed || launching) return
    setLaunching(true)
    setLaunchError("")
    try {
      await onQuickStartStream(trimmed)
      setQuickPrompt("")
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Could not start the session.")
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="ade-project-shell">
      <header className="ade-project-topbar">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <FolderGit2 className="size-4 opacity-80 shrink-0" />
          <h1 className="text-[15px] font-semibold tracking-tight m-0 truncate">{project.name}</h1>
          {repoSlug ? <span className="ade-pill font-mono">{repoSlug}</span> : null}
          <span className="ade-pill ade-pill-accent">{blueprint.name}</span>
          {project.modelProfile ? <span className="ade-pill">{project.modelProfile}</span> : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="sf-btn-primary !h-8"
            onClick={() => {
              setActiveTab("sessions")
              void onQuickStartStream("")
            }}
          >
            <Plus className="size-3.5" /> New session
          </button>
          {onToggleFiles ? (
            <button
              type="button"
              className={`ade-icon-btn ${filesOpen ? "bg-[rgb(var(--surface-raised))] text-[rgb(var(--foreground))]" : ""}`}
              title="Project files"
              aria-label="Project files"
              onClick={onToggleFiles}
            >
              <FolderTree className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            className={`ade-icon-btn ${settingsOpen ? "bg-[rgb(var(--surface-raised))] text-[rgb(var(--foreground))]" : ""}`}
            title="Project settings"
            aria-label="Project settings"
            onClick={onToggleSettings}
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </header>

      {!project.repository && !project.githubUrl && !settingsOpen ? (
        <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-[rgb(var(--border)/0.7)] bg-[rgb(var(--surface)/0.55)] text-xs">
          <span className="opacity-75">
            This project is empty. Link a local folder or GitHub repository in project settings.
          </span>
          <button type="button" className="sf-btn-secondary !h-7 shrink-0" onClick={onToggleSettings}>
            <Settings2 className="size-3.5" /> Configure project
          </button>
        </div>
      ) : null}

      <div className="ade-project-tabs-row">
        <nav className="ade-project-tabs" role="tablist" aria-label="Project views">
          <button type="button" role="tab" aria-selected={activeTab === "sessions"} className={`ade-project-tab ${activeTab === "sessions" ? "is-active" : ""}`} onClick={() => setActiveTab("sessions")}>
            <Columns2 className="size-3.5" />
            <span>Sessions</span>
            <span className="ade-count-badge">{sessions.length}</span>
          </button>
          {!simple ? (
            <button type="button" role="tab" aria-selected={activeTab === "issues"} className={`ade-project-tab ${activeTab === "issues" ? "is-active" : ""}`} onClick={() => setActiveTab("issues")}>
              <ListTodo className="size-3.5" />
              <span>Issues</span>
            </button>
          ) : null}
          {!simple ? (
            <button type="button" role="tab" aria-selected={activeTab === "pulls"} className={`ade-project-tab ${activeTab === "pulls" ? "is-active" : ""}`} onClick={() => setActiveTab("pulls")}>
              <GitPullRequest className="size-3.5" />
              <span>Pull requests</span>
            </button>
          ) : null}
          <button type="button" role="tab" aria-selected={activeTab === "subagents"} className={`ade-project-tab ${activeTab === "subagents" ? "is-active" : ""}`} onClick={() => setActiveTab("subagents")}>
            <Bot className="size-3.5" />
            <span>Agents</span>
            {totalSubagentsCount > 0 ? <span className="ade-count-badge is-accent">{totalSubagentsCount}</span> : null}
          </button>
          {!simple ? (
            <button type="button" role="tab" aria-selected={activeTab === "automations"} className={`ade-project-tab ${activeTab === "automations" ? "is-active" : ""}`} onClick={() => setActiveTab("automations")}>
              <CalendarClock className="size-3.5" />
              <span>Automations</span>
            </button>
          ) : null}
        </nav>

        {activeTab === "sessions" ? (
          <div className="ade-segmented" role="tablist" aria-label="Session view">
            <button type="button" role="tab" aria-selected={sessionView === "list"} className={sessionView === "list" ? "is-active" : ""} onClick={() => setSessionView("list")}>List</button>
            <button type="button" role="tab" aria-selected={sessionView === "side"} className={sessionView === "side" ? "is-active" : ""} onClick={() => setSessionView("side")}>Side by side</button>
          </div>
        ) : null}
        {activeTab === "sessions" && sessionView === "side" && visiblePaneIds.length > 0 ? (
          <div className="flex items-center gap-2">
            {hiddenStreamIds.length > 0 ? (
              <button type="button" className="ade-chip-btn" onClick={() => onOpenStreamPane(hiddenStreamIds[0])} title="Open another session side by side">
                <Plus className="size-3" /> Add pane ({hiddenStreamIds.length})
              </button>
            ) : null}
            <div className="ade-segmented" role="group" aria-label="Pane layout">
              <button type="button" className={layout === "single" ? "is-active" : ""} onClick={() => setLayout("single")} title="Single pane"><Square className="size-3" /></button>
              <button type="button" className={layout === "split" ? "is-active" : ""} onClick={() => setLayout("split")} title="2-up split panes"><Columns2 className="size-3" /></button>
              <button type="button" className={layout === "grid" ? "is-active" : ""} onClick={() => setLayout("grid")} title="Multi-pane grid"><LayoutGrid className="size-3" /></button>
            </div>
          </div>
        ) : null}
      </div>

      {activeTab === "sessions" && sessionView === "list" ? (
        <div className="ade-streams-canvas">
          <ProjectSessionList
            projectName={project.name}
            sessions={sessions}
            entries={inboxEntries}
            onOpenSession={onMaximizeSession}
            onQuickStart={onQuickStartStream}
            onSessionContextMenu={onSessionContextMenu}
          />
        </div>
      ) : null}
      {activeTab === "sessions" && sessionView === "side" ? (
        <div className="ade-streams-canvas">
          {launchError ? <div className="ade-banner-error">{launchError}</div> : null}

          {visiblePaneIds.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="w-11 h-11 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] grid place-items-center mb-4 opacity-85">
                <Columns2 className="size-5" />
              </div>
              <h2 className="text-[16px] font-semibold m-0">Start a session in {project.name}</h2>
              <p className="text-[13px] opacity-65 max-w-md mt-1.5 mb-5 leading-relaxed">
                Each session is an agent working on its own branch. Open several here to watch them side by side.
              </p>
              <form
                className="w-full max-w-xl flex items-center gap-2 p-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))]"
                onSubmit={e => { e.preventDefault(); void handleQuickLaunch() }}
              >
                <input
                  className="flex-1 bg-transparent border-0 outline-none px-2 text-[13px]"
                  placeholder={`What should an agent build or investigate in ${project.name}?`}
                  value={quickPrompt}
                  onChange={e => setQuickPrompt(e.target.value)}
                  disabled={launching}
                />
                <button type="submit" className="sf-btn-primary !h-8" disabled={launching || !quickPrompt.trim()}>
                  {launching ? "Starting…" : "Start session"}
                </button>
              </form>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                <button type="button" className="sf-btn-ghost" onClick={() => setActiveTab("issues")}>
                  <ListTodo className="size-3.5" /> Browse GitHub Issues
                </button>
              </div>
            </div>
          ) : (
            <div className={`ade-streams-grid layout-${layout}`}>
              {visiblePaneIds.map(streamId => {
                const sess = sessionMap.get(streamId)
                if (sess) {
                  return (
                    <LiveSessionPane
                      key={sess.id}
                      session={sess}
                      focused={focusedStreamId === sess.id}
                      onFocus={() => onFocusStream(sess.id)}
                      onMaximize={() => onMaximizeSession(sess.id)}
                      onClose={() => onCloseStreamPane(sess.id)}
                      onSendQuickMessage={onSendQuickMessage}
                    />
                  )
                }
                return null
              })}
            </div>
          )}

          <section className="ade-archived-drawer">
            <button type="button" className="ade-archived-head" onClick={() => setArchivedOpen(v => !v)}>
              <span className="flex items-center gap-2">
                {archivedOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                <Archive className="size-3.5" />
                <span>Archived sessions</span>
                <span className="ade-count-badge">{archivedSessions.length}</span>
              </span>
              <span className="text-[11px] font-normal opacity-70">Right-click a session to archive it</span>
            </button>
            {archivedOpen ? (
              <div className="border-t border-[rgb(var(--border)/0.7)] divide-y divide-[rgb(var(--border)/0.5)]">
                {archivedSessions.length === 0 ? (
                  <div className="px-3.5 py-3 text-[12px] opacity-60">No archived sessions in this project.</div>
                ) : (
                  archivedSessions.map(sess => (
                    <div key={sess.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[12.5px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <GitBranch className="size-3.5 opacity-55 shrink-0" />
                        <span className="truncate">{sess.label}</span>
                        {sess.workspace?.branch ? <span className="ade-pill !text-[10.5px] font-mono">{sess.workspace.branch}</span> : null}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button type="button" className="ade-chip-btn" onClick={() => onUnarchiveSession(sess.id)} title="Restore to active sessions">
                          <ArchiveRestore className="size-3" /> Restore
                        </button>
                        <button type="button" className="ade-chip-btn ade-chip-danger" onClick={() => onDeleteSession(sess)} title="Delete permanently">
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === "issues" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <ProjectIssuesList
            project={project}
            onStartSessionFromIssue={onStartSessionFromIssue}
            onOpenProjectSettings={onToggleSettings}
          />
        </div>
      ) : null}

      {activeTab === "pulls" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <ProjectPullRequests
            project={project}
            sessionBranches={Object.fromEntries([...sessions, ...archivedSessions].filter(s => s.workspace?.branch).map(s => [s.workspace!.branch!, s.id]))}
            onOpenExternal={url => (onOpenExternal ? onOpenExternal(url) : void window.open(url, "_blank", "noopener"))}
            onOpenSession={onMaximizeSession}
            onOpenProjectSettings={onToggleSettings}
          />
        </div>
      ) : null}

      {activeTab === "automations" ? (
        <ProjectAutomationsTab
          projectId={project.id}
          hasGitHub={Boolean(project.githubUrl)}
          hasCheckout={Boolean(project.repository)}
          onOpenSession={id => void (onOpenStartedSession ? onOpenStartedSession(id) : onMaximizeSession(id))}
        />
      ) : null}

      {activeTab === "subagents" ? (
        <ProjectSubagentsTab
          activity={activity}
          activityError={activityError}
          onOpenAgent={onOpenAgent}
        />
      ) : null}
    </div>
  )
}
