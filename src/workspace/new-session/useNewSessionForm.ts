import { useEffect, useState } from "react"
import { HARNESS_CATALOG, type SessionEngineId, type SessionInteractionMode } from "@ade/protocol"
import { request } from "../../api"
import type { GitHubIssue, StartFrom, TaskStart } from "../../app-types"
import type { Project } from "../../ProjectsView"
import { useBlueprintOptions, VIBE_ID } from "../../blueprints/blueprint-options"
import type { TranslationKey } from "../../i18n"
import { useI18n } from "../../i18n/I18nContext"
import { useRunTargets, type RunTarget, type TargetSettings } from "../../run-targets"
import type { StartChoice } from "../StartFromPicker"
import type { LinearIssue } from "../LinearIssuePicker"

export type EngineId = SessionEngineId
export type InteractionMode = SessionInteractionMode
export type EngineOption = {
  id: EngineId
  name: string
  description: string
  available: boolean
  modes: readonly InteractionMode[]
}
export type OpenMenu = null | "project" | "workspace" | "agent" | "mode" | "blueprint" | "runOn" | "attempts"

const DEFAULT_ENGINES: EngineOption[] = [
  { id: "pi", name: "ADE agent", description: "Built-in agent (Pi Durable) with your model provider, subagents, browser tools and approvals.", available: true, modes: ["chat"] },
  ...HARNESS_CATALOG.map(entry => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    available: true,
    modes: entry.modes,
  })),
]

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
  interactionMode?: InteractionMode
  startFrom?: StartFrom
  title?: string
  attempts?: EngineId[]
  runOn?: RunTarget
  blueprintId?: string
}

