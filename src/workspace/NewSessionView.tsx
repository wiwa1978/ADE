import { useEffect, useState, type FormEvent } from "react"
import {
  ArrowUp,
  FolderOpen,
  FolderPlus,
  Link2,
  Server,
  Sparkles,
  X,
} from "lucide-react"
import { request } from "../../api"
import type { ApprovalPolicy, GitHubIssue, ProviderCatalogEntry, StartFrom, TaskStart } from "../../app-types"
import type { Project } from "../../ProjectsView"
import { ModelPicker } from "../composer/ModelPicker"
import { StartFromPicker, type StartChoice } from "./StartFromPicker"

type EngineId = "pi" | "claude-code" | "codex"
type EngineOption = { id: EngineId; name: string; description: string; available: boolean }

type OpenIssueOption = {
  repository: string
  number: number
  title: string
  body: string
  state: "open" | "closed"
  url: string
}

export function NewSessionView({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onOpenEnvironmentPalette,
  environmentName,
  modelCatalog,
  selectedProvider,
  selectedModel,
  onSelectModel,
  reasoning,
  onSelectReasoning,
  approvalPolicy,
  onChangeApprovalPolicy,
  onOpenSettings,
  starting,
  error,
  onStart,
  onLookupIssue,
}: {
  projects: Project[]
  selectedProjectId: string | null
  onSelectProject: (id: string | null) => void
  onAddProject?: () => void
  onOpenEnvironmentPalette?: () => void
  environmentName: string
  modelCatalog: ProviderCatalogEntry[]
  selectedProvider: string
  selectedModel: string
  onSelectModel: (provider: string, id: string) => void
  reasoning: string
  onSelectReasoning: (level: string) => void
  approvalPolicy?: ApprovalPolicy
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => void
  onOpenSettings?: () => void
  starting: boolean
  error: string
  onStart: (input: {
    projectId: string | null
    kind: TaskStart["kind"]
    repository: string
    prompt: string
    githubIssue?: GitHubIssue
    engine: EngineId
    startFrom?: StartFrom
    title?: string
    attempts?: EngineId[]
  }) => Promise<void>
  onLookupIssue?: (projectId: string, url: string) => Promise<GitHubIssue>
}) {
  const activeProject = projects.find(p => p.id === selectedProjectId) ?? null
  const [kind, setKind] = useState<TaskStart["kind"]>(activeProject?.repository ? "worktree" : "checkout")
  const [repository, setRepository] = useState(activeProject?.repository ?? "")
  const [prompt, setPrompt] = useState("")
  const [issueOpen, setIssueOpen] = useState(false)
  const [issueUrl, setIssueUrl] = useState("")
  const [openIssues, setOpenIssues] = useState<OpenIssueOption[]>([])
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [linkedIssue, setLinkedIssue] = useState<GitHubIssue | null>(null)
  const [issueError, setIssueError] = useState("")
  const [lookingUp, setLookingUp] = useState(false)
  const [engines, setEngines] = useState<EngineOption[]>([])
  const [engine, setEngine] = useState<EngineId>("pi")
  const [startChoice, setStartChoice] = useState<StartChoice>({ mode: "new" })
  // Best of N: run the same task several times, each in its own worktree, possibly with different agents.
  const [attemptCount, setAttemptCount] = useState(1)
  const [attemptEngines, setAttemptEngines] = useState<Array<EngineId | null>>([null, null, null])

  useEffect(() => {
    let active = true
    void request<{ engines: EngineOption[] }>("/api/engines").then(result => { if (active) setEngines(result.engines) }).catch(() => undefined)
    return () => { active = false }
  }, [])
  // External agents need a workspace to work in.
  const engineAllowed = (id: EngineId) => id === "pi" || kind !== "none"
  const activeEngine = engines.find(item => item.id === engine)

  const effectiveRepo = activeProject?.repository || repository

  const handleProjectChange = (nextId: string) => {
    const id = nextId === "__none__" ? null : nextId
    onSelectProject(id)
    setStartChoice({ mode: "new" })
    const proj = projects.find(p => p.id === id)
    setRepository(proj?.repository ?? "")
    setKind(proj?.repository ? "worktree" : "checkout")
    setLinkedIssue(null)
    setOpenIssues([])
    setIssueOpen(false)
  }

  const activeProjectId = activeProject?.id ?? null
  const activeProjectGithubUrl = activeProject?.githubUrl ?? null

  useEffect(() => {
    if (!issueOpen || !activeProjectId || !activeProjectGithubUrl || openIssues.length > 0) return
    let cancelled = false
    void request<{ issues: OpenIssueOption[] }>(
      `/api/projects/${encodeURIComponent(activeProjectId)}/issues?state=open`,
    )
      .then(res => {
        if (!cancelled) {
          setOpenIssues(res.issues)
          setIssueError("")
          setLoadingIssues(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setIssueError(err instanceof Error ? err.message : "Could not load open GitHub issues.")
          setLoadingIssues(false)
        }
      })
    return () => { cancelled = true }
  }, [issueOpen, activeProjectId, activeProjectGithubUrl, openIssues.length])

  async function pickFolder() {
    try {
      const res = await request<{ path: string | null }>("/api/system/pick-folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      if (res.path) setRepository(res.path)
    } catch (err) {
      // Native OS folder picker is optional on headless/Linux hosts; log for diagnostics.
      console.warn("[ADE] Native folder picker unavailable:", err instanceof Error ? err.message : String(err))
    }
  }

  const handleLookupIssue = async () => {
    if (!selectedProjectId || !issueUrl.trim() || !onLookupIssue) return
    setLookingUp(true)
    setIssueError("")
    try {
      const issue = await onLookupIssue(selectedProjectId, issueUrl.trim())
      setLinkedIssue(issue)
      if (!prompt.trim()) setPrompt(`Work on #${issue.number}: ${issue.title}`)
      setIssueOpen(false)
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : "Could not load issue.")
    } finally {
      setLookingUp(false)
    }
  }

  // Starting from existing work: the prompt is optional, the session is named after the branch or PR.
  const canStartFrom = kind === "worktree" && Boolean(activeProject?.repository)
  const startFrom: StartFrom | undefined = !canStartFrom ? undefined
    : startChoice.mode === "branch" && startChoice.branch ? { branch: startChoice.branch }
      : startChoice.mode === "pr" && startChoice.number ? { pullRequest: startChoice.number }
        : undefined
  const startFromIncomplete = canStartFrom && startChoice.mode !== "new" && !startFrom
  const startTitle = startChoice.mode === "branch" ? startChoice.branch
    : startChoice.mode === "pr" && startChoice.number ? `PR #${startChoice.number}${startChoice.title ? `: ${startChoice.title}` : ""}` : undefined
  const canAttempt = kind === "worktree" && startChoice.mode === "new"
  const availableEngines = engines.filter(option => option.available)
  const canSubmit = !starting && !startFromIncomplete && (Boolean(prompt.trim()) || Boolean(startFrom)) && (kind === "none" || Boolean(effectiveRepo.trim()))

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    void onStart({
      projectId: selectedProjectId,
      kind,
      repository: kind === "none" ? "" : effectiveRepo.trim(),
      prompt: prompt.trim(),
      githubIssue: linkedIssue ?? undefined,
      engine: engineAllowed(engine) ? engine : "pi",
      ...(startFrom ? { startFrom, title: startTitle } : {}),
      ...(canAttempt && attemptCount > 1 ? { attempts: attemptEngines.slice(0, attemptCount).map(item => item ?? engine) } : {}),
    })
  }

  const needsManualRepo = kind !== "none" && !activeProject?.repository

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl flex flex-col gap-5">
        {/* Clean Heading */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl grid place-items-center bg-[rgb(var(--primary)/0.14)] text-[rgb(var(--primary))] border border-[rgb(var(--primary)/0.3)] shrink-0">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">New session</h1>
              <p className="text-xs opacity-65 mt-0.5">
                An agent works on the task in its own workspace. You review its changes and ship them as a pull request.
              </p>
            </div>
          </div>
          {onOpenEnvironmentPalette ? (
            <button type="button" className="sf-btn-secondary shrink-0" onClick={onOpenEnvironmentPalette} title="Switch environment (Cmd+E)">
              <Server className="size-3.5 opacity-75" /> {environmentName}
            </button>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Clean Top Context Row: Project + Execution Mode */}
          <div className="flex flex-col gap-3">
            <div className="sf-label">
              <span>Project</span>
              <div className="flex gap-1.5">
                <select
                  className="sf-field flex-1"
                  value={selectedProjectId ?? "__none__"}
                  onChange={e => handleProjectChange(e.target.value)}
                >
                  <option value="__none__">No project</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {onAddProject ? (
                  <button type="button" className="sf-btn-secondary shrink-0" onClick={onAddProject} title="Add new project">
                    <FolderPlus className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="sf-label">
              <span>Workspace</span>
              <div className="sf-segmented h-9 w-full justify-between">
                {(
                  [
                    { id: "worktree", label: "Own branch" },
                    { id: "checkout", label: "Project folder" },
                    { id: "none", label: "Chat only" },
                  ] as const
                ).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`sf-seg-btn flex-1 justify-center ${kind === opt.id ? "is-active" : ""}`}
                    onClick={() => setKind(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {canStartFrom && activeProject ? (
            <StartFromPicker
              key={activeProject.id}
              projectId={activeProject.id}
              hasGitHub={Boolean(activeProject.githubUrl)}
              value={startChoice}
              onChange={setStartChoice}
            />
          ) : null}

          {/* Which agent does the work */}
          {engines.length > 1 ? (
            <div className="sf-label">
              <span>Agent</span>
              <div className="sf-segmented h-9 w-full justify-between" role="radiogroup" aria-label="Agent">
                {engines.map(option => {
                  const disabledOption = !option.available || !engineAllowed(option.id)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={engine === option.id}
                      disabled={disabledOption}
                      title={!option.available ? `${option.name} isn't installed on this host` : !engineAllowed(option.id) ? `${option.name} needs a workspace (own branch or project folder)` : option.description}
                      className={`sf-seg-btn flex-1 justify-center ${engine === option.id ? "is-active" : ""}`}
                      onClick={() => setEngine(option.id)}
                    >
                      {option.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {canAttempt ? (
            <div className="sf-label">
              <span>Attempts</span>
              <div className="ade-attempts-row">
                <div className="sf-segmented h-9" role="radiogroup" aria-label="Attempts">
                  {[1, 2, 3].map(count => (
                    <button key={count} type="button" role="radio" aria-checked={attemptCount === count}
                      className={`sf-seg-btn justify-center ${attemptCount === count ? "is-active" : ""}`} style={{ minWidth: 44 }}
                      onClick={() => setAttemptCount(count)}>
                      {count}
                    </button>
                  ))}
                </div>
                <small className="opacity-65">{attemptCount === 1 ? "One agent on one branch." : `${attemptCount} agents work on the same task, each on its own branch. Compare the results and keep the best.`}</small>
              </div>
              {attemptCount > 1 && availableEngines.length > 1 ? (
                <div className="ade-attempts-agents">
                  {Array.from({ length: attemptCount }, (_, index) => (
                    <label key={index}>
                      <span>Attempt {"ABC"[index]}</span>
                      <select className="sf-field !h-8" value={attemptEngines[index] ?? engine}
                        onChange={event => setAttemptEngines(current => current.map((item, i) => (i === index ? event.target.value as EngineId : item)))}>
                        {availableEngines.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Only ask for a manual local path if the project doesn't have one yet */}
          {needsManualRepo ? (
            <div className="sf-label">
              <span>Local Git Repository Path</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="sf-field flex-1"
                  placeholder="/Users/you/Code/my-project"
                  value={repository}
                  onChange={e => setRepository(e.target.value)}
                />
                <button type="button" className="sf-btn-secondary" onClick={() => void pickFolder()}>
                  <FolderOpen className="size-3.5" /> Browse…
                </button>
              </div>
            </div>
          ) : null}

          {/* Optional GitHub Issue Picker (loads real open issues from project!) */}
          {activeProject?.githubUrl ? (
            <div className="flex flex-col gap-2">
              {linkedIssue ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--primary)/0.45)] bg-[rgb(var(--primary)/0.1)] text-xs">
                  <span className="truncate">
                    <strong className="font-mono">#{linkedIssue.number}</strong> {linkedIssue.title}
                  </span>
                  <button type="button" className="sf-btn-ghost !h-6 !px-1.5" onClick={() => setLinkedIssue(null)}>
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : !issueOpen ? (
                <div>
                  <button type="button" className="sf-btn-secondary" onClick={() => setIssueOpen(true)}>
                    <Link2 className="size-3.5" /> Import GitHub issue from {activeProject.githubUrl.replace(/^https:\/\/github\.com\//i, "")}
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3 flex flex-col gap-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Import GitHub Issue</span>
                    <button type="button" className="sf-btn-ghost !h-6 !px-1.5" onClick={() => setIssueOpen(false)}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                  {loadingIssues ? (
                    <div className="opacity-65 py-2">Loading open issues…</div>
                  ) : openIssues.length > 0 ? (
                    <div className="max-h-36 overflow-y-auto divide-y divide-[rgb(var(--border)/0.5)] rounded-lg border border-[rgb(var(--border)/0.7)] bg-[rgb(var(--background))]">
                      {openIssues.map(iss => (
                        <button
                          key={iss.number}
                          type="button"
                          className="w-full px-3 py-2 text-left hover:bg-[rgb(var(--surface-raised))] flex items-center gap-2"
                          onClick={() => {
                            setLinkedIssue({ ...iss, truncated: false })
                            if (!prompt.trim()) setPrompt(`Implement #${iss.number}: ${iss.title}\n\n${iss.body}`)
                            setIssueOpen(false)
                          }}
                        >
                          <span className="font-mono opacity-60">#{iss.number}</span>
                          <span className="truncate">{iss.title}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="sf-field !h-8 flex-1"
                      placeholder="Or paste issue URL (https://github.com/owner/repo/issues/123)"
                      value={issueUrl}
                      onChange={e => setIssueUrl(e.target.value)}
                    />
                    <button type="button" className="sf-btn-secondary !h-8" disabled={lookingUp || !issueUrl.trim()} onClick={() => void handleLookupIssue()}>
                      {lookingUp ? "Loading…" : "Load"}
                    </button>
                  </div>
                  {issueError ? <div className="text-rose-400">{issueError}</div> : null}
                </div>
              )}
            </div>
          ) : null}

          {/* Main Task Prompt Composer */}
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] focus-within:border-[rgb(var(--primary))] transition-colors overflow-hidden">
            <textarea
              className="w-full bg-transparent border-0 outline-none resize-none px-4 pt-3.5 pb-2 text-[13.5px] leading-relaxed text-[rgb(var(--foreground))]"
              rows={4}
              placeholder={startFrom ? "Optional: what should the agent do on this branch? Leave empty to just open it." : "Describe the task. Enter to start, Shift+Enter for a new line."}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (canSubmit) handleSubmit(e)
                }
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-[rgb(var(--border)/0.65)] bg-[rgb(var(--surface-raised)/0.5)]">
              <div className="flex items-center gap-2">
                {engine !== "pi" && engineAllowed(engine) ? (
                  <span className="text-xs opacity-70">{activeEngine?.name} uses its own sign-in and model.</span>
                ) : <ModelPicker
                  catalog={modelCatalog}
                  selectedProvider={selectedProvider}
                  selectedModel={selectedModel}
                  reasoning={reasoning}
                  approvalPolicy={approvalPolicy}
                  onSelectModel={onSelectModel}
                  onSelectReasoning={onSelectReasoning}
                  onChangeApprovalPolicy={onChangeApprovalPolicy}
                  onOpenSettings={onOpenSettings}
                />}
              </div>

              <button
                type="submit"
                className="sf-btn-primary"
                disabled={!canSubmit}
              >
                <ArrowUp className="size-3.5" />
                {starting ? "Starting…" : canAttempt && attemptCount > 1 ? `Start ${attemptCount} attempts` : "Start session"}
              </button>
            </div>
          </div>

          {error ? <div className="ade-banner-error">{error}</div> : null}
        </form>
      </div>
    </div>
  )
}
