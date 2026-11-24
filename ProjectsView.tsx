import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react"
import { ArrowLeft, ArrowUpRight, FolderGit2, FolderOpen, GitBranch, PanelRight, Plus } from "lucide-react"
import { requestJson } from "./api"
import type { FeatureAgent } from "./FeatureAgents"
import { BUILTIN_BLUEPRINTS } from "./packages/blueprints/index.ts"
import type {
  GitHubConnection,
  GitHubRepository,
  GitHubRepositoryPage,
  Project,
  ProjectInput,
} from "./packages/protocol/index.ts"
import { ProjectScriptsSettings } from "./src/projects/ProjectScriptsSettings"
import { ProjectInstructionsSettings } from "./src/projects/ProjectInstructionsSettings"
import { ProjectSecretsSettings } from "./src/projects/ProjectSecretsSettings"
import { ProjectRunOnSettings } from "./src/projects/ProjectRunOnSettings"

import { useBlueprintOptions } from "./src/blueprints/blueprint-options"
export type { GitHubConnection, GitHubRepository, GitHubRepositoryPage, Project, ProjectInput }
type Feature = { id: string; label: string; status: string; workspace?: { kind: string; branch: string | null; status: string } }
export type ProjectActivity = { agents: (FeatureAgent & { sessionId: string; sessionName: string })[]; errors: { sessionId: string; sessionName: string; message: string }[]; observedAt: number }

type SearchGitHubRepositories = (login: string, query: string, page: number, signal?: AbortSignal) => Promise<GitHubRepositoryPage>

