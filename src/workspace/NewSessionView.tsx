import { useEffect, useRef, useState } from "react"
import {
  Check,
  ChevronDown,
  Cpu,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Layers,
  Link2,
  MessageSquare,
  Search,
  Server,
  Settings2,
  X,
} from "lucide-react"
import { request } from "../../api"
import type { ApprovalPolicy, GitHubIssue, ProviderCatalogEntry, SkillsAndRulesCatalog, StartFrom, TaskStart } from "../../app-types"
import type { Project } from "../../ProjectsView"
import { ComposerDock } from "../composer/ComposerDock"
import { StartFromPicker, type StartChoice } from "./StartFromPicker"
import { LinearIssuePicker, type LinearIssue } from "./LinearIssuePicker"
import { runTargetDescriptions, targetLabel, targetUnavailable, useRunTargets, type RunTarget, type TargetSettings } from "../run-targets"
import { DEFAULT_KEYBINDINGS, formatShortcut, type KeybindingMap } from "../keybindings"
import { ConversationLayout } from "./ConversationLayout"
import { WorkspaceEmptyHero } from "./WorkspaceEmptyHero"

type EngineId = "pi" | "claude-code" | "codex"
type OpenMenu = null | "project" | "workspace" | "runOn" | "attempts"

type OpenIssueOption = {
  repository: string
  number: number
  title: string
  body: string
  state: "open" | "closed"
  url: string
}

const WORKSPACE_OPTIONS: { id: TaskStart["kind"]; label: string; desc: string }[] = [
  { id: "worktree", label: "New branch", desc: "Isolated Git worktree so your main checkout stays clean" },
  { id: "checkout", label: "Direct checkout", desc: "Edit files directly in the project's existing checkout" },
  { id: "none", label: "Chat only", desc: "Conversation without attaching a codebase" },
]

