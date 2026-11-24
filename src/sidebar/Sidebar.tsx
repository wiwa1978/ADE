import { useState } from "react"
import { Archive, ChevronDown, ChevronRight, Folder, FolderGit2, GitBranch, MessageCircle, MessageSquare, Pin, Plus, Server, Workflow, X } from "lucide-react"
import type { Conversation } from "../../app-types"
import type { FactoryRunDetail } from "../factory/types"
import type { Project } from "../../ProjectsView"
import { sessionStateIcon, sessionStateInfo, type InboxEntry } from "../session-state"
import type { KeybindingMap } from "../keybindings"
import type { AddProjectSource } from "../projects/AddProjectWizard"
import { ProjectsHeaderControls } from "./ProjectsHeaderControls"
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
  width: number
  selection: SidebarSelection
  projects: Project[]
  sessionsByProject: Record<string, Conversation[]>
  ungroupedSessions: Conversation[]
  chats: Conversation[]
  factoryRunsByProject: Record<string, FactoryRunDetail[]>
  archivedProjects: Project[]
  archivedSessions: Conversation[]
  inbox: Record<string, InboxEntry>
  inboxCount: number
  expandedProjects: string[]
  pinnedIds: string[]
  unreadIds: string[]
  archivedExpanded: boolean
  renamingId: string | null
  renameText: string
  environmentName: string
  runtimeOnline: boolean
  live: boolean
  keybindings?: KeybindingMap
  onCollapse: () => void
  onNewSession: (projectId?: string) => void
  onCreateWorktree?: () => void
  onSearch: () => void
  onOpenInbox: () => void
  onAddProject: (initialSource?: AddProjectSource) => void
  onMarkAllRead?: () => void
  onClearCompleted?: () => void
  onOpenProject: (projectId: string) => void
  onToggleProject: (projectId: string) => void
  onOpenSession: (session: Conversation) => void
  onOpenFactoryRun: (projectId: string, runId: string) => void
  onNewChat: () => void
  onContextMenu: (target: ContextTarget) => void
  onRenameChange: (text: string) => void
  onRenameSubmit: (session: Conversation) => void
  onRenameCancel: () => void
  onToggleArchived: () => void
  onRestore: (id: string) => void
  onOpenSettings: () => void
  onOpenEnvironments: () => void
}

function StateDot({ entry, session }: { entry?: InboxEntry; session: Conversation }) {
  const state = entry?.state ?? (session.status === "working" ? "working" : "idle")
  const info = sessionStateInfo[state]
  return <span className={`ade-state-dot is-${info.tone}`} title={info.label} aria-label={info.label} />
}

/** The session's state as a small colored icon; the label is its tooltip and accessible name. */
function StateIcon({ state }: { state: InboxEntry["state"] }) {
  const info = sessionStateInfo[state]
  const Icon = sessionStateIcon[state]
  return <span className={`ade-row-icon is-${info.tone}`} role="img" aria-label={info.label} title={`${info.label} — ${info.hint}`}><Icon className="size-3.5" /></span>
}

function RowLabel({ session, props, unread }: { session: Conversation; props: SidebarProps; unread: boolean }) {
  if (props.renamingId === session.id) {
    return <input
      className="ade-input-sm !h-6 flex-1"
      autoFocus
      aria-label="Session name"
      value={props.renameText}
      onClick={event => event.stopPropagation()}
      onChange={event => props.onRenameChange(event.target.value)}
      onBlur={() => props.onRenameSubmit(session)}
      onKeyDown={event => {
        if (event.key === "Enter") props.onRenameSubmit(session)
        if (event.key === "Escape") props.onRenameCancel()
      }}
    />
  }
  return <span className={`ade-truncate flex-1 ${unread ? "font-semibold" : ""}`}>{session.label}</span>
}

