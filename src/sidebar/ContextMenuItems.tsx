import { ChevronRight } from "lucide-react"
import type { Conversation } from "../../app-types"
import type { Project } from "../../ProjectsView"

export type SubmenuKind = "open-in" | "section" | "under" | null

const EXTERNAL_APPS = [
  ["cursor", "Cursor", "3"],
  ["vscode", "VS Code", "4"],
  ["windsurf", "Windsurf", "5"],
  ["finder", "Finder", "6"],
] as const

export function ProjectContextMenuItems({
  project,
  archived,
  submenu,
  flipSub,
  onSetSubmenu,
  onClose,
  onNewProjectStream,
  onOpenExternalApp,
  onOpenProjectSettings,
  onToggleArchiveProject,
  onDeleteProject,
}: {
  project: Project
  archived: boolean
  submenu: SubmenuKind
  flipSub: boolean
  onSetSubmenu: (next: SubmenuKind | ((prev: SubmenuKind) => SubmenuKind)) => void
  onClose: () => void
  onNewProjectStream: (project: Project) => void
  onOpenExternalApp: (app: "cursor" | "vscode" | "windsurf" | "finder", path?: string | null) => void
  onOpenProjectSettings: (project: Project) => void
  onToggleArchiveProject: (project: Project) => void
  onDeleteProject: (project: Project) => void
}) {
  return (
    <>
      <button type="button" className="ade-ctx-item" role="menuitem" onClick={() => { onNewProjectStream(project); onClose() }}>
        <span>New stream</span>
        <span className="ade-ctx-shortcut">N</span>
      </button>

      <div
        className={`ade-ctx-item ${submenu === "open-in" ? "is-open" : ""}`}
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => onSetSubmenu("open-in")}
        onClick={() => onSetSubmenu(s => (s === "open-in" ? null : "open-in"))}
      >
        <span>Open in</span>
        <ChevronRight className="size-3.5 opacity-60" />
        {submenu === "open-in" ? (
          <div className={`ade-ctx-submenu ${flipSub ? "align-left" : ""}`} onClick={e => e.stopPropagation()}>
            <div className="ade-ctx-section-label">Open in</div>
            {EXTERNAL_APPS.map(([app, label, num]) => (
              <button key={app} type="button" className="ade-ctx-item" onClick={() => { onOpenExternalApp(app, project.repository); onClose() }}>
                <span>{label}</span>
                <span className="ade-ctx-shortcut">{num}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <button type="button" className="ade-ctx-item" role="menuitem" onClick={() => { onOpenProjectSettings(project); onClose() }}>
        <span>Project settings</span>
        <span className="ade-ctx-shortcut">S</span>
      </button>

      <div className="ade-ctx-divider" />

      <button type="button" className="ade-ctx-item" role="menuitem" onClick={() => { onToggleArchiveProject(project); onClose() }}>
        <span>{archived ? "Restore" : "Archive"}</span>
        <span className="ade-ctx-shortcut">A</span>
      </button>

      <button type="button" className="ade-ctx-item is-danger" role="menuitem" onClick={() => { onDeleteProject(project); onClose() }}>
        <span>Delete</span>
        <span className="ade-ctx-shortcut">D</span>
      </button>
    </>
  )
}

export function SessionContextMenuItems({
  sess,
  projects,
  pinned,
  unread,
  archived,
  submenu,
  flipSub,
  onSetSubmenu,
  onClose,
  onOpenSplitView,
  onOpenNewWindow,
  onOpenExternalApp,
  onContinueInCloud,
  onTogglePin,
  onToggleUnread,
  onRenameSession,
  onForkSession,
  onMoveToSection,
  onMoveUnderProject,
  onToggleArchiveSession,
  onDeleteSession,
}: {
  sess: Conversation
  projects: Project[]
  pinned: boolean
  unread: boolean
  archived: boolean
  submenu: SubmenuKind
  flipSub: boolean
  onSetSubmenu: (next: SubmenuKind | ((prev: SubmenuKind) => SubmenuKind)) => void
  onClose: () => void
  onOpenSplitView: (session: Conversation) => void
  onOpenNewWindow: (session: Conversation) => void
  onOpenExternalApp: (app: "cursor" | "vscode" | "windsurf" | "finder", path?: string | null) => void
  onContinueInCloud: (session: Conversation) => void
  onTogglePin: (id: string) => void
  onToggleUnread: (id: string) => void
  onRenameSession: (session: Conversation) => void
  onForkSession: (session: Conversation) => void
  onMoveToSection: (session: Conversation, mode: "coding" | "personal") => void
  onMoveUnderProject: (session: Conversation, projectId: string | null) => void
  onToggleArchiveSession: (id: string) => void
  onDeleteSession: (session: Conversation) => void
}) {
  const canDelete = sess.id !== "coding" && sess.id !== "personal"
  const canRename = sess.id !== "coding" && sess.id !== "personal"
  const workspacePath = projects.find(p => p.id === sess.projectId)?.repository ?? sess.workspace?.path ?? null

  return (
    <>
      <div
        className={`ade-ctx-item ${submenu === "open-in" ? "is-open" : ""}`}
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => onSetSubmenu("open-in")}
        onClick={() => onSetSubmenu(s => (s === "open-in" ? null : "open-in"))}
      >
        <span>Open in</span>
        <ChevronRight className="size-3.5 opacity-60" />
        {submenu === "open-in" ? (
          <div className={`ade-ctx-submenu ${flipSub ? "align-left" : ""}`} onClick={e => e.stopPropagation()}>
            <button type="button" className="ade-ctx-item" onClick={() => { onOpenSplitView(sess); onClose() }}>
              <span>Split view</span>
              <span className="ade-ctx-shortcut">1</span>
            </button>
            <button type="button" className="ade-ctx-item" onClick={() => { onOpenNewWindow(sess); onClose() }}>
              <span>New window</span>
              <span className="ade-ctx-shortcut">2</span>
            </button>
            <div className="ade-ctx-divider" />
            <div className="ade-ctx-section-label">Open in</div>
            {EXTERNAL_APPS.map(([app, label, num]) => (
              <button key={app} type="button" className="ade-ctx-item" onClick={() => { onOpenExternalApp(app, workspacePath); onClose() }}>
                <span>{label}</span>
                <span className="ade-ctx-shortcut">{num}</span>
              </button>
            ))}
            <div className="ade-ctx-divider" />
            <div className="ade-ctx-section-label">Continue in</div>
            <button type="button" className="ade-ctx-item" onClick={() => { onContinueInCloud(sess); onClose() }}>
              <div>
                <div>Cloud</div>
                <span className="ade-ctx-item-sub">Runs without your computer</span>
              </div>
              <span className="ade-ctx-shortcut">7</span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="ade-ctx-divider" />

      <button type="button" className="ade-ctx-item" role="menuitem" onMouseEnter={() => onSetSubmenu(null)} onClick={() => { onTogglePin(sess.id); onClose() }}>
        <span>{pinned ? "Unpin" : "Pin"}</span>
        <span className="ade-ctx-shortcut">P</span>
      </button>

      <button type="button" className="ade-ctx-item" role="menuitem" onMouseEnter={() => onSetSubmenu(null)} onClick={() => { onToggleUnread(sess.id); onClose() }}>
        <span>{unread ? "Mark as read" : "Mark as unread"}</span>
        <span className="ade-ctx-shortcut">U</span>
      </button>

      <button
        type="button"
        className="ade-ctx-item"
        role="menuitem"
        disabled={!canRename}
        style={!canRename ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
        onMouseEnter={() => onSetSubmenu(null)}
        onClick={() => { if (canRename) { onRenameSession(sess); onClose() } }}
      >
        <span>Rename</span>
        <span className="ade-ctx-shortcut">R</span>
      </button>

      <button type="button" className="ade-ctx-item" role="menuitem" onMouseEnter={() => onSetSubmenu(null)} onClick={() => { onForkSession(sess); onClose() }}>
        <span>Fork</span>
        <span className="ade-ctx-shortcut">F</span>
      </button>

      <div className="ade-ctx-divider" />

      <div
        className={`ade-ctx-item ${submenu === "section" ? "is-open" : ""}`}
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => onSetSubmenu("section")}
        onClick={() => onSetSubmenu(s => (s === "section" ? null : "section"))}
      >
        <span>Move to section</span>
        <ChevronRight className="size-3.5 opacity-60" />
        {submenu === "section" ? (
          <div className={`ade-ctx-submenu ${flipSub ? "align-left" : ""}`} onClick={e => e.stopPropagation()}>
            <button type="button" className="ade-ctx-item" onClick={() => { onMoveToSection(sess, "coding"); onClose() }}>
              <span>Coding chats</span>
              {sess.mode === "coding" ? <span className="ade-ctx-shortcut">✓</span> : null}
            </button>
            <button type="button" className="ade-ctx-item" onClick={() => { onMoveToSection(sess, "personal"); onClose() }}>
              <span>Personal chats</span>
              {sess.mode === "personal" ? <span className="ade-ctx-shortcut">✓</span> : null}
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={`ade-ctx-item ${submenu === "under" ? "is-open" : ""}`}
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => onSetSubmenu("under")}
        onClick={() => onSetSubmenu(s => (s === "under" ? null : "under"))}
      >
        <span>Move under</span>
        <ChevronRight className="size-3.5 opacity-60" />
        {submenu === "under" ? (
          <div className={`ade-ctx-submenu ${flipSub ? "align-left" : ""}`} onClick={e => e.stopPropagation()}>
            <div className="ade-ctx-section-label">Projects</div>
            {projects.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[11.5px] opacity-60">No projects yet</div>
            ) : (
              projects.map(p => (
                <button key={p.id} type="button" className="ade-ctx-item" onClick={() => { onMoveUnderProject(sess, p.id); onClose() }}>
                  <span className="ade-truncate">{p.name}</span>
                  {sess.projectId === p.id ? <span className="ade-ctx-shortcut">✓</span> : null}
                </button>
              ))
            )}
            {sess.projectId ? (
              <>
                <div className="ade-ctx-divider" />
                <button type="button" className="ade-ctx-item" onClick={() => { onMoveUnderProject(sess, null); onClose() }}>
                  <span>Ungrouped</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="ade-ctx-divider" />

      {canDelete ? (
        <button type="button" className="ade-ctx-item" role="menuitem" onMouseEnter={() => onSetSubmenu(null)} onClick={() => { onToggleArchiveSession(sess.id); onClose() }}>
          <span>{archived ? "Restore" : "Archive"}</span>
          <span className="ade-ctx-shortcut">A</span>
        </button>
      ) : null}

      <button
        type="button"
        className="ade-ctx-item is-danger"
        role="menuitem"
        disabled={!canDelete}
        style={!canDelete ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
        onMouseEnter={() => onSetSubmenu(null)}
        onClick={() => { if (canDelete) { onDeleteSession(sess); onClose() } }}
      >
        <span>Delete</span>
        <span className="ade-ctx-shortcut">D</span>
      </button>
    </>
  )
}
