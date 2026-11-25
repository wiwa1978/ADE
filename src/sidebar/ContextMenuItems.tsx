import { ChevronRight } from "lucide-react"
import type { Conversation } from "../app-types"
import type { Project } from "../ProjectsView"
import { useI18n } from "../i18n/I18nContext"

export type SubmenuKind = "open-in" | "copy" | "split" | null

const EXTERNAL_APPS = [
  ["cursor", "Cursor", "3"],
  ["vscode", "VS Code", "4"],
  ["windsurf", "Windsurf", "5"],
  ["finder", "Finder", "6"],
] as const

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Fallback when Clipboard API is restricted.
    const el = document.createElement("textarea")
    el.value = text
    el.style.position = "fixed"
    el.style.opacity = "0"
    document.body.appendChild(el)
    el.select()
    document.execCommand("copy")
    el.remove()
  }
}

export function ProjectContextMenuItems({
  project,
  pinned,
  pinShortcut = "⌥⌘P",
  archived,
  submenu,
  flipSub,
  onSetSubmenu,
  onClose,
  onTogglePinProject,
  onNewProjectStream,
  onShowProjectArtifacts,
  onOpenExternalApp,
  onOpenProjectSettings,
  onToggleArchiveProject,
  onDeleteProject,
}: {
  project: Project
  pinned: boolean
  pinShortcut?: string
  archived: boolean
  submenu: SubmenuKind
  flipSub: boolean
  onSetSubmenu: (next: SubmenuKind | ((prev: SubmenuKind) => SubmenuKind)) => void
  onClose: () => void
  onTogglePinProject: (project: Project) => void
  onNewProjectStream: (project: Project) => void
  onShowProjectArtifacts: (project: Project) => void
  onOpenExternalApp: (app: "cursor" | "vscode" | "windsurf" | "finder", path?: string | null) => void
  onOpenProjectSettings: (project: Project) => void
  onToggleArchiveProject: (project: Project) => void
  onDeleteProject: (project: Project) => void
}) {
  const { t } = useI18n()
  return (
    <>
      <button type="button" className="ade-ctx-item" role="menuitem" onMouseEnter={() => onSetSubmenu(null)} onClick={() => { onNewProjectStream(project); onClose() }}>
        <span>{t("context.newSession")}</span>
        <span className="ade-ctx-shortcut">N</span>
      </button>

      <button type="button" className="ade-ctx-item" role="menuitem" onMouseEnter={() => onSetSubmenu(null)} onClick={() => { onShowProjectArtifacts(project); onClose() }}>
        <span>{t("context.showProjectArtifacts")}</span>
      </button>

      <button type="button" className="ade-ctx-item" role="menuitem" onMouseEnter={() => onSetSubmenu(null)} onClick={() => { onTogglePinProject(project); onClose() }}>
        <span>{pinned ? t("context.unpin") : t("context.pin")}</span>
        {pinShortcut ? <span className="ade-ctx-shortcut">{pinShortcut}</span> : null}
      </button>

      <div
        className={`ade-ctx-item ${submenu === "open-in" ? "is-open" : ""}`}
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => onSetSubmenu("open-in")}
        onClick={() => onSetSubmenu(s => (s === "open-in" ? null : "open-in"))}
      >
        <span>{t("context.openIn")}</span>
        <ChevronRight className="size-3.5 opacity-60" />
        {submenu === "open-in" ? (
          <div className={`ade-ctx-submenu ${flipSub ? "align-left" : ""}`} onClick={e => e.stopPropagation()}>
            <div className="ade-ctx-section-label">{t("context.openIn")}</div>
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
        <span>{t("context.openSettings")}</span>
        <span className="ade-ctx-shortcut">S</span>
      </button>

      <div className="ade-ctx-divider" />

      <button type="button" className="ade-ctx-item" role="menuitem" onClick={() => { onToggleArchiveProject(project); onClose() }}>
        <span>{archived ? t("context.restore") : t("context.archive")}</span>
        <span className="ade-ctx-shortcut">A</span>
      </button>

      <button type="button" className="ade-ctx-item is-danger" role="menuitem" onClick={() => { onDeleteProject(project); onClose() }}>
        <span>{t("context.delete")}</span>
        <span className="ade-ctx-shortcut">D</span>
      </button>
    </>
  )
}

export function SessionContextMenuItems({
  sess,
  projects,
  pinShortcut = "⌥⌘P",
  pinned,
  unread,
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
  onShowSessionArtifacts,
  onRenameSession,
  onStopSession,
  onDeleteSession,
}: {
  sess: Conversation
  projects: Project[]
  pinShortcut?: string
  pinned: boolean
  unread: boolean
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
  onShowSessionArtifacts: (session: Conversation) => void
  onRenameSession: (session: Conversation) => void
  onStopSession: (session: Conversation) => void
  onDeleteSession: (session: Conversation) => void
}) {
  const { t } = useI18n()
  const canDelete = sess.id !== "coding" && sess.id !== "personal"
  const canRename = sess.id !== "coding" && sess.id !== "personal"
  const isWorking = sess.status === "working"
  const workspacePath = projects.find(p => p.id === sess.projectId)?.repository ?? sess.workspace?.path ?? null
  const branchName = sess.workspace?.branch ?? null
  const sessionUrl = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sess.id)}`

  return (
    <>
      <button
        type="button"
        className="ade-ctx-item"
        role="menuitem"
        disabled={!canRename}
        style={!canRename ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
        onMouseEnter={() => onSetSubmenu(null)}
        onClick={() => { if (canRename) { onRenameSession(sess); onClose() } }}
      >
        <span>{t("context.rename")}</span>
      </button>

      <button
        type="button"
        className="ade-ctx-item"
        role="menuitem"
        onMouseEnter={() => onSetSubmenu(null)}
        onClick={() => { onTogglePin(sess.id); onClose() }}
      >
        <span>{pinned ? t("context.unpin") : t("context.pin")}</span>
        {pinShortcut ? <span className="ade-ctx-shortcut">{pinShortcut}</span> : null}
      </button>

      <button
        type="button"
        className="ade-ctx-item"
        role="menuitem"
        onMouseEnter={() => onSetSubmenu(null)}
        onClick={() => { onToggleUnread(sess.id); onClose() }}
      >
        <span>{unread ? t("context.markRead") : t("context.markUnread")}</span>
      </button>

      <button
        type="button"
        className="ade-ctx-item"
        role="menuitem"
        onMouseEnter={() => onSetSubmenu(null)}
        onClick={() => { onShowSessionArtifacts(sess); onClose() }}
      >
        <span>{t("context.showSessionArtifacts")}</span>
      </button>

      <div className="ade-ctx-divider" />

      <div
        className={`ade-ctx-item ${submenu === "copy" ? "is-open" : ""}`}
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => onSetSubmenu("copy")}
        onClick={() => onSetSubmenu(s => (s === "copy" ? null : "copy"))}
      >
        <span>{t("context.copy")}</span>
        <ChevronRight className="size-3.5 opacity-60" />
        {submenu === "copy" ? (
          <div className={`ade-ctx-submenu ${flipSub ? "align-left" : ""}`} onClick={e => e.stopPropagation()}>
            <button type="button" className="ade-ctx-item" onClick={() => { void copyToClipboard(sess.label); onClose() }}>
              <span>{t("context.copySessionName")}</span>
            </button>
            <button type="button" className="ade-ctx-item" onClick={() => { void copyToClipboard(sess.id); onClose() }}>
              <span>{t("context.copySessionId")}</span>
            </button>
            {branchName ? (
              <button type="button" className="ade-ctx-item" onClick={() => { void copyToClipboard(branchName); onClose() }}>
                <span>{t("context.copyBranchName")}</span>
              </button>
            ) : null}
            {workspacePath ? (
              <button type="button" className="ade-ctx-item" onClick={() => { void copyToClipboard(workspacePath); onClose() }}>
                <span>{t("context.copyFolderPath")}</span>
              </button>
            ) : null}
            <button type="button" className="ade-ctx-item" onClick={() => { void copyToClipboard(sessionUrl); onClose() }}>
              <span>{t("context.copySessionLink")}</span>
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={`ade-ctx-item ${submenu === "split" ? "is-open" : ""}`}
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => onSetSubmenu("split")}
        onClick={() => onSetSubmenu(s => (s === "split" ? null : "split"))}
      >
        <span>Split</span>
        <ChevronRight className="size-3.5 opacity-60" />
        {submenu === "split" ? (
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
            <button type="button" className="ade-ctx-item" onClick={() => { onContinueInCloud(sess); onClose() }}>
              <div>
                <div>Continue in Cloud</div>
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
        disabled={!isWorking}
        style={!isWorking ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
        onMouseEnter={() => onSetSubmenu(null)}
        onClick={() => { if (isWorking) { onStopSession(sess); onClose() } }}
      >
        <span>Stop</span>
      </button>

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
      </button>
    </>
  )
}