function SessionRow({ session, props, child }: { session: Conversation; props: SidebarProps; child: boolean }) {
  const entry = props.inbox[session.id]
  const selected = props.selection.kind === "session" && props.selection.sessionId === session.id
  const unread = props.unreadIds.includes(session.id) || Boolean(entry?.needsYou && !selected)
  const pr = entry?.pullRequest
  const showState = entry && entry.state !== "idle" && entry.state !== "replied" && entry.state !== "working"
  return (
    <div
      role="button"
      tabIndex={0}
      className={`ade-nav-row ${child ? "ade-nav-row-child" : ""} ${selected ? "is-selected" : ""}`}
      onClick={() => props.onOpenSession(session)}
      onKeyDown={event => { if (event.key === "Enter") props.onOpenSession(session) }}
      onContextMenu={event => {
        event.preventDefault()
        props.onContextMenu({ kind: "session", session, x: event.clientX, y: event.clientY })
      }}
      title={entry ? `${sessionStateInfo[entry.state].label} — ${sessionStateInfo[entry.state].hint}` : undefined}
    >
      <StateDot entry={entry} session={session} />
      {props.pinnedIds.includes(session.id) ? <Pin className="size-3 shrink-0 opacity-60" aria-label="Pinned" /> : null}
      <RowLabel session={session} props={props} unread={unread} />
      {pr ? <span className={`ade-row-tag is-${pr.state === "OPEN" ? (pr.checksSummary === "failure" ? "failed" : "ok") : pr.state === "MERGED" ? "merged" : "idle"}`}>#{pr.number}</span>
        : showState ? <StateIcon state={entry.state} /> : null}
    </div>
  )
}

