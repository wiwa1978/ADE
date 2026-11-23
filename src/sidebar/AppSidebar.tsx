import { useEffect, useRef, useState } from "react"
import { FolderPlus, Inbox, PanelLeft, Search, Settings2 } from "lucide-react"
import type { Conversation, RuntimeHealth } from "../../app-types"
import type { Project } from "../../ProjectsView"
import type { FactoryRunDetail } from "../factory/types"
import type { InboxEntry } from "../session-state"
import { Sidebar, type SidebarSelection } from "./Sidebar"
import type { ContextMenuTarget } from "./SidebarContextMenu"
import { DEFAULT_KEYBINDINGS, formatShortcut, type KeybindingMap } from "../keybindings"
import type { AddProjectSource } from "../projects/AddProjectWizard"

type AppSidebarProps = {
  selection: SidebarSelection
  expandedProjects: string[]
  visibleProjects: Project[]
  codingTasks: Conversation[]
  ungroupedTasks: Conversation[]
  chats: Conversation[]
  archivedProjects: Project[]
  archivedSessions: Conversation[]
  archivedIds: string[]
  pinnedIds: string[]
  unreadIds: string[]
  factoryRuns: FactoryRunDetail[]
  inbox: Record<string, InboxEntry>
  inboxCount: number
  runtime: RuntimeHealth | null
  activeEnvironmentName: string
  sseConnected: boolean
  keybindings?: KeybindingMap
  renamingId: string | null
  renameText: string
  onChangeRenameText: (text: string) => void
  onCancelRename: () => void
  onSubmitRename: (sess: Conversation) => Promise<void>
  onOpenNewSession: (projectId?: string) => void
  onOpenCreateWorktree?: () => void
  onOpenCommandCenter: () => void
  onOpenInbox: () => void
  onOpenAddProject: (initialSource?: AddProjectSource) => void
  onMarkAllRead?: () => void
  onClearCompleted?: () => void
  onOpenProject: (projectId: string) => void
  onToggleExpandProject: (projectId: string) => void
  onOpenSession: (session: Conversation) => void
  onOpenFactoryRun: (projectId: string, runId: string) => void
  onCreateChatThread: (mode: "coding" | "personal") => void
  onToggleArchive: (id: string, archivedNow?: boolean) => void
  onOpenContextMenu: (target: ContextMenuTarget) => void
  onOpenSettings: () => void
  onOpenEnvironmentPalette: () => void
}

/** The app's left navigation: handles collapsing and resizing, and renders the Sidebar. */
export function AppSidebar(props: AppSidebarProps) {
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
    [...list].sort((a, b) => Number(props.pinnedIds.includes(b.id)) - Number(props.pinnedIds.includes(a.id)))

  const kb = props.keybindings ?? DEFAULT_KEYBINDINGS
  const searchBadge = kb.commandCenter ? formatShortcut(kb.commandCenter) : ""
  const addProjectBadge = kb.addProject ? formatShortcut(kb.addProject) : ""
  const inboxBadge = kb.openInbox ? formatShortcut(kb.openInbox) : ""
  const settingsBadge = kb.openSettings ? formatShortcut(kb.openSettings) : ""

  if (!sidebarOpen) {
    return (
      <div className="flex flex-col items-center gap-2 py-3 px-1.5 border-r border-[rgb(var(--border))] bg-[rgb(var(--nav))]">
        <button type="button" className="ade-icon-btn" onClick={() => setSidebarOpen(true)} title="Expand sidebar" aria-label="Expand sidebar">
          <PanelLeft className="size-4" />
        </button>
        <button type="button" className="ade-icon-btn" onClick={props.onOpenCommandCenter} title={searchBadge ? `Search (${searchBadge})` : "Search"} aria-label="Search">
          <Search className="size-4" />
        </button>
        <button type="button" className="ade-icon-btn" onClick={() => props.onOpenAddProject()} title={addProjectBadge ? `Add project (${addProjectBadge})` : "Add project"} aria-label="Add project">
          <FolderPlus className="size-4" />
        </button>
        <button type="button" className="ade-icon-btn relative" onClick={props.onOpenInbox} title={inboxBadge ? `Inbox (${inboxBadge})` : "Inbox"} aria-label={`Inbox, ${props.inboxCount} need you`}>
          <Inbox className="size-4" />
          {props.inboxCount > 0 ? <span className="ade-rail-badge">{props.inboxCount}</span> : null}
        </button>
        <button type="button" className="ade-icon-btn mt-auto" onClick={props.onOpenSettings} title={settingsBadge ? `Settings (${settingsBadge})` : "Settings"} aria-label="Settings">
          <Settings2 className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <>
      <Sidebar
        width={sidebarWidth}
        selection={props.selection}
        projects={props.visibleProjects}
        sessionsByProject={Object.fromEntries(props.visibleProjects.map(project => [project.id, sortPinnedFirst(props.codingTasks.filter(s => s.projectId === project.id && !props.archivedIds.includes(s.id)))]))}
        ungroupedSessions={props.ungroupedTasks}
        chats={props.chats}
        factoryRunsByProject={Object.fromEntries(props.visibleProjects.map(project => [project.id, props.factoryRuns.filter(r => r.run.projectId === project.id)]))}
        archivedProjects={props.archivedProjects}
        archivedSessions={props.archivedSessions}
        inbox={props.inbox}
        inboxCount={props.inboxCount}
        expandedProjects={props.expandedProjects}
        pinnedIds={props.pinnedIds}
        unreadIds={props.unreadIds}
        archivedExpanded={archivedExpanded}
        renamingId={props.renamingId}
        renameText={props.renameText}
        environmentName={props.activeEnvironmentName}
        runtimeOnline={Boolean(props.runtime?.online)}
        live={props.sseConnected}
        keybindings={kb}
        onCollapse={() => setSidebarOpen(false)}
        onNewSession={props.onOpenNewSession}
        onCreateWorktree={props.onOpenCreateWorktree}
        onSearch={props.onOpenCommandCenter}
        onOpenInbox={props.onOpenInbox}
        onAddProject={props.onOpenAddProject}
        onMarkAllRead={props.onMarkAllRead}
        onClearCompleted={props.onClearCompleted}
        onOpenProject={props.onOpenProject}
        onToggleProject={props.onToggleExpandProject}
        onOpenSession={props.onOpenSession}
        onOpenFactoryRun={props.onOpenFactoryRun}
        onNewChat={() => props.onCreateChatThread("coding")}
        onContextMenu={props.onOpenContextMenu}
        onRenameChange={props.onChangeRenameText}
        onRenameSubmit={sess => void props.onSubmitRename(sess)}
        onRenameCancel={props.onCancelRename}
        onToggleArchived={() => setArchivedExpanded(v => !v)}
        onRestore={id => props.onToggleArchive(id, true)}
        onOpenSettings={props.onOpenSettings}
        onOpenEnvironments={props.onOpenEnvironmentPalette}
      />
      <div
        className="ade-split-divider"
        onPointerDown={() => { sidebarDragging.current = true }}
        title="Drag to resize sidebar"
      />
    </>
  )
}