export const WORKSPACE_OPTIONS: { id: TaskStart["kind"]; label: TranslationKey; desc: TranslationKey }[] = [
  { id: "worktree", label: "ns.newBranch", desc: "ns.newBranchDesc" },
  { id: "checkout", label: "ns.directCheckout", desc: "ns.directCheckoutDesc" },
  { id: "none", label: "ns.chatOnly", desc: "ns.chatOnlyDesc" },
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
  onStart: (input: NewSessionStartInput) => Promise<string | null | void>
  onLookupIssue?: (projectId: string, url: string) => Promise<GitHubIssue>
  initialIssue?: GitHubIssue | null
}) {
  const { t } = useI18n()
  const unarchivedProjects = projects.filter(p => !p.archivedAt)
  const activeProject = unarchivedProjects.find(p => p.id === selectedProjectId) ?? null
  const [sessionTitle, setSessionTitle] = useState("")
  const [kind, setKind] = useState<TaskStart["kind"]>(activeProject?.repository ? "worktree" : "checkout")
  const [repository, setRepository] = useState(activeProject?.repository ?? "")
  const [prompt, setPrompt] = useState(initialIssue ? t("ns.workOn", { number: initialIssue.number, title: initialIssue.title }) : "")
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
      setPrompt(t("ns.workOn", { number: initialIssue.number, title: initialIssue.title }))
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
  const [engine, setEngine] = useState<EngineId>("pi")
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("chat")
  const [engineOptions, setEngineOptions] = useState<EngineOption[]>(DEFAULT_ENGINES)

  const blueprintOptions = useBlueprintOptions()
  const runTargets = useRunTargets()

  useEffect(() => {
    let cancelled = false
    void request<{ engines?: EngineOption[] }>("/api/engines")
      .then(result => {
        if (!cancelled && Array.isArray(result.engines) && result.engines.length > 0) {
          setEngineOptions(result.engines)
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

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
          setIssueError(err instanceof Error ? err.message : t("ns.loadIssuesError"))
          setLoadingIssues(false)
        }
      })
    return () => { cancelled = true }
  }, [issueOpen, activeProjectId, activeProjectGithubUrl, openIssues.length, t])

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
      if (!prompt.trim()) setPrompt(t("ns.workOn", { number: issue.number, title: issue.title }))
      setIssueOpen(false)
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : t("ns.loadIssueError"))
    } finally {
      setLookingUp(false)
    }
  }

  const handleSelectOpenIssue = (iss: OpenIssueOption) => {
    setLinkedIssue({ ...iss, truncated: false })
    if (!prompt.trim()) setPrompt(`Implement #${iss.number}: ${iss.title}\n\n${iss.body}`)
    setIssueOpen(false)
  }

  const handleSelectKind = (nextKind: TaskStart["kind"]) => {
    setKind(nextKind)
    if (nextKind === "none") {
      setEngine("pi")
      setInteractionMode("chat")
    }
  }

  const handleSelectEngine = (nextEngine: EngineId) => {
    setEngine(nextEngine)
    const option = engineOptions.find(opt => opt.id === nextEngine)
    if (nextEngine === "pi") {
      setInteractionMode("chat")
    } else if (option && !option.modes.includes("chat")) {
      setInteractionMode("terminal")
    }
  }

  const handleSelectMode = (nextMode: InteractionMode) => {
    setInteractionMode(nextMode)
    const currentOption = engineOptions.find(opt => opt.id === engine)
    if (nextMode === "terminal") {
      if (engine === "pi" || (currentOption && !currentOption.modes.includes("terminal"))) {
        const terminalCapable = engineOptions.filter(opt => opt.id !== "pi" && opt.modes.includes("terminal"))
        const preferred = terminalCapable.find(opt => opt.available) ?? terminalCapable[0]
        setEngine(preferred?.id ?? "claude-code")
      }
    } else if (currentOption && !currentOption.modes.includes("chat")) {
      setEngine("pi")
    }
  }

  const effectiveEngine: EngineId = kind === "none" ? "pi" : engine
  const activeEngineOption = engineOptions.find(opt => opt.id === effectiveEngine) ?? DEFAULT_ENGINES[0]
  const effectiveMode: InteractionMode = kind === "none" || effectiveEngine === "pi"
    ? "chat"
    : !activeEngineOption.modes.includes("chat")
      ? "terminal"
      : interactionMode
  const isTerminalMode = effectiveMode === "terminal"

  const canStartFrom = kind === "worktree" && Boolean(activeProject?.repository)
  const startFrom: StartFrom | undefined = !canStartFrom ? undefined
    : startChoice.mode === "branch" && startChoice.branch ? { branch: startChoice.branch }
      : startChoice.mode === "pr" && startChoice.number ? { pullRequest: startChoice.number }
        : undefined
  const startFromIncomplete = canStartFrom && startChoice.mode !== "new" && !startFrom
  const startTitle = startChoice.mode === "branch" ? startChoice.branch
    : startChoice.mode === "pr" && startChoice.number ? `PR #${startChoice.number}${startChoice.title ? `: ${startChoice.title}` : ""}` : undefined
  const canAttempt = kind === "worktree" && startChoice.mode === "new" && !isTerminalMode
  const readyToStart = !starting && !startFromIncomplete && (kind === "none" || Boolean(effectiveRepo.trim()))
  const needsManualRepo = kind !== "none" && !activeProject?.repository

  const handleSubmitText = (text: string) => {
    if (!readyToStart) return
    const trimmed = text.trim()
    if (!trimmed && !startFrom && !isTerminalMode) return
    const resolvedTitle = sessionTitle.trim()
      || startTitle
      || (linearIssue ? `${linearIssue.identifier}: ${linearIssue.title}` : undefined)
    void onStart({
      projectId: selectedProjectId,
      kind,
      repository: kind === "none" ? "" : effectiveRepo.trim(),
      prompt: trimmed,
      githubIssue: linkedIssue ?? undefined,
      engine: effectiveEngine,
      interactionMode: effectiveMode,
      ...(startFrom ? { startFrom } : {}),
      ...(resolvedTitle ? { title: resolvedTitle } : {}),
      ...(kind !== "none" ? { runOn: effectiveRunOn, ...(!isTerminalMode ? { blueprintId: effectiveBlueprint } : {}) } : {}),
      ...(canAttempt && attemptCount > 1 ? { attempts: Array.from({ length: attemptCount }, () => effectiveEngine) } : {}),
    })
  }

  return {
    unarchivedProjects, activeProject, sessionTitle, setSessionTitle,
    kind, setKind: handleSelectKind, repository, setRepository, prompt, setPrompt,
    engine: effectiveEngine, interactionMode: effectiveMode, isTerminalMode,
    engineOptions, activeEngineOption, handleSelectEngine, handleSelectMode,
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
