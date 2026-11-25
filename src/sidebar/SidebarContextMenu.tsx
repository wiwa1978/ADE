import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Conversation } from "../app-types"
import type { Project } from "../ProjectsView"
import { ProjectContextMenuItems, SessionContextMenuItems, type SubmenuKind } from "./ContextMenuItems"

export type ContextMenuTarget =
  | { kind: "session"; session: Conversation; x: number; y: number }
  | { kind: "project"; project: Project; x: number; y: number }

export function SidebarContextMenu({
  target,
  projects,
  pinShortcut = "⌥⌘P",
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
  onShowSessionArtifacts,
  onRenameSession,
  onStopSession,
  onDeleteSession,
  onNewProjectStream,
  onShowProjectArtifacts,
  onOpenProjectSettings,
  onToggleArchiveProject,
  onDeleteProject,
}: {
  target: ContextMenuTarget | null
  projects: Project[]
  pinShortcut?: string
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
  onShowSessionArtifacts: (session: Conversation) => void
  onRenameSession: (session: Conversation) => void
  onStopSession: (session: Conversation) => void
  onDeleteSession: (session: Conversation) => void
  onNewProjectStream: (project: Project) => void
  onShowProjectArtifacts: (project: Project) => void
  onOpenProjectSettings: (project: Project) => void
  onToggleArchiveProject: (project: Project) => void
  onDeleteProject: (project: Project) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [submenu, setSubmenu] = useState<SubmenuKind>(null)
  const [prevTarget, setPrevTarget] = useState(target)
  const [pos, setPos] = useState<{ left: number; top: number; flipSub: boolean }>({
    left: target?.x ?? 0,
    top: target?.y ?? 0,
    flipSub: false,
  })

  if (target !== prevTarget) {
    setPrevTarget(target)
    if (!target) setSubmenu(null)
  }

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
    if (!target) return
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return }
      const key = e.key.toLowerCase()
      if (target.kind === "project") {
        const proj = target.project
        if (key === "p") { e.preventDefault(); onTogglePin(`project:${proj.id}`); onClose() }
        else if (key === "n") { e.preventDefault(); onNewProjectStream(proj); onClose() }
        else if (key === "s") { e.preventDefault(); onOpenProjectSettings(proj); onClose() }
        else if (key === "a") { e.preventDefault(); onToggleArchiveProject(proj); onClose() }
        else if (key === "d") { e.preventDefault(); onDeleteProject(proj); onClose() }
        return
      }
      const sess = target.session
      const projectPath = projects.find(p => p.id === sess.projectId)?.repository ?? sess.workspace?.path ?? null
      if (submenu === "split") {
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
      else if (key === "s" && sess.status === "working") { e.preventDefault(); onStopSession(sess); onClose() }
      else if (key === "d" && sess.id !== "coding" && sess.id !== "personal") { e.preventDefault(); onDeleteSession(sess); onClose() }
    }
    window.addEventListener("mousedown", onMouseDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [
    target, submenu, projects, onClose, onOpenSplitView, onOpenNewWindow, onOpenExternalApp,
    onContinueInCloud, onTogglePin, onToggleUnread, onRenameSession, onStopSession,
    onDeleteSession, onNewProjectStream, onOpenProjectSettings, onToggleArchiveProject, onDeleteProject,
  ])

  if (!target) return null

  return (
    <div
      ref={menuRef}
      className="ade-ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      aria-label={`Actions for ${target.kind === "project" ? target.project.name : target.session.label}`}
    >
      {target.kind === "project" ? (
        <ProjectContextMenuItems
          project={target.project}
          pinned={isPinned(`project:${target.project.id}`)}
          pinShortcut={pinShortcut}
          archived={isArchived(`project:${target.project.id}`)}
          submenu={submenu}
          flipSub={pos.flipSub}
          onSetSubmenu={setSubmenu}
          onClose={onClose}
          onTogglePinProject={p => onTogglePin(`project:${p.id}`)}
          onNewProjectStream={onNewProjectStream}
          onShowProjectArtifacts={onShowProjectArtifacts}
          onOpenExternalApp={onOpenExternalApp}
          onOpenProjectSettings={onOpenProjectSettings}
          onToggleArchiveProject={onToggleArchiveProject}
          onDeleteProject={onDeleteProject}
        />
      ) : (
        <SessionContextMenuItems
          sess={target.session}
          projects={projects}
          pinShortcut={pinShortcut}
          pinned={isPinned(target.session.id)}
          unread={isUnread(target.session.id)}
          submenu={submenu}
          flipSub={pos.flipSub}
          onSetSubmenu={setSubmenu}
          onClose={onClose}
          onOpenSplitView={onOpenSplitView}
          onOpenNewWindow={onOpenNewWindow}
          onOpenExternalApp={onOpenExternalApp}
          onContinueInCloud={onContinueInCloud}
          onTogglePin={onTogglePin}
          onToggleUnread={onToggleUnread}
          onShowSessionArtifacts={onShowSessionArtifacts}
          onRenameSession={onRenameSession}
          onStopSession={onStopSession}
          onDeleteSession={onDeleteSession}
        />
      )}
    </div>
  )
}