export function NewSessionView({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onConfigureProject,
  onOpenEnvironmentPalette,
  environmentName,
  keybindings = DEFAULT_KEYBINDINGS,
  modelCatalog,
  selectedProvider,
  selectedModel,
  onSelectModel,
  reasoning,
  onSelectReasoning,
  approvalPolicy,
  onChangeApprovalPolicy,
  skillsCatalog,
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
  onConfigureProject?: (projectId: string) => void
  onOpenEnvironmentPalette?: () => void
  environmentName: string
  keybindings?: KeybindingMap
  modelCatalog: ProviderCatalogEntry[]
  selectedProvider: string
  selectedModel: string
  onSelectModel: (provider: string, id: string) => void
  reasoning: string
  onSelectReasoning: (level: string) => void
  approvalPolicy?: ApprovalPolicy
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => void
  skillsCatalog?: SkillsAndRulesCatalog
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
    runOn?: RunTarget
  }) => Promise<void>
  onLookupIssue?: (projectId: string, url: string) => Promise<GitHubIssue>
}) {
  const unarchivedProjects = projects.filter(p => !p.archivedAt)
  const activeProject = unarchivedProjects.find(p => p.id === selectedProjectId) ?? null
  const [sessionTitle, setSessionTitle] = useState("")
  const [kind, setKind] = useState<TaskStart["kind"]>(activeProject?.repository ? "worktree" : "checkout")
  const [repository, setRepository] = useState(activeProject?.repository ?? "")
  const [prompt, setPrompt] = useState("")
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [projectQuery, setProjectQuery] = useState("")
  const [issueOpen, setIssueOpen] = useState(false)
  const [issueUrl, setIssueUrl] = useState("")
  const [openIssues, setOpenIssues] = useState<OpenIssueOption[]>([])
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [linkedIssue, setLinkedIssue] = useState<GitHubIssue | null>(null)
  const [issueError, setIssueError] = useState("")
  const [lookingUp, setLookingUp] = useState(false)
  const [startChoice, setStartChoice] = useState<StartChoice>({ mode: "new" })
  const [linearIssue, setLinearIssue] = useState<LinearIssue | null>(null)
  const [runOn, setRunOn] = useState<RunTarget | null>(null)
  const [projectRunOn, setProjectRunOn] = useState<({ projectId: string } & TargetSettings) | null>(null)
  const [attemptCount, setAttemptCount] = useState(1)

  const pillBarRef = useRef<HTMLDivElement>(null)
  const runTargets = useRunTargets()

  useEffect(() => {
    if (!selectedProjectId) return
    let cancelled = false
    void request<TargetSettings>(`/api/projects/${encodeURIComponent(selectedProjectId)}/run-on`)
      .then(result => { if (!cancelled) setProjectRunOn({ projectId: selectedProjectId, ...result }) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedProjectId])

  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (e: MouseEvent) => {
      if (pillBarRef.current && !pillBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [openMenu])

  const defaultRunOn = projectRunOn && projectRunOn.projectId === selectedProjectId ? projectRunOn.target : "local"
  const effectiveRunOn = runOn ?? defaultRunOn
  const effectiveRepo = activeProject?.repository || repository

  const handleProjectChange = (nextId: string | null) => {
    onSelectProject(nextId)
    setStartChoice({ mode: "new" })
    setRunOn(null)
    const proj = unarchivedProjects.find(p => p.id === nextId)
    setRepository(proj?.repository ?? "")
    setKind(proj?.repository ? "worktree" : "checkout")
    setLinkedIssue(null)
    setOpenIssues([])
    setIssueOpen(false)
    setOpenMenu(null)
    setProjectQuery("")
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

  const canStartFrom = kind === "worktree" && Boolean(activeProject?.repository)
  const startFrom: StartFrom | undefined = !canStartFrom ? undefined
    : startChoice.mode === "branch" && startChoice.branch ? { branch: startChoice.branch }
      : startChoice.mode === "pr" && startChoice.number ? { pullRequest: startChoice.number }
        : undefined
  const startFromIncomplete = canStartFrom && startChoice.mode !== "new" && !startFrom
  const startTitle = startChoice.mode === "branch" ? startChoice.branch
    : startChoice.mode === "pr" && startChoice.number ? `PR #${startChoice.number}${startChoice.title ? `: ${startChoice.title}` : ""}` : undefined
  const canAttempt = kind === "worktree" && startChoice.mode === "new"
  const readyToStart = !starting && !startFromIncomplete && (kind === "none" || Boolean(effectiveRepo.trim()))
  const needsManualRepo = kind !== "none" && !activeProject?.repository

  const handleSubmitText = (text: string) => {
    if (!readyToStart) return
    const trimmed = text.trim()
    if (!trimmed && !startFrom) return
    const customTitle = sessionTitle.trim()
    const resolvedTitle = customTitle
      || startTitle
      || (linearIssue ? `${linearIssue.identifier}: ${linearIssue.title}` : undefined)
    void onStart({
      projectId: selectedProjectId,
      kind,
      repository: kind === "none" ? "" : effectiveRepo.trim(),
      prompt: trimmed,
      githubIssue: linkedIssue ?? undefined,
      engine: "pi",
      ...(startFrom ? { startFrom } : {}),
      ...(resolvedTitle ? { title: resolvedTitle } : {}),
      ...(kind !== "none" ? { runOn: effectiveRunOn } : {}),
      ...(canAttempt && attemptCount > 1 ? { attempts: Array.from({ length: attemptCount }, () => "pi" as const) } : {}),
    })
  }

  const filteredProjects = unarchivedProjects.filter(p => {
    const q = projectQuery.trim().toLowerCase()
    if (!q) return true
    return p.name.toLowerCase().includes(q) || (p.repository ?? "").toLowerCase().includes(q)
  })

  const workspaceLabel = WORKSPACE_OPTIONS.find(o => o.id === kind)?.label ?? "New branch"
  const runOnAvailable = runTargets?.available ?? ["local", "docker"]

  return (
    <ConversationLayout
      header={
        <header className="ade-workspace-header">
          <div className="ade-header-left">
            <span className="ade-header-title ade-truncate">
              {sessionTitle.trim() || "New session"}
            </span>
            {activeProject ? (
              <span className="ade-pill">{activeProject.name}</span>
            ) : null}
          </div>
          <div className="ade-header-right">
            {onOpenEnvironmentPalette ? (
              <button
                type="button"
                className="ade-header-tool-btn"
                onClick={onOpenEnvironmentPalette}
                title={keybindings.switchEnvironment ? `Switch environment (${formatShortcut(keybindings.switchEnvironment)})` : "Switch environment"}
              >
                <Server className="size-3.5" />
                <span>{environmentName}</span>
              </button>
            ) : null}
          </div>
        </header>
      }
      aboveComposer={
        <div className="ade-ns-above">
          {error ? <div className="ade-banner-error">{error}</div> : null}

          {/* Compact Context Pill Row — sits cleanly above the shared ComposerDock */}
          <div className="ade-ns-pills" ref={pillBarRef}>
            {/* Project Picker Pill */}
            <div className="ade-ns-menu-anchor">
              <button
                type="button"
                className={`ade-ns-pill ${openMenu === "project" ? "is-open" : ""}`}
                aria-haspopup="listbox"
                aria-expanded={openMenu === "project"}
                onClick={() => setOpenMenu(m => (m === "project" ? null : "project"))}
              >
                <FolderGit2 className="size-3.5 opacity-70" />
                <span className="truncate max-w-[160px]">{activeProject ? activeProject.name : "No project"}</span>
                <ChevronDown className="size-3 opacity-55" />
              </button>

              {openMenu === "project" ? (
                <div className="ade-ns-popover ade-ns-popover-up" role="dialog" aria-label="Choose project">
                  {unarchivedProjects.length > 4 ? (
                    <div className="ade-ns-popover-search">
                      <Search className="size-3.5 opacity-55 shrink-0" />
                      <input
                        type="text"
                        placeholder="Filter projects…"
                        value={projectQuery}
                        onChange={e => setProjectQuery(e.target.value)}
                        autoFocus
                      />
                    </div>
                  ) : null}
                  <div className="ade-ns-popover-list">
                    <button
                      type="button"
                      className={`ade-ns-popover-item ${selectedProjectId === null ? "is-selected" : ""}`}
                      onClick={() => handleProjectChange(null)}
                    >
                      <span className="flex-1 truncate">No project</span>
                      {selectedProjectId === null ? <Check className="size-3.5 text-[rgb(var(--primary))]" /> : null}
                    </button>
                    {filteredProjects.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className={`ade-ns-popover-item ${selectedProjectId === p.id ? "is-selected" : ""}`}
                        onClick={() => handleProjectChange(p.id)}
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">{p.name}</span>
                          {!p.repository ? (
                            <span className="block text-[10.5px] opacity-55 truncate">Empty project</span>
                          ) : null}
                        </span>
                        {selectedProjectId === p.id ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
                      </button>
                    ))}
                  </div>
                  {onAddProject ? (
                    <div className="ade-ns-popover-footer">
                      <button
                        type="button"
                        className="ade-ns-popover-item"
                        onClick={() => { setOpenMenu(null); onAddProject() }}
                      >
                        <FolderPlus className="size-3.5 opacity-75" />
                        <span>New project…</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Workspace Mode Pill */}
            <div className="ade-ns-menu-anchor">
              <button
                type="button"
                className={`ade-ns-pill ${openMenu === "workspace" ? "is-open" : ""}`}
                aria-haspopup="listbox"
                aria-expanded={openMenu === "workspace"}
                onClick={() => setOpenMenu(m => (m === "workspace" ? null : "workspace"))}
              >
                {kind === "worktree" ? <GitBranch className="size-3.5 opacity-70" />
                  : kind === "checkout" ? <FolderOpen className="size-3.5 opacity-70" />
                    : <MessageSquare className="size-3.5 opacity-70" />}
                <span>{workspaceLabel}</span>
                <ChevronDown className="size-3 opacity-55" />
              </button>

              {openMenu === "workspace" ? (
                <div className="ade-ns-popover ade-ns-popover-up" role="dialog" aria-label="Workspace mode">
                  <div className="ade-ns-popover-list">
                    {WORKSPACE_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`ade-ns-popover-item ${kind === opt.id ? "is-selected" : ""}`}
                        onClick={() => { setKind(opt.id); setOpenMenu(null) }}
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium">{opt.label}</span>
                          <span className="block text-[11px] opacity-60">{opt.desc}</span>
                        </span>
                        {kind === opt.id ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Run On Pill */}
            {kind !== "none" ? (
              <div className="ade-ns-menu-anchor">
                <button
                  type="button"
                  className={`ade-ns-pill ${openMenu === "runOn" ? "is-open" : ""}`}
                  aria-haspopup="listbox"
                  aria-expanded={openMenu === "runOn"}
                  onClick={() => setOpenMenu(m => (m === "runOn" ? null : "runOn"))}
                >
                  <Cpu className="size-3.5 opacity-70" />
                  <span>{targetLabel(effectiveRunOn)}</span>
                  <ChevronDown className="size-3 opacity-55" />
                </button>

                {openMenu === "runOn" ? (
                  <div className="ade-ns-popover ade-ns-popover-up !w-[280px]" role="dialog" aria-label="Run on target">
                    <div className="ade-ns-popover-list">
                      {runOnAvailable.map(target => {
                        const blocked = runTargets?.docker
                          ? targetUnavailable(
                              target,
                              runTargets,
                              projectRunOn && projectRunOn.projectId === selectedProjectId ? projectRunOn : { sshHost: "" },
                            )
                          : ""
                        const detail =
                          target === "docker"
                            ? `${runTargetDescriptions.docker} Image: ${projectRunOn?.image ?? "node:22-bookworm"}.`
                            : target === "ssh" && projectRunOn?.sshHost
                              ? `Host: ${projectRunOn.sshHost}`
                              : runTargetDescriptions[target]
                        return (
                          <button
                            key={target}
                            type="button"
                            disabled={Boolean(blocked)}
                            title={blocked || detail}
                            className={`ade-ns-popover-item ${effectiveRunOn === target ? "is-selected" : ""}`}
                            onClick={() => { setRunOn(target); setOpenMenu(null) }}
                          >
                            <span className="flex-1 min-w-0">
                              <span className="block font-medium">{targetLabel(target)}</span>
                              <span className="block text-[11px] opacity-60 leading-snug">{blocked || detail}</span>
                            </span>
                            {effectiveRunOn === target ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Attempts Pill */}
            {canAttempt ? (
              <div className="ade-ns-menu-anchor">
                <button
                  type="button"
                  className={`ade-ns-pill ${openMenu === "attempts" ? "is-open" : ""}`}
                  aria-haspopup="listbox"
                  aria-expanded={openMenu === "attempts"}
                  onClick={() => setOpenMenu(m => (m === "attempts" ? null : "attempts"))}
                >
                  <Layers className="size-3.5 opacity-70" />
                  <span>{attemptCount === 1 ? "1 attempt" : `${attemptCount} attempts`}</span>
                  <ChevronDown className="size-3 opacity-55" />
                </button>

                {openMenu === "attempts" ? (
                  <div className="ade-ns-popover ade-ns-popover-up !w-[240px]" role="dialog" aria-label="Attempts">
                    <div className="ade-ns-popover-list">
                      {[1, 2, 3].map(count => (
                        <button
                          key={count}
                          type="button"
                          className={`ade-ns-popover-item ${attemptCount === count ? "is-selected" : ""}`}
                          onClick={() => { setAttemptCount(count); setOpenMenu(null) }}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="block font-medium">{count === 1 ? "1 attempt" : `${count} parallel attempts`}</span>
                            <span className="block text-[11px] opacity-60">
                              {count === 1 ? "Single agent on one branch" : `${count} agents on separate branches`}
                            </span>
                          </span>
                          {attemptCount === count ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Quick Add Project */}
            {onAddProject ? (
              <button type="button" className="ade-ns-pill ade-ns-pill-quiet" onClick={onAddProject} title="Create a new project">
                <FolderPlus className="size-3.5 opacity-70" />
                <span>New project</span>
              </button>
            ) : null}

            {/* GitHub Issue trigger */}
            {activeProject?.githubUrl && !linkedIssue ? (
              <button type="button" className="ade-ns-pill ade-ns-pill-quiet" onClick={() => setIssueOpen(v => !v)}>
                <Link2 className="size-3.5 opacity-70" />
                <span>Link issue</span>
              </button>
            ) : null}
          </div>

          {needsManualRepo ? (
            <div className="ade-ns-folder-bar">
              <FolderOpen className="size-4 opacity-60 shrink-0" />
              <input
                type="text"
                className="ade-ns-folder-input"
                placeholder={activeProject ? `Attach a folder to ${activeProject.name}…` : "Choose a local folder path…"}
                value={repository}
                onChange={e => setRepository(e.target.value)}
              />
              <button type="button" className="sf-btn-secondary !h-7 !text-[12px] shrink-0" onClick={() => void pickFolder()}>
                Browse…
              </button>
              {activeProject && onConfigureProject ? (
                <button
                  type="button"
                  className="sf-btn-ghost !h-7 !text-[12px] shrink-0"
                  onClick={() => onConfigureProject(activeProject.id)}
                  title="Open project settings on the right side"
                >
                  <Settings2 className="size-3.5" /> Configure
                </button>
              ) : null}
            </div>
          ) : null}

          {canStartFrom && activeProject ? (
            <StartFromPicker
              key={activeProject.id}
              projectId={activeProject.id}
              hasGitHub={Boolean(activeProject.githubUrl)}
              value={startChoice}
              onChange={setStartChoice}
            />
          ) : null}

          {linkedIssue ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--primary)/0.45)] bg-[rgb(var(--primary)/0.1)] text-xs">
              <span className="truncate">
                <strong className="font-mono">#{linkedIssue.number}</strong> {linkedIssue.title}
              </span>
              <button type="button" className="sf-btn-ghost !h-6 !px-1.5" onClick={() => setLinkedIssue(null)}>
                <X className="size-3.5" />
              </button>
            </div>
          ) : issueOpen && activeProject?.githubUrl ? (
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
          ) : null}

          <LinearIssuePicker
            selected={linearIssue}
            onClear={() => setLinearIssue(null)}
            onPick={issue => {
              setLinearIssue(issue)
              if (!prompt.trim()) setPrompt(`Work on ${issue.identifier}: ${issue.title}\n${issue.url}${issue.description ? `\n\n${issue.description}` : ""}`)
            }}
          />
        </div>
      }
      composer={
        <ComposerDock
          draft={prompt}
          onDraftChange={setPrompt}
          busy={starting}
          disabled={!readyToStart}
          canSubmitEmpty={Boolean(startFrom)}
          placeholder={startFrom
            ? "Optional: what should the agent do on this branch? Leave empty to just open it."
            : `Message ADE… ${formatShortcut(keybindings.sendMessage)} to start, ${formatShortcut(keybindings.newLine)} for a new line.`}
          submitTitle={canAttempt && attemptCount > 1 ? `Start ${attemptCount} attempts` : "Start session"}
          modelCatalog={modelCatalog}
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          reasoning={reasoning}
          onSelectReasoning={onSelectReasoning}
          approvalPolicy={approvalPolicy}
          onChangeApprovalPolicy={onChangeApprovalPolicy}
          onOpenSettings={onOpenSettings}
          skillsCatalog={skillsCatalog}
          hasWorkspace={Boolean(effectiveRepo.trim())}
          sendChord={keybindings.sendMessage}
          newLineChord={keybindings.newLine}
          onSubmit={handleSubmitText}
        />
      }
    >
      <div className="ade-timeline">
        <WorkspaceEmptyHero
          title={sessionTitle.trim() || "New session"}
          subtitle="Click the title above to name this session, or describe what you want built, planned, or investigated."
          editableTitle={{
            value: sessionTitle,
            placeholder: "New session",
            ariaLabel: "Session name",
            onChange: setSessionTitle,
          }}
        />
      </div>
    </ConversationLayout>
  )
}
