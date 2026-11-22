import { useCallback, useEffect, useState } from "react"
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
import { getCaptainEndpoint, request, resolveCaptainUrl, setCaptainEndpoint } from "../../api"
import type {
  BrowserState,
  FactoryBlueprint,
  ModelProfileId,
  ProviderCatalogEntry,
} from "../../app-types"
import type { Project } from "../../ProjectsView"
import { FactoryKanban } from "./FactoryKanban"
import { FactoryIssuesList } from "./FactoryIssuesList"
import { FactoryRunWorkspace } from "./FactoryRunWorkspace"
import { ProjectConfigModal } from "./ProjectConfigModal"
import { QuickIssueModal } from "./QuickIssueModal"
import { AddProjectWizard } from "../projects/AddProjectWizard"
import type { FactoryCapabilities, FactoryRunDetail } from "./types"

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
  const [caps, setCaps] = useState<FactoryCapabilities | null>(null)
  const [blueprints, setBlueprints] = useState<FactoryBlueprint[]>([])
  const [runs, setRuns] = useState<FactoryRunDetail[]>([])
  const [activeTab, setActiveTab] = useState<FactoryTab>("kanban")
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const [projectModalMode, setProjectModalMode] = useState<"create" | "edit" | null>(null)
  const [newIssueOpen, setNewIssueOpen] = useState(false)

  const [endpointFlavor, setEndpointFlavor] = useState<"local" | "remote">(() => getCaptainEndpoint().flavor)
  const [remoteUrl, setRemoteUrl] = useState(() => getCaptainEndpoint().baseUrl)
  const [remoteToken, setRemoteToken] = useState(() => getCaptainEndpoint().authToken ?? "")
  const [showRemoteConfig, setShowRemoteConfig] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const activeProject =
    projects.find(p => p.id === selectedProjectId) ??
    projects[0] ??
    null

  const refresh = useCallback(async () => {
    try {
      const [c, bps, r] = await Promise.all([
        request<FactoryCapabilities>("/api/factory/capabilities"),
        request<{ blueprints: FactoryBlueprint[] }>("/api/factory/blueprints"),
        request<{ runs: FactoryRunDetail[] }>("/api/factory/runs"),
      ])
      setCaps(c)
      setBlueprints(bps.blueprints)
      setRuns(r.runs)
      setError("")
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — restart \`npm run dev\` if the runtime server was started before Factory routes were added.`
          : "Could not load Factory runtime.",
      )
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Real-time SSE updates so Kanban cards, subagents, logs, and diffs stream live
  useEffect(() => {
    if (typeof EventSource === "undefined") return
    const es = new EventSource(resolveCaptainUrl("/api/events"))
    const onFactoryEvent = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as { payload?: { type?: string; payload?: FactoryRunDetail } }
        const inner = parsed?.payload
        if (inner?.type === "run.updated" && inner.payload?.run?.runId) {
          const updated = inner.payload
          setRuns(prev => {
            const exists = prev.some(r => r.run.runId === updated.run.runId)
            return exists
              ? prev.map(r => (r.run.runId === updated.run.runId ? updated : r))
              : [...prev, updated]
          })
        }
      } catch (err) {
        console.warn("[ADE] Ignored malformed factory.event SSE frame:", err instanceof Error ? err.message : String(err))
      }
    }
    es.addEventListener("factory.event", onFactoryEvent)
    return () => {
      es.removeEventListener("factory.event", onFactoryEvent)
      es.close()
    }
  }, [endpointFlavor])

  const projectRuns = activeProject
    ? runs.filter(r => r.run.projectId === activeProject.id)
    : runs

  const activeRun =
    runs.find(r => r.run.runId === selectedRunId) ??
    projectRuns[projectRuns.length - 1] ??
    runs[runs.length - 1] ??
    null

  function applyEndpoint(nextFlavor: "local" | "remote") {
    setEndpointFlavor(nextFlavor)
    if (nextFlavor === "local") {
      setShowRemoteConfig(false)
      setCaptainEndpoint({ flavor: "local", baseUrl: "", region: "local" })
      void refresh()
    } else {
      setShowRemoteConfig(true)
      if (remoteUrl.trim()) {
        setCaptainEndpoint({
          flavor: "remote",
          baseUrl: remoteUrl.trim(),
          authToken: remoteToken.trim() || undefined,
          region: "eu",
        })
        void refresh()
      }
    }
  }

  async function startRunForActiveProject(input: {
    issueNumber?: number
    taskPrompt?: string
    autoStart: boolean
  }) {
    if (!activeProject) {
      setProjectModalMode("create")
      return
    }
    if (!activeProject.repository) {
      setError(`Link a local Git checkout path in "${activeProject.name}" Project Settings first.`)
      setProjectModalMode("edit")
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await request<{ run: FactoryRunDetail }>("/api/factory/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.id,
          issueNumber: input.issueNumber,
          taskPrompt: input.taskPrompt,
          autoStart: input.autoStart,
        }),
      })
      setRuns(prev => {
        const exists = prev.some(r => r.run.runId === res.run.run.runId)
        return exists ? prev.map(r => (r.run.runId === res.run.run.runId ? res.run : r)) : [...prev, res.run]
      })
      setSelectedRunId(res.run.run.runId)
      setNewIssueOpen(false)
      setActiveTab("workspace")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Factory run.")
    } finally {
      setBusy(false)
    }
  }

  async function runAction(
    runId: string,
    action: "step" | "auto-run" | "approve" | "pause" | "takeover",
    body: Record<string, unknown> = {},
  ) {
    setBusy(true)
    setError("")
    try {
      const res = await request<{ run: FactoryRunDetail }>(
        `/api/factory/runs/${encodeURIComponent(runId)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      )
      setRuns(prev => prev.map(r => (r.run.runId === res.run.run.runId ? res.run : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : `Factory action "${action}" failed.`)
    } finally {
      setBusy(false)
    }
  }

  async function steerRun(runId: string, note: string) {
    setBusy(true)
    setError("")
    try {
      const res = await request<{ run: FactoryRunDetail }>(
        `/api/factory/runs/${encodeURIComponent(runId)}/steer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note }),
        },
      )
      setRuns(prev => prev.map(r => (r.run.runId === res.run.run.runId ? res.run : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send steering note.")
    } finally {
      setBusy(false)
    }
  }

  const activeBlueprintName =
    blueprints.find(b => b.id === (activeProject?.blueprintId ?? "automated-factory"))?.name ??
    "Automated Factory"

  const profiles: { id: ModelProfileId; name: string; euCompliantByDefault: boolean }[] =
    caps?.modelProfiles ?? [
      { id: "balanced", name: "Balanced", euCompliantByDefault: false },
      { id: "max-quality", name: "Max Quality", euCompliantByDefault: false },
      { id: "budget", name: "Budget / Fast", euCompliantByDefault: false },
      { id: "eu-only", name: "EU Data Residency (GDPR)", euCompliantByDefault: true },
      { id: "eu-sovereign", name: "EU Sovereign (CLOUD-Act-Free)", euCompliantByDefault: true },
      { id: "local-ollama", name: "Local / Ollama ($0)", euCompliantByDefault: true },
    ]

  return (
    <div className="sf-shell">
      {/* Row 1: Single Clean Project-First Header */}
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
              onChange={e => {
                if (e.target.value) onSelectProject(e.target.value)
              }}
            >
              {projects.length === 0 ? <option value="">No project yet</option> : null}
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="sf-btn-secondary"
              onClick={() => setProjectModalMode("create")}
              title="Add new project"
            >
              <FolderPlus className="size-3.5" /> New Project
            </button>
            {activeProject ? (
              <button
                type="button"
                className="sf-btn-ghost"
                onClick={() => setProjectModalMode("edit")}
                title="Project blueprint, GitHub repo, and model settings"
              >
                <Settings2 className="size-3.5" /> Project Settings
              </button>
            ) : null}
          </div>
        </div>

        <div className="sf-header-right">
          <div className="sf-segmented" role="tablist" aria-label="Factory view">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "kanban"}
              className={`sf-seg-btn ${activeTab === "kanban" ? "is-active" : ""}`}
              onClick={() => setActiveTab("kanban")}
            >
              <KanbanSquare className="size-3.5" /> Kanban ({projectRuns.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "issues"}
              className={`sf-seg-btn ${activeTab === "issues" ? "is-active" : ""}`}
              onClick={() => setActiveTab("issues")}
            >
              <ListTodo className="size-3.5" /> GitHub Issues
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "workspace"}
              className={`sf-seg-btn ${activeTab === "workspace" ? "is-active" : ""}`}
              onClick={() => setActiveTab("workspace")}
              disabled={!activeRun}
            >
              <Workflow className="size-3.5" /> Run Workspace
            </button>
          </div>

          <button
            type="button"
            className="sf-btn-primary"
            onClick={() => {
              if (!activeProject) setProjectModalMode("create")
              else setNewIssueOpen(true)
            }}
          >
            <Plus className="size-3.5" /> New Issue
          </button>
        </div>
      </header>

      {/* Row 2: Compact Project Context Bar (Blueprint, Repo, Models, Flavor) */}
      <div className="sf-meta-bar">
        <div className="sf-meta-chips">
          {activeProject ? (
            <>
              <button
                type="button"
                className="sf-badge sf-badge-accent cursor-pointer"
                onClick={() => setProjectModalMode("edit")}
                title="Click to change project blueprint"
              >
                {activeBlueprintName}
              </button>
              {activeProject.githubUrl ? (
                <span className="sf-badge sf-badge-muted font-mono">
                  <GitBranch className="size-3" /> {activeProject.githubUrl.replace(/^https:\/\/github\.com\//i, "")}
                </span>
              ) : (
                <button
                  type="button"
                  className="sf-badge sf-badge-warn cursor-pointer"
                  onClick={() => setProjectModalMode("edit")}
                >
                  + Link GitHub Repo
                </button>
              )}
              {activeProject.repository ? (
                <span className="sf-badge sf-badge-muted font-mono max-w-[260px] truncate">
                  <FolderGit2 className="size-3 shrink-0" /> {activeProject.repository}
                </span>
              ) : (
                <button
                  type="button"
                  className="sf-badge sf-badge-warn cursor-pointer"
                  onClick={() => setProjectModalMode("edit")}
                >
                  + Set Local Checkout
                </button>
              )}
              <button
                type="button"
                className="sf-badge sf-badge-muted cursor-pointer"
                onClick={() => setProjectModalMode("edit")}
              >
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
            <button
              type="button"
              className={`sf-seg-btn !h-6 !px-2 !text-[11px] ${endpointFlavor === "local" ? "is-active" : ""}`}
              onClick={() => applyEndpoint("local")}
            >
              Local ($0)
            </button>
            <button
              type="button"
              className={`sf-seg-btn !h-6 !px-2 !text-[11px] ${endpointFlavor === "remote" ? "is-active" : ""}`}
              onClick={() => applyEndpoint("remote")}
            >
              Remote
            </button>
          </div>
          <button type="button" className="sf-btn-ghost !h-7" onClick={() => void refresh()} title="Refresh">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Optional Remote Endpoint Bar */}
      {showRemoteConfig ? (
        <div className="px-5 py-2.5 border-b border-[rgb(var(--border)/0.75)] bg-[rgb(var(--surface))] grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
          <label className="sf-label">
            <span>Remote Captain URL</span>
            <input
              className="sf-field !h-8 !text-xs"
              placeholder="https://captain.eu.example.com"
              value={remoteUrl}
              onChange={e => setRemoteUrl(e.target.value)}
            />
          </label>
          <label className="sf-label">
            <span>Bearer Token</span>
            <input
              type="password"
              className="sf-field !h-8 !text-xs"
              placeholder="ade_remote_…"
              value={remoteToken}
              onChange={e => setRemoteToken(e.target.value)}
            />
          </label>
          <button type="button" className="sf-btn-primary !h-8" onClick={() => applyEndpoint("remote")}>
            Connect Remote Captain
          </button>
        </div>
      ) : null}

      {error ? <div className="mx-5 mt-3 ade-banner-error">{error}</div> : null}

      {/* Main Content Area */}
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
          runs={projectRuns}
          selectedRunId={selectedRunId}
          onSelectRun={id => {
            setSelectedRunId(id)
            setActiveTab("workspace")
          }}
          onAutoRun={id => void runAction(id, "auto-run")}
          onNewRun={() => setNewIssueOpen(true)}
        />
      ) : activeTab === "issues" ? (
        <FactoryIssuesList
          project={activeProject}
          onOpenProjectSettings={() => setProjectModalMode("edit")}
          onStartFromIssue={async issue => {
            await startRunForActiveProject({
              issueNumber: issue.number,
              taskPrompt: `#${issue.number}: ${issue.title}\n\n${issue.body}`,
              autoStart: true,
            })
          }}
        />
      ) : activeRun ? (
        <FactoryRunWorkspace
          run={activeRun}
          environmentId={environmentId}
          terminalFontSize={terminalFontSize}
          terminalScrollback={terminalScrollback}
          browserState={browserState}
          busy={busy}
          onBackToKanban={() => setActiveTab("kanban")}
          onAction={(action, body) => runAction(activeRun.run.runId, action, body)}
          onSteer={note => steerRun(activeRun.run.runId, note)}
          onBrowserStateChange={onBrowserStateChange}
          onOpenExternal={onOpenExternal}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-xs opacity-65">
          Select a card from the Kanban board or click <strong>+ New Issue</strong> to start a run.
        </div>
      )}

      {/* Multi-Source Add Project Wizard (GitHub / Git URL / Local Folder / From Scratch) */}
      <AddProjectWizard
        open={projectModalMode === "create"}
        githubLogin={githubLogin}
        onClose={() => setProjectModalMode(null)}
        onCreated={saved => {
          onProjectSaved(saved)
          onSelectProject(saved.id)
        }}
      />

      {/* Project-Level Config Modal (Edit Active Project) */}
      <ProjectConfigModal
        key={`edit:${activeProject?.id ?? "none"}`}
        open={projectModalMode === "edit" && activeProject !== null}
        mode="edit"
        project={activeProject}
        blueprints={blueprints}
        modelProfiles={profiles}
        modelCatalog={modelCatalog}
        githubLogin={githubLogin}
        onClose={() => setProjectModalMode(null)}
        onSaved={saved => {
          onProjectSaved(saved)
          onSelectProject(saved.id)
        }}
      />

      {/* Quick Issue Modal (inherits Project repo, blueprint & models) */}
      <QuickIssueModal
        open={newIssueOpen}
        project={activeProject}
        busy={busy}
        onClose={() => setNewIssueOpen(false)}
        onStart={startRunForActiveProject}
      />
    </div>
  )
}
