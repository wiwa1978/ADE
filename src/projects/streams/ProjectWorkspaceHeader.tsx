import {
  Bot,
  CalendarClock,
  Columns2,
  FolderGit2,
  FolderTree,
  GitPullRequest,
  KanbanSquare,
  LayoutGrid,
  ListTodo,
  Plus,
  Settings2,
  Square,
  Workflow,
} from "lucide-react"
import { Badge, Banner, Button, IconButton } from "../../../components/ui/index.ts"
import type { Project } from "../../../ProjectsView"

export type ProjectTab = "sessions" | "kanban" | "issues" | "pulls" | "subagents" | "automations"
export type StreamLayout = "single" | "split" | "grid"

interface ProjectWorkspaceHeaderProps {
  project: Project
  blueprintName: string
  repoSlug: string | null
  sessionsCount: number
  factoryRunsCount: number
  totalSubagentsCount: number
  activeTab: ProjectTab
  sessionView: "list" | "side"
  layout: StreamLayout
  visiblePaneCount: number
  hiddenStreamCount: number
  filesOpen: boolean
  settingsOpen: boolean
  onSelectTab: (tab: ProjectTab) => void
  onSelectSessionView: (view: "list" | "side") => void
  onSelectLayout: (layout: StreamLayout) => void
  onOpenNextHiddenPane: () => void
  onStartFactoryRun: () => void
  onNewSession: () => void
  onToggleFiles?: () => void
  onToggleSettings: () => void
}

export function ProjectWorkspaceHeader({
  project,
  blueprintName,
  repoSlug,
  sessionsCount,
  factoryRunsCount,
  totalSubagentsCount,
  activeTab,
  sessionView,
  layout,
  visiblePaneCount,
  hiddenStreamCount,
  filesOpen,
  settingsOpen,
  onSelectTab,
  onSelectSessionView,
  onSelectLayout,
  onOpenNextHiddenPane,
  onStartFactoryRun,
  onNewSession,
  onToggleFiles,
  onToggleSettings,
}: ProjectWorkspaceHeaderProps) {
  return (
    <>
      <header className="ade-project-topbar">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <FolderGit2 className="size-4 opacity-80 shrink-0" />
          <h1 className="text-[15px] font-semibold tracking-tight m-0 truncate">{project.name}</h1>
          {repoSlug ? <Badge size="sm" className="font-mono">{repoSlug}</Badge> : null}
          <Badge size="sm" tone="accent">{blueprintName}</Badge>
          {project.modelProfile ? <Badge size="sm">{project.modelProfile}</Badge> : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="md"
            onClick={onStartFactoryRun}
            title="Launch a new Software Factory run on this project"
          >
            <Workflow className="size-3.5" /> Factory run
          </Button>
          <Button variant="primary" size="md" onClick={onNewSession}>
            <Plus className="size-3.5" /> New session
          </Button>
          {onToggleFiles ? (
            <IconButton
              aria-label="Project files"
              title="Project files"
              onClick={onToggleFiles}
              className={filesOpen ? "bg-[rgb(var(--surface-raised))] text-[rgb(var(--foreground))]" : ""}
            >
              <FolderTree className="size-4" />
            </IconButton>
          ) : null}
          <IconButton
            aria-label="Project settings"
            title="Project settings"
            onClick={onToggleSettings}
            className={settingsOpen ? "bg-[rgb(var(--surface-raised))] text-[rgb(var(--foreground))]" : ""}
          >
            <Settings2 className="size-4" />
          </IconButton>
        </div>
      </header>

      {!project.repository && !project.githubUrl && !settingsOpen ? (
        <Banner
          tone="info"
          className="rounded-none border-x-0 border-t-0 px-5"
          action={
            <Button variant="secondary" size="sm" onClick={onToggleSettings}>
              <Settings2 className="size-3.5" /> Configure project
            </Button>
          }
        >
          This project is empty. Link a local folder or GitHub repository in project settings.
        </Banner>
      ) : null}

      <div className="ade-project-tabs-row">
        <nav className="ade-project-tabs" role="tablist" aria-label="Project views">
          <button type="button" role="tab" aria-selected={activeTab === "sessions"} className={`ade-project-tab ${activeTab === "sessions" ? "is-active" : ""}`} onClick={() => onSelectTab("sessions")}>
            <Columns2 className="size-3.5" />
            <span>Sessions</span>
            <span className="ade-count-badge">{sessionsCount + factoryRunsCount}</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "kanban"} className={`ade-project-tab ${activeTab === "kanban" ? "is-active" : ""}`} onClick={() => onSelectTab("kanban")}>
            <KanbanSquare className="size-3.5" />
            <span>Factory</span>
            <span className="ade-count-badge">{factoryRunsCount}</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "issues"} className={`ade-project-tab ${activeTab === "issues" ? "is-active" : ""}`} onClick={() => onSelectTab("issues")}>
            <ListTodo className="size-3.5" />
            <span>Issues</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "pulls"} className={`ade-project-tab ${activeTab === "pulls" ? "is-active" : ""}`} onClick={() => onSelectTab("pulls")}>
            <GitPullRequest className="size-3.5" />
            <span>Pull requests</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "subagents"} className={`ade-project-tab ${activeTab === "subagents" ? "is-active" : ""}`} onClick={() => onSelectTab("subagents")}>
            <Bot className="size-3.5" />
            <span>Agents</span>
            {totalSubagentsCount > 0 ? <span className="ade-count-badge is-accent">{totalSubagentsCount}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "automations"} className={`ade-project-tab ${activeTab === "automations" ? "is-active" : ""}`} onClick={() => onSelectTab("automations")}>
            <CalendarClock className="size-3.5" />
            <span>Automations</span>
          </button>
        </nav>

        {activeTab === "sessions" ? (
          <div className="ade-segmented" role="tablist" aria-label="Session view">
            <button type="button" role="tab" aria-selected={sessionView === "list"} className={sessionView === "list" ? "is-active" : ""} onClick={() => onSelectSessionView("list")}>List</button>
            <button type="button" role="tab" aria-selected={sessionView === "side"} className={sessionView === "side" ? "is-active" : ""} onClick={() => onSelectSessionView("side")}>Side by side</button>
          </div>
        ) : null}

        {activeTab === "sessions" && sessionView === "side" && visiblePaneCount > 0 ? (
          <div className="flex items-center gap-2">
            {hiddenStreamCount > 0 ? (
              <Button variant="chip" size="xs" onClick={onOpenNextHiddenPane} title="Open another session side by side">
                <Plus className="size-3" /> Add pane ({hiddenStreamCount})
              </Button>
            ) : null}
            <div className="ade-segmented" role="group" aria-label="Pane layout">
              <button type="button" className={layout === "single" ? "is-active" : ""} onClick={() => onSelectLayout("single")} title="Single pane"><Square className="size-3" /></button>
              <button type="button" className={layout === "split" ? "is-active" : ""} onClick={() => onSelectLayout("split")} title="2-up split panes"><Columns2 className="size-3" /></button>
              <button type="button" className={layout === "grid" ? "is-active" : ""} onClick={() => onSelectLayout("grid")} title="Multi-pane grid"><LayoutGrid className="size-3" /></button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
