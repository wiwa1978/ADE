import { useState } from "react"
import {
  FolderGit2,
  FolderPlus,
  GitBranch,
  KanbanSquare,
  ListTodo,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Workflow,
} from "lucide-react"
import type { BrowserState, ProviderCatalogEntry } from "../../app-types"
import type { Project } from "../../ProjectsView"
import { FactoryKanban } from "./FactoryKanban"
import { FactoryIssuesList } from "./FactoryIssuesList"
import { FactoryRunWorkspace } from "./FactoryRunWorkspace"
import { ProjectConfigModal } from "./ProjectConfigModal"
import { QuickIssueModal } from "./QuickIssueModal"
import { AddProjectWizard } from "../projects/AddProjectWizard"
import { useFactoryRuns } from "./useFactoryRuns"

type FactoryTab = "kanban" | "issues" | "workspace"

export function FactoryView({
  projects,
  selectedProjectId,
  modelCatalog,
  githubLogin,
  environmentId,
  terminalFontSize,
  terminalScrollback,
  browserState,
  onSelectProject,
  onProjectSaved,
  onBrowserStateChange,
  onOpenExternal,
}: {
  projects: Project[]
  selectedProjectId: string | null
  modelCatalog: ProviderCatalogEntry[]
  githubLogin: string | null
  environmentId: string
  terminalFontSize: number
  terminalScrollback: number
  browserState: BrowserState
  onSelectProject: (id: string) => void
  onProjectSaved: (project: Project) => void
  onBrowserStateChange: (state: BrowserState) => void
  onOpenExternal: (url: string) => Promise<void>
}) {
  const [activeTab, setActiveTab] = useState<FactoryTab>("kanban")
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [projectModalMode, setProjectModalMode] = useState<"create" | "edit" | null>(null)
  const [newIssueOpen, setNewIssueOpen] = useState(false)

  const activeProject = projects.find(p => p.id === selectedProjectId) ?? projects[0] ?? null

  const factory = useFactoryRuns({
    activeProject,
    selectedRunId,
    onSelectRun: setSelectedRunId,
    onNeedProjectModal: setProjectModalMode,
    onRunStarted: () => {
      setNewIssueOpen(false)
      setActiveTab("workspace")
    },
  })

  return (
    <div className="sf-shell">
      <header className="sf-header">
        <div className="sf-header-left">
          <div className="flex items-center gap-2">
            <Workflow className="size-4 text-[rgb(var(--primary))]" />
            <span className="text-[14px] font-semibold tracking-tight">Factory</span>
          </div>

          <div className="sf-project-select-wrap">
            <select
              className="sf-select-compact"
              aria-label="Active project"
              value={activeProject?.id ?? ""}
              onChange={e => { if (e.target.value) onSelectProject(e.target.value) }}
            >
              {projects.length === 0 ? <option value="">No project yet</option> : null}
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" className="sf-btn-secondary" onClick={() => setProjectModalMode("create")} title="Add new project">
              <FolderPlus className="size-3.5" /> New Project
            </button>
            {activeProject ? (
              <button type="button" className="sf-btn-ghost" onClick={() => setProjectModalMode("edit")} title="Project blueprint, GitHub repo, and model settings">
                <Settings2 className="size-3.5" /> Project Settings
              </button>
            ) : null}
          </div>
        </div>

        <div className="sf-header-right">
          <div className="sf-segmented" role="tablist" aria-label="Factory view">
            <button type="button" role="tab" aria-selected={activeTab === "kanban"} className={`sf-seg-btn ${activeTab === "kanban" ? "is-active" : ""}`} onClick={() => setActiveTab("kanban")}>
              <KanbanSquare className="size-3.5" /> Kanban ({factory.projectRuns.length})
            </button>
            <button type="button" role="tab" aria-selected={activeTab === "issues"} className={`sf-seg-btn ${activeTab === "issues" ? "is-active" : ""}`} onClick={() => setActiveTab("issues")}>
              <ListTodo className="size-3.5" /> GitHub Issues
            </button>
            <button type="button" role="tab" aria-selected={activeTab === "workspace"} className={`sf-seg-btn ${activeTab === "workspace" ? "is-active" : ""}`} onClick={() => setActiveTab("workspace")} disabled={!factory.activeRun}>
              <Workflow className="size-3.5" /> Run Workspace
            </button>
          </div>

          <button
            type="button"
            className="sf-btn-primary"
            onClick={() => { if (!activeProject) setProjectModalMode("create"); else setNewIssueOpen(true) }}
          >
            <Plus className="size-3.5" /> New Issue
          </button>
        </div>
      </header>

      <div className="sf-meta-bar">
        <div className="sf-meta-chips">
          {activeProject ? (
            <>
              <button type="button" className="sf-badge sf-badge-accent cursor-pointer" onClick={() => setProjectModalMode("edit")} title="Click to change project blueprint">
                {factory.activeBlueprintName}
              </button>
              {activeProject.githubUrl ? (
                <span className="sf-badge sf-badge-muted font-mono">
                  <GitBranch className="size-3" /> {activeProject.githubUrl.replace(/^https:\/\/github\.com\//i, "")}
                </span>
              ) : (
                <button type="button" className="sf-badge sf-badge-warn cursor-pointer" onClick={() => setProjectModalMode("edit")}>
                  + Link GitHub Repo
                </button>
              )}
              {activeProject.repository ? (
                <span className="sf-badge sf-badge-muted font-mono max-w-[260px] truncate">
                  <FolderGit2 className="size-3 shrink-0" /> {activeProject.repository}
                </span>
              ) : (
                <button type="button" className="sf-badge sf-badge-warn cursor-pointer" onClick={() => setProjectModalMode("edit")}>
                  + Set Local Checkout
                </button>
              )}
              <button type="button" className="sf-badge sf-badge-muted cursor-pointer" onClick={() => setProjectModalMode("edit")}>
                Model: {activeProject.modelProfile ?? "balanced"}
              </button>
              {activeProject.euOnlyMode ? (
                <span className="sf-badge sf-badge-eu">
                  <ShieldCheck className="size-3" /> {activeProject.cloudActFree ? "EU Sovereign" : "EU GDPR"}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-xs opacity-70">Create your first project to configure its repo, blueprint, and models.</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="sf-segmented">
            <button type="button" className={`sf-seg-btn !h-6 !px-2 !text-[11px] ${factory.endpointFlavor === "local" ? "is-active" : ""}`} onClick={() => factory.applyEndpoint("local")}>
              Local ($0)
            </button>
            <button type="button" className={`sf-seg-btn !h-6 !px-2 !text-[11px] ${factory.endpointFlavor === "remote" ? "is-active" : ""}`} onClick={() => factory.applyEndpoint("remote")}>
              Remote
            </button>
          </div>
          <button type="button" className="sf-btn-ghost !h-7" onClick={() => void factory.refresh()} title="Refresh">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {factory.showRemoteConfig ? (
        <div className="px-5 py-2.5 border-b border-[rgb(var(--border)/0.75)] bg-[rgb(var(--surface))] grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
          <label className="sf-label">
            <span>Remote Captain URL</span>
            <input className="sf-field !h-8 !text-xs" placeholder="https://captain.eu.example.com" value={factory.remoteUrl} onChange={e => factory.setRemoteUrl(e.target.value)} />
          </label>
          <label className="sf-label">
            <span>Bearer Token</span>
            <input type="password" className="sf-field !h-8 !text-xs" placeholder="ade_remote_…" value={factory.remoteToken} onChange={e => factory.setRemoteToken(e.target.value)} />
          </label>
          <button type="button" className="sf-btn-primary !h-8" onClick={() => factory.applyEndpoint("remote")}>
            Connect Remote Captain
          </button>
        </div>
      ) : null}

      {factory.error ? <div className="mx-5 mt-3 ade-banner-error">{factory.error}</div> : null}

      {!activeProject ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
          <Workflow className="size-9 text-[rgb(var(--primary))] opacity-80" />
          <h2 className="text-base font-semibold">Set up your first Software Factory project</h2>
          <p className="text-xs opacity-70 max-w-md leading-relaxed">
            Link a local Git checkout and GitHub repository, choose your Blueprint (Automated Factory, OpenSpec, Spec Kit, EGM, or Squad), and set your default models once.
          </p>
          <button type="button" className="sf-btn-primary" onClick={() => setProjectModalMode("create")}>
            <FolderPlus className="size-4" /> Create Project
          </button>
        </div>
      ) : activeTab === "kanban" ? (
        <FactoryKanban
          runs={factory.projectRuns}
          selectedRunId={selectedRunId}
          onSelectRun={id => { setSelectedRunId(id); setActiveTab("workspace") }}
          onAutoRun={id => void factory.runAction(id, "auto-run")}
          onNewRun={() => setNewIssueOpen(true)}
        />
      ) : activeTab === "issues" ? (
        <FactoryIssuesList
          project={activeProject}
          onOpenProjectSettings={() => setProjectModalMode("edit")}
          onStartFromIssue={async issue => {
            await factory.startRunForActiveProject({
              issueNumber: issue.number,
              taskPrompt: `#${issue.number}: ${issue.title}\n\n${issue.body}`,
              autoStart: true,
            })
          }}
        />
      ) : factory.activeRun ? (
        <FactoryRunWorkspace
          run={factory.activeRun}
          environmentId={environmentId}
          terminalFontSize={terminalFontSize}
          terminalScrollback={terminalScrollback}
          browserState={browserState}
          busy={factory.busy}
          onBackToKanban={() => setActiveTab("kanban")}
          onAction={(action, body) => factory.runAction(factory.activeRun!.run.runId, action, body)}
          onSteer={note => factory.steerRun(factory.activeRun!.run.runId, note)}
          onBrowserStateChange={onBrowserStateChange}
          onOpenExternal={onOpenExternal}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-xs opacity-65">
          Select a card from the Kanban board or click <strong>+ New Issue</strong> to start a run.
        </div>
      )}

      <AddProjectWizard
        open={projectModalMode === "create"}
        githubLogin={githubLogin}
        onClose={() => setProjectModalMode(null)}
        onCreated={saved => { onProjectSaved(saved); onSelectProject(saved.id) }}
      />

      <ProjectConfigModal
        key={`edit:${activeProject?.id ?? "none"}`}
        open={projectModalMode === "edit" && activeProject !== null}
        mode="edit"
        project={activeProject}
        blueprints={factory.blueprints}
        modelProfiles={factory.profiles}
        modelCatalog={modelCatalog}
        githubLogin={githubLogin}
        onClose={() => setProjectModalMode(null)}
        onSaved={saved => { onProjectSaved(saved); onSelectProject(saved.id) }}
      />

      <QuickIssueModal
        open={newIssueOpen}
        project={activeProject}
        busy={factory.busy}
        onClose={() => setNewIssueOpen(false)}
        onStart={factory.startRunForActiveProject}
      />
    </div>
  )
}
