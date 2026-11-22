import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import type { Conversation } from "../../app-types"
import type { Project } from "../../ProjectsView"

export type ContextMenuTarget =
  | { kind: "session"; session: Conversation; x: number; y: number }
  | { kind: "project"; project: Project; x: number; y: number }

export function SidebarContextMenu({
  target,
  projects,
  isPinned,
  isUnread,
  isArchived,
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
  onNewProjectStream,
  onOpenProjectSettings,
  onToggleArchiveProject,
  onDeleteProject,
}: {
  target: ContextMenuTarget | null
  projects: Project[]
  isPinned: (id: string) => boolean
  isUnread: (id: string) => boolean
  isArchived: (id: string) => boolean
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
  onNewProjectStream: (project: Project) => void
  onOpenProjectSettings: (project: Project) => void
  onToggleArchiveProject: (project: Project) => void
  onDeleteProject: (project: Project) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [submenu, setSubmenu] = useState<"open-in" | "section" | "under" | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number; flipSub: boolean }>({
    left: target?.x ?? 0,
    top: target?.y ?? 0,
    flipSub: false,
  })

  useLayoutEffect(() => {
    if (!target) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const rect = menuRef.current?.getBoundingClientRect()
    const w = rect?.width ?? 220
    const h = rect?.height ?? 320
    const left = Math.min(target.x, Math.max(8, vw - w - 8))
    const top = Math.min(target.y, Math.max(8, vh - h - 8))
    const flipSub = left + w + 230 > vw
    setPos({ left, top, flipSub })
  }, [target])

  useEffect(() => {
    if (!target) {
      setSubmenu(null)
      return
    }
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (target.kind !== "session") return
      const key = e.key.toLowerCase()
      const sess = target.session
      const projectPath = projects.find(p => p.id === sess.projectId)?.repository ?? sess.workspace?.path ?? null
      if (submenu === "open-in") {
        if (key === "1") { e.preventDefault(); onOpenSplitView(sess); onClose() }
        else if (key === "2") { e.preventDefault(); onOpenNewWindow(sess); onClose() }
        else if (key === "3") { e.preventDefault(); onOpenExternalApp("cursor", projectPath); onClose() }
        else if (key === "4") { e.preventDefault(); onOpenExternalApp("vscode", projectPath); onClose() }
        else if (key === "5") { e.preventDefault(); onOpenExternalApp("windsurf", projectPath); onClose() }
        else if (key === "6") { e.preventDefault(); onOpenExternalApp("finder", projectPath); onClose() }
        else if (key === "7") { e.preventDefault(); onContinueInCloud(sess); onClose() }
        return
      }
      if (key === "p") { e.preventDefault(); onTogglePin(sess.id); onClose() }
      else if (key === "u") { e.preventDefault(); onToggleUnread(sess.id); onClose() }
      else if (key === "r") { e.preventDefault(); onRenameSession(sess); onClose() }
      else if (key === "f") { e.preventDefault(); onForkSession(sess); onClose() }
      else if (key === "a") { e.preventDefault(); onToggleArchiveSession(sess.id); onClose() }
      else if (key === "d") { e.preventDefault(); onDeleteSession(sess); onClose() }
    }
    window.addEventListener("mousedown", onMouseDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [
    target,
    submenu,
    projects,
    onClose,
    onOpenSplitView,
    onOpenNewWindow,
    onOpenExternalApp,
    onContinueInCloud,
    onTogglePin,
    onToggleUnread,
    onRenameSession,
    onForkSession,
    onToggleArchiveSession,
    onDeleteSession,
  ])

  if (!target) return null

  if (target.kind === "project") {
    const project = target.project
    const archived = isArchived(`project:${project.id}`)
    return (
      <div
        ref={menuRef}
        className="ade-ctx-menu"
        style={{ left: pos.left, top: pos.top }}
        role="menu"
        aria-label={`Actions for ${project.name}`}
      >
        <button
          type="button"
          className="ade-ctx-item"
          role="menuitem"
          onClick={() => { onNewProjectStream(project); onClose() }}
        >
          <span>New stream</span>
          <span className="ade-ctx-shortcut">N</span>
        </button>

        <div
          className={`ade-ctx-item ${submenu === "open-in" ? "is-open" : ""}`}
          role="menuitem"
          tabIndex={0}
          onMouseEnter={() => setSubmenu("open-in")}
          onClick={() => setSubmenu(s => (s === "open-in" ? null : "open-in"))}
        >
          <span>Open in</span>
          <ChevronRight className="size-3.5 opacity-60" />
          {submenu === "open-in" ? (
            <div className={`ade-ctx-submenu ${pos.flipSub ? "align-left" : ""}`} onClick={e => e.stopPropagation()}>
              <div className="ade-ctx-section-label">Open in</div>
              {(
                [
                  ["cursor", "Cursor", "3"],
                  ["vscode", "VS Code", "4"],
                  ["windsurf", "Windsurf", "5"],
                  ["finder", "Finder", "6"],
                ] as const
              ).map(([app, label, num]) => (
                <button
                  key={app}
                  type="button"
                  className="ade-ctx-item"
                  onClick={() => { onOpenExternalApp(app, project.repository); onClose() }}
                >
                  <span>{label}</span>
                  <span className="ade-ctx-shortcut">{num}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="ade-ctx-item"
          role="menuitem"
          onClick={() => { onOpenProjectSettings(project); onClose() }}
        >
          <span>Project settings</span>
          <span className="ade-ctx-shortcut">S</span>
        </button>

        <div className="ade-ctx-divider" />

        <button
          type="button"
          className="ade-ctx-item"
          role="menuitem"
          onClick={() => { onToggleArchiveProject(project); onClose() }}
        >
          <span>{archived ? "Unarchive" : "Archive"}</span>
          <span className="ade-ctx-shortcut">A</span>
        </button>

        <button
          type="button"
          className="ade-ctx-item is-danger"
          role="menuitem"
          onClick={() => { onDeleteProject(project); onClose() }}
        >
          <span>Delete</span>
          <span className="ade-ctx-shortcut">D</span>
        </button>
      </div>
    )
  }

  const sess = target.session
  const pinned = isPinned(sess.id)
  const unread = isUnread(sess.id)
  const archived = isArchived(sess.id)
  const canDelete = sess.id !== "coding" && sess.id !== "personal"
  const canRename = sess.id !== "coding" && sess.id !== "personal"
  const workspacePath = projects.find(p => p.id === sess.projectId)?.repository ?? sess.workspace?.path ?? null

  return (
    <div
      ref={menuRef}
      className="ade-ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      aria-label={`Actions for ${sess.label}`}
    >
      {/* Open in ▸ */}
      <div
        className={`ade-ctx-item ${submenu === "open-in" ? "is-open" : ""}`}
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => setSubmenu("open-in")}
        onClick={() => setSubmenu(s => (s === "open-in" ? null : "open-in"))}
      >
        <span>Open in</span>
        <ChevronRight className="size-3.5 opacity-60" />
        {submenu === "open-in" ? (
          <div className={`ade-ctx-submenu ${pos.flipSub ? "align-left" : ""}`} onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="ade-ctx-item"
              onClick={() => { onOpenSplitView(sess); onClose() }}
            >
              <span>Split view</span>
              <span className="ade-ctx-shortcut">1</span>
            </button>
            <button
              type="button"
              className="ade-ctx-item"
              onClick={() => { onOpenNewWindow(sess); onClose() }}
            >
              <span>New window</span>
              <span className="ade-ctx-shortcut">2</span>
            </button>
            <div className="ade-ctx-divider" />
            <div className="ade-ctx-section-label">Open in</div>
            <button
              type="button"
              className="ade-ctx-item"
              onClick={() => { onOpenExternalApp("cursor", workspacePath); onClose() }}
            >
              <span>Cursor</span>
              <span className="ade-ctx-shortcut">3</span>
            </button>
            <button
              type="button"
              className="ade-ctx-item"
              onClick={() => { onOpenExternalApp("vscode", workspacePath); onClose() }}
            >
              <span>VS Code</span>
              <span className="ade-ctx-shortcut">4</span>
            </button>
            <button
              type="button"
              className="ade-ctx-item"
              onClick={() => { onOpenExternalApp("windsurf", workspacePath); onClose() }}
            >
              <span>Windsurf</span>
              <span className="ade-ctx-shortcut">5</span>
            </button>
            <button
              type="button"
              className="ade-ctx-item"
              onClick={() => { onOpenExternalApp("finder", workspacePath); onClose() }}
            >
              <span>Finder</span>
              <span className="ade-ctx-shortcut">6</span>
            </button>
            <div className="ade-ctx-divider" />
            <div className="ade-ctx-section-label">Continue in</div>
            <button
              type="button"
              className="ade-ctx-item"
              onClick={() => { onContinueInCloud(sess); onClose() }}
            >
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

      <button
        type="button"
        className="ade-ctx-item"
        role="menuitem"
        onMouseEnter={() => setSubmenu(null)}
        onClick={() => { onTogglePin(sess.id); onClose() }}
      >
        <span>{pinned ? "Unpin" : "Pin"}</span>
        <span className="ade-ctx-shortcut">P</span>
      </button>

      <button
        type="button"
        className="ade-ctx-item"
        role="menuitem"
        onMouseEnter={() => setSubmenu(null)}
        onClick={() => { onToggleUnread(sess.id); onClose() }}
      >
        <span>{unread ? "Mark as read" : "Mark as unread"}</span>
        <span className="ade-ctx-shortcut">U</span>
      </button>

      <button
        type="button"
        className="ade-ctx-item"
        role="menuitem"
        disabled={!canRename}
        style={!canRename ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
        onMouseEnter={() => setSubmenu(null)}
        onClick={() => { if (canRename) { onRenameSession(sess); onClose() } }}
      >
        <span>Rename</span>
        <span className="ade-ctx-shortcut">R</span>
      </button>

      <button
        type="button"
        className="ade-ctx-item"
        role="menuitem"
        onMouseEnter={() => setSubmenu(null)}
        onClick={() => { onForkSession(sess); onClose() }}
      >
        <span>Fork</span>
        <span className="ade-ctx-shortcut">F</span>
      </button>

      <div className="ade-ctx-divider" />

      {/* Move to section ▸ */}
      <div
        className={`ade-ctx-item ${submenu === "section" ? "is-open" : ""}`}
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => setSubmenu("section")}
        onClick={() => setSubmenu(s => (s === "section" ? null : "section"))}
      >
        <span>Move to section</span>
        <ChevronRight className="size-3.5 opacity-60" />
        {submenu === "section" ? (
          <div className={`ade-ctx-submenu ${pos.flipSub ? "align-left" : ""}`} onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="ade-ctx-item"
              onClick={() => { onMoveToSection(sess, "coding"); onClose() }}
            >
              <span>Coding chats</span>
              {sess.mode === "coding" ? <span className="ade-ctx-shortcut">✓</span> : null}
            </button>
            <button
              type="button"
              className="ade-ctx-item"
              onClick={() => { onMoveToSection(sess, "personal"); onClose() }}
            >
              <span>Personal chats</span>
              {sess.mode === "personal" ? <span className="ade-ctx-shortcut">✓</span> : null}
            </button>
          </div>
        ) : null}
      </div>

      {/* Move under ▸ */}
      <div
        className={`ade-ctx-item ${submenu === "under" ? "is-open" : ""}`}
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => setSubmenu("under")}
        onClick={() => setSubmenu(s => (s === "under" ? null : "under"))}
      >
        <span>Move under</span>
        <ChevronRight className="size-3.5 opacity-60" />
        {submenu === "under" ? (
          <div className={`ade-ctx-submenu ${pos.flipSub ? "align-left" : ""}`} onClick={e => e.stopPropagation()}>
            <div className="ade-ctx-section-label">Projects</div>
            {projects.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[11.5px] opacity-60">No projects yet</div>
            ) : (
              projects.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="ade-ctx-item"
                  onClick={() => { onMoveUnderProject(sess, p.id); onClose() }}
                >
                  <span className="ade-truncate">{p.name}</span>
                  {sess.projectId === p.id ? <span className="ade-ctx-shortcut">✓</span> : null}
                </button>
              ))
            )}
            {sess.projectId ? (
              <>
                <div className="ade-ctx-divider" />
                <button
                  type="button"
                  className="ade-ctx-item"
                  onClick={() => { onMoveUnderProject(sess, null); onClose() }}
                >
                  <span>Ungrouped</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="ade-ctx-divider" />

      <button
        type="button"
        className="ade-ctx-item"
        role="menuitem"
        onMouseEnter={() => setSubmenu(null)}
        onClick={() => { onToggleArchiveSession(sess.id); onClose() }}
      >
        <span>{archived ? "Unarchive" : "Archive"}</span>
        <span className="ade-ctx-shortcut">A</span>
      </button>

      <button
        type="button"
        className="ade-ctx-item is-danger"
        role="menuitem"
        disabled={!canDelete}
        style={!canDelete ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
        onMouseEnter={() => setSubmenu(null)}
        onClick={() => { if (canDelete) { onDeleteSession(sess); onClose() } }}
      >
        <span>Delete</span>
        <span className="ade-ctx-shortcut">D</span>
      </button>
    </div>
  )
}
