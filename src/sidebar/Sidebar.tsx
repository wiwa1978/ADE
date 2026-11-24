import { useCallback, useMemo, useState } from "react"
import { Plus, Server, X } from "lucide-react"
import { Badge } from "../../components/ui/index.ts"
import type { Conversation } from "../../app-types"
import type { Project } from "../../ProjectsView"
import type { FactoryRunDetail } from "../factory/types"
import type { KeybindingMap } from "../keybindings"
import type { AddProjectSource } from "../projects/AddProjectWizard"
import type { InboxEntry } from "../session-state"
import { ProjectsHeaderControls } from "./ProjectsHeaderControls"
import { SidebarArchivedSection } from "./SidebarArchivedSection"
import { SidebarProjectTree } from "./SidebarProjectTree"
import { SidebarChatRow, SidebarSessionRow } from "./SidebarSessionRow"
import { computeStatusGroups, filterProjects } from "./sidebar-filtering"
import { loadSidebarPrefs, saveSidebarPrefs, type SidebarPrefs } from "./sidebar-prefs"

export type SidebarSelection =
  | { kind: "inbox" }
  | { kind: "project"; projectId: string }
  | { kind: "session"; sessionId: string }
  | { kind: "new-session" }
  | { kind: "settings" }
  | { kind: "other" }

type ContextTarget =
  | { kind: "session"; session: Conversation; x: number; y: number }
  | { kind: "project"; project: Project; x: number; y: number }

export type SidebarProps = {
  width: number; selection: SidebarSelection; projects: Project[]
  sessionsByProject: Record<string, Conversation[]>; ungroupedSessions: Conversation[]
  chats: Conversation[]; factoryRunsByProject: Record<string, FactoryRunDetail[]>
  archivedProjects: Project[]; archivedSessions: Conversation[]
  inbox: Record<string, InboxEntry>; inboxCount: number; expandedProjects: string[]
  pinnedIds: string[]; unreadIds: string[]; archivedExpanded: boolean
  renamingId: string | null; renameText: string; environmentName: string
  runtimeOnline: boolean; live: boolean; keybindings?: KeybindingMap
  onCollapse: () => void; onNewSession: (projectId?: string) => void; onCreateWorktree?: () => void
  onSearch: () => void; onOpenInbox: () => void; onAddProject: (initialSource?: AddProjectSource) => void
  onMarkAllRead?: () => void; onClearCompleted?: () => void
  onOpenProject: (projectId: string) => void; onToggleProject: (projectId: string) => void
  onOpenSession: (session: Conversation) => void; onOpenFactoryRun: (projectId: string, runId: string) => void
  onNewChat: () => void; onContextMenu: (target: ContextTarget) => void
  onRenameChange: (text: string) => void; onRenameSubmit: (session: Conversation) => void; onRenameCancel: () => void
  onToggleArchived: () => void; onRestore: (id: string) => void
  onOpenSettings: () => void; onOpenEnvironments: () => void
}

