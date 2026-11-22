import { useCallback, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react"
import { request } from "../../api"
import type {
  FactoryBlueprint,
  ModelProfileId,
  ProviderCatalogEntry,
} from "../../app-types"
import {
  GitHubRepositoryPicker,
  type GitHubRepositoryPage,
  type Project,
} from "../../ProjectsView"

function toSlug(url: string | null | undefined): string {
  if (!url) return ""
  return url.replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/$/, "")
}

export function ProjectConfigModal({
  open,
  mode,
  project,
  blueprints,
  modelProfiles,
  modelCatalog,
  githubLogin,
  onClose,
  onSaved,
}: {
  open: boolean
  mode: "create" | "edit"
  project: Project | null
  blueprints: FactoryBlueprint[]
  modelProfiles: { id: ModelProfileId; name: string; euCompliantByDefault: boolean }[]
  modelCatalog: ProviderCatalogEntry[]
  githubLogin: string | null
  onClose: () => void
  onSaved: (project: Project) => void
}) {
  const editing = mode === "edit" && project !== null
  const [name, setName] = useState(editing ? project.name : "")
  const [repository, setRepository] = useState(editing ? (project.repository ?? "") : "")
  const [githubRepo, setGithubRepo] = useState(editing ? toSlug(project.githubUrl) : "")
  const [blueprintId, setBlueprintId] = useState(editing ? (project.blueprintId ?? "automated-factory") : "automated-factory")
  const [modelProfile, setModelProfile] = useState<ModelProfileId>(
    (editing ? project.modelProfile : "balanced") as ModelProfileId,
  )
  const [euOnlyMode, setEuOnlyMode] = useState(editing ? Boolean(project.euOnlyMode) : false)
  const [cloudActFree, setCloudActFree] = useState(editing ? Boolean(project.cloudActFree) : false)
  const [showStageModels, setShowStageModels] = useState(false)
  const [stageOverrides, setStageOverrides] = useState<Record<string, { provider: string; model: string }>>(
    editing && project.stageOverrides ? { ...project.stageOverrides } : {},
  )

  const [detecting, setDetecting] = useState(false)
  const [activeGhLogin, setActiveGhLogin] = useState<string | null>(githubLogin)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const handleSearchRepos = useCallback(
    (login: string, query: string, page: number, signal?: AbortSignal) =>
      request<GitHubRepositoryPage>("/api/github/repositories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login, query, page }),
        signal,
      }),
    [],
  )

  const handleQuickConnect = useCallback(async () => {
    const res = await request<{ login: string | null }>("/api/github/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    setActiveGhLogin(res.login)
    return res.login
  }, [])

  if (!open) return null

  const selectedBlueprint = blueprints.find(b => b.id === blueprintId) ?? blueprints[0]
  const availableProviders = modelCatalog.filter(p => p.models.length > 0)

  async function detectFromLocalPath() {
    if (!repository.trim()) {
      setError("Enter a local repository path first to detect its GitHub remote.")
      return
    }
    setDetecting(true)
    setError("")
    try {
      const res = await request<{ repository: string; githubRepo: string | null }>("/api/projects/detect-git", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: repository.trim() }),
      })
      setRepository(res.repository)
      if (res.githubRepo) {
        setGithubRepo(res.githubRepo)
        if (!name.trim()) {
          setName(res.githubRepo.split("/")[1] || res.githubRepo)
        }
      } else {
        setError("Valid Git checkout found, but no GitHub `origin` remote was detected. Enter owner/repo manually.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not inspect that local folder.")
    } finally {
      setDetecting(false)
    }
  }

  function updateStageOverride(stageId: string, provider: string, model: string) {
    setStageOverrides(prev => {
      if (!provider || !model) {
        const next = { ...prev }
        delete next[stageId]
        return next
      }
      return { ...prev, [stageId]: { provider, model } }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError("Provide a project name.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const id = editing ? project.id : crypto.randomUUID()
      const payload = {
        id,
        name: name.trim(),
        repository: repository.trim(),
        githubUrl: githubRepo.trim(),
        blueprintId,
        modelProfile: cloudActFree ? "eu-sovereign" : euOnlyMode ? "eu-only" : modelProfile,
        euOnlyMode: euOnlyMode || cloudActFree,
        cloudActFree,
        stageOverrides: Object.keys(stageOverrides).length ? stageOverrides : null,
      }
      const res = await request<{ project: Project }>(editing ? `/api/projects/${encodeURIComponent(id)}` : "/api/projects", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      onSaved(res.project)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save project.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sf-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="sf-modal" onSubmit={handleSubmit}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold">
              {editing ? `Project Settings · ${project.name}` : "New Software Factory Project"}
            </h2>
            <p className="text-xs opacity-65 mt-0.5">
              Configure repository, GitHub link, default blueprint, and model policy once at the project level.
            </p>
          </div>
          <button type="button" className="sf-btn-ghost" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {error ? <div className="ade-banner-error">{error}</div> : null}

        <label className="sf-label">
          <span>Project Name *</span>
          <input
            className="sf-field"
            placeholder="e.g. ADE Core"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
        </label>

        {/* Local Checkout + Auto-Detect */}
        <div className="sf-label">
          <span>Local Git Checkout Path</span>
          <div className="flex gap-2">
            <input
              className="sf-field flex-1"
              placeholder="/Users/you/Code/my-repo"
              value={repository}
              onChange={e => setRepository(e.target.value)}
            />
            <button
              type="button"
              className="sf-btn-secondary"
              onClick={() => void detectFromLocalPath()}
              disabled={detecting || !repository.trim()}
            >
              <FolderGit2 className="size-3.5" />
              {detecting ? "Detecting…" : "Detect Remote"}
            </button>
          </div>
        </div>

        {/* Linked GitHub Repo — Searchable Dropdown + Create New Repo on GitHub */}
        <div className="sf-label">
          <span>Linked GitHub Repository (search existing or create new)</span>
          <GitHubRepositoryPicker
            inputId="factory-project-github-repo"
            login={activeGhLogin}
            value={githubRepo}
            disabled={busy}
            onChange={next => {
              setGithubRepo(next)
              if (!name.trim() && next.includes("/")) {
                setName(next.split("/")[1] || next)
              }
            }}
            onSearch={handleSearchRepos}
            onQuickConnect={handleQuickConnect}
          />
        </div>

        {/* Project-Level Blueprint Selection */}
        <div className="sf-label">
          <span>Project Blueprint</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {blueprints.map(bp => {
              const selected = blueprintId === bp.id
              return (
                <button
                  key={bp.id}
                  type="button"
                  onClick={() => setBlueprintId(bp.id)}
                  className="rounded-lg border p-2.5 text-left transition-colors cursor-pointer"
                  style={{
                    borderColor: selected ? "rgb(var(--primary))" : "rgb(var(--border))",
                    background: selected ? "rgb(var(--primary) / 0.12)" : "rgb(var(--surface))",
                    color: "rgb(var(--foreground))",
                  }}
                >
                  <div className="text-xs font-semibold">{bp.name}</div>
                  <div className="text-[11px] opacity-65 mt-0.5">
                    {bp.stages.length} stages · {bp.bestFor}
                  </div>
                </button>
              )
            })}
          </div>
          {selectedBlueprint ? (
            <div className="rounded-lg border border-[rgb(var(--border)/0.8)] bg-[rgb(var(--surface))] px-3 py-2 flex flex-wrap items-center gap-1.5">
              {selectedBlueprint.stages.map((s, idx) => (
                <span key={s.id} className="inline-flex items-center gap-1">
                  {idx > 0 ? <span className="opacity-40 text-[11px]">→</span> : null}
                  <span className={`sf-badge ${s.contextIsolation === "goldfish" ? "sf-badge-accent" : "sf-badge-muted"}`}>
                    {s.name}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* Project-Level Model Profile & EU Compliance */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          <label className="sf-label">
            <span>Default Model Profile</span>
            <select
              className="sf-field"
              value={cloudActFree ? "eu-sovereign" : euOnlyMode ? "eu-only" : modelProfile}
              onChange={e => setModelProfile(e.target.value as ModelProfileId)}
              disabled={euOnlyMode || cloudActFree}
            >
              {modelProfiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-2 pt-5 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={euOnlyMode}
                onChange={e => { setEuOnlyMode(e.target.checked); if (!e.target.checked) setCloudActFree(false) }}
              />
              <ShieldCheck className="size-3.5 text-sky-400" />
              <span>EU Residency (GDPR endpoints)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cloudActFree}
                onChange={e => { setCloudActFree(e.target.checked); if (e.target.checked) setEuOnlyMode(true) }}
              />
              <Sparkles className="size-3.5 text-emerald-400" />
              <span>EU Sovereign (CLOUD-Act-Free)</span>
            </label>
          </div>
        </div>

        {/* Optional Per-Stage Model Overrides */}
        {selectedBlueprint && availableProviders.length > 0 ? (
          <div className="rounded-lg border border-[rgb(var(--border)/0.85)] bg-[rgb(var(--surface))] p-3">
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs font-semibold w-full text-left"
              onClick={() => setShowStageModels(v => !v)}
            >
              {showStageModels ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              <SlidersHorizontal className="size-3.5 opacity-75" />
              <span>Per-Stage Model Overrides</span>
              <span className="ml-auto text-[11px] opacity-60 font-normal">
                {Object.keys(stageOverrides).length ? `${Object.keys(stageOverrides).length} custom` : "Using profile defaults"}
              </span>
            </button>
            {showStageModels ? (
              <div className="grid gap-2 mt-3 pt-2.5 border-t border-[rgb(var(--border)/0.7)]">
                {selectedBlueprint.stages.map(stage => {
                  const cur = stageOverrides[stage.id] ?? { provider: "", model: "" }
                  const selectedProv = availableProviders.find(p => p.id === cur.provider)
                  return (
                    <div key={stage.id} className="grid grid-cols-3 gap-2 items-center text-xs">
                      <span className="truncate font-medium">
                        {stage.name}
                        {stage.contextIsolation === "goldfish" ? " (Goldfish)" : ""}
                      </span>
                      <select
                        className="sf-field !h-8 !text-xs"
                        value={cur.provider}
                        onChange={e => {
                          const prov = availableProviders.find(p => p.id === e.target.value)
                          updateStageOverride(stage.id, e.target.value, prov?.defaultModel ?? prov?.models[0]?.id ?? "")
                        }}
                      >
                        <option value="">Profile ({stage.defaultModelRole})</option>
                        {availableProviders.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <select
                        className="sf-field !h-8 !text-xs"
                        value={cur.model}
                        disabled={!selectedProv}
                        onChange={e => updateStageOverride(stage.id, cur.provider, e.target.value)}
                      >
                        <option value="">Default</option>
                        {(selectedProv?.models ?? []).map(m => (
                          <option key={m.id} value={m.id}>{m.name || m.id}</option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2 border-t border-[rgb(var(--border)/0.8)]">
          <button type="button" className="sf-btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="sf-btn-primary" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save Project Settings" : "Create Project"}
          </button>
        </div>
      </form>
    </div>
  )
}
