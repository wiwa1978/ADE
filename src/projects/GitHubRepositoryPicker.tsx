import { useEffect, useId, useState, type KeyboardEvent } from "react"
import { Plus } from "lucide-react"
import { request } from "../../api"
import { Banner, Button, Input } from "@/components/ui"
import type { GitHubRepository, GitHubRepositoryPage } from "../../packages/protocol/index.ts"

export type SearchGitHubRepositories = (login: string, query: string, page: number, signal?: AbortSignal) => Promise<GitHubRepositoryPage>
export type CreatedGitHubRepository = { fullName: string; url: string; private: boolean }
export type CreateGitHubRepository = (input: { name: string; description?: string; visibility: "private" | "public"; addReadme?: boolean }) => Promise<CreatedGitHubRepository>

const repositoryName = (value: string) => value.replace(/^https:\/\/github\.com\//i, "")
const filterRepos = (repos: GitHubRepository[], value: string) => {
  const query = repositoryName(value.trim()).toLowerCase()
  return repos.filter(repo => repo.fullName.toLowerCase().includes(query))
}

async function defaultCreateRepo(input: { name: string; description?: string; visibility: "private" | "public"; addReadme?: boolean }): Promise<CreatedGitHubRepository> {
  const res = await request<{ repository: CreatedGitHubRepository }>("/api/github/repositories/create", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  })
  return res.repository
}