export function Sidebar(props: SidebarProps) {
  const { selection, onContextMenu } = props
  const [prefs, setPrefs] = useState<SidebarPrefs>(loadSidebarPrefs)
  const [filterText, setFilterText] = useState("")

  const updatePrefs = (patch: Partial<SidebarPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch }
      saveSidebarPrefs(next)
      return next
    })
  }

  const handleSessionContextMenu = useCallback(
    (session: Conversation, x: number, y: number) => onContextMenu({ kind: "session", session, x, y }),
    [onContextMenu],
  )
  const handleProjectContextMenu = useCallback(
    (project: Project, x: number, y: number) => onContextMenu({ kind: "project", project, x, y }),
    [onContextMenu],
  )

  const filterCtx = useMemo(
    () => ({ prefs, query: filterText.trim().toLowerCase(), inbox: props.inbox, unreadIds: props.unreadIds, pinnedIds: props.pinnedIds }),
    [prefs, filterText, props.inbox, props.unreadIds, props.pinnedIds],
  )
  const allCodingSessions = useMemo(
    () => [...Object.values(props.sessionsByProject).flat(), ...props.ungroupedSessions],
    [props.sessionsByProject, props.ungroupedSessions],
  )
  const hasUnread = props.unreadIds.length > 0 || props.inboxCount > 0
  const hasCompleted = allCodingSessions.some(s => s.status !== "working")
  const filteredProjects = useMemo(() => filterProjects(props.projects, props.sessionsByProject, filterCtx), [props.projects, props.sessionsByProject, filterCtx])
  const statusGroups = useMemo(() => computeStatusGroups(allCodingSessions, filterCtx), [allCodingSessions, filterCtx])

  return (
    <aside className={`ade-sidebar ${prefs.compact ? "is-compact" : ""}`} style={{ width: `${props.width}px` }} aria-label="Workspace navigation">
      <div className="ade-sidebar-top">
        <div className="ade-brand-row">
          <div className="ade-brand-badge">A</div>
          <div className="ade-truncate"><div className="ade-brand-title">ADE</div></div>
        </div>
      </div>

      <div className="ade-sidebar-scroll">
        <div>
          <ProjectsHeaderControls
            inboxCount={props.inboxCount}
            environmentName={props.environmentName}
            projects={props.projects}
            prefs={prefs}
            hasUnread={hasUnread}
            hasCompleted={hasCompleted}
            onChangePrefs={updatePrefs}
            onOpenInbox={props.onOpenInbox}
            onOpenEnvironments={props.onOpenEnvironments}
            onOpenAddProject={src => props.onAddProject(src)}
            onOpenCreateWorktree={() => (props.onCreateWorktree ? props.onCreateWorktree() : props.onNewSession())}
            onMarkAllRead={() => props.onMarkAllRead?.()}
            onClearCompleted={() => props.onClearCompleted?.()}
          />

          {prefs.showSearch ? (
            <div className="ade-sidebar-filter-box">
              <input type="text" placeholder="Filter…" aria-label="Filter projects and sessions" value={filterText} onChange={e => setFilterText(e.target.value)} />
              {filterText ? (
                <button type="button" className="ade-sidebar-filter-clear" onClick={() => setFilterText("")} aria-label="Clear filter">
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          ) : null}

          {prefs.groupBy === "status" ? (
            <div className="ade-nav-list">
              {statusGroups.length === 0 ? (
                <div className="ade-sidebar-filter-empty">No agent activity matches these filters.</div>
              ) : (
                statusGroups.map(group => (
                  <div key={group.id} className="mb-1.5">
                    <div className="ade-sidebar-status-label">{group.label} ({group.items.length})</div>
                    {group.items.map(session => {
                      const entry = props.inbox[session.id]
                      const selected = selection.kind === "session" && selection.sessionId === session.id
                      return (
                        <SidebarSessionRow
                          key={session.id} session={session} entry={entry} selected={selected}
                          unread={props.unreadIds.includes(session.id) || Boolean(entry?.needsYou && !selected)}
                          pinned={props.pinnedIds.includes(session.id)} child={false}
                          renaming={props.renamingId === session.id} renameText={props.renameText}
                          onOpenSession={props.onOpenSession} onContextMenu={handleSessionContextMenu}
                          onRenameChange={props.onRenameChange} onRenameSubmit={props.onRenameSubmit} onRenameCancel={props.onRenameCancel}
                        />
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          ) : (
            <SidebarProjectTree
              totalProjectsCount={props.projects.length} filteredProjects={filteredProjects}
              sessionsByProject={props.sessionsByProject} ungroupedSessions={props.ungroupedSessions}
              factoryRunsByProject={props.factoryRunsByProject} expandedProjects={props.expandedProjects}
              selection={selection} filterCtx={filterCtx} renamingId={props.renamingId} renameText={props.renameText}
              onAddProject={props.onAddProject} onOpenProject={props.onOpenProject} onToggleProject={props.onToggleProject}
              onNewSession={props.onNewSession} onOpenSession={props.onOpenSession} onOpenFactoryRun={props.onOpenFactoryRun}
              onSessionContextMenu={handleSessionContextMenu} onProjectContextMenu={handleProjectContextMenu}
              onRenameChange={props.onRenameChange} onRenameSubmit={props.onRenameSubmit} onRenameCancel={props.onRenameCancel}
            />
          )}
        </div>

        {!prefs.hideChats ? (
          <div>
            <div className="ade-nav-section-head">
              <span>Chats</span>
              <button type="button" className="ade-icon-btn" title="New chat" aria-label="New chat" onClick={props.onNewChat}>
                <Plus className="size-3.5" />
              </button>
            </div>
            <div className="ade-nav-list">
              {props.chats.map(session => (
                <SidebarChatRow
                  key={session.id}
                  session={session}
                  selected={selection.kind === "session" && selection.sessionId === session.id}
                  unread={props.unreadIds.includes(session.id)}
                  pinned={props.pinnedIds.includes(session.id)}
                  renaming={props.renamingId === session.id}
                  renameText={props.renameText}
                  onOpenSession={props.onOpenSession}
                  onContextMenu={handleSessionContextMenu}
                  onRenameChange={props.onRenameChange}
                  onRenameSubmit={props.onRenameSubmit}
                  onRenameCancel={props.onRenameCancel}
                />
              ))}
            </div>
          </div>
        ) : null}

        <SidebarArchivedSection
          projects={props.projects}
          archivedProjects={props.archivedProjects}
          archivedSessions={props.archivedSessions}
          expanded={props.archivedExpanded}
          onToggle={props.onToggleArchived}
          onRestore={props.onRestore}
          onOpenSession={props.onOpenSession}
          onSessionContextMenu={handleSessionContextMenu}
        />
      </div>

      <div className="ade-sidebar-footer">
        <button type="button" className="ade-host-status w-full text-left cursor-pointer" onClick={props.onOpenEnvironments} title="Switch environment">
          <span className={`ade-state-dot is-${props.runtimeOnline ? "ok" : "waiting"}`} />
          <Server className="size-3 shrink-0" />
          <span className="ade-truncate flex-1">{props.environmentName}</span>
          {props.live ? <Badge tone="ok" className="!text-[9.5px]">live</Badge> : null}
        </button>
      </div>
    </aside>
  )
}
