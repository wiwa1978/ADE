import { ChevronDown, ChevronRight, Folder, FolderGit2, Pin, Plus, Workflow } from "lucide-react"
import type { Conversation } from "../../app-types"
import type { Project } from "../../ProjectsView"
import type { FactoryRunDetail } from "../factory/types"
import type { AddProjectSource } from "../projects/AddProjectWizard"
import type { SidebarSelection } from "./Sidebar"
import { sessionMatchesFilter, type SidebarFilterContext } from "./sidebar-filtering"
import { SidebarSessionRow } from "./SidebarSessionRow"

interface SidebarProjectTreeProps {
  totalProjectsCount: number
  filteredProjects: Project[]
  sessionsByProject: Record<string, Conversation[]>
  ungroupedSessions: Conversation[]
  factoryRunsByProject: Record<string, FactoryRunDetail[]>
  expandedProjects: string[]
  selection: SidebarSelection
  filterCtx: SidebarFilterContext
  renamingId: string | null
  renameText: string
  onAddProject: (initialSource?: AddProjectSource) => void
  onOpenProject: (projectId: string) => void
  onToggleProject: (projectId: string) => void
  onNewSession: (projectId?: string) => void
  onOpenSession: (session: Conversation) => void
  onOpenFactoryRun: (projectId: string, runId: string) => void
  onSessionContextMenu: (session: Conversation, x: number, y: number) => void
  onProjectContextMenu: (project: Project, x: number, y: number) => void
  onRenameChange: (text: string) => void
  onRenameSubmit: (session: Conversation) => void
  onRenameCancel: () => void
}

export function SidebarProjectTree({
  totalProjectsCount,
  filteredProjects,
  sessionsByProject,
  ungroupedSessions,
  factoryRunsByProject,
  expandedProjects,
  selection,
  filterCtx,
  renamingId,
  renameText,
  onAddProject,
  onOpenProject,
  onToggleProject,
  onNewSession,
  onOpenSession,
  onOpenFactoryRun,
  onSessionContextMenu,
  onProjectContextMenu,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: SidebarProjectTreeProps) {
  const { prefs, query, inbox, unreadIds, pinnedIds } = filterCtx
  const hasSessionFilter = prefs.unreadOnly || prefs.pinnedOnly || Boolean(query)

  const renderSessionRow = (session: Conversation, child: boolean) => {
    const entry = inbox[session.id]
    const selected = selection.kind === "session" && selection.sessionId === session.id
    const unread = unreadIds.includes(session.id) || Boolean(entry?.needsYou && !selected)
    return (
      <SidebarSessionRow
        key={session.id}
        session={session}
        entry={entry}
        selected={selected}
        unread={unread}
        pinned={pinnedIds.includes(session.id)}
        child={child}
        renaming={renamingId === session.id}
        renameText={renameText}
        onOpenSession={onOpenSession}
        onContextMenu={onSessionContextMenu}
        onRenameChange={onRenameChange}
        onRenameSubmit={onRenameSubmit}
        onRenameCancel={onRenameCancel}
      />
    )
  }

  return (
    <div className="ade-nav-list">
      {totalProjectsCount === 0 ? (
        <button type="button" className="ade-nav-empty" onClick={() => onAddProject("menu")}>
          <FolderGit2 className="size-3.5" /> Add your first project
        </button>
      ) : filteredProjects.length === 0 ? (
        <div className="ade-sidebar-filter-empty">No projects match these filters.</div>
      ) : null}

      {filteredProjects.map((project, idx) => {
        const pinned = pinnedIds.includes(`project:${project.id}`)
        const nextProject = filteredProjects[idx + 1]
        const showPinnedDivider = pinned && nextProject && !pinnedIds.includes(`project:${nextProject.id}`)
        const expanded = expandedProjects.includes(project.id)
        const rawSessions = sessionsByProject[project.id] ?? []
        const sessions = hasSessionFilter ? rawSessions.filter(s => sessionMatchesFilter(s, filterCtx)) : rawSessions
        const runs = factoryRunsByProject[project.id] ?? []
        const attention = rawSessions.filter(session => inbox[session.id]?.needsYou).length
        const working = rawSessions.filter(session => inbox[session.id]?.state === "working" || session.status === "working").length

        return (
          <div key={project.id}>
            <div
              className={`ade-nav-row ${selection.kind === "project" && selection.projectId === project.id ? "is-selected" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onOpenProject(project.id)}
              onKeyDown={event => { if (event.key === "Enter") onOpenProject(project.id) }}
              onContextMenu={event => {
                event.preventDefault()
                onProjectContextMenu(project, event.clientX, event.clientY)
              }}
            >
              <button
                type="button"
                className="ade-icon-btn !w-5 !h-5"
                onClick={event => { event.stopPropagation(); onToggleProject(project.id) }}
                aria-label={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
                aria-expanded={expanded}
              >
                {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
              <Folder className="size-3.5 shrink-0 opacity-75" />
              <span className="ade-truncate flex-1">{project.name}</span>
              {pinned ? <Pin className="size-3 shrink-0 opacity-60" aria-label="Pinned" /> : null}
              {!expanded && attention > 0 ? (
                <span className="ade-count-badge is-accent" title={`${attention} need you`}>{attention}</span>
              ) : !expanded && working > 0 ? (
                <span className="ade-state-dot is-running" title={`${working} working`} />
              ) : null}
              <div className="ade-nav-row-actions">
                <button
                  type="button"
                  className="ade-icon-btn !w-5 !h-5"
                  title={`New session in ${project.name}`}
                  aria-label={`New session in ${project.name}`}
                  onClick={event => { event.stopPropagation(); onNewSession(project.id) }}
                >
                  <Plus className="size-3" />
                </button>
              </div>
            </div>

            {expanded ? (
              <div className="flex flex-col gap-0.5 mt-0.5">
                {sessions.map(session => renderSessionRow(session, true))}
                {runs.map(run => (
                  <div
                    key={run.run.runId}
                    role="button"
                    tabIndex={0}
                    className="ade-nav-row ade-nav-row-child"
                    onClick={() => onOpenFactoryRun(project.id, run.run.runId)}
                    onKeyDown={event => { if (event.key === "Enter") onOpenFactoryRun(project.id, run.run.runId) }}
                    title="Software Factory run"
                  >
                    <span className={`ade-state-dot is-${run.run.status === "running" ? "running" : run.run.status === "failed" ? "failed" : run.run.status === "completed" ? "ok" : "waiting"}`} />
                    <Workflow className="size-3 shrink-0 opacity-70" />
                    <span className="ade-truncate flex-1">
                      {run.run.issueRef?.number ? `#${run.run.issueRef.number} ` : ""}
                      {run.run.issueRef?.title || run.taskPrompt || run.run.runId.slice(0, 8)}
                    </span>
                  </div>
                ))}
                {sessions.length === 0 && runs.length === 0 ? (
                  <button
                    type="button"
                    className="ade-nav-row ade-nav-row-child opacity-60 hover:opacity-100"
                    onClick={() => onNewSession(project.id)}
                    onContextMenu={event => {
                      event.preventDefault()
                      onProjectContextMenu(project, event.clientX, event.clientY)
                    }}
                  >
                    <Plus className="size-3 shrink-0" />
                    <span className="ade-truncate">New session</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            {showPinnedDivider ? <div className="my-1 mx-2 border-t border-[rgb(var(--border)/0.6)]" /> : null}
          </div>
        )
      })}

      {ungroupedSessions.filter(s => sessionMatchesFilter(s, filterCtx)).map(session => renderSessionRow(session, false))}
    </div>
  )
}
