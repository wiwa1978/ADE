import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react"
import { ArrowLeft, ArrowUpRight, FolderGit2, GitBranch, PanelRight } from "lucide-react"
import type { FeatureAgent } from "./FeatureAgents"

export type Project = { id: string; name: string; githubUrl: string | null; repository: string | null }
export type ProjectInput = { id: string; name: string; githubUrl: string; repository: string }
export type GitHubConnection = { login: string | null }
export type GitHubRepository = { fullName: string; private: boolean }
export type GitHubRepositoryPage = { repositories: GitHubRepository[]; nextPage: number | null }
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

function GitHubRepositoryPicker({ login, value, disabled, onChange, onOpenSettings, onSearch }: {
  login: string | null; value: string; disabled: boolean; onChange: (value: string) => void; onOpenSettings: () => void
  onSearch: SearchGitHubRepositories
}) {
  const [open, setOpen] = useState(false)
  const [repositories, setRepositories] = useState<GitHubRepository[]>([])
  const [nextPage, setNextPage] = useState<number | null>(1)
  const [error, setError] = useState("")
  const [activeIndex, setActiveIndex] = useState(-1)
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
    <input id="project-github-repo" value={value} disabled={disabled} placeholder="Search or enter owner/repository"
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
      {error ? <div className="github-repo-status"><p role="alert">{error}</p><button type="button" className="text-button" onClick={() => setError("")}>Try again</button> <button type="button" className="text-button" onClick={onOpenSettings}>Connection settings</button></div>
        : nextPage !== null ? <p className="github-repo-status" role="status">{visible.length ? "Loading more repositories…" : "Loading repositories…"}</p>
        : !visible.length ? <p className="github-repo-status" role="status">No matches. You can enter a repository manually.</p>
        : matches.length > visible.length ? <p className="github-repo-status">Keep typing to narrow the results.</p> : null}
    </div>}
  </div>
}

export function ProjectSettings({ project, open, initialDraft, githubConnection, githubStatusError, onSave, onClose, onOpenSettings, onSearchRepositories }: {
  project: Project; open: boolean; onSave: (input: ProjectInput) => Promise<Project>; onClose: () => void
  initialDraft?: ProjectInput; githubConnection: GitHubConnection | null; githubStatusError: string
  onOpenSettings: (draft: ProjectInput) => void
  onSearchRepositories: SearchGitHubRepositories
}) {
  const [name, setName] = useState(initialDraft?.name ?? project.name)
  const [githubUrl, setGithubUrl] = useState(repositoryName(initialDraft?.githubUrl ?? project.githubUrl ?? ""))
  const [repository, setRepository] = useState(initialDraft?.repository ?? project.repository ?? "")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [saved, setSaved] = useState(false)
  const githubAccount = githubConnection?.login ?? null
  const dirty = name !== project.name || githubUrl !== repositoryName(project.githubUrl ?? "") || repository !== (project.repository ?? "")
  const openConnectionSettings = () => onOpenSettings({ id: project.id, name, githubUrl, repository })
  const searchableAccount = githubStatusError ? null : githubAccount

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !dirty || !name.trim()) return
    setSaving(true)
    setSaveError("")
    try {
      const updated = await onSave({ id: project.id, name: name.trim(), githubUrl: githubUrl.trim(), repository: repository.trim() })
      setName(updated.name)
      setGithubUrl(repositoryName(updated.githubUrl ?? ""))
      setRepository(updated.repository ?? "")
      setSaved(true)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save this project.")
    } finally { setSaving(false) }
  }

  return <aside id="project-settings" className="inspector project-settings" aria-labelledby="project-settings-title" hidden={!open}>
    <div className="panel-title"><h2 id="project-settings-title">Project settings</h2><button className="icon-button" aria-label="Close project settings" onClick={onClose}><PanelRight size={16} /></button></div>
    <form className="project-form" onSubmit={save}>
      <label>Project name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={saving} /></label>
      <div className="project-field">
        <label htmlFor="project-github-repo">GitHub repository <small>Optional</small></label>
        <GitHubRepositoryPicker key={`${searchableAccount ?? "none"}:${open}`} login={searchableAccount} value={githubUrl} disabled={saving}
          onChange={setGithubUrl} onOpenSettings={openConnectionSettings} onSearch={onSearchRepositories} />
        <p id="project-github-hint" className="hint">Choose a repository or enter its URL. This does not clone it.</p>
        {!githubConnection && !githubStatusError ? <p className="hint" role="status">Checking GitHub connection…</p> : !githubAccount || githubStatusError ? <>
          <p className="hint">{githubStatusError ? "GitHub connection is unavailable." : "Connect GitHub in Settings to search repositories."}</p>
          <button type="button" className="text-button project-link" disabled={saving} onClick={openConnectionSettings}>Open connection settings</button>
        </> : null}
        {project.githubUrl && <a className="text-button project-link" href={project.githubUrl} target="_blank" rel="noreferrer">Open on GitHub <ArrowUpRight size={13} /></a>}
      </div>
      <div className="project-field">
        <label>Default local checkout <small>Optional</small><input value={repository} onChange={event => setRepository(event.target.value)} placeholder="C:\Code\your-repository" aria-describedby="project-checkout-hint" disabled={saving} /></label>
        <p id="project-checkout-hint" className="hint">Applies to new sessions only.</p>
      </div>
      {saveError && <p className="error" role="alert">{saveError}</p>}
      <div className="form-actions"><button className="action-button" disabled={saving || !dirty || !name.trim()}>{saving ? "Saving…" : "Save changes"}</button>{saved && !dirty && <span className="hint" role="status">Saved</span>}</div>
    </form>
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
