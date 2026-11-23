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
import { useSessionTools } from "../layout/session-tools"

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

  const tools = useSessionTools().filter(tool => !tool.menuOnly)
  // The hover card beside an activity bar icon (one at a time, placed next to the icon).
  const [tip, setTip] = useState<RailTip | null>(null)
  const kb = props.keybindings ?? DEFAULT_KEYBINDINGS
  const searchBadge = kb.commandCenter ? formatShortcut(kb.commandCenter) : ""
  const addProjectBadge = kb.addProject ? formatShortcut(kb.addProject) : ""
  const inboxBadge = kb.openInbox ? formatShortcut(kb.openInbox) : ""
  const settingsBadge = kb.openSettings ? formatShortcut(kb.openSettings) : ""

  // The activity bar on the far left: always there. App places at the top, the open session's tools
  // (each opens in the side panel, again to hide it) in the middle, Settings at the bottom.
  const rail = (
    <nav className="ade-activity-bar" aria-label="Activity bar">
      <RailButton tip={setTip} label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} description="Your projects, sessions and chats" active={sidebarOpen} onClick={() => setSidebarOpen(open => !open)} ariaLabel={sidebarOpen ? "Hide sidebar" : "Expand sidebar"}>
        <PanelLeft className="size-[18px]" />
      </RailButton>
      <RailButton tip={setTip} label="Search" description="Find projects, sessions and commands" shortcut={searchBadge} onClick={props.onOpenCommandCenter}>
        <Search className="size-[18px]" />
      </RailButton>
      <RailButton tip={setTip} label="Inbox" description={props.inboxCount > 0 ? `${props.inboxCount} ${props.inboxCount === 1 ? "session needs" : "sessions need"} you` : "Every session, sorted by what needs you first"} shortcut={inboxBadge} active={props.selection.kind === "inbox"} onClick={props.onOpenInbox} ariaLabel={`Inbox, ${props.inboxCount} need you`}>
        <Inbox className="size-[18px]" />
        {props.inboxCount > 0 ? <span className="ade-rail-badge">{props.inboxCount}</span> : null}
      </RailButton>
      <RailButton tip={setTip} label="Add project" description="Add a repository or folder" shortcut={addProjectBadge} onClick={() => props.onOpenAddProject()}>
        <FolderPlus className="size-[18px]" />
      </RailButton>
      {tools.length ? <span className="ade-activity-sep" aria-hidden="true" /> : null}
      {tools.map(tool => {
        const Icon = tool.icon
        return (
          <RailButton key={tool.id} tip={setTip} label={tool.label} description={tool.description} status={tool.attention ? "Waiting for you" : tool.badge !== undefined && tool.badge !== "" ? String(tool.badge) : tool.live ? "Active" : undefined} active={tool.active} onClick={tool.onOpen}>
            <Icon className="size-[18px]" />
            {tool.attention ? <span className="ade-activity-live is-attention" aria-hidden="true" />
              : typeof tool.badge === "number" && tool.badge > 0 ? <span className="ade-rail-badge is-quiet">{tool.badge > 99 ? "99+" : tool.badge}</span>
                : tool.live ? <span className="ade-activity-live" aria-hidden="true" /> : null}
          </RailButton>
        )
      })}
      <RailButton tip={setTip} label="Settings" description="Models, agents, appearance and more" shortcut={settingsBadge} active={props.selection.kind === "settings"} onClick={props.onOpenSettings} className="mt-auto">
        <Settings2 className="size-[18px]" />
      </RailButton>
      {tip ? (
        <div className="ade-activity-tip" role="tooltip" style={{ top: tip.top }}>
          <div className="ade-activity-tip-head">
            <strong>{tip.label}</strong>
            {tip.status ? <span className="ade-activity-tip-status">{tip.status}</span> : null}
            {tip.shortcut ? <kbd>{tip.shortcut}</kbd> : null}
          </div>
          <span>{tip.description}</span>
        </div>
      ) : null}
    </nav>
  )

  if (!sidebarOpen) return rail

  return (
    <>
      {rail}
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

type RailTip = { label: string; description: string; shortcut?: string; status?: string; top: number }

/** An activity bar icon with a hover card: its name, what it does, its shortcut and status. */
function RailButton({ tip, label, description, shortcut, status, active = false, onClick, ariaLabel, className = "", children }: {
  tip: (next: RailTip | null) => void
  label: string
  description: string
  shortcut?: string
  status?: string
  active?: boolean
  onClick: () => void
  ariaLabel?: string
  className?: string
  children: React.ReactNode
}) {
  const show = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    tip({ label, description, shortcut, status, top: rect.top + rect.height / 2 })
  }
  return (
    <button
      type="button"
      className={`ade-activity-btn ${active ? "is-active" : ""} ${className}`}
      onClick={() => { tip(null); onClick() }}
      onMouseEnter={event => show(event.currentTarget)}
      onMouseLeave={() => tip(null)}
      onFocus={event => show(event.currentTarget)}
      onBlur={() => tip(null)}
      aria-label={ariaLabel ?? label}
      aria-description={description}
      aria-pressed={active}
      data-shortcut={shortcut || undefined}
    >
      {children}
    </button>
  )
}
