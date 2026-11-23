import type { Conversation, EnvironmentDirectory, SubagentInfo, WorkspaceTab } from "../../app-types"
import type { Project } from "../../ProjectsView"
import type { SettingsCategory } from "../../SettingsView"
import { CommandCenter } from "../sidebar/CommandCenter"
import { EnvironmentPalette } from "../sidebar/EnvironmentPalette"
import { SidebarContextMenu, type ContextMenuTarget } from "../sidebar/SidebarContextMenu"
import { AddProjectWizard } from "../projects/AddProjectWizard"
import { formatShortcut, type KeybindingMap } from "../keybindings"

type AppOverlaysProps = {
  commandOpen: boolean
  addProjectOpen: boolean
  envPaletteOpen: boolean
  contextMenu: ContextMenuTarget | null
  projects: Project[]
  visibleProjects: Project[]
  sessions: Conversation[]
  subagents: SubagentInfo[]
  hasActiveWorkspace: boolean
  githubLogin: string | null
  environmentDirectory: EnvironmentDirectory
  activeEnvironmentId: string
  pinnedIds: string[]
  unreadIds: string[]
  archivedIds: string[]
  keybindings?: KeybindingMap
  onCloseCommand: () => void
  onCloseAddProject: () => void
  onCloseEnvPalette: () => void
  onCloseContextMenu: () => void
  onSelectProjectFromCommand: (id: string) => void
  onSelectSession: (id: string) => void
  onNewSession: (projectId?: string) => void
  onOpenPanel: (tab: WorkspaceTab) => void
  onOpenExternalBrowser: (url: string) => void
  onOpenSettings: () => void
  onOpenSettingsSection: (category: SettingsCategory, autoOpenAdd?: boolean) => void
  onProjectCreated: (saved: Project, options?: { openSettings?: boolean }) => void
  onSelectEnvironment: (env: EnvironmentDirectory["environments"][number]) => Promise<void>
  onOpenSplitView: (sess: Conversation) => void
  onOpenExternalApp: (app: "cursor" | "vscode" | "windsurf" | "finder", path?: string | null) => void
  onTogglePin: (id: string) => void
  onToggleUnread: (id: string) => void
  onRenameSession: (sess: Conversation) => void
  onStopSession: (sess: Conversation) => void
  onDeleteSession: (sess: Conversation) => void
  onOpenProjectSettings: (project: Project) => void
  onToggleArchiveProject: (project: Project) => void
  onDeleteProject: (project: Project) => void
}

export function AppOverlays({
  commandOpen,
  addProjectOpen,
  envPaletteOpen,
  contextMenu,
  projects,
  visibleProjects,
  sessions,
  subagents,
  hasActiveWorkspace,
  githubLogin,
  environmentDirectory,
  activeEnvironmentId,
  pinnedIds,
  unreadIds,
  archivedIds,
  keybindings,
  onCloseCommand,
  onCloseAddProject,
  onCloseEnvPalette,
  onCloseContextMenu,
  onSelectProjectFromCommand,
  onSelectSession,
  onNewSession,
  onOpenPanel,
  onOpenExternalBrowser,
  onOpenSettings,
  onOpenSettingsSection,
  onProjectCreated,
  onSelectEnvironment,
  onOpenSplitView,
  onOpenExternalApp,
  onTogglePin,
  onToggleUnread,
  onRenameSession,
  onStopSession,
  onDeleteSession,
  onOpenProjectSettings,
  onToggleArchiveProject,
  onDeleteProject,
}: AppOverlaysProps) {
  return (
    <>
      <CommandCenter
        open={commandOpen}
        onClose={onCloseCommand}
        projects={projects}
        sessions={sessions}
        subagents={subagents}
        hasActiveWorkspace={hasActiveWorkspace}
        onSelectProject={onSelectProjectFromCommand}
        onSelectSession={s => onSelectSession(s.id)}
        onNewSession={() => onNewSession()}
        onOpenPanel={kind => onOpenPanel({ id: kind, kind, title: kind[0].toUpperCase() + kind.slice(1) })}
        onOpenSubagent={id => {
          const found = subagents.find(s => s.id === id)
          onOpenPanel({ id: `subagent:${id}`, kind: "subagent", title: found?.name || "Subagent", subagentId: id })
        }}
        onOpenExternalBrowser={onOpenExternalBrowser}
        onOpenSettings={onOpenSettings}
      />

      <AddProjectWizard
        open={addProjectOpen}
        githubLogin={githubLogin}
        environments={environmentDirectory.environments}
        activeEnvironmentId={activeEnvironmentId}
        existingProjectNames={projects.map(p => p.name)}
        onSelectEnvironment={onSelectEnvironment}
        onAddHost={() => onOpenSettingsSection("environments", false)}
        onClose={onCloseAddProject}
        onCreated={onProjectCreated}
      />

      <EnvironmentPalette
        open={envPaletteOpen}
        environments={environmentDirectory.environments}
        activeId={activeEnvironmentId}
        onSelect={onSelectEnvironment}
        onManageEnvironments={() => onOpenSettingsSection("environments", false)}
        onAddHost={() => onOpenSettingsSection("environments", false)}
        onClose={onCloseEnvPalette}
      />

      <SidebarContextMenu
        target={contextMenu}
        projects={visibleProjects}
        pinShortcut={keybindings?.pinSession ? formatShortcut(keybindings.pinSession) : ""}
        isPinned={id => pinnedIds.includes(id)}
        isUnread={id => unreadIds.includes(id)}
        isArchived={id => archivedIds.includes(id)}
        onClose={onCloseContextMenu}
        onOpenSplitView={onOpenSplitView}
        onOpenNewWindow={s => {
          const url = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(s.id)}`
          window.open(url, "_blank", "noopener")
        }}
        onOpenExternalApp={onOpenExternalApp}
        onContinueInCloud={() => onOpenSettingsSection("environments", true)}
        onTogglePin={onTogglePin}
        onToggleUnread={onToggleUnread}
        onRenameSession={onRenameSession}
        onStopSession={onStopSession}
        onDeleteSession={onDeleteSession}
        onNewProjectStream={project => onNewSession(project.id)}
        onOpenProjectSettings={onOpenProjectSettings}
        onToggleArchiveProject={onToggleArchiveProject}
        onDeleteProject={onDeleteProject}
      />
    </>
  )
}