export function Sidebar(props: SidebarProps) {
  const { selection } = props
  const [prefs, setPrefs] = useState<SidebarPrefs>(loadSidebarPrefs)
  const [filterText, setFilterText] = useState("")
  // Search, Inbox, collapse and Settings live in the activity bar on the far left.

  const updatePrefs = (patch: Partial<SidebarPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch }
      saveSidebarPrefs(next)
      return next
    })
  }

  const q = filterText.trim().toLowerCase()
  const sessionMatchesFilter = (session: Conversation): boolean => {
    const entry = props.inbox[session.id]
    const isUnread = props.unreadIds.includes(session.id) || Boolean(entry?.needsYou)
    if (prefs.unreadOnly && !isUnread) return false
    if (prefs.pinnedOnly && !props.pinnedIds.includes(session.id)) return false
    if (q && !session.label.toLowerCase().includes(q) && !(session.workspace?.branch ?? "").toLowerCase().includes(q)) return false
    return true
  }

  const allCodingSessions = [
    ...Object.values(props.sessionsByProject).flat(),
    ...props.ungroupedSessions,
  ]
  const hasUnread = props.unreadIds.length > 0 || props.inboxCount > 0
  const hasCompleted = allCodingSessions.some(s => s.status !== "working")

  const filteredProjects = props.projects.filter(project => {
    if (prefs.projectFilter && project.id !== prefs.projectFilter) return false
    if (prefs.pinnedOnly && !props.pinnedIds.includes(`project:${project.id}`)) {
      const hasPinnedSession = (props.sessionsByProject[project.id] ?? []).some(s => props.pinnedIds.includes(s.id))
      if (!hasPinnedSession) return false
    }
    if (prefs.unreadOnly) {
      const hasUnreadSession = (props.sessionsByProject[project.id] ?? []).some(s => props.unreadIds.includes(s.id) || Boolean(props.inbox[s.id]?.needsYou))
      if (!hasUnreadSession) return false
    }
    if (q) {
      const matchesName = project.name.toLowerCase().includes(q)
      const matchesSession = (props.sessionsByProject[project.id] ?? []).some(sessionMatchesFilter)
      if (!matchesName && !matchesSession) return false
    }
    return true
  })

  const statusGroups = (() => {
    if (prefs.groupBy !== "status") return []
    const relevant = allCodingSessions.filter(s => {
      if (prefs.projectFilter && s.projectId !== prefs.projectFilter) return false
      return sessionMatchesFilter(s)
    })
    const buckets: { id: string; label: string; items: Conversation[] }[] = [
      { id: "attention", label: "Needs attention", items: [] },
      { id: "working", label: "Working", items: [] },
      { id: "idle", label: "Idle", items: [] },
    ]
    for (const s of relevant) {
      const entry = props.inbox[s.id]
      if (entry?.needsYou) buckets[0].items.push(s)
      else if (s.status === "working" || entry?.state === "working") buckets[1].items.push(s)
      else buckets[2].items.push(s)
    }
    return buckets.filter(b => b.items.length > 0)
  })()

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
              <input
                type="text"
                placeholder="Filter…"
                aria-label="Filter projects and sessions"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
              />
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
                    {group.items.map(session => <SessionRow key={session.id} session={session} props={props} child={false} />)}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="ade-nav-list">
              {props.projects.length === 0 ? (
                <button type="button" className="ade-nav-empty" onClick={() => props.onAddProject("menu")}>
                  <FolderGit2 className="size-3.5" /> Add your first project
                </button>
              ) : filteredProjects.length === 0 ? (
                <div className="ade-sidebar-filter-empty">No projects match these filters.</div>
              ) : null}
              {filteredProjects.map((project, idx) => {
                const pinned = props.pinnedIds.includes(`project:${project.id}`)
                const nextProject = filteredProjects[idx + 1]
                const showPinnedDivider = pinned && nextProject && !props.pinnedIds.includes(`project:${nextProject.id}`)
                const expanded = props.expandedProjects.includes(project.id)
                const rawSessions = props.sessionsByProject[project.id] ?? []
                const sessions = (prefs.unreadOnly || prefs.pinnedOnly || q) ? rawSessions.filter(sessionMatchesFilter) : rawSessions
                const runs = props.factoryRunsByProject[project.id] ?? []
                const attention = rawSessions.filter(session => props.inbox[session.id]?.needsYou).length
                const working = rawSessions.filter(session => props.inbox[session.id]?.state === "working" || session.status === "working").length
                return (
                  <div key={project.id}>
                    <div
                      className={`ade-nav-row ${selection.kind === "project" && selection.projectId === project.id ? "is-selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => props.onOpenProject(project.id)}
                      onKeyDown={event => { if (event.key === "Enter") props.onOpenProject(project.id) }}
                      onContextMenu={event => {
                        event.preventDefault()
                        props.onContextMenu({ kind: "project", project, x: event.clientX, y: event.clientY })
                      }}
                    >
                      <button
                        type="button"
                        className="ade-icon-btn !w-5 !h-5"
                        onClick={event => { event.stopPropagation(); props.onToggleProject(project.id) }}
                        aria-label={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
                        aria-expanded={expanded}
                      >
                        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                      <Folder className="size-3.5 shrink-0 opacity-75" />
                      <span className="ade-truncate flex-1">{project.name}</span>
                      {pinned ? <Pin className="size-3 shrink-0 opacity-60" aria-label="Pinned" /> : null}
                      {!expanded && attention > 0 ? <span className="ade-count-badge is-accent" title={`${attention} need you`}>{attention}</span>
                        : !expanded && working > 0 ? <span className="ade-state-dot is-running" title={`${working} working`} /> : null}
                      <div className="ade-nav-row-actions">
                        <button
                          type="button"
                          className="ade-icon-btn !w-5 !h-5"
                          title={`New session in ${project.name}`}
                          aria-label={`New session in ${project.name}`}
                          onClick={event => { event.stopPropagation(); props.onNewSession(project.id) }}
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        {sessions.map(session => <SessionRow key={session.id} session={session} props={props} child />)}
                        {runs.map(run => (
                          <div
                            key={run.run.runId}
                            role="button"
                            tabIndex={0}
                            className="ade-nav-row ade-nav-row-child"
                            onClick={() => props.onOpenFactoryRun(project.id, run.run.runId)}
                            onKeyDown={event => { if (event.key === "Enter") props.onOpenFactoryRun(project.id, run.run.runId) }}
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
                            onClick={() => props.onNewSession(project.id)}
                            onContextMenu={event => {
                              event.preventDefault()
                              props.onContextMenu({ kind: "project", project, x: event.clientX, y: event.clientY })
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
              {props.ungroupedSessions.filter(sessionMatchesFilter).map(session => <SessionRow key={session.id} session={session} props={props} child={false} />)}
            </div>
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
            {props.chats.map(session => {
              const selected = props.selection.kind === "session" && props.selection.sessionId === session.id
              const unread = props.unreadIds.includes(session.id)
              return (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  className={`ade-nav-row ${selected ? "is-selected" : ""}`}
                  onClick={() => props.onOpenSession(session)}
                  onKeyDown={event => { if (event.key === "Enter") props.onOpenSession(session) }}
                  onContextMenu={event => {
                    event.preventDefault()
                    props.onContextMenu({ kind: "session", session, x: event.clientX, y: event.clientY })
                  }}
                >
                  {session.status === "working" ? <span className="ade-state-dot is-running" title="Working" /> : session.mode === "personal" ? <MessageCircle className="size-3.5 shrink-0 opacity-70" /> : <MessageSquare className="size-3.5 shrink-0 opacity-70" />}
                  <RowLabel session={session} props={props} unread={unread} />
                  {props.pinnedIds.includes(session.id) ? <Pin className="size-3 shrink-0 opacity-55" aria-label="Pinned" /> : null}
                </div>
              )
            })}
          </div>
        </div>
        ) : null}

        {props.archivedProjects.length + props.archivedSessions.length > 0 ? (
          <div className="ade-archived-section">
            <button type="button" className="ade-nav-row opacity-60 hover:opacity-100 !text-[11.5px]" aria-expanded={props.archivedExpanded} onClick={props.onToggleArchived}>
              <Archive className="size-3 shrink-0" />
              <span className="flex-1">Archived ({props.archivedProjects.length + props.archivedSessions.length})</span>
              {props.archivedExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
            {props.archivedExpanded ? <>
              {props.archivedProjects.map(project => (
                <div key={project.id} className="ade-nav-row ade-nav-row-child ade-archived-row">
                  <FolderGit2 className="size-3 shrink-0 opacity-60" />
                  <span className="ade-truncate flex-1 opacity-70">{project.name}</span>
                  <button type="button" className="ade-archived-restore" aria-label={`Restore project ${project.name}`} onClick={() => props.onRestore(`project:${project.id}`)}>Restore</button>
                </div>
              ))}
              {props.archivedSessions.map(session => {
                const projectName = props.projects.find(p => p.id === session.projectId)?.name ?? props.archivedProjects.find(p => p.id === session.projectId)?.name
                return (
                  <div
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    className="ade-nav-row ade-nav-row-child ade-archived-row"
                    title={session.workspace?.removed ? "Worktree removed — restoring recreates it from its branch" : undefined}
                    onClick={() => props.onOpenSession(session)}
                    onKeyDown={event => { if (event.key === "Enter") props.onOpenSession(session) }}
                    onContextMenu={event => {
                      event.preventDefault()
                      props.onContextMenu({ kind: "session", session, x: event.clientX, y: event.clientY })
                    }}
                  >
                    {session.chatThread ? <MessageSquare className="size-3 shrink-0 opacity-60" /> : <GitBranch className="size-3 shrink-0 opacity-60" />}
                    <span className="ade-truncate flex-1 opacity-70">{session.label}{projectName ? <small className="opacity-60"> · {projectName}</small> : null}</span>
                    <button type="button" className="ade-archived-restore" aria-label={`Restore ${session.label}`} onClick={event => { event.stopPropagation(); props.onRestore(session.id) }}>Restore</button>
                  </div>
                )
              })}
            </> : null}
          </div>
        ) : null}
      </div>

      <div className="ade-sidebar-footer">
        <button type="button" className="ade-host-status w-full text-left cursor-pointer" onClick={props.onOpenEnvironments} title="Switch environment">
          <span className={`ade-state-dot is-${props.runtimeOnline ? "ok" : "waiting"}`} />
          <Server className="size-3 shrink-0" />
          <span className="ade-truncate flex-1">{props.environmentName}</span>
          {props.live ? <span className="ade-pill ade-pill-ok !text-[9.5px] !py-0">live</span> : null}
        </button>
      </div>
    </aside>
  )
}
