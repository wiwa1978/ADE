import { useEffect, useState } from "react"
import { request } from "../../../api"
import type { GitHubIssue, StartFrom, TaskStart } from "../../../app-types"
import type { Project } from "../../../ProjectsView"
import { useBlueprintOptions, VIBE_ID } from "../../blueprints/blueprint-options"
import { useRunTargets, type RunTarget, type TargetSettings } from "../../run-targets"
import type { StartChoice } from "../StartFromPicker"
import type { LinearIssue } from "../LinearIssuePicker"

export type EngineId = "pi" | "claude-code" | "codex"
export type OpenMenu = null | "project" | "workspace" | "blueprint" | "runOn" | "attempts"

export type OpenIssueOption = {
  repository: string
  number: number
  title: string
  body: string
  state: "open" | "closed"
  url: string
}

export type NewSessionStartInput = {
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
  blueprintId?: string
}

export const WORKSPACE_OPTIONS: { id: TaskStart["kind"]; label: string; desc: string }[] = [
  { id: "worktree", label: "New branch", desc: "Isolated Git worktree so your main checkout stays clean" },
  { id: "checkout", label: "Direct checkout", desc: "Edit files directly in the project's existing checkout" },
  { id: "none", label: "Chat only", desc: "Conversation without attaching a codebase" },
]

export function useNewSessionForm({
  projects,
  selectedProjectId,
  onSelectProject,
  starting,
  onStart,
  onLookupIssue,
  initialIssue,
}: {
  projects: Project[]
  selectedProjectId: string | null
  onSelectProject: (id: string | null) => void
  starting: boolean
  onStart: (input: NewSessionStartInput) => Promise<void>
  onLookupIssue?: (projectId: string, url: string) => Promise<GitHubIssue>
  initialIssue?: GitHubIssue | null
}) {
  const unarchivedProjects = projects.filter(p => !p.archivedAt)
  const activeProject = unarchivedProjects.find(p => p.id === selectedProjectId) ?? null
  const [sessionTitle, setSessionTitle] = useState("")
  const [kind, setKind] = useState<TaskStart["kind"]>(activeProject?.repository ? "worktree" : "checkout")
  const [repository, setRepository] = useState(activeProject?.repository ?? "")
  const [prompt, setPrompt] = useState(initialIssue ? `Work on #${initialIssue.number}: ${initialIssue.title}` : "")
  const [issueOpen, setIssueOpen] = useState(false)
  const [issueUrl, setIssueUrl] = useState("")
  const [openIssues, setOpenIssues] = useState<OpenIssueOption[]>([])
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [linkedIssue, setLinkedIssue] = useState<GitHubIssue | null>(initialIssue ?? null)
  const [prevInitialIssue, setPrevInitialIssue] = useState(initialIssue ?? null)
  if ((initialIssue ?? null) !== prevInitialIssue) {
    setPrevInitialIssue(initialIssue ?? null)
    if (initialIssue) {
      setLinkedIssue(initialIssue)
      setPrompt(`Work on #${initialIssue.number}: ${initialIssue.title}`)
    }
  }
  const [issueError, setIssueError] = useState("")
  const [lookingUp, setLookingUp] = useState(false)
  const [startChoice, setStartChoice] = useState<StartChoice>({ mode: "new" })
  const [linearIssue, setLinearIssue] = useState<LinearIssue | null>(null)
  const [runOn, setRunOn] = useState<RunTarget | null>(null)
  const [projectRunOn, setProjectRunOn] = useState<({ projectId: string } & TargetSettings) | null>(null)
  const [attemptCount, setAttemptCount] = useState(1)
  const [blueprintChoice, setBlueprintChoice] = useState<string | null>(null)

  const blueprintOptions = useBlueprintOptions()
  const runTargets = useRunTargets()

  useEffect(() => {
    if (!selectedProjectId) return
    let cancelled = false
    void request<TargetSettings>(`/api/projects/${encodeURIComponent(selectedProjectId)}/run-on`)
      .then(result => { if (!cancelled) setProjectRunOn({ projectId: selectedProjectId, ...result }) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedProjectId])

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

  const defaultRunOn = projectRunOn && projectRunOn.projectId === selectedProjectId ? projectRunOn.target : "local"
  const effectiveRunOn = runOn ?? defaultRunOn
  const effectiveRepo = activeProject?.repository || repository
  const projectBlueprint = activeProject?.blueprintId || VIBE_ID
  const blueprintLocked = Boolean(activeProject?.blueprintLocked)
  const effectiveBlueprint = blueprintLocked ? projectBlueprint : blueprintChoice ?? projectBlueprint
  const effectiveBlueprintOption = blueprintOptions.find(option => option.id === effectiveBlueprint)

  const handleProjectChange = (nextId: string | null) => {
    onSelectProject(nextId)
    setStartChoice({ mode: "new" })
    setRunOn(null)
    setBlueprintChoice(null)
    const proj = unarchivedProjects.find(p => p.id === nextId)
    setRepository(proj?.repository ?? "")
    setKind(proj?.repository ? "worktree" : "checkout")
    setLinkedIssue(null)
    setOpenIssues([])
    setIssueOpen(false)
  }

  const handleToggleIssueOpen = () => {
    setIssueOpen(prev => {
      const next = !prev
      if (next && activeProjectId && activeProjectGithubUrl && openIssues.length === 0) {
        setLoadingIssues(true)
      }
      return next
    })
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

  const handleSelectOpenIssue = (iss: OpenIssueOption) => {
    setLinkedIssue({ ...iss, truncated: false })
    if (!prompt.trim()) setPrompt(`Implement #${iss.number}: ${iss.title}\n\n${iss.body}`)
    setIssueOpen(false)
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
    const resolvedTitle = sessionTitle.trim()
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
      ...(kind !== "none" ? { runOn: effectiveRunOn, blueprintId: effectiveBlueprint } : {}),
      ...(canAttempt && attemptCount > 1 ? { attempts: Array.from({ length: attemptCount }, () => "pi" as const) } : {}),
    })
  }

  return {
    unarchivedProjects, activeProject, sessionTitle, setSessionTitle,
    kind, setKind, repository, setRepository, prompt, setPrompt,
    issueOpen, setIssueOpen, issueUrl, setIssueUrl, openIssues, loadingIssues,
    linkedIssue, setLinkedIssue, issueError, lookingUp,
    startChoice, setStartChoice, linearIssue, setLinearIssue,
    runOn, setRunOn, projectRunOn, attemptCount, setAttemptCount,
    blueprintChoice, setBlueprintChoice, blueprintOptions, runTargets,
    effectiveRunOn, effectiveRepo, projectBlueprint, blueprintLocked,
    effectiveBlueprint, effectiveBlueprintOption,
    canStartFrom, startFrom, canAttempt, readyToStart, needsManualRepo,
    handleProjectChange, handleToggleIssueOpen, handleLookupIssue, handleSelectOpenIssue, handleSubmitText,
  }
}
