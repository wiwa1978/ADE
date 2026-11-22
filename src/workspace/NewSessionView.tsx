import { useCallback, useEffect, useState, type FormEvent } from "react"
import {
  ArrowUp,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Link2,
  Server,
  Sparkles,
  Workflow,
  X,
} from "lucide-react"
import { request } from "../../api"
import type { ApprovalPolicy, GitHubIssue, ProviderCatalogEntry, TaskStart } from "../../app-types"
import type { Project } from "../../ProjectsView"
import { ModelPicker } from "../composer/ModelPicker"

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

  const effectiveRepo = activeProject?.repository || repository

  const handleProjectChange = (nextId: string) => {
    const id = nextId === "__none__" ? null : nextId
    onSelectProject(id)
    const proj = projects.find(p => p.id === id)
    setRepository(proj?.repository ?? "")
    setKind(proj?.repository ? "worktree" : "checkout")
    setLinkedIssue(null)
    setOpenIssues([])
    setIssueOpen(false)
  }

  const loadProjectIssues = useCallback(async () => {
    if (!activeProject?.id || !activeProject.githubUrl) return
    setLoadingIssues(true)
    setIssueError("")
    try {
      const res = await request<{ issues: OpenIssueOption[] }>(
        `/api/projects/${encodeURIComponent(activeProject.id)}/issues?state=open`,
      )
      setOpenIssues(res.issues)
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : "Could not load open GitHub issues.")
    } finally {
      setLoadingIssues(false)
    }
  }, [activeProject?.id, activeProject?.githubUrl])

  useEffect(() => {
    if (issueOpen && activeProject?.githubUrl && openIssues.length === 0) {
      void loadProjectIssues()
    }
  }, [issueOpen, activeProject?.githubUrl, openIssues.length, loadProjectIssues])

  async function pickFolder() {
    try {
      const res = await request<{ path: string | null }>("/api/system/pick-folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      if (res.path) setRepository(res.path)
    } catch {
      // ignore if native dialog unavailable
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
    } catch (err: any) {
      setIssueError(err?.message || "Could not load issue.")
    } finally {
      setLookingUp(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) return
    void onStart({
      projectId: selectedProjectId,
      kind,
      repository: kind === "none" ? "" : effectiveRepo.trim(),
      prompt: prompt.trim(),
      githubIssue: linkedIssue ?? undefined,
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
              <h1 className="text-lg font-semibold tracking-tight">New Task</h1>
              <p className="text-xs opacity-65 mt-0.5">
                Start a coding task inside a project — inherits its repository, GitHub link, and blueprint automatically.
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sf-label">
              <span>Project (Codebase)</span>
              <div className="flex gap-1.5">
                <select
                  className="sf-field flex-1"
                  value={selectedProjectId ?? "__none__"}
                  onChange={e => handleProjectChange(e.target.value)}
                >
                  <option value="__none__">Standalone (no project)</option>
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
              <span>Workspace Isolation</span>
              <div className="sf-segmented h-9 w-full justify-between">
                {(
                  [
                    { id: "worktree", label: "Worktree" },
                    { id: "checkout", label: "Checkout" },
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

          {/* Inherited Project Context Strip (clean, read-only summary when project already has a repo!) */}
          {activeProject && activeProject.repository && kind !== "none" ? (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--border)/0.75)] bg-[rgb(var(--surface)/0.65)] text-xs">
              <span className="sf-badge sf-badge-accent">
                <Workflow className="size-3" /> {activeProject.blueprintId ?? "automated-factory"}
              </span>
              <span className="sf-badge sf-badge-muted font-mono max-w-[280px] truncate">
                <FolderGit2 className="size-3 shrink-0" /> {activeProject.repository}
              </span>
              {activeProject.githubUrl ? (
                <span className="sf-badge sf-badge-muted font-mono">
                  <GitBranch className="size-3" /> {activeProject.githubUrl.replace(/^https:\/\/github\.com\//i, "")}
                </span>
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
              placeholder="What should the Captain and subagents build, fix, or refactor? (Enter to start, Shift+Enter for newline)"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (prompt.trim()) handleSubmit(e)
                }
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-[rgb(var(--border)/0.65)] bg-[rgb(var(--surface-raised)/0.5)]">
              <div className="flex items-center gap-2">
                <ModelPicker
                  catalog={modelCatalog}
                  selectedProvider={selectedProvider}
                  selectedModel={selectedModel}
                  reasoning={reasoning}
                  approvalPolicy={approvalPolicy}
                  onSelectModel={onSelectModel}
                  onSelectReasoning={onSelectReasoning}
                  onChangeApprovalPolicy={onChangeApprovalPolicy}
                  onOpenSettings={onOpenSettings}
                />
              </div>

              <button
                type="submit"
                className="sf-btn-primary"
                disabled={starting || !prompt.trim() || (kind !== "none" && !effectiveRepo.trim())}
              >
                <ArrowUp className="size-3.5" />
                {starting ? "Starting…" : "Start Task"}
              </button>
            </div>
          </div>

          {error ? <div className="ade-banner-error">{error}</div> : null}
        </form>
      </div>
    </div>
  )
}
