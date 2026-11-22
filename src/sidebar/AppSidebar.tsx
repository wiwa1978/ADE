import { useEffect, useRef, useState } from "react"
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderGit2,
  GitBranch,
  Globe,
  Maximize2,
  MessageCircle,
  MessageSquare,
  PanelLeft,
  Pencil,
  Pin,
  Plus,
  Search,
  Server,
  Settings2,
  Workflow,
} from "lucide-react"
import type { Conversation, RuntimeHealth, Screen } from "../../app-types"
import type { Project } from "../../ProjectsView"
import type { FactoryRunDetail } from "../factory/types"
import type { ContextMenuTarget } from "./SidebarContextMenu"

type AppSidebarProps = {
  screen: Screen
  newSessionOpen: boolean
  activeSession: Conversation
  selectedProjectId: string | null
  expandedProjects: string[]
  projects: Project[]
  visibleProjects: Project[]
  codingTasks: Conversation[]
  ungroupedTasks: Conversation[]
  generalChats: Conversation[]
  personalChats: Conversation[]
  archivedProjects: Project[]
  archivedSessions: Conversation[]
  archivedIds: string[]
  pinnedIds: string[]
  unreadIds: string[]
  factoryRuns: FactoryRunDetail[]
  openStreamIdsByProject: Record<string, string[]>
  focusedStreamId: string | null
  runtime: RuntimeHealth | null
  activeEnvironmentName: string
  sseConnected: boolean
  renamingId: string | null
  renameText: string
  onStartRename: (sess: Conversation) => void
  onChangeRenameText: (text: string) => void
  onCancelRename: () => void
  onSubmitRename: (sess: Conversation) => Promise<void>
  onOpenNewSession: (projectId?: string) => void
  onOpenCommandCenter: () => void
  onOpenProjectsIndex: () => void
  onOpenAddProject: () => void
  onOpenProject: (projectId: string, openSettings?: boolean) => void
  onToggleExpandProject: (projectId: string) => void
  onSelectProjectStream: (projectId: string, streamId: string, sessionId?: string) => void
  onMaximizeSession: (sessionId: string) => void
  onSelectSession: (sessionId: string) => void
  onCreateChatThread: (mode: "coding" | "personal") => void
  onToggleArchive: (id: string, archivedNow?: boolean) => void
  onOpenContextMenu: (target: ContextMenuTarget) => void
  onOpenScreen: (screen: "factory" | "worktrees" | "settings") => void
  onOpenBrowser: () => void
  onOpenEnvironmentPalette: () => void
}

