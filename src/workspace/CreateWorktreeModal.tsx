import { useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitPullRequest,
  Laptop,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react"
import { request } from "../../api"
import type { GitHubIssue, StartFrom, TaskStart } from "../../app-types"
import type { Project } from "../../ProjectsView"
import { targetLabel, targetUnavailable, useRunTargets, type RunTarget } from "../run-targets"

type EngineId = "pi" | "claude-code" | "codex"
type CreateFromTab = "prompt" | "github" | "branch" | "name"

type BranchItem = { name: string; current?: boolean }
type OpenIssueItem = { number: number; title: string; body: string; state: "open" | "closed"; url: string; repository: string }
type OpenPullItem = { number: number; title: string; headRefName?: string }

export function CreateWorktreeModal({
  open,
  projects,
  initialProjectId,
  environmentName,
  starting,
  error,
  onClose,
  onAddProject,
  onOpenProviderSettings,
  onCreate,
}: {
  open: boolean
  projects: Project[]
  initialProjectId: string | null
  environmentName: string
  starting: boolean
  error: string
  onClose: () => void
  onAddProject: () => void
  onOpenProviderSettings: () => void
  onCreate: (input: {
    projectId: string | null
    kind: TaskStart["kind"]
    repository: string
    prompt: string
    githubIssue?: GitHubIssue
    engine: EngineId
    startFrom?: StartFrom
    title?: string
    attempts?: EngineId[]
    runOn?: RunTarget
  }) => Promise<void>
}) {
  const unarchived = useMemo(() => projects.filter(p => !p.archivedAt), [projects])
  const [projectId, setProjectId] = useState<string>(initialProjectId ?? unarchived[0]?.id ?? "")
  const [runOn, setRunOn] = useState<RunTarget>("local")
  const [fromTab, setFromTab] = useState<CreateFromTab>("prompt")
  const [queryText, setQueryText] = useState("")
  const [baseBranch, setBaseBranch] = useState("origin/main")
  const [selectedBranch, setSelectedBranch] = useState("")
  const [selectedPr, setSelectedPr] = useState<OpenPullItem | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<OpenIssueItem | null>(null)
  const [engine, setEngine] = useState<EngineId>("pi")
  const [kind, setKind] = useState<TaskStart["kind"]>("worktree")
  const [attempts, setAttempts] = useState(1)
  const [manualRepo, setManualRepo] = useState("")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [createMore, setCreateMore] = useState(false)
  const [localError, setLocalError] = useState("")
  const [branches, setBranches] = useState<BranchItem[]>([])
  const [issues, setIssues] = useState<OpenIssueItem[]>([])
  const [pulls, setPulls] = useState<OpenPullItem[]>([])
  const [prevSyncKey, setPrevSyncKey] = useState(`${open}:${initialProjectId ?? ""}`)

  const inputRef = useRef<HTMLInputElement>(null)
  const runTargets = useRunTargets()

  const syncKey = `${open}:${initialProjectId ?? ""}`
  if (syncKey !== prevSyncKey) {
    setPrevSyncKey(syncKey)
    if (open) {
      const nextProj = unarchived.find(p => p.id === initialProjectId) ?? unarchived[0] ?? null
      setProjectId(nextProj?.id ?? "")
      setManualRepo(nextProj?.repository ?? "")
      setKind(nextProj?.repository ? "worktree" : "checkout")
      setQueryText("")
      setSelectedBranch("")
      setSelectedPr(null)
      setSelectedIssue(null)
      setLocalError("")
    }
  }

  const activeProject = unarchived.find(p => p.id === projectId) ?? null
  const activeRepo = activeProject?.repository ?? ""
  const activeGithubUrl = activeProject?.githubUrl ?? ""

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open, fromTab])

  useEffect(() => {
    if (!open || !projectId || !activeRepo) return
    let cancelled = false
    void request<{ branches?: (string | BranchItem)[] }>(`/api/projects/${encodeURIComponent(projectId)}/branches`)
      .then(res => {
        if (cancelled) return
        const normalized = (res.branches ?? []).map(b => (typeof b === "string" ? { name: b } : b))
        setBranches(normalized)
        const def = normalized.find(b => /^(origin\/)?(main|master)$/.test(b.name))
        if (def) setBaseBranch(def.name)
      })
      .catch(() => {
        if (!cancelled) setBranches([])
      })
    return () => { cancelled = true }
  }, [open, projectId, activeRepo])

  useEffect(() => {
    if (!open || !projectId || !activeGithubUrl || fromTab !== "github") return
    let cancelled = false
    void Promise.all([
      request<{ issues?: OpenIssueItem[] }>(`/api/projects/${encodeURIComponent(projectId)}/issues?state=open`).catch(() => ({ issues: [] })),
      request<{ pullRequests?: OpenPullItem[] }>(`/api/projects/${encodeURIComponent(projectId)}/pulls?state=open`).catch(() => ({ pullRequests: [] })),
    ]).then(([issRes, prRes]) => {
      if (cancelled) return
      setIssues(issRes.issues ?? [])
      setPulls(prRes.pullRequests ?? [])
    })
    return () => { cancelled = true }
  }, [open, projectId, activeGithubUrl, fromTab])

  async function pickFolder() {
    try {
      const res = await request<{ path: string | null }>("/api/system/pick-folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      if (res.path) setManualRepo(res.path)
    } catch {
      // Optional native picker.
    }
  }

  const effectiveRepo = activeRepo || manualRepo.trim()

  const canCreate = !starting && (kind === "none" || Boolean(effectiveRepo)) && (
    Boolean(queryText.trim()) || Boolean(selectedBranch) || Boolean(selectedPr) || Boolean(selectedIssue)
  )

  async function submitCreate() {
    if (!canCreate) {
      if (kind !== "none" && !effectiveRepo) {
        setLocalError("Attach a local folder (under Advanced) or pick a project with a repository.")
        setAdvancedOpen(true)
      }
      return
    }
    setLocalError("")
    const trimmed = queryText.trim()
    let startFrom: StartFrom | undefined
    let title: string | undefined
    let promptText = trimmed

    if (fromTab === "branch" && (selectedBranch || trimmed)) {
      const br = selectedBranch || trimmed
      startFrom = { branch: br }
      title = br
      promptText = ""
    } else if (fromTab === "github" && selectedPr) {
      startFrom = { pullRequest: selectedPr.number }
      title = `PR #${selectedPr.number}: ${selectedPr.title}`
      promptText = trimmed || `Review and work on pull request #${selectedPr.number}: ${selectedPr.title}`
    } else if (fromTab === "github" && selectedIssue) {
      title = `#${selectedIssue.number}: ${selectedIssue.title}`
      promptText = `Work on #${selectedIssue.number}: ${selectedIssue.title}\n\n${selectedIssue.body}`
    } else if (fromTab === "name" && trimmed) {
      title = trimmed
      promptText = `Set up workspace for: ${trimmed}`
    }

    try {
      await onCreate({
        projectId: activeProject?.id ?? null,
        kind,
        repository: kind === "none" ? "" : effectiveRepo,
        prompt: promptText,
        githubIssue: selectedIssue ? { ...selectedIssue, truncated: false } : undefined,
        engine,
        ...(startFrom ? { startFrom } : {}),
        ...(title ? { title } : {}),
        ...(kind !== "none" ? { runOn } : {}),
        ...(kind === "worktree" && !startFrom && attempts > 1 ? { attempts: Array.from({ length: attempts }, () => engine) } : {}),
      })
      if (createMore) {
        setQueryText("")
        setSelectedBranch("")
        setSelectedPr(null)
        setSelectedIssue(null)
        inputRef.current?.focus()
      } else {
        onClose()
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not create worktree.")
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !starting) {
        e.preventDefault()
        onClose()
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault()
        void submitCreate()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!open) return null

  const availableTargets = runTargets?.available ?? ["local", "docker"]
  const filteredBranches = branches.filter(b => !queryText.trim() || b.name.toLowerCase().includes(queryText.trim().toLowerCase())).slice(0, 8)
  const filteredIssues = issues.filter(i => !queryText.trim() || `#${i.number} ${i.title}`.toLowerCase().includes(queryText.trim().toLowerCase())).slice(0, 6)
  const filteredPulls = pulls.filter(p => !queryText.trim() || `#${p.number} ${p.title}`.toLowerCase().includes(queryText.trim().toLowerCase())).slice(0, 6)

  return (
    <div className="ade-cmd-backdrop" onClick={e => { if (e.target === e.currentTarget && !starting) onClose() }}>
      <div className="ade-wt-modal" role="dialog" aria-modal="true" aria-label="Create worktree">
        <div className="ade-wt-head">
          <h2>Create worktree</h2>
          <button type="button" className="ade-wizard-icon-btn" onClick={onClose} disabled={starting} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {(error || localError) ? (
          <div className="px-5">
            <div className="ade-banner-error">{localError || error}</div>
          </div>
        ) : null}

        <div className="ade-wt-body">
          {/* Row 1: Project + Run on */}
          <div className="ade-wt-grid-2">
            <div className="ade-wt-field">
              <div className="ade-wt-label-row">
                <label htmlFor="wt-project">Project</label>
                <button
                  type="button"
                  className="ade-wt-mini-icon"
                  title="Add new project"
                  aria-label="Add new project"
                  onClick={() => { onClose(); onAddProject() }}
                >
                  <FolderPlus className="size-3.5" />
                </button>
              </div>
              <select
                id="wt-project"
                className="ade-wt-select"
                value={projectId}
                onChange={e => {
                  const id = e.target.value
                  setProjectId(id)
                  const next = unarchived.find(p => p.id === id)
                  setManualRepo(next?.repository ?? "")
                  setKind(next?.repository ? "worktree" : "checkout")
                  setSelectedBranch("")
                  setSelectedPr(null)
                  setSelectedIssue(null)
                }}
              >
                {unarchived.length === 0 ? <option value="">No projects yet</option> : null}
                {unarchived.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="ade-wt-field">
              <div className="ade-wt-label-row">
                <label htmlFor="wt-run-on">Run on</label>
              </div>
              <div className="ade-wt-select-wrap">
                <Laptop className="size-3.5 opacity-60 shrink-0" />
                <select
                  id="wt-run-on"
                  className="ade-wt-select-bare"
                  value={runOn}
                  onChange={e => setRunOn(e.target.value as RunTarget)}
                >
                  {availableTargets.map(target => {
                    const blocked = runTargets?.docker ? targetUnavailable(target, runTargets, { sshHost: "" }) : ""
                    return (
                      <option key={target} value={target} disabled={Boolean(blocked)}>
                        {target === "local" ? environmentName : targetLabel(target)}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>
          </div>

          {/* Row 2: Create From [Optional] + Base branch pill */}
          <div className="ade-wt-field">
            <div className="ade-wt-label-row">
              <label htmlFor="wt-create-from">
                Create From <span className="opacity-50 font-normal">[Optional]</span>
              </label>
              {activeRepo ? (
                <div className="ade-wt-branch-pill">
                  <GitBranch className="size-3 opacity-70" />
                  <select
                    aria-label="Base branch"
                    value={baseBranch}
                    onChange={e => setBaseBranch(e.target.value)}
                  >
                    <option value={baseBranch}>{baseBranch}</option>
                    {branches.filter(b => b.name !== baseBranch).slice(0, 12).map(b => (
                      <option key={b.name} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <div className="ade-wt-tabs" role="tablist" aria-label="Create worktree source">
              {(
                [
                  { id: "prompt", title: "Task prompt", icon: <Sparkles className="size-3.5" /> },
                  { id: "github", title: "GitHub issue or PR", icon: <GitPullRequest className="size-3.5" /> },
                  { id: "branch", title: "Existing Git branch", icon: <GitBranch className="size-3.5" /> },
                  { id: "name", title: "Custom workspace name", icon: <span className="text-[11.5px] font-semibold">Aa</span> },
                ] as const
              ).map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={fromTab === tab.id}
                  title={tab.title}
                  className={`ade-wt-tab ${fromTab === tab.id ? "is-active" : ""}`}
                  onClick={() => { setFromTab(tab.id); setSelectedBranch(""); setSelectedPr(null); setSelectedIssue(null) }}
                >
                  {tab.icon}
                </button>
              ))}
            </div>

            <div className="ade-wt-input-box">
              <Search className="size-3.5 opacity-55 shrink-0" />
              <input
                ref={inputRef}
                id="wt-create-from"
                type="text"
                placeholder={
                  fromTab === "github"
                    ? "Search open issues/PRs or enter #1234…"
                    : fromTab === "branch"
                      ? "Filter or type a Git branch name…"
                      : fromTab === "name"
                        ? "Give this workspace a name…"
                        : "Type a task, #1234, branch, or GitHub URL…"
                }
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
              />
              {queryText ? (
                <button type="button" className="ade-wt-mini-icon" onClick={() => setQueryText("")} aria-label="Clear">
                  <X className="size-3" />
                </button>
              ) : null}
            </div>

            {fromTab === "branch" && filteredBranches.length > 0 ? (
              <div className="ade-wt-pick-list">
                {filteredBranches.map(b => (
                  <button
                    key={b.name}
                    type="button"
                    className={`ade-wt-pick-item ${selectedBranch === b.name ? "is-selected" : ""}`}
                    onClick={() => { setSelectedBranch(b.name); setQueryText(b.name) }}
                  >
                    <GitBranch className="size-3 opacity-60 shrink-0" />
                    <span className="ade-truncate">{b.name}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {fromTab === "github" && (filteredIssues.length > 0 || filteredPulls.length > 0) ? (
              <div className="ade-wt-pick-list">
                {filteredIssues.map(iss => (
                  <button
                    key={`iss-${iss.number}`}
                    type="button"
                    className={`ade-wt-pick-item ${selectedIssue?.number === iss.number ? "is-selected" : ""}`}
                    onClick={() => { setSelectedIssue(iss); setSelectedPr(null); setQueryText(`#${iss.number} ${iss.title}`) }}
                  >
                    <span className="font-mono text-[11px] opacity-60">#{iss.number}</span>
                    <span className="ade-truncate">{iss.title}</span>
                  </button>
                ))}
                {filteredPulls.map(pr => (
                  <button
                    key={`pr-${pr.number}`}
                    type="button"
                    className={`ade-wt-pick-item ${selectedPr?.number === pr.number ? "is-selected" : ""}`}
                    onClick={() => { setSelectedPr(pr); setSelectedIssue(null); setQueryText(`PR #${pr.number} ${pr.title}`) }}
                  >
                    <GitPullRequest className="size-3 opacity-65 shrink-0" />
                    <span className="font-mono text-[11px] opacity-60">#{pr.number}</span>
                    <span className="ade-truncate">{pr.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Row 3: Agent [Optional] */}
          <div className="ade-wt-field">
            <div className="ade-wt-label-row">
              <label htmlFor="wt-agent">
                Agent <span className="opacity-50 font-normal">[Optional]</span>
              </label>
              <button
                type="button"
                className="ade-wt-mini-icon"
                title="Configure providers"
                aria-label="Configure providers"
                onClick={() => { onClose(); onOpenProviderSettings() }}
              >
                <SlidersHorizontal className="size-3.5" />
              </button>
            </div>
            <div className="ade-wt-select-wrap">
              <Bot className="size-3.5 opacity-75 shrink-0" />
              <select
                id="wt-agent"
                className="ade-wt-select-bare"
                value={engine}
                onChange={e => setEngine(e.target.value as EngineId)}
              >
                <option value="pi">ADE Agent (Pi Durable)</option>
                <option value="claude-code">Claude Code (CLI)</option>
                <option value="codex">Codex (CLI)</option>
              </select>
            </div>
          </div>

          {/* Row 4: Advanced disclosure */}
          <div>
            <button
              type="button"
              className="ade-wt-advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen(v => !v)}
            >
              <span>Advanced</span>
              {advancedOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>

            {advancedOpen ? (
              <div className="ade-wt-advanced-body">
                <div className="ade-wt-grid-2">
                  <div className="ade-wt-field">
                    <label htmlFor="wt-kind">Workspace mode</label>
                    <select id="wt-kind" className="ade-wt-select" value={kind} onChange={e => setKind(e.target.value as TaskStart["kind"])}>
                      <option value="worktree">New branch (worktree)</option>
                      <option value="checkout">Direct checkout</option>
                      <option value="none">Chat only</option>
                    </select>
                  </div>
                  <div className="ade-wt-field">
                    <label htmlFor="wt-attempts">Parallel attempts</label>
                    <select id="wt-attempts" className="ade-wt-select" value={attempts} onChange={e => setAttempts(Number(e.target.value))}>
                      <option value={1}>1 agent</option>
                      <option value={2}>2 parallel branches</option>
                      <option value={3}>3 parallel branches</option>
                    </select>
                  </div>
                </div>
                {kind !== "none" && !activeRepo ? (
                  <div className="ade-wt-field">
                    <label htmlFor="wt-folder">Local folder path</label>
                    <div className="flex gap-2">
                      <input
                        id="wt-folder"
                        className="sf-field flex-1 !h-8"
                        placeholder="/Users/you/Code/my-project"
                        value={manualRepo}
                        onChange={e => setManualRepo(e.target.value)}
                      />
                      <button type="button" className="sf-btn-secondary !h-8" onClick={() => void pickFolder()}>
                        <FolderOpen className="size-3.5" /> Browse…
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer: Create more switch + Create ⌘↩ */}
        <div className="ade-wt-footer">
          <label className="ade-wt-more-toggle">
            <button
              type="button"
              role="switch"
              aria-checked={createMore}
              className={`st-switch ${createMore ? "is-on" : ""}`}
              onClick={() => setCreateMore(v => !v)}
            >
              <span />
            </button>
            <span>Create more</span>
          </label>

          <button
            type="button"
            className="ade-wt-create-btn"
            disabled={!canCreate}
            onClick={() => void submitCreate()}
          >
            <span>{starting ? "Creating…" : "Create"}</span>
            <kbd>⌘↩</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