function repositoryName(value: string) {
  return value.replace(/^https:\/\/github\.com\//i, "")
}

function filterGitHubRepositories(repositories: GitHubRepository[], value: string) {
  const query = repositoryName(value.trim()).toLowerCase()
  return repositories.filter(repo => repo.fullName.toLowerCase().includes(query))
}

export type CreatedGitHubRepository = { fullName: string; url: string; private: boolean }
type CreateGitHubRepository = (input: {
  name: string
  description?: string
  visibility: "private" | "public"
  addReadme?: boolean
}) => Promise<CreatedGitHubRepository>

async function defaultCreateGitHubRepository(input: {
  name: string
  description?: string
  visibility: "private" | "public"
  addReadme?: boolean
}): Promise<CreatedGitHubRepository> {
  const res = await requestJson<{ repository: CreatedGitHubRepository }>("/api/github/repositories/create", "POST", input)
  return res.repository
}

export function GitHubRepositoryPicker({
  login,
  value,
  disabled,
  inputId = "project-github-repo",
  onChange,
  onOpenSettings,
  onSearch,
  onCreateRepository = defaultCreateGitHubRepository,
  onQuickConnect,
}: {
  login: string | null
  value: string
  disabled: boolean
  inputId?: string
  onChange: (value: string) => void
  onOpenSettings?: () => void
  onSearch: SearchGitHubRepositories
  onCreateRepository?: CreateGitHubRepository
  onQuickConnect?: () => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [repositories, setRepositories] = useState<GitHubRepository[]>([])
  const [nextPage, setNextPage] = useState<number | null>(1)
  const [error, setError] = useState("")
  const [activeIndex, setActiveIndex] = useState(-1)
  const [creatingOpen, setCreatingOpen] = useState(false)
  const [newRepoName, setNewRepoName] = useState("")
  const [newRepoDesc, setNewRepoDesc] = useState("")
  const [newRepoVisibility, setNewRepoVisibility] = useState<"private" | "public">("private")
  const [newRepoReadme, setNewRepoReadme] = useState(true)
  const [creatingBusy, setCreatingBusy] = useState(false)
  const [createError, setCreateError] = useState("")
  const [connecting, setConnecting] = useState(false)
  const listId = useId()
  const expanded = Boolean(login && open && !disabled)
  const matches = filterGitHubRepositories(repositories, value)
  const visible = matches.slice(0, 50)

  useEffect(() => {
    if (!expanded || !login || nextPage === null || error) return
    const controller = new AbortController()
    let cancelled = false
    void onSearch(login, "", nextPage, controller.signal).then(result => {
      if (cancelled) return
      if (result.nextPage !== null && (!Number.isInteger(result.nextPage) || result.nextPage <= nextPage)) {
        throw new Error("GitHub returned an invalid next page.")
      }
      setRepositories(current => {
        const byName = new Map(current.map(repo => [repo.fullName.toLowerCase(), repo]))
        for (const repo of result.repositories) byName.set(repo.fullName.toLowerCase(), repo)
        return [...byName.values()]
      })
      setNextPage(result.nextPage)
    }).catch(cause => {
      if (cancelled) return
      setRepositories([])
      setNextPage(1)
      setError(cause instanceof Error ? cause.message : "Could not load repositories.")
    })
    return () => { cancelled = true; controller.abort() }
  }, [expanded, login, nextPage, error, onSearch])

  useEffect(() => {
    if (expanded && activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" })
  }, [expanded, activeIndex, listId])

  function show() {
    if (!login || disabled) return
    if (!open) {
      setRepositories([])
      setNextPage(1)
      setError("")
      setActiveIndex(-1)
    }
    setOpen(true)
  }

  function select(repo: GitHubRepository) {
    onChange(repo.fullName)
    setActiveIndex(-1)
    setOpen(false)
    setCreatingOpen(false)
  }

  function openCreateForm() {
    const cleaned = repositoryName(value.trim()).replace(/^[^/]+\//, "")
    setNewRepoName(cleaned)
    setNewRepoDesc("")
    setCreateError("")
    setCreatingOpen(true)
    setOpen(false)
  }

  async function handleCreateRepo() {
    if (!newRepoName.trim()) {
      setCreateError("Enter a repository name (e.g. my-app).")
      return
    }
    setCreatingBusy(true)
    setCreateError("")
    try {
      const created = await onCreateRepository({
        name: newRepoName.trim(),
        description: newRepoDesc.trim() || undefined,
        visibility: newRepoVisibility,
        addReadme: newRepoReadme,
      })
      setRepositories(prev => [{ fullName: created.fullName, private: created.private }, ...prev])
      onChange(created.fullName)
      setCreatingOpen(false)
      setNewRepoName("")
      setNewRepoDesc("")
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Could not create repository on GitHub.")
    } finally {
      setCreatingBusy(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (login && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault()
      show()
      if (expanded && visible.length) {
        setActiveIndex(current => event.key === "ArrowDown"
          ? (current + 1) % visible.length
          : current <= 0 ? visible.length - 1 : current - 1)
      }
    } else if (expanded && event.key === "Enter") {
      event.preventDefault()
      const selected = visible[activeIndex < 0 ? 0 : activeIndex]
      if (selected) select(selected)
      else setOpen(false)
    } else if (expanded && event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  return <div className="github-repo-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false)
      setActiveIndex(-1)
    }
  }}>
    <div className="github-repo-input-anchor">
      <input id={inputId} value={value} disabled={disabled} placeholder="Search or enter owner/repository"
        aria-describedby="project-github-hint" role={login ? "combobox" : undefined} aria-autocomplete={login ? "list" : undefined}
        aria-expanded={login ? expanded : undefined} aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && activeIndex >= 0 && activeIndex < visible.length ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off" onFocus={show} onClick={show} onKeyDown={handleKeyDown}
        onChange={event => { onChange(event.target.value); setActiveIndex(-1); show() }} />
      {expanded && <div className="github-repo-dropdown">
        <ul className="github-repo-results" id={listId} role="listbox" aria-label="GitHub repositories" aria-busy={nextPage !== null && !error}>
          {visible.map((repo, index) => <li id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex} key={repo.fullName}
            onMouseDown={event => event.preventDefault()} onMouseMove={() => setActiveIndex(index)} onClick={() => select(repo)}>
            <span>{repo.fullName}</span><small>{repo.private ? "Private" : "Public"}</small>
          </li>)}
        </ul>
        {error ? <div className="github-repo-status"><p role="alert">{error}</p><button type="button" className="text-button" onClick={() => setError("")}>Try again</button> {onOpenSettings ? <button type="button" className="text-button" onClick={onOpenSettings}>Connection settings</button> : null}</div>
          : nextPage !== null ? <p className="github-repo-status" role="status">{visible.length ? "Loading more repositories…" : "Loading repositories…"}</p>
          : !visible.length ? <p className="github-repo-status" role="status">No matches. Enter a repository manually or create one below.</p>
          : matches.length > visible.length ? <p className="github-repo-status">Keep typing to narrow the results.</p> : null}
        <div className="github-repo-footer">
          <button type="button" className="text-button" onMouseDown={e => e.preventDefault()} onClick={openCreateForm}>
            <Plus size={12} /> Create new repository on GitHub{value.trim() ? `: "${repositoryName(value.trim())}"` : ""}
          </button>
        </div>
      </div>}
    </div>

    <div className="github-repo-create-row" style={{ marginTop: 6 }}>
      {!login && onQuickConnect ? (
        <button
          type="button"
          className="text-button"
          disabled={disabled || connecting}
          onClick={async () => {
            setConnecting(true)
            try { await onQuickConnect() } finally { setConnecting(false) }
          }}
        >
          {connecting ? "Connecting GitHub CLI…" : "Connect GitHub CLI to search"}
        </button>
      ) : null}
      <button
        type="button"
        className="text-button"
        disabled={disabled}
        onClick={() => (creatingOpen ? setCreatingOpen(false) : openCreateForm())}
      >
        <Plus size={12} /> {creatingOpen ? "Hide create repo" : "Create new repo on GitHub"}
      </button>
    </div>

    {creatingOpen ? (
      <div className="github-repo-create-box">
        <div style={{ fontSize: 12, fontWeight: 600 }}>Create new GitHub repository</div>
        {createError ? <p className="error" role="alert" style={{ margin: 0 }}>{createError}</p> : null}
        <input
          value={newRepoName}
          placeholder="repository-name (or org/repository-name)"
          disabled={creatingBusy}
          onChange={e => setNewRepoName(e.target.value)}
        />
        <input
          value={newRepoDesc}
          placeholder="Short description (optional)"
          disabled={creatingBusy}
          onChange={e => setNewRepoDesc(e.target.value)}
        />
        <div className="github-repo-create-row">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{ display: "inline-flex", gap: 4, alignItems: "center", margin: 0, cursor: "pointer" }}>
              <input
                type="radio"
                name={`vis-${listId}`}
                checked={newRepoVisibility === "private"}
                onChange={() => setNewRepoVisibility("private")}
                style={{ width: "auto", height: "auto" }}
              />
              Private
            </label>
            <label style={{ display: "inline-flex", gap: 4, alignItems: "center", margin: 0, cursor: "pointer" }}>
              <input
                type="radio"
                name={`vis-${listId}`}
                checked={newRepoVisibility === "public"}
                onChange={() => setNewRepoVisibility("public")}
                style={{ width: "auto", height: "auto" }}
              />
              Public
            </label>
            <label style={{ display: "inline-flex", gap: 4, alignItems: "center", margin: 0, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={newRepoReadme}
                onChange={e => setNewRepoReadme(e.target.checked)}
                style={{ width: "auto", height: "auto" }}
              />
              README
            </label>
          </div>
          <button
            type="button"
            className="action-button"
            disabled={creatingBusy || !newRepoName.trim()}
            onClick={() => void handleCreateRepo()}
          >
            {creatingBusy ? "Creating…" : "Create & Link"}
          </button>
        </div>
      </div>
    ) : null}
  </div>
}

export function ProjectSettings({ project, open, initialDraft, githubConnection, githubStatusError, environmentName, onSave, onClose, onOpenSettings, onSearchRepositories, width, paneRef }: {
  /** Set by the project page's resizable right panel. */
  width?: number
  paneRef?: React.Ref<HTMLElement>
  project: Project; open: boolean; environmentName?: string; onSave: (input: ProjectInput) => Promise<Project>; onClose: () => void
  initialDraft?: ProjectInput; githubConnection: GitHubConnection | null; githubStatusError: string
  onOpenSettings: (draft: ProjectInput) => void
  onSearchRepositories: SearchGitHubRepositories
}) {
  const [name, setName] = useState(initialDraft?.name ?? project.name)
  const [githubUrl, setGithubUrl] = useState(repositoryName(initialDraft?.githubUrl ?? project.githubUrl ?? ""))
  const [repository, setRepository] = useState(initialDraft?.repository ?? project.repository ?? "")
  const [blueprintId, setBlueprintId] = useState(initialDraft?.blueprintId ?? project.blueprintId ?? "vibe")
  const [blueprintLocked, setBlueprintLocked] = useState(initialDraft?.blueprintLocked ?? project.blueprintLocked ?? false)
  const blueprintOptions = useBlueprintOptions()
  const [modelProfile, setModelProfile] = useState(initialDraft?.modelProfile ?? project.modelProfile ?? "balanced")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [saved, setSaved] = useState(false)
  const githubAccount = githubConnection?.login ?? null
  const dirty =
    name !== project.name ||
    githubUrl !== repositoryName(project.githubUrl ?? "") ||
    repository !== (project.repository ?? "") ||
    blueprintId !== (project.blueprintId ?? "vibe") ||
    blueprintLocked !== (project.blueprintLocked ?? false) ||
    modelProfile !== (project.modelProfile ?? "balanced")
  const openConnectionSettings = () => onOpenSettings({ id: project.id, name, githubUrl, repository, blueprintId, blueprintLocked, modelProfile })
  const searchableAccount = githubStatusError ? null : githubAccount

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !dirty || !name.trim()) return
    setSaving(true)
    setSaveError("")
    try {
      const updated = await onSave({
        id: project.id,
        name: name.trim(),
        githubUrl: githubUrl.trim(),
        repository: repository.trim(),
        blueprintId,
        blueprintLocked,
        modelProfile,
      })
      setName(updated.name)
      setGithubUrl(repositoryName(updated.githubUrl ?? ""))
      setRepository(updated.repository ?? "")
      setBlueprintId(updated.blueprintId ?? "vibe")
      setBlueprintLocked(updated.blueprintLocked ?? false)
      setModelProfile(updated.modelProfile ?? "balanced")
      setSaved(true)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save this project.")
    } finally { setSaving(false) }
  }

  async function pickLocalFolder() {
    try {
      const res = await requestJson<{ path: string | null }>("/api/system/pick-folder", "POST")
      if (!res.path) return
      setRepository(res.path)
      if (!githubUrl.trim()) {
        try {
          const detected = await requestJson<{ githubRepo: string | null }>("/api/projects/detect-git", "POST", { path: res.path })
          if (detected.githubRepo) setGithubUrl(detected.githubRepo)
        } catch {
          // Non-git folder or no remote; keep folder path as-is.
        }
      }
    } catch {
      // Native picker unavailable on headless hosts.
    }
  }

  return <aside ref={paneRef} id="project-settings" className="inspector project-settings" aria-labelledby="project-settings-title" hidden={!open} style={width ? { width } : undefined}>
    <div className="panel-title"><h2 id="project-settings-title">Project settings</h2><button className="icon-button" aria-label="Close project settings" onClick={onClose}><PanelRight size={16} /></button></div>
    <form className="project-form" onSubmit={save}>
      {!project.repository && !project.githubUrl ? (
        <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-[12px] leading-relaxed opacity-85">
          Empty project — pick a local folder or link a GitHub repository below to finish setup.
        </div>
      ) : null}
      <div className="project-environment-label"><span>Environment</span><strong>{environmentName ?? "This computer"}</strong><small>New sessions inherit this project’s environment.</small></div>
      <label>Project name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={saving} /></label>
      <div className="project-field">
        <label htmlFor="project-github-repo">GitHub repository <small>Optional</small></label>
        <GitHubRepositoryPicker key={`${searchableAccount ?? "none"}:${open}`} login={searchableAccount} value={githubUrl} disabled={saving}
          onChange={setGithubUrl} onOpenSettings={openConnectionSettings} onSearch={onSearchRepositories} />
        <p id="project-github-hint" className="hint">Search existing repositories, enter a URL, or create a new repository on GitHub.</p>
        {!githubConnection && !githubStatusError ? <p className="hint" role="status">Checking GitHub connection…</p> : !githubAccount || githubStatusError ? <>
          <p className="hint">{githubStatusError ? "GitHub connection is unavailable." : "Connect GitHub in Settings to search repositories."}</p>
          <button type="button" className="text-button project-link" disabled={saving} onClick={openConnectionSettings}>Open connection settings</button>
        </> : null}
        {project.githubUrl && <a className="text-button project-link" href={project.githubUrl} target="_blank" rel="noreferrer">Open on GitHub <ArrowUpRight size={13} /></a>}
      </div>
      <div className="project-field">
        <label htmlFor="project-local-checkout">Default local checkout <small>Optional</small></label>
        <div className="flex items-center gap-1.5" style={{ marginTop: 6 }}>
          <input id="project-local-checkout" className="flex-1 min-w-0" value={repository} onChange={event => setRepository(event.target.value)} placeholder="/Users/you/Code/your-repository" aria-describedby="project-checkout-hint" disabled={saving} />
          <button type="button" className="sf-btn-secondary !h-8 shrink-0" disabled={saving} onClick={() => void pickLocalFolder()} title="Browse for a local folder">
            <FolderOpen className="size-3.5" /> Browse
          </button>
        </div>
        <p id="project-checkout-hint" className="hint">Applies to new sessions.</p>
      </div>
      <div className="project-field">
        <label>
          Way of working
          <select className="sf-field" style={{ marginTop: 6 }} value={blueprintId} onChange={e => setBlueprintId(e.target.value)} disabled={saving}>
            {(blueprintOptions.length ? blueprintOptions : [{ id: "vibe", name: "Vibe coding" }, ...BUILTIN_BLUEPRINTS]).map(bp => (
              <option key={bp.id} value={bp.id}>{bp.name}</option>
            ))}
          </select>
        </label>
        <p className="hint">The default for new sessions in this project. Vibe coding has no stages; a blueprint takes each session through its stages, and you approve the gated ones.</p>
        <label className="project-check">
          <input type="checkbox" checked={blueprintLocked} onChange={e => setBlueprintLocked(e.target.checked)} disabled={saving} />
          Every session uses this way of working
        </label>
        <p className="hint">For team or regulated repositories: sessions can't pick another one (Vibe included).</p>
      </div>
      <div className="project-field">
        <label>
          Model Profile
          <select className="sf-field" style={{ marginTop: 6 }} value={modelProfile} onChange={e => setModelProfile(e.target.value)} disabled={saving}>
            <option value="balanced">Balanced</option>
            <option value="max-quality">Max Quality</option>
            <option value="budget">Budget / Fast</option>
            <option value="eu-only">EU Data Residency (GDPR)</option>
            <option value="eu-sovereign">EU Sovereign (CLOUD-Act-Free)</option>
            <option value="local-ollama">Local / Ollama ($0)</option>
          </select>
        </label>
      </div>
      {saveError && <p className="error" role="alert">{saveError}</p>}
      <div className="form-actions"><button className="action-button" disabled={saving || !dirty || !name.trim()}>{saving ? "Saving…" : "Save changes"}</button>{saved && !dirty && <span className="hint" role="status">Saved</span>}</div>
    </form>
    <ProjectScriptsSettings projectId={project.id} />
    {project.repository ? <ProjectRunOnSettings projectId={project.id} /> : null}
    <ProjectSecretsSettings projectId={project.id} />
    {project.repository ? <ProjectInstructionsSettings projectId={project.id} /> : null}
  </aside>
}

type Props = {
  projects: Project[]
  project: Project | null
  features: Feature[]
  error: string
  activity: ProjectActivity | null
  activityError: string
  onSelect: (id: string) => void
  onBack: () => void
  onOpenFeature: (id: string) => void
  onOpenAgent: (sessionId: string, agent: FeatureAgent) => void
}

export function ProjectsView({ projects, project, features, error, activity, activityError, onSelect, onBack, onOpenFeature, onOpenAgent }: Props) {
  return <main className="projects-scroll">
    <div className="projects-page">
      {project && <button className="text-button project-back" onClick={onBack}><ArrowLeft size={14} /> All projects</button>}
      <header className="project-heading">
        <div><h1>{project?.name ?? "Projects"}</h1><p>{project ? "Sessions and their delegated work." : "Keep related sessions and their agents together. GitHub is optional."}</p></div>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {project ? <section className="project-features">
        <div className="list-heading"><h2>Sessions</h2><span>{features.length}</span></div>
        {features.length ? <div className="project-list">{features.map(feature => <button className="project-row" key={feature.id} onClick={() => onOpenFeature(feature.id)}>
          <GitBranch size={18} /><span className="project-row-copy"><strong>{feature.label}</strong><small>{feature.workspace?.branch ?? (feature.workspace?.kind === "none" ? "No workspace" : "Existing checkout")}</small></span>
          <span className={`activity-label ${feature.workspace?.status === "attention" ? "blocked" : feature.status}`}><i />{feature.workspace?.status === "attention" ? "Needs attention" : feature.status === "working" ? "Working" : "Idle"}</span><ArrowUpRight size={16} />
        </button>)}</div> : <div className="project-empty"><GitBranch size={25} /><h2>No sessions yet</h2><p>Use the plus beside this project in the left pane to start a session.</p></div>}
        <div className="list-heading"><h2>Subagent activity</h2></div>
        {activityError && <p className="error" role="alert">Activity unavailable: {activityError}</p>}
        {!activity && !activityError && <p className="hint" role="status">Loading subagent activity...</p>}
        {activity && <>
          <p className="hint">Last checked {new Date(activity.observedAt).toLocaleTimeString()}{activityError ? " · stale" : ""}</p>
          {activity.errors.map(item => <p className="error" role="alert" key={item.sessionId}>{item.sessionName}: {item.message}</p>)}
          {activity.agents.length ? <div className="agent-list">{activity.agents.map(agent => <button className="agent-row" key={`${agent.sessionId}:${agent.id}`} onClick={() => onOpenAgent(agent.sessionId, agent)}>
            <span><strong>{agent.name} · {agent.sessionName}</strong><small>{agent.assignment}</small><small>{agent.messages.filter(message => message.role === "assistant").at(-1)?.content ?? "No report yet"}</small><small>Session ID: {agent.sessionId} · Subagent ID: {agent.id} · Assignment ID: {agent.assignmentId}</small></span><span className={`activity-label ${agent.status}`}>{agent.status}</span>
          </button>)}</div> : !activity.errors.length && <p className="hint">No delegated work yet.</p>}
        </>}
      </section> : projects.length ? <div className="project-list">{projects.map(item => <button className="project-row" key={item.id} onClick={() => onSelect(item.id)}>
        <FolderGit2 size={20} /><span className="project-row-copy"><strong>{item.name}</strong><small>{item.githubUrl?.replace("https://github.com/", "") ?? "Local project - no GitHub link"}</small></span><ArrowUpRight size={17} />
      </button>)}</div> : <div className="project-empty"><FolderGit2 size={28} /><h2>A home for your sessions</h2><p>Use the plus beside Projects in the left pane to create a project.</p></div>}
    </div>
  </main>
}