export function GitHubRepositoryPicker({
  login, value, disabled, inputId = "project-github-repo", onChange, onOpenSettings, onSearch,
  onCreateRepository = defaultCreateRepo, onQuickConnect,
}: {
  login: string | null; value: string; disabled: boolean; inputId?: string
  onChange: (value: string) => void; onOpenSettings?: () => void
  onSearch: SearchGitHubRepositories; onCreateRepository?: CreateGitHubRepository
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
  const matches = filterRepos(repositories, value)
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
      setRepositories([]); setNextPage(1)
      setError(cause instanceof Error ? cause.message : "Could not load repositories.")
    })
    return () => { cancelled = true; controller.abort() }
  }, [expanded, login, nextPage, error, onSearch])

  useEffect(() => {
    if (expanded && activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" })
  }, [expanded, activeIndex, listId])

  function show() {
    if (!login || disabled) return
    if (!open) { setRepositories([]); setNextPage(1); setError(""); setActiveIndex(-1) }
    setOpen(true)
  }

  function select(repo: GitHubRepository) {
    onChange(repo.fullName); setActiveIndex(-1); setOpen(false); setCreatingOpen(false)
  }

  function openCreateForm() {
    setNewRepoName(repositoryName(value.trim()).replace(/^[^/]+\//, ""))
    setNewRepoDesc(""); setCreateError(""); setCreatingOpen(true); setOpen(false)
  }

  async function handleCreateRepo() {
    if (!newRepoName.trim()) { setCreateError("Enter a repository name (e.g. my-app)."); return }
    setCreatingBusy(true); setCreateError("")
    try {
      const created = await onCreateRepository({
        name: newRepoName.trim(), description: newRepoDesc.trim() || undefined,
        visibility: newRepoVisibility, addReadme: newRepoReadme,
      })
      setRepositories(prev => [{ fullName: created.fullName, private: created.private }, ...prev])
      onChange(created.fullName); setCreatingOpen(false); setNewRepoName(""); setNewRepoDesc("")
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Could not create repository on GitHub.")
    } finally { setCreatingBusy(false) }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (login && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault(); show()
      if (expanded && visible.length) {
        setActiveIndex(i => event.key === "ArrowDown" ? (i + 1) % visible.length : i <= 0 ? visible.length - 1 : i - 1)
      }
    } else if (expanded && event.key === "Enter") {
      event.preventDefault()
      const selected = visible[activeIndex < 0 ? 0 : activeIndex]
      if (selected) select(selected)
      else setOpen(false)
    } else if (expanded && event.key === "Escape") {
      event.preventDefault(); setOpen(false); setActiveIndex(-1)
    }
  }

  return (
    <div className="github-repo-picker" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setOpen(false); setActiveIndex(-1) } }}>
      <div className="github-repo-input-anchor">
        <Input
          id={inputId} value={value} disabled={disabled} placeholder="Search or enter owner/repository"
          aria-describedby="project-github-hint" role={login ? "combobox" : undefined} aria-autocomplete={login ? "list" : undefined}
          aria-expanded={login ? expanded : undefined} aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded && activeIndex >= 0 && activeIndex < visible.length ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off" onFocus={show} onClick={show} onKeyDown={handleKeyDown}
          onChange={e => { onChange(e.target.value); setActiveIndex(-1); show() }}
        />
        {expanded ? (
          <div className="github-repo-dropdown">
            <ul className="github-repo-results" id={listId} role="listbox" aria-label="GitHub repositories" aria-busy={nextPage !== null && !error}>
              {visible.map((repo, index) => (
                <li key={repo.fullName} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
                  onMouseDown={e => e.preventDefault()} onMouseMove={() => setActiveIndex(index)} onClick={() => select(repo)}>
                  <span>{repo.fullName}</span><small>{repo.private ? "Private" : "Public"}</small>
                </li>
              ))}
            </ul>
            {error ? (
              <div className="github-repo-status space-y-1.5">
                <Banner tone="error">{error}</Banner>
                <div className="flex items-center gap-2">
                  <button type="button" className="text-button" onClick={() => setError("")}>Try again</button>
                  {onOpenSettings ? <button type="button" className="text-button" onClick={onOpenSettings}>Connection settings</button> : null}
                </div>
              </div>
            ) : nextPage !== null ? (
              <p className="github-repo-status" role="status">{visible.length ? "Loading more repositories…" : "Loading repositories…"}</p>
            ) : !visible.length ? (
              <p className="github-repo-status" role="status">No matches. Enter a repository manually or create one below.</p>
            ) : matches.length > visible.length ? (
              <p className="github-repo-status">Keep typing to narrow the results.</p>
            ) : null}
            <div className="github-repo-footer">
              <button type="button" className="text-button" onMouseDown={e => e.preventDefault()} onClick={openCreateForm}>
                <Plus size={12} /> Create new repository on GitHub{value.trim() ? `: "${repositoryName(value.trim())}"` : ""}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="github-repo-create-row mt-1.5">
        {!login && onQuickConnect ? (
          <button type="button" className="text-button" disabled={disabled || connecting} onClick={async () => { setConnecting(true); try { await onQuickConnect() } finally { setConnecting(false) } }}>
            {connecting ? "Connecting GitHub CLI…" : "Connect GitHub CLI to search"}
          </button>
        ) : null}
        <button type="button" className="text-button" disabled={disabled} onClick={() => (creatingOpen ? setCreatingOpen(false) : openCreateForm())}>
          <Plus size={12} /> {creatingOpen ? "Hide create repo" : "Create new repo on GitHub"}
        </button>
      </div>

      {creatingOpen ? (
        <div className="github-repo-create-box">
          <div className="text-xs font-semibold">Create new GitHub repository</div>
          {createError ? <Banner tone="error">{createError}</Banner> : null}
          <Input value={newRepoName} placeholder="repository-name (or org/repository-name)" disabled={creatingBusy} onChange={e => setNewRepoName(e.target.value)} />
          <Input value={newRepoDesc} placeholder="Short description (optional)" disabled={creatingBusy} onChange={e => setNewRepoDesc(e.target.value)} />
          <div className="github-repo-create-row">
            <div className="flex items-center gap-2.5">
              {(["private", "public"] as const).map(vis => (
                <label key={vis} className="m-0 inline-flex cursor-pointer items-center gap-1 capitalize">
                  <input type="radio" name={`vis-${listId}`} checked={newRepoVisibility === vis} onChange={() => setNewRepoVisibility(vis)} className="h-auto w-auto" />
                  {vis}
                </label>
              ))}
              <label className="m-0 inline-flex cursor-pointer items-center gap-1">
                <input type="checkbox" checked={newRepoReadme} onChange={e => setNewRepoReadme(e.target.checked)} className="h-auto w-auto" />
                README
              </label>
            </div>
            <Button variant="primary" size="sm" loading={creatingBusy} disabled={!newRepoName.trim()} onClick={() => void handleCreateRepo()}>
              {creatingBusy ? "Creating…" : "Create & Link"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