export function AppSidebar({
  screen,
  newSessionOpen,
  activeSession,
  selectedProjectId,
  expandedProjects,
  projects,
  visibleProjects,
  codingTasks,
  ungroupedTasks,
  generalChats,
  personalChats,
  archivedProjects,
  archivedSessions,
  archivedIds,
  pinnedIds,
  unreadIds,
  factoryRuns,
  openStreamIdsByProject,
  focusedStreamId,
  runtime,
  activeEnvironmentName,
  sseConnected,
  renamingId,
  renameText,
  onStartRename,
  onChangeRenameText,
  onCancelRename,
  onSubmitRename,
  onOpenNewSession,
  onOpenCommandCenter,
  onOpenProjectsIndex,
  onOpenAddProject,
  onOpenProject,
  onToggleExpandProject,
  onSelectProjectStream,
  onMaximizeSession,
  onSelectSession,
  onCreateChatThread,
  onToggleArchive,
  onOpenContextMenu,
  onOpenScreen,
  onOpenBrowser,
  onOpenEnvironmentPalette,
}: AppSidebarProps) {
  const [sidebarOpen, setSidebarOpen] = useState(() => matchMedia("(min-width: 720px)").matches)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("ade.sidebar-width"))
    return saved >= 200 && saved <= 360 ? saved : 254
  })
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const sidebarDragging = useRef(false)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!sidebarDragging.current) return
      const next = Math.min(360, Math.max(200, e.clientX))
      setSidebarWidth(next)
      localStorage.setItem("ade.sidebar-width", String(Math.round(next)))
    }
    const onUp = () => { sidebarDragging.current = false }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [])

  const sortPinnedFirst = (list: Conversation[]) =>
    [...list].sort((a, b) => Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)))

  if (!sidebarOpen) {
    return (
      <div className="flex flex-col items-center gap-2 py-3 px-1.5 border-r border-[rgb(var(--border))] bg-[rgb(var(--nav))]">
        <button type="button" className="ade-icon-btn" onClick={() => setSidebarOpen(true)} title="Expand sidebar">
          <PanelLeft className="size-4" />
        </button>
        <button type="button" className="ade-icon-btn" onClick={() => onOpenNewSession()} title="New session">
          <Plus className="size-4" />
        </button>
        <button type="button" className="ade-icon-btn" onClick={onOpenCommandCenter} title="Command Center (Cmd+K)">
          <Search className="size-4" />
        </button>
        <button type="button" className="ade-icon-btn" onClick={() => onOpenScreen("factory")} title="Software Factory">
          <Workflow className="size-4" />
        </button>
        <button type="button" className="ade-icon-btn" onClick={onOpenBrowser} title="Built-in Browser">
          <Globe className="size-4" />
        </button>
        <button type="button" className="ade-icon-btn mt-auto" onClick={() => onOpenScreen("settings")} title="Settings">
          <Settings2 className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <>
      <aside className="ade-sidebar" style={{ width: `${sidebarWidth}px` }} aria-label="Workspace navigation">
        <div className="ade-sidebar-top">
          <div className="ade-brand-row">
            <div className="ade-brand-badge">A</div>
            <div className="ade-truncate">
              <div className="ade-brand-title">ADE</div>
            </div>
          </div>
          <button type="button" className="ade-icon-btn" onClick={() => setSidebarOpen(false)} title="Collapse sidebar">
            <PanelLeft className="size-4" />
          </button>
        </div>

        <div className="ade-sidebar-actions">
          <button type="button" className="ade-new-session-btn" onClick={() => onOpenNewSession()}>
            <Plus className="size-3.5" /> New session
          </button>
          <button type="button" className="ade-search-trigger" onClick={onOpenCommandCenter} title="Command Center (Cmd+K)">
            <Search className="size-3.5" />
            <kbd className="ade-kbd">⌘K</kbd>
          </button>
        </div>

        <div className="ade-sidebar-scroll">
          {/* Projects & Streams */}
          <div>
            <div className="ade-nav-section-head">
              <button
                type="button"
                className="bg-transparent border-0 p-0 text-inherit uppercase tracking-wider font-semibold"
                onClick={onOpenProjectsIndex}
              >
                Projects
              </button>
              <button
                type="button"
                className="ade-icon-btn"
                onClick={onOpenAddProject}
                title="Add project (GitHub, Git URL, local folder, or new)"
              >
                <Plus className="size-3.5" />
              </button>
            </div>

            <div className="ade-nav-list">
              {visibleProjects.map(project => {
                const expanded = expandedProjects.includes(project.id)
                const projectSessions = sortPinnedFirst(
                  codingTasks.filter(s => s.projectId === project.id && !archivedIds.includes(s.id)),
                )
                const projectRuns = factoryRuns.filter(r => r.run.projectId === project.id)
                const openPanes = openStreamIdsByProject[project.id] ?? []
                return (
                  <div key={project.id}>
                    <div
                      className={`ade-nav-row ${screen === "project" && selectedProjectId === project.id ? "is-selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenProject(project.id, false)}
                      onContextMenu={e => {
                        e.preventDefault()
                        onOpenContextMenu({ kind: "project", project, x: e.clientX, y: e.clientY })
                      }}
                      onKeyDown={e => { if (e.key === "Enter") onOpenProject(project.id, false) }}
                    >
                      <button
                        type="button"
                        className="ade-icon-btn !w-5 !h-5"
                        onClick={e => {
                          e.stopPropagation()
                          onToggleExpandProject(project.id)
                        }}
                        aria-label={expanded ? "Collapse project" : "Expand project"}
                      >
                        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                      <Folder className="size-3.5 shrink-0 opacity-75" />
                      <span className="ade-truncate flex-1">{project.name}</span>
                      <div className="ade-nav-row-actions">
                        <button
                          type="button"
                          className="ade-icon-btn !w-5 !h-5"
                          title={`New stream in ${project.name}`}
                          onClick={e => {
                            e.stopPropagation()
                            onOpenNewSession(project.id)
                          }}
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        {projectSessions.map(sess => {
                          const isUnreadItem = unreadIds.includes(sess.id)
                          const isPinnedItem = pinnedIds.includes(sess.id)
                          const inPane = screen === "project" && selectedProjectId === project.id && (openPanes.includes(sess.id) || openPanes.length === 0)
                          return (
                            <div
                              key={sess.id}
                              className={`ade-nav-row ade-nav-row-child ${
                                (screen === "work" && !newSessionOpen && activeSession.id === sess.id) ||
                                (screen === "project" && selectedProjectId === project.id && focusedStreamId === sess.id)
                                  ? "is-selected"
                                  : ""
                              }`}
                              role="button"
                              tabIndex={0}
                              onClick={() => onSelectProjectStream(project.id, sess.id, sess.id)}
                              onContextMenu={e => {
                                e.preventDefault()
                                onOpenContextMenu({ kind: "session", session: sess, x: e.clientX, y: e.clientY })
                              }}
                              onKeyDown={e => {
                                if (e.key === "Enter") onSelectProjectStream(project.id, sess.id, sess.id)
                              }}
                            >
                              <span className={`ade-dot ade-dot-${sess.status === "working" ? "running" : sess.workspace?.status === "attention" ? "failed" : "completed"}`} />
                              {renamingId === sess.id ? (
                                <input
                                  className="ade-input-sm !h-6 flex-1"
                                  autoFocus
                                  value={renameText}
                                  onClick={e => e.stopPropagation()}
                                  onChange={e => onChangeRenameText(e.target.value)}
                                  onBlur={() => void onSubmitRename(sess)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") void onSubmitRename(sess)
                                    if (e.key === "Escape") onCancelRename()
                                  }}
                                />
                              ) : (
                                <>
                                  {isPinnedItem ? <Pin className="size-3 shrink-0 opacity-60" /> : null}
                                  <span className={`ade-truncate flex-1 ${isUnreadItem ? "font-semibold" : ""}`}>{sess.label}</span>
                                  {inPane ? <span className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--primary))] shrink-0" title="Open in middle pane" /> : null}
                                  <div className="ade-nav-row-actions">
                                    <button
                                      type="button"
                                      className="ade-icon-btn !w-5 !h-5"
                                      title="Open full workspace"
                                      onClick={e => {
                                        e.stopPropagation()
                                        onMaximizeSession(sess.id)
                                      }}
                                    >
                                      <Maximize2 className="size-3" />
                                    </button>
                                    <button
                                      type="button"
                                      className="ade-icon-btn !w-5 !h-5"
                                      title="Rename stream"
                                      onClick={e => {
                                        e.stopPropagation()
                                        onStartRename(sess)
                                      }}
                                    >
                                      <Pencil className="size-3" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )
                        })}

                        {projectRuns.map(runDetail => {
                          const streamKey = `factory:${runDetail.run.runId}`
                          return (
                            <div
                              key={streamKey}
                              className={`ade-nav-row ade-nav-row-child ${screen === "project" && selectedProjectId === project.id && focusedStreamId === streamKey ? "is-selected" : ""}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => onSelectProjectStream(project.id, streamKey)}
                              onKeyDown={e => {
                                if (e.key === "Enter") onSelectProjectStream(project.id, streamKey)
                              }}
                            >
                              <span
                                className={`ade-dot ade-dot-${
                                  runDetail.run.status === "running"
                                    ? "running"
                                    : runDetail.run.status === "completed"
                                      ? "completed"
                                      : runDetail.run.status === "failed"
                                        ? "failed"
                                        : "waiting"
                                }`}
                              />
                              <Workflow className="size-3 shrink-0 opacity-70" />
                              <span className="ade-truncate flex-1">
                                {runDetail.run.issueRef?.number ? `#${runDetail.run.issueRef.number} ` : ""}
                                {runDetail.run.issueRef?.title || runDetail.taskPrompt || runDetail.run.runId.slice(0, 8)}
                              </span>
                            </div>
                          )
                        })}

                        <button
                          type="button"
                          className="ade-nav-row ade-nav-row-child opacity-60 hover:opacity-100"
                          onClick={() => onOpenNewSession(project.id)}
                        >
                          <Plus className="size-3 shrink-0" />
                          <span className="ade-truncate">New stream</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}

              {ungroupedTasks.map(sess => (
                <div
                  key={sess.id}
                  className={`ade-nav-row ${screen === "work" && !newSessionOpen && activeSession.id === sess.id ? "is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSession(sess.id)}
                  onContextMenu={e => {
                    e.preventDefault()
                    onOpenContextMenu({ kind: "session", session: sess, x: e.clientX, y: e.clientY })
                  }}
                  onKeyDown={e => { if (e.key === "Enter") onSelectSession(sess.id) }}
                >
                  <span className={`ade-dot ade-dot-${sess.status === "working" ? "running" : "completed"}`} />
                  <GitBranch className="size-3.5 shrink-0 opacity-70" />
                  {renamingId === sess.id ? (
                    <input
                      className="ade-input-sm !h-6 flex-1"
                      autoFocus
                      value={renameText}
                      onClick={e => e.stopPropagation()}
                      onChange={e => onChangeRenameText(e.target.value)}
                      onBlur={() => void onSubmitRename(sess)}
                      onKeyDown={e => {
                        if (e.key === "Enter") void onSubmitRename(sess)
                        if (e.key === "Escape") onCancelRename()
                      }}
                    />
                  ) : (
                    <span className={`ade-truncate flex-1 ${unreadIds.includes(sess.id) ? "font-semibold" : ""}`}>{sess.label}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Direct Chats */}
          <div>
            <div className="ade-nav-section-head">
              <span>Chats</span>
              <div className="flex items-center gap-0.5">
                <button type="button" className="ade-icon-btn" title="New coding chat" onClick={() => onCreateChatThread("coding")}>
                  <Plus className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="ade-nav-list">
              {[...generalChats, ...personalChats].map(sess => {
                const isPersonal = sess.mode === "personal"
                const isPinnedItem = pinnedIds.includes(sess.id)
                const isUnreadItem = unreadIds.includes(sess.id)
                return (
                  <div
                    key={sess.id}
                    role="button"
                    tabIndex={0}
                    className={`ade-nav-row ${screen === "work" && !newSessionOpen && activeSession.id === sess.id ? "is-selected" : ""}`}
                    onClick={() => onSelectSession(sess.id)}
                    onContextMenu={e => {
                      e.preventDefault()
                      onOpenContextMenu({ kind: "session", session: sess, x: e.clientX, y: e.clientY })
                    }}
                    onKeyDown={e => { if (e.key === "Enter") onSelectSession(sess.id) }}
                  >
                    <span className={`ade-dot ade-dot-${sess.status === "working" ? "running" : isUnreadItem ? "waiting" : "completed"}`} />
                    {isPersonal ? (
                      <MessageCircle className="size-3.5 shrink-0 opacity-70" />
                    ) : (
                      <MessageSquare className="size-3.5 shrink-0 opacity-70" />
                    )}
                    {renamingId === sess.id ? (
                      <input
                        className="ade-input-sm !h-6 flex-1"
                        autoFocus
                        value={renameText}
                        onClick={e => e.stopPropagation()}
                        onChange={e => onChangeRenameText(e.target.value)}
                        onBlur={() => void onSubmitRename(sess)}
                        onKeyDown={e => {
                          if (e.key === "Enter") void onSubmitRename(sess)
                          if (e.key === "Escape") onCancelRename()
                        }}
                      />
                    ) : (
                      <>
                        <span className={`ade-truncate flex-1 ${isUnreadItem ? "font-semibold" : ""}`}>{sess.label}</span>
                        {isPinnedItem ? <Pin className="size-3 shrink-0 opacity-55" /> : null}
                      </>
                    )}
                  </div>
                )
              })}

              {archivedProjects.length + archivedSessions.length > 0 ? (
                <div className="mt-1 ade-archived-section">
                  <button
                    type="button"
                    className="ade-nav-row opacity-60 hover:opacity-100 !text-[11.5px]"
                    aria-expanded={archivedExpanded}
                    onClick={() => setArchivedExpanded(v => !v)}
                  >
                    <Archive className="size-3 shrink-0" />
                    <span className="flex-1">Archived ({archivedProjects.length + archivedSessions.length})</span>
                    {archivedExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  </button>
                  {archivedExpanded ? <>
                    {archivedProjects.map(project => (
                      <div key={project.id} className="ade-nav-row ade-nav-row-child ade-archived-row">
                        <FolderGit2 className="size-3 shrink-0 opacity-60" />
                        <span className="ade-truncate flex-1 opacity-70">{project.name}</span>
                        <button type="button" className="ade-archived-restore" aria-label={`Restore project ${project.name}`} onClick={() => onToggleArchive(`project:${project.id}`, true)}>Restore</button>
                      </div>
                    ))}
                    {archivedSessions.map(sess => {
                      const projectName = projects.find(p => p.id === sess.projectId)?.name
                      return (
                        <div
                          key={sess.id}
                          role="button"
                          tabIndex={0}
                          className="ade-nav-row ade-nav-row-child ade-archived-row"
                          title={sess.workspace?.removed ? "Worktree removed — restoring recreates it from its branch" : undefined}
                          onClick={() => onSelectSession(sess.id)}
                          onContextMenu={e => {
                            e.preventDefault()
                            onOpenContextMenu({ kind: "session", session: sess, x: e.clientX, y: e.clientY })
                          }}
                        >
                          {sess.chatThread ? <MessageSquare className="size-3 shrink-0 opacity-60" /> : <GitBranch className="size-3 shrink-0 opacity-60" />}
                          <span className="ade-truncate flex-1 opacity-70">{sess.label}{projectName ? <small className="opacity-60"> · {projectName}</small> : null}</span>
                          <button type="button" className="ade-archived-restore" aria-label={`Restore ${sess.label}`} onClick={event => { event.stopPropagation(); onToggleArchive(sess.id, true) }}>Restore</button>
                        </div>
                      )
                    })}
                  </> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="ade-sidebar-footer">
          <button
            type="button"
            className={`ade-nav-row ${screen === "factory" ? "is-selected" : ""}`}
            onClick={() => onOpenScreen("factory")}
          >
            <Workflow className="size-3.5 opacity-75" />
            <span>Software Factory</span>
          </button>
          <button
            type="button"
            className={`ade-nav-row ${screen === "worktrees" ? "is-selected" : ""}`}
            onClick={() => onOpenScreen("worktrees")}
          >
            <FolderGit2 className="size-3.5 opacity-75" />
            <span>Worktrees</span>
          </button>
          <button type="button" className="ade-nav-row" onClick={onOpenBrowser}>
            <Globe className="size-3.5 opacity-75" />
            <span>Built-in Browser</span>
          </button>
          <button
            type="button"
            className={`ade-nav-row ${screen === "settings" ? "is-selected" : ""}`}
            onClick={() => onOpenScreen("settings")}
          >
            <Settings2 className="size-3.5 opacity-75" />
            <span>Settings &amp; MCP</span>
          </button>
          <button
            type="button"
            className="ade-host-status w-full text-left cursor-pointer"
            onClick={onOpenEnvironmentPalette}
            title="Switch environment (This device / SSH / Remote)"
          >
            <span className={`ade-dot ${runtime?.online ? "ade-dot-completed" : "ade-dot-waiting"}`} />
            <Server className="size-3 shrink-0" />
            <span className="ade-truncate flex-1">{activeEnvironmentName}</span>
            {sseConnected ? <span className="ade-pill ade-pill-ok !text-[9.5px] !py-0">live</span> : null}
          </button>
        </div>
      </aside>
      <div
        className="ade-split-divider"
        onPointerDown={() => { sidebarDragging.current = true }}
        title="Drag to resize sidebar"
      />
    </>
  )
}
