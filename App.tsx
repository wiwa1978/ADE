import { useCallback, useEffect, useRef, useState } from "react"
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderGit2,
  GitBranch,
  Globe,
  Maximize2,
  MessageCircle,
  MessageSquare,
  PanelLeft,
  Pencil,
  Pin,
  Plus,
  Search,
  Server,
  Settings2,
  Sparkles,
  Workflow,
} from "lucide-react"
import { request, resolveCaptainUrl } from "./api"
import type {
  Conversation,
  EnvironmentDirectory,
  GitHubIssue,
  ProviderCatalogEntry,
  RuntimeHealth,
  Screen,
  SessionArtifact,
  TaskStart,
  WorkspaceTab,
} from "./app-types"
import { clearPendingStart, pendingStarts, storePendingStart } from "./pending-task-starts"
import { ProjectSettings, ProjectsView, type GitHubRepositoryPage, type Project, type ProjectActivity, type ProjectInput } from "./ProjectsView"
import { SettingsView, type SettingsCategory } from "./SettingsView"
import { WorktreeDiagnostics } from "./WorktreeDiagnostics"
import { useConnections } from "./useConnections"
import { useSettings } from "./useSettings"
import { useWorktrees } from "./useWorktrees"
import { useRuntimeStream } from "./src/hooks/useRuntimeStream"
import { SplitWorkspace } from "./src/workspace/SplitWorkspace"
import { NewSessionView } from "./src/workspace/NewSessionView"
import { CommandCenter } from "./src/sidebar/CommandCenter"
import { EnvironmentPalette } from "./src/sidebar/EnvironmentPalette"
import { SidebarContextMenu, type ContextMenuTarget } from "./src/sidebar/SidebarContextMenu"
import { AddProjectWizard } from "./src/projects/AddProjectWizard"
import { ProjectStreamsWorkspace } from "./src/projects/ProjectStreamsWorkspace"
import { FactoryView } from "./src/factory/FactoryView"
import type { FactoryRunDetail } from "./src/factory/types"

type LastView = { screen?: Screen; activeSessionId?: string; selectedProjectId?: string | null; expandedProjects?: string[] }

/** The view to reopen after a reload, unless "Reopen last view" is turned off in Settings → General. */
function readLastView(): LastView {
  try {
    const settings = JSON.parse(localStorage.getItem("ade-settings-v1") ?? "{}")
    if (settings?.restoreLastView === false) return {}
    const saved = JSON.parse(localStorage.getItem("ade.last-view") ?? "{}")
    return saved && typeof saved === "object" ? saved : {}
  } catch {
    return {}
  }
}
const lastView = readLastView()

function readStoredIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function writeStoredIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // ignore storage errors
  }
}

function searchGitHubRepositories(login: string, query: string, page: number, signal?: AbortSignal) {
  return request<GitHubRepositoryPage>("/api/github/repositories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, query, page }),
    signal,
  })
}

export default function App() {
  const { settings, error: settingsError, resolved, update } = useSettings()
  const [screen, setScreen] = useState<Screen>(() => lastView.screen === "project" || lastView.screen === "factory" ? lastView.screen : "work")
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    try {
      const param = new URLSearchParams(window.location.search).get("session")
      return param || (typeof lastView.activeSessionId === "string" ? lastView.activeSessionId : "") || "coding"
    } catch {
      return "coding"
    }
  })
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => typeof lastView.selectedProjectId === "string" ? lastView.selectedProjectId : null)
  const [expandedProjects, setExpandedProjects] = useState<string[]>(() => Array.isArray(lastView.expandedProjects) ? lastView.expandedProjects.filter(id => typeof id === "string") : [])
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [projectDrafts, setProjectDrafts] = useState<Record<string, ProjectInput>>({})
  const [projectActivity, setProjectActivity] = useState<ProjectActivity | null>(null)
  const [projectActivityError, setProjectActivityError] = useState("")
  const [factoryRuns, setFactoryRuns] = useState<FactoryRunDetail[]>([])
  const [openStreamIdsByProject, setOpenStreamIdsByProject] = useState<Record<string, string[]>>({})
  const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null)

  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general")
  const [settingsAutoOpenAddEnv, setSettingsAutoOpenAddEnv] = useState(false)

  const [pinnedIds, setPinnedIds] = useState<string[]>(() => readStoredIds("ade.pinned-ids"))
  const [unreadIds, setUnreadIds] = useState<string[]>(() => readStoredIds("ade.unread-ids"))
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null)

  const [runtime, setRuntime] = useState<RuntimeHealth | null>(null)
  const [modelCatalog, setModelCatalog] = useState<ProviderCatalogEntry[]>([])
  const [runtimeError, setRuntimeError] = useState("")
  const [environmentVersion, setEnvironmentVersion] = useState(0)
  const [activeEnvironmentId, setActiveEnvironmentId] = useState("local")
  const [activeEnvironmentName, setActiveEnvironmentName] = useState("This computer")
  const [environmentDirectory, setEnvironmentDirectory] = useState<EnvironmentDirectory>({
    activeId: "local",
    environments: [{ id: "local", name: "This computer", kind: "local", status: "connected", active: true }],
  })
  const [envPaletteOpen, setEnvPaletteOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)

  const [sessions, setSessions] = useState<Conversation[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsError, setProjectsError] = useState("")
  const [creatingSession, setCreatingSession] = useState(false)
  const [launchError, setLaunchError] = useState("")
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<{ id: string; name: string; content: string }[]>([])

  const [sidebarOpen, setSidebarOpen] = useState(() => matchMedia("(min-width: 720px)").matches)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("ade.sidebar-width"))
    return saved >= 200 && saved <= 360 ? saved : 254
  })
  const [commandOpen, setCommandOpen] = useState(false)
  const [externalOpenRequest, setExternalOpenRequest] = useState<WorkspaceTab | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState("")

  const previousScreen = useRef<Screen>("work")
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const sidebarDragging = useRef(false)

  const connections = useConnections(screen, setRuntime, environmentVersion)
  const worktrees = useWorktrees()

  // Remember where the user was so a reload or restart reopens the same project or session.
  useEffect(() => {
    try {
      if (!settings.restoreLastView) {
        localStorage.removeItem("ade.last-view")
        return
      }
      const view: LastView = { screen, activeSessionId, selectedProjectId, expandedProjects }
      localStorage.setItem("ade.last-view", JSON.stringify(view))
    } catch {
      // Storage can be unavailable (private mode); restoring the view is a convenience only.
    }
  }, [settings.restoreLastView, screen, activeSessionId, selectedProjectId, expandedProjects])

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? sessions[0] ?? {
    id: "coding",
    mode: "coding" as const,
    label: "Coding lead",
    status: "idle" as const,
    messages: [],
  }
  const isCodingTask = Boolean(activeSession.workspace || (activeSession.id !== "coding" && activeSession.id !== "personal" && !activeSession.chatThread))
  const hasWorkspace = Boolean(activeSession.workspace?.path && activeSession.workspace.status === "ready")

  const loadSessions = useCallback(async () => {
    try {
      const data = await request<{ sessions: Conversation[] }>("/api/sessions")
      setSessions(data.sessions ?? [])
    } catch {
      // handled by health check
    }
  }, [])

  const loadProjects = useCallback(async () => {
    try {
      const data = await request<{ projects: Project[] }>("/api/projects")
      setProjects(data.projects ?? [])
      setProjectsError("")
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Could not load projects.")
    }
  }, [])

  const loadFactoryRuns = useCallback(async () => {
    try {
      const data = await request<{ runs: FactoryRunDetail[] }>("/api/factory/runs")
      if (Array.isArray(data?.runs)) setFactoryRuns(data.runs)
    } catch {
      // optional when factory routes are unavailable in minimal test fixtures
    }
  }, [])

  useEffect(() => {
    if (typeof EventSource === "undefined") return
    const es = new EventSource(resolveCaptainUrl("/api/events"))
    const onFactoryEvent = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as { payload?: { type?: string; payload?: FactoryRunDetail } }
        const inner = parsed?.payload
        if (inner?.type === "run.updated" && inner.payload?.run?.runId) {
          const updated = inner.payload
          setFactoryRuns(prev => {
            const exists = prev.some(r => r.run.runId === updated.run.runId)
            return exists
              ? prev.map(r => (r.run.runId === updated.run.runId ? updated : r))
              : [...prev, updated]
          })
        }
      } catch {
        // ignore
      }
    }
    es.addEventListener("factory.event", onFactoryEvent)
    return () => {
      es.removeEventListener("factory.event", onFactoryEvent)
      es.close()
    }
  }, [environmentVersion])

  const loadHealth = useCallback(async () => {
    try {
      const qs = settings.provider ? `?provider=${encodeURIComponent(settings.provider)}` : ""
      const data = await request<RuntimeHealth>(`/api/health${qs}`)
      setRuntime(data)
      setRuntimeError("")
    } catch (err) {
      setRuntime(null)
      setRuntimeError(err instanceof Error ? err.message : "Waiting for the ADE local runtime.")
    }
  }, [settings.provider])

  const loadEnvironments = useCallback(async () => {
    try {
      const dir = await request<EnvironmentDirectory>("/api/environments")
      setEnvironmentDirectory(dir)
      const active = dir.environments.find(e => e.id === dir.activeId) ?? dir.environments[0]
      if (active) {
        setActiveEnvironmentId(active.id)
        setActiveEnvironmentName(active.name)
      }
    } catch {
      // fallback to local
    }
  }, [])

  const loadModelCatalog = useCallback(async () => {
    try {
      const catalog = await request<{ providers: ProviderCatalogEntry[] }>("/api/models/catalog")
      if (Array.isArray(catalog?.providers)) setModelCatalog(catalog.providers)
    } catch {
      // The runtime may still be starting; health polling surfaces connection errors.
    }
  }, [])

  useEffect(() => {
    void loadHealth()
    void loadModelCatalog()
    void loadSessions()
    void loadProjects()
    void loadFactoryRuns()
    void loadEnvironments()
  }, [loadHealth, loadModelCatalog, loadSessions, loadProjects, loadFactoryRuns, loadEnvironments, environmentVersion])

  // Refresh provider list when returning from Settings so toggled providers appear immediately
  useEffect(() => {
    if (screen === "work") void loadModelCatalog()
  }, [screen, loadModelCatalog])

  // Replay any pending task starts stored before reload
  useEffect(() => {
    const pending = Object.values(pendingStarts()).filter(s => (s.environmentId ?? "local") === activeEnvironmentId)
    if (!pending.length) return
    for (const start of pending) {
      void request<{ session: Conversation }>("/api/coding-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(start),
      }).then(() => {
        clearPendingStart(start.id)
        void loadSessions()
      }).catch(() => {
        // leave for manual retry if runtime offline
      })
    }
  }, [activeEnvironmentId, loadSessions])

  const stream = useRuntimeStream({
    sessionId: screen === "work" && !newSessionOpen ? activeSession.id : null,
    hasWorkspace,
    isCodingTask,
    environmentVersion,
    onSessionsChanged: () => void loadSessions(),
    onAgentBrowserDriving: () => {
      setExternalOpenRequest({ id: "browser", kind: "browser", title: "Browser" })
    },
    onArtifactUpdated: (artifactId) => {
      setExternalOpenRequest({ id: "artifact", kind: "artifact", title: "Artifact", artifactId })
    },
  })

  // Desktop notifications (Settings → Notifications). Only shown when ADE isn't the focused window.
  const previousStatuses = useRef<Map<string, string>>(new Map())
  const notifiedApprovals = useRef<Set<string>>(new Set())
  useEffect(() => {
    const canNotify = typeof Notification !== "undefined" && Notification.permission === "granted" && !document.hasFocus()
    for (const sess of sessions) {
      const before = previousStatuses.current.get(sess.id)
      if (canNotify && settings.notifyOnFinish && before === "working" && sess.status === "idle") {
        const last = [...sess.messages].reverse().find(m => m.role !== "user")
        const notification = new Notification(`${sess.label} finished`, { body: last?.role === "error" ? `Error: ${last.content.slice(0, 140)}` : "The agent is waiting for your next message.", tag: `finish-${sess.id}` })
        notification.onclick = () => { window.focus(); setActiveSessionId(sess.id); setNewSessionOpen(false); setScreen("work") }
      }
      previousStatuses.current.set(sess.id, sess.status)
    }
  }, [sessions, settings.notifyOnFinish])
  useEffect(() => {
    for (const approval of stream.approvals) {
      if (notifiedApprovals.current.has(approval.id)) continue
      notifiedApprovals.current.add(approval.id)
      if (!settings.notifyOnApproval || typeof Notification === "undefined" || Notification.permission !== "granted" || document.hasFocus()) continue
      const label = sessions.find(s => s.id === approval.sessionId)?.label
      const notification = new Notification(label ? `${label} needs approval` : "An agent needs approval", { body: approval.command ?? approval.summary ?? "Open ADE to allow or deny the request.", tag: `approval-${approval.id}` })
      notification.onclick = () => { window.focus(); setActiveSessionId(approval.sessionId); setNewSessionOpen(false); setScreen("work") }
    }
  }, [stream.approvals, settings.notifyOnApproval, sessions])

  // Load project activity when viewing a project
  useEffect(() => {
    if (screen !== "project" || !selectedProjectId) return
    let cancelled = false
    setProjectActivity(null)
    setProjectActivityError("")
    void request<ProjectActivity>(`/api/projects/${encodeURIComponent(selectedProjectId)}/agents`)
      .then(data => { if (!cancelled) setProjectActivity(data) })
      .catch(err => { if (!cancelled) setProjectActivityError(err?.message || "Unavailable") })
    return () => { cancelled = true }
  }, [screen, selectedProjectId, environmentVersion])

  // Keyboard shortcuts: Cmd+K (Command Center), Alt+L (focus composer)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setCommandOpen(v => !v)
      } else if (e.altKey && e.key.toLowerCase() === "l") {
        e.preventDefault()
        composerRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // Sidebar resize drag
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!sidebarDragging.current) return
      const next = Math.min(360, Math.max(200, e.clientX))
      setSidebarWidth(next)
      localStorage.setItem("ade.sidebar-width", String(Math.round(next)))
    }
    const onUp = () => { sidebarDragging.current = false }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [])

  const matchingRuntime = runtime && (!settings.provider || runtime.provider === settings.provider) ? runtime : null
  const effectiveCatalog: ProviderCatalogEntry[] = (() => {
    if (modelCatalog.length > 0) return modelCatalog
    if (!runtime) return []
    return (runtime.providers?.length ? runtime.providers : [{ id: runtime.provider, name: runtime.provider }]).map(p => ({
      id: p.id,
      name: p.name,
      kind: "api" as const,
      configured: p.id === runtime.provider ? runtime.configured : false,
      enabled: true,
      defaultModel: p.id === runtime.provider ? runtime.defaultModel : "",
      setupMessage: p.id === runtime.provider ? runtime.message : "",
      models: p.id === runtime.provider ? runtime.models : [],
    }))
  })()
  // A saved provider that the harness can no longer run (e.g. an old CLI-tool choice) falls back to the runtime default.
  const effectiveProvider = (settings.provider && (!effectiveCatalog.length || effectiveCatalog.some(p => p.id === settings.provider)))
    ? settings.provider
    : runtime?.provider || effectiveCatalog.find(p => p.configured)?.id || effectiveCatalog[0]?.id || "anthropic"
  const activeCatalogProvider = effectiveCatalog.find(p => p.id === effectiveProvider) ?? effectiveCatalog[0]
  const availableModels = activeCatalogProvider?.models?.length
    ? activeCatalogProvider.models
    : (matchingRuntime?.models ?? runtime?.models ?? [])
  const selectedModel = availableModels.some(m => m.id === settings.model)
    ? settings.model
    : (settings.model || activeCatalogProvider?.defaultModel || matchingRuntime?.defaultModel || runtime?.defaultModel || "")
  const modelReady = Boolean(activeCatalogProvider?.configured && selectedModel)
  const modelSetupMessage = activeCatalogProvider?.setupMessage || "Set up a model provider in Settings → Models."
  const providerName = activeCatalogProvider?.name ?? runtime?.providers.find(p => p.id === effectiveProvider)?.name ?? effectiveProvider

  const handleAttachFiles = async (fileList: FileList | null) => {
    if (!fileList) return
    const added: { id: string; name: string; content: string }[] = []
    for (const file of Array.from(fileList).slice(0, 6)) {
      if (file.size > 64_000) continue
      try {
        const text = await file.text()
        added.push({ id: crypto.randomUUID(), name: file.name, content: text })
      } catch {
        // skip unreadable file
      }
    }
    if (added.length) setAttachments(prev => [...prev, ...added])
  }

  const handleSendMessage = async (text: string) => {
    const attachmentBlock = attachments.length
      ? `\n\n${attachments.map(a => `--- Attached file: ${a.name} ---\n\`\`\`\n${a.content}\n\`\`\``).join("\n\n")}`
      : ""
    const content = `${text}${attachmentBlock}`.slice(0, 8000)
    setDraft("")
    setAttachments([])
    setSending(true)
    try {
      const payload = {
        id: crypto.randomUUID(),
        content,
        provider: effectiveProvider,
        model: selectedModel,
        reasoning: settings.reasoning,
        async: true,
      }
      const endpoint = activeSession.chatThread
        ? `/api/chat-threads/${encodeURIComponent(activeSession.id)}/messages`
        : isCodingTask
          ? `/api/coding-tasks/${encodeURIComponent(activeSession.id)}/messages`
          : `/api/sessions/${activeSession.mode}/messages`
      await request<{ session: Conversation }>(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      await loadSessions()
      void stream.refreshTimeline(activeSession.id)
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "Could not send message.")
    } finally {
      setSending(false)
    }
  }

  const handleSteerSession = async (text: string, mode: "steer" | "follow-up") => {
    setDraft("")
    try {
      await request(`/api/sessions/${encodeURIComponent(activeSession.id)}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text, mode }),
      })
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "Could not steer session.")
    }
  }

  const handleAbortSession = async () => {
    try {
      await request(`/api/sessions/${encodeURIComponent(activeSession.id)}/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      await loadSessions()
    } catch {
      // ignore
    }
  }

  const handleCompactSession = async () => {
    try {
      await request(`/api/sessions/${encodeURIComponent(activeSession.id)}/compact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "Could not compact session.")
    }
  }

  const handleStartNewSession = async (input: {
    projectId: string | null
    kind: TaskStart["kind"]
    repository: string
    prompt: string
    githubIssue?: GitHubIssue
  }) => {
    setCreatingSession(true)
    setLaunchError("")
    const taskId = crypto.randomUUID()
    const start: TaskStart = {
      id: taskId,
      title: input.prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "New session",
      repository: input.repository,
      kind: input.kind,
      environmentId: activeEnvironmentId,
      projectId: input.projectId,
      githubIssue: input.githubIssue,
      ...(modelReady && input.prompt.trim() ? {
        initialMessage: {
          id: crypto.randomUUID(),
          content: input.prompt,
          provider: effectiveProvider,
          model: selectedModel,
          reasoning: settings.reasoning,
        },
      } : {}),
    }
    storePendingStart(start)
    try {
      const res = await request<{ session: Conversation }>("/api/coding-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(start),
      })
      clearPendingStart(taskId)
      await loadSessions()
      if (!start.initialMessage && input.prompt.trim()) {
        // No model is ready: keep the prompt in the composer so it can be sent once a provider is set up.
        setDraft(input.prompt)
        setRuntimeError(`${modelSetupMessage} Your message is waiting in the composer.`)
      }
      setActiveSessionId(res.session.id)
      setNewSessionOpen(false)
      setScreen("work")
      if (input.projectId && !expandedProjects.includes(input.projectId)) {
        setExpandedProjects(prev => [...prev, input.projectId!])
      }
    } catch (err) {
      clearPendingStart(taskId)
      setLaunchError(err instanceof Error ? err.message : "Could not create session.")
    } finally {
      setCreatingSession(false)
    }
  }

  const handleSaveProject = async (input: ProjectInput, existingId?: string) => {
    const endpoint = existingId ? `/api/projects/${encodeURIComponent(existingId)}` : "/api/projects"
    const res = await request<{ project: Project }>(endpoint, {
      method: existingId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    await loadProjects()
    return res.project
  }

  const handleCreateChatThread = async (mode: "coding" | "personal") => {
    try {
      const id = crypto.randomUUID()
      const res = await request<{ session: Conversation }>("/api/chat-threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, mode }),
      })
      await loadSessions()
      setActiveSessionId(res.session.id)
      setNewSessionOpen(false)
      setScreen("work")
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "Could not create chat.")
    }
  }

  const handleRenameSubmit = async (session: Conversation) => {
    const trimmed = renameText.trim()
    setRenamingId(null)
    if (!trimmed || trimmed === session.label) return
    const endpoint = session.chatThread
      ? `/api/chat-threads/${encodeURIComponent(session.id)}`
      : `/api/coding-tasks/${encodeURIComponent(session.id)}`
    try {
      await request(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      })
      await loadSessions()
    } catch {
      // ignore
    }
  }

  const handleReviewArtifact = async (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => {
    await stream.reviewArtifact(artifact.id, decision, feedback)
    const msg = decision === "approved"
      ? `I have approved the artifact "${artifact.title}". Please proceed with the implementation.`
      : `Changes requested on artifact "${artifact.title}": ${feedback || "Please revise."}`
    if (activeSession.status === "working" || stream.timeline?.busy) {
      await handleSteerSession(msg, "follow-up")
    } else {
      await handleSendMessage(msg)
    }
  }

  const openSettingsSection = useCallback((category: SettingsCategory, autoOpenAdd = false) => {
    previousScreen.current = screen
    setSettingsCategory(category)
    setSettingsAutoOpenAddEnv(autoOpenAdd)
    setScreen("settings")
  }, [screen])

  const togglePin = useCallback((id: string) => {
    setPinnedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [id, ...prev]
      writeStoredIds("ade.pinned-ids", next)
      return next
    })
  }, [])

  const toggleUnread = useCallback((id: string) => {
    setUnreadIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      writeStoredIds("ade.unread-ids", next)
      return next
    })
  }, [])

  const clearUnread = useCallback((id: string) => {
    setUnreadIds(prev => {
      if (!prev.includes(id)) return prev
      const next = prev.filter(x => x !== id)
      writeStoredIds("ade.unread-ids", next)
      return next
    })
  }, [])

  // Archive state lives on the host so it survives reloads and is shared by every client of that host.
  const archivedIds = [
    ...sessions.filter(s => s.archivedAt).map(s => s.id),
    ...projects.filter(p => p.archivedAt).map(p => `project:${p.id}`),
  ]
  const toggleArchive = useCallback(async (id: string, archivedNow?: boolean) => {
    const isProject = id.startsWith("project:")
    const targetId = isProject ? id.slice("project:".length) : id
    const currentlyArchived = archivedNow ?? (isProject
      ? Boolean(projects.find(p => p.id === targetId)?.archivedAt)
      : Boolean(sessions.find(s => s.id === targetId)?.archivedAt))
    try {
      const result = await request<{ worktreeError?: string; sessions?: { worktreeError?: string }[] }>(
        isProject ? `/api/projects/${encodeURIComponent(targetId)}/archive` : `/api/sessions/${encodeURIComponent(targetId)}/archive`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(isProject
            ? { archived: !currentlyArchived, removeWorktrees: settings.archiveRemovesWorktree }
            : { archived: !currentlyArchived, removeWorktree: settings.archiveRemovesWorktree }),
        },
      )
      const kept = [result.worktreeError, ...(result.sessions ?? []).map(s => s.worktreeError)].filter(Boolean)
      if (kept.length) setRuntimeError(`Archived, but a worktree was kept: ${kept[0]}`)
      if (!currentlyArchived && !isProject && activeSessionId === targetId) setActiveSessionId("coding")
      if (!currentlyArchived && isProject && selectedProjectId === targetId) {
        setSelectedProjectId(null)
        setScreen("work")
      }
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "Could not change the archive state.")
    } finally {
      await Promise.all([loadSessions(), loadProjects()])
    }
  }, [projects, sessions, settings.archiveRemovesWorktree, activeSessionId, selectedProjectId, loadSessions, loadProjects])

  // One-time migration of the old browser-only archive list to the host.
  useEffect(() => {
    const legacy = readStoredIds("ade.archived-ids")
    if (!legacy.length || (!sessions.length && !projects.length)) return
    localStorage.removeItem("ade.archived-ids")
    for (const id of legacy) {
      const known = id.startsWith("project:")
        ? projects.some(p => `project:${p.id}` === id && !p.archivedAt)
        : sessions.some(s => s.id === id && !s.archivedAt && s.id !== "coding" && s.id !== "personal")
      if (known) void toggleArchive(id, false)
    }
  }, [sessions, projects, toggleArchive])

  const openProject = useCallback((projectId: string, openSettings = false) => {
    setProjectsError("")
    setSelectedProjectId(projectId)
    setExpandedProjects(prev => (prev.includes(projectId) ? prev : [...prev, projectId]))
    setProjectSettingsOpen(openSettings)
    setScreen("project")
  }, [])

  const openStreamPane = useCallback((projectId: string, streamId: string) => {
    setOpenStreamIdsByProject(prev => {
      const existing = prev[projectId] ?? []
      const nextList = existing.includes(streamId) ? existing : [...existing, streamId]
      return { ...prev, [projectId]: nextList }
    })
    setFocusedStreamId(streamId)
  }, [])

  const closeStreamPane = useCallback((projectId: string, streamId: string) => {
    setOpenStreamIdsByProject(prev => {
      const existing = prev[projectId] ?? []
      return { ...prev, [projectId]: existing.filter(id => id !== streamId) }
    })
  }, [])

  const handleOpenExternalApp = useCallback(async (app: "cursor" | "vscode" | "windsurf" | "finder", path?: string | null) => {
    try {
      await request("/api/system/open-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app, path: path || undefined }),
      })
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : `Could not open in ${app}.`)
    }
  }, [])

  const handleForkSession = useCallback(async (sess: Conversation) => {
    try {
      const res = await request<{ session: Conversation }>(`/api/sessions/${encodeURIComponent(sess.id)}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      await loadSessions()
      if (res?.session?.id) {
        setActiveSessionId(res.session.id)
        setNewSessionOpen(false)
        setScreen("work")
      }
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "Could not fork chat.")
    }
  }, [loadSessions])

  const handleMoveSession = useCallback(async (sess: Conversation, opts: { mode?: "coding" | "personal"; projectId?: string | null }) => {
    try {
      await request(`/api/sessions/${encodeURIComponent(sess.id)}/move`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      })
      await loadSessions()
      if (opts.projectId) {
        setExpandedProjects(prev => (prev.includes(opts.projectId!) ? prev : [...prev, opts.projectId!]))
      }
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "Could not move chat.")
    }
  }, [loadSessions])

  const handleDeleteSession = useCallback(async (sess: Conversation) => {
    const endpoint = sess.chatThread
      ? `/api/chat-threads/${encodeURIComponent(sess.id)}`
      : `/api/coding-tasks/${encodeURIComponent(sess.id)}`
    try {
      await request(endpoint, { method: "DELETE" })
      await loadSessions()
      if (activeSessionId === sess.id) {
        setActiveSessionId("coding")
      }
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "Could not delete session.")
    }
  }, [activeSessionId, loadSessions])

  const handleDeleteProject = useCallback(async (project: Project) => {
    try {
      await request(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" })
      setProjects(prev => prev.filter(p => p.id !== project.id))
      if (selectedProjectId === project.id) {
        setSelectedProjectId(null)
        if (screen === "project") setScreen("projects")
      }
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Could not delete project.")
    }
  }, [screen, selectedProjectId])

  const handleSendQuickStreamMessage = useCallback(async (sess: Conversation, text: string) => {
    const payload = {
      id: crypto.randomUUID(),
      content: text,
      provider: effectiveProvider,
      model: selectedModel,
      reasoning: settings.reasoning,
      async: true,
    }
    const endpoint = sess.chatThread
      ? `/api/chat-threads/${encodeURIComponent(sess.id)}/messages`
      : sess.id !== "coding" && sess.id !== "personal"
        ? `/api/coding-tasks/${encodeURIComponent(sess.id)}/messages`
        : `/api/sessions/${sess.mode}/messages`
    await request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    await loadSessions()
  }, [effectiveProvider, selectedModel, settings.reasoning, loadSessions])

  const handleStartFactoryRunForProject = useCallback(async (
    project: Project,
    opts?: { issueNumber?: number; issueTitle?: string; issueBody?: string },
  ) => {
    try {
      const res = await request<{ run: FactoryRunDetail }>("/api/factory/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          repoPath: project.repository || undefined,
          githubRepo: project.githubUrl?.replace(/^https:\/\/github\.com\//i, "") || undefined,
          blueprintId: project.blueprintId || "automated-factory",
          modelProfile: project.modelProfile || "balanced",
          euOnlyMode: project.euOnlyMode ?? false,
          cloudActFree: project.cloudActFree ?? false,
          issueNumber: opts?.issueNumber,
          issueTitle: opts?.issueTitle,
          issueBody: opts?.issueBody,
        }),
      })
      if (res?.run?.run?.runId) {
        await loadFactoryRuns()
        openStreamPane(project.id, `factory:${res.run.run.runId}`)
      }
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : "Could not start Software Factory run.")
    }
  }, [loadFactoryRuns, openStreamPane])

  const handleFactoryRunAction = useCallback(async (
    runId: string,
    action: "step" | "approve" | "pause" | "steer",
    note?: string,
  ) => {
    const path =
      action === "step"
        ? `/api/factory/runs/${encodeURIComponent(runId)}/step`
        : action === "approve"
          ? `/api/factory/runs/${encodeURIComponent(runId)}/approve`
          : action === "pause"
            ? `/api/factory/runs/${encodeURIComponent(runId)}/pause`
            : `/api/factory/runs/${encodeURIComponent(runId)}/steer`
    await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(note ? { note, message: note } : {}),
    })
    await loadFactoryRuns()
  }, [loadFactoryRuns])

  const sortPinnedFirst = (list: Conversation[]) =>
    [...list].sort((a, b) => Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)))

  const visibleProjects = projects.filter(p => !archivedIds.includes(`project:${p.id}`))
  const codingTasks = sessions.filter(s => s.id !== "coding" && s.id !== "personal" && !s.chatThread)
  const personalChats = sortPinnedFirst(sessions.filter(s => s.mode === "personal" && !archivedIds.includes(s.id)))
  const generalChats = sortPinnedFirst(sessions.filter(s => (s.id === "coding" || (s.chatThread && s.mode === "coding")) && !archivedIds.includes(s.id)))
  const archivedProjects = projects.filter(p => p.archivedAt)
  const archivedSessions = sessions.filter(s => s.archivedAt)
  const ungroupedTasks = sortPinnedFirst(codingTasks.filter(s => !s.projectId && !archivedIds.includes(s.id)))
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null

  return (
    <div className="ade-app-shell">
      {/* Paseo-inspired Collapsible Sidebar */}
      {sidebarOpen ? (
        <>
          <aside className="ade-sidebar" style={{ width: `${sidebarWidth}px` }} aria-label="Workspace navigation">
            <div className="ade-sidebar-top">
              <div className="ade-brand-row">
                <div className="ade-brand-badge">A</div>
                <div className="ade-truncate">
                  <div className="ade-brand-title">ADE</div>
                </div>
              </div>
              <button type="button" className="ade-icon-btn" onClick={() => setSidebarOpen(false)} title="Collapse sidebar">
                <PanelLeft className="size-4" />
              </button>
            </div>

            <div className="ade-sidebar-actions">
              <button
                type="button"
                className="ade-new-session-btn"
                onClick={() => {
                  setNewSessionOpen(true)
                  setScreen("work")
                }}
              >
                <Plus className="size-3.5" /> New session
              </button>
              <button
                type="button"
                className="ade-search-trigger"
                onClick={() => setCommandOpen(true)}
                title="Command Center (Cmd+K)"
              >
                <Search className="size-3.5" />
                <kbd className="ade-kbd">⌘K</kbd>
              </button>
            </div>

            <div className="ade-sidebar-scroll">
              {/* Projects & Streams */}
              <div>
                <div className="ade-nav-section-head">
                  <button
                    type="button"
                    className="bg-transparent border-0 p-0 text-inherit uppercase tracking-wider font-semibold"
                    onClick={() => {
                      setProjectsError("")
                      setSelectedProjectId(null)
                      setScreen("projects")
                    }}
                  >
                    Projects
                  </button>
                  <button
                    type="button"
                    className="ade-icon-btn"
                    onClick={() => setAddProjectOpen(true)}
                    title="Add project (GitHub, Git URL, local folder, or new)"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>

                <div className="ade-nav-list">
                  {visibleProjects.map(project => {
                    const expanded = expandedProjects.includes(project.id)
                    const projectSessions = sortPinnedFirst(
                      codingTasks.filter(s => s.projectId === project.id && !archivedIds.includes(s.id)),
                    )
                    const projectRuns = factoryRuns.filter(r => r.run.projectId === project.id)
                    const openPanes = openStreamIdsByProject[project.id] ?? []
                    return (
                      <div key={project.id}>
                        <div
                          className={`ade-nav-row ${screen === "project" && selectedProjectId === project.id ? "is-selected" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => openProject(project.id, false)}
                          onContextMenu={e => {
                            e.preventDefault()
                            setContextMenu({ kind: "project", project, x: e.clientX, y: e.clientY })
                          }}
                          onKeyDown={e => { if (e.key === "Enter") openProject(project.id, false) }}
                        >
                          <button
                            type="button"
                            className="ade-icon-btn !w-5 !h-5"
                            onClick={e => {
                              e.stopPropagation()
                              setExpandedProjects(prev => prev.includes(project.id) ? prev.filter(id => id !== project.id) : [...prev, project.id])
                            }}
                            aria-label={expanded ? "Collapse project" : "Expand project"}
                          >
                            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          </button>
                          <Folder className="size-3.5 shrink-0 opacity-75" />
                          <span className="ade-truncate flex-1">{project.name}</span>
                          <div className="ade-nav-row-actions">
                            <button
                              type="button"
                              className="ade-icon-btn !w-5 !h-5"
                              title={`New stream in ${project.name}`}
                              onClick={e => {
                                e.stopPropagation()
                                setSelectedProjectId(project.id)
                                setNewSessionOpen(true)
                                setScreen("work")
                              }}
                            >
                              <Plus className="size-3" />
                            </button>
                          </div>
                        </div>

                        {expanded ? (
                          <div className="flex flex-col gap-0.5 mt-0.5">
                            {projectSessions.map(sess => {
                              const isUnreadItem = unreadIds.includes(sess.id)
                              const isPinnedItem = pinnedIds.includes(sess.id)
                              const inPane = screen === "project" && selectedProjectId === project.id && (openPanes.includes(sess.id) || openPanes.length === 0)
                              return (
                                <div
                                  key={sess.id}
                                  className={`ade-nav-row ade-nav-row-child ${
                                    (screen === "work" && !newSessionOpen && activeSession.id === sess.id) ||
                                    (screen === "project" && selectedProjectId === project.id && focusedStreamId === sess.id)
                                      ? "is-selected"
                                      : ""
                                  }`}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => {
                                    clearUnread(sess.id)
                                    if (screen === "project" && selectedProjectId === project.id) {
                                      openStreamPane(project.id, sess.id)
                                    } else {
                                      setSelectedProjectId(project.id)
                                      openStreamPane(project.id, sess.id)
                                      setScreen("project")
                                    }
                                  }}
                                  onContextMenu={e => {
                                    e.preventDefault()
                                    setContextMenu({ kind: "session", session: sess, x: e.clientX, y: e.clientY })
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      clearUnread(sess.id)
                                      setSelectedProjectId(project.id)
                                      openStreamPane(project.id, sess.id)
                                      setScreen("project")
                                    }
                                  }}
                                >
                                  <span className={`ade-dot ade-dot-${sess.status === "working" ? "running" : sess.workspace?.status === "attention" ? "failed" : "completed"}`} />
                                  {renamingId === sess.id ? (
                                    <input
                                      className="ade-input-sm !h-6 flex-1"
                                      autoFocus
                                      value={renameText}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => setRenameText(e.target.value)}
                                      onBlur={() => void handleRenameSubmit(sess)}
                                      onKeyDown={e => { if (e.key === "Enter") void handleRenameSubmit(sess); if (e.key === "Escape") setRenamingId(null) }}
                                    />
                                  ) : (
                                    <>
                                      {isPinnedItem ? <Pin className="size-3 shrink-0 opacity-60" /> : null}
                                      <span className={`ade-truncate flex-1 ${isUnreadItem ? "font-semibold" : ""}`}>{sess.label}</span>
                                      {inPane ? <span className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--primary))] shrink-0" title="Open in middle pane" /> : null}
                                      <div className="ade-nav-row-actions">
                                        <button
                                          type="button"
                                          className="ade-icon-btn !w-5 !h-5"
                                          title="Open full workspace"
                                          onClick={e => {
                                            e.stopPropagation()
                                            clearUnread(sess.id)
                                            setActiveSessionId(sess.id)
                                            setNewSessionOpen(false)
                                            setScreen("work")
                                          }}
                                        >
                                          <Maximize2 className="size-3" />
                                        </button>
                                        <button
                                          type="button"
                                          className="ade-icon-btn !w-5 !h-5"
                                          title="Rename stream"
                                          onClick={e => { e.stopPropagation(); setRenamingId(sess.id); setRenameText(sess.label) }}
                                        >
                                          <Pencil className="size-3" />
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )
                            })}

                            {projectRuns.map(runDetail => {
                              const streamKey = `factory:${runDetail.run.runId}`
                              return (
                                <div
                                  key={streamKey}
                                  className={`ade-nav-row ade-nav-row-child ${screen === "project" && selectedProjectId === project.id && focusedStreamId === streamKey ? "is-selected" : ""}`}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => {
                                    setSelectedProjectId(project.id)
                                    openStreamPane(project.id, streamKey)
                                    setScreen("project")
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      setSelectedProjectId(project.id)
                                      openStreamPane(project.id, streamKey)
                                      setScreen("project")
                                    }
                                  }}
                                >
                                  <span
                                    className={`ade-dot ade-dot-${
                                      runDetail.run.status === "running"
                                        ? "running"
                                        : runDetail.run.status === "completed"
                                          ? "completed"
                                          : runDetail.run.status === "failed"
                                            ? "failed"
                                            : "waiting"
                                    }`}
                                  />
                                  <Workflow className="size-3 shrink-0 opacity-70" />
                                  <span className="ade-truncate flex-1">
                                    {runDetail.run.issueRef?.number ? `#${runDetail.run.issueRef.number} ` : ""}
                                    {runDetail.run.issueRef?.title || runDetail.taskPrompt || runDetail.run.runId.slice(0, 8)}
                                  </span>
                                </div>
                              )
                            })}

                            <button
                              type="button"
                              className="ade-nav-row ade-nav-row-child opacity-60 hover:opacity-100"
                              onClick={() => {
                                setSelectedProjectId(project.id)
                                setNewSessionOpen(true)
                                setScreen("work")
                              }}
                            >
                              <Plus className="size-3 shrink-0" />
                              <span className="ade-truncate">New stream</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}

                  {ungroupedTasks.map(sess => (
                    <div
                      key={sess.id}
                      className={`ade-nav-row ${screen === "work" && !newSessionOpen && activeSession.id === sess.id ? "is-selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        clearUnread(sess.id)
                        setActiveSessionId(sess.id)
                        setNewSessionOpen(false)
                        setScreen("work")
                      }}
                      onContextMenu={e => {
                        e.preventDefault()
                        setContextMenu({ kind: "session", session: sess, x: e.clientX, y: e.clientY })
                      }}
                      onKeyDown={e => { if (e.key === "Enter") { clearUnread(sess.id); setActiveSessionId(sess.id); setNewSessionOpen(false); setScreen("work") } }}
                    >
                      <span className={`ade-dot ade-dot-${sess.status === "working" ? "running" : "completed"}`} />
                      <GitBranch className="size-3.5 shrink-0 opacity-70" />
                      {renamingId === sess.id ? (
                        <input
                          className="ade-input-sm !h-6 flex-1"
                          autoFocus
                          value={renameText}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setRenameText(e.target.value)}
                          onBlur={() => void handleRenameSubmit(sess)}
                          onKeyDown={e => { if (e.key === "Enter") void handleRenameSubmit(sess); if (e.key === "Escape") setRenamingId(null) }}
                        />
                      ) : (
                        <span className={`ade-truncate flex-1 ${unreadIds.includes(sess.id) ? "font-semibold" : ""}`}>{sess.label}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Direct Chats */}
              <div>
                <div className="ade-nav-section-head">
                  <span>Chats</span>
                  <div className="flex items-center gap-0.5">
                    <button type="button" className="ade-icon-btn" title="New coding chat" onClick={() => void handleCreateChatThread("coding")}>
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="ade-nav-list">
                  {[...generalChats, ...personalChats].map(sess => {
                    const isPersonal = sess.mode === "personal"
                    const isPinnedItem = pinnedIds.includes(sess.id)
                    const isUnreadItem = unreadIds.includes(sess.id)
                    return (
                      <div
                        key={sess.id}
                        role="button"
                        tabIndex={0}
                        className={`ade-nav-row ${screen === "work" && !newSessionOpen && activeSession.id === sess.id ? "is-selected" : ""}`}
                        onClick={() => {
                          clearUnread(sess.id)
                          setActiveSessionId(sess.id)
                          setNewSessionOpen(false)
                          setScreen("work")
                        }}
                        onContextMenu={e => {
                          e.preventDefault()
                          setContextMenu({ kind: "session", session: sess, x: e.clientX, y: e.clientY })
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            clearUnread(sess.id)
                            setActiveSessionId(sess.id)
                            setNewSessionOpen(false)
                            setScreen("work")
                          }
                        }}
                      >
                        <span className={`ade-dot ade-dot-${sess.status === "working" ? "running" : isUnreadItem ? "waiting" : "completed"}`} />
                        {isPersonal ? (
                          <MessageCircle className="size-3.5 shrink-0 opacity-70" />
                        ) : (
                          <MessageSquare className="size-3.5 shrink-0 opacity-70" />
                        )}
                        {renamingId === sess.id ? (
                          <input
                            className="ade-input-sm !h-6 flex-1"
                            autoFocus
                            value={renameText}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setRenameText(e.target.value)}
                            onBlur={() => void handleRenameSubmit(sess)}
                            onKeyDown={e => { if (e.key === "Enter") void handleRenameSubmit(sess); if (e.key === "Escape") setRenamingId(null) }}
                          />
                        ) : (
                          <>
                            <span className={`ade-truncate flex-1 ${isUnreadItem ? "font-semibold" : ""}`}>{sess.label}</span>
                            {isPinnedItem ? <Pin className="size-3 shrink-0 opacity-55" /> : null}
                          </>
                        )}
                      </div>
                    )
                  })}

                  {archivedProjects.length + archivedSessions.length > 0 ? (
                    <div className="mt-1 ade-archived-section">
                      <button
                        type="button"
                        className="ade-nav-row opacity-60 hover:opacity-100 !text-[11.5px]"
                        aria-expanded={archivedExpanded}
                        onClick={() => setArchivedExpanded(v => !v)}
                      >
                        <Archive className="size-3 shrink-0" />
                        <span className="flex-1">Archived ({archivedProjects.length + archivedSessions.length})</span>
                        {archivedExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      </button>
                      {archivedExpanded ? <>
                        {archivedProjects.map(project => (
                          <div key={project.id} className="ade-nav-row ade-nav-row-child ade-archived-row">
                            <FolderGit2 className="size-3 shrink-0 opacity-60" />
                            <span className="ade-truncate flex-1 opacity-70">{project.name}</span>
                            <button type="button" className="ade-archived-restore" aria-label={`Restore project ${project.name}`} onClick={() => void toggleArchive(`project:${project.id}`, true)}>Restore</button>
                          </div>
                        ))}
                        {archivedSessions.map(sess => {
                          const projectName = projects.find(p => p.id === sess.projectId)?.name
                          return (
                            <div
                              key={sess.id}
                              role="button"
                              tabIndex={0}
                              className="ade-nav-row ade-nav-row-child ade-archived-row"
                              title={sess.workspace?.removed ? "Worktree removed — restoring recreates it from its branch" : undefined}
                              onClick={() => {
                                setActiveSessionId(sess.id)
                                setNewSessionOpen(false)
                                setScreen("work")
                              }}
                              onContextMenu={e => {
                                e.preventDefault()
                                setContextMenu({ kind: "session", session: sess, x: e.clientX, y: e.clientY })
                              }}
                            >
                              {sess.chatThread ? <MessageSquare className="size-3 shrink-0 opacity-60" /> : <GitBranch className="size-3 shrink-0 opacity-60" />}
                              <span className="ade-truncate flex-1 opacity-70">{sess.label}{projectName ? <small className="opacity-60"> · {projectName}</small> : null}</span>
                              <button type="button" className="ade-archived-restore" aria-label={`Restore ${sess.label}`} onClick={event => { event.stopPropagation(); void toggleArchive(sess.id, true) }}>Restore</button>
                            </div>
                          )
                        })}
                      </> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="ade-sidebar-footer">
              <button
                type="button"
                className={`ade-nav-row ${screen === "factory" ? "is-selected" : ""}`}
                onClick={() => { previousScreen.current = screen; setScreen("factory") }}
              >
                <Workflow className="size-3.5 opacity-75" />
                <span>Software Factory</span>
              </button>
              <button
                type="button"
                className={`ade-nav-row ${screen === "worktrees" ? "is-selected" : ""}`}
                onClick={() => { previousScreen.current = screen; setScreen("worktrees") }}
              >
                <FolderGit2 className="size-3.5 opacity-75" />
                <span>Worktrees</span>
              </button>
              <button
                type="button"
                className="ade-nav-row"
                onClick={() => {
                  setNewSessionOpen(false)
                  setScreen("work")
                  setExternalOpenRequest({ id: "browser", kind: "browser", title: "Browser" })
                }}
              >
                <Globe className="size-3.5 opacity-75" />
                <span>Built-in Browser</span>
              </button>
              <button
                type="button"
                className={`ade-nav-row ${screen === "settings" ? "is-selected" : ""}`}
                onClick={() => { previousScreen.current = screen; setScreen("settings") }}
              >
                <Settings2 className="size-3.5 opacity-75" />
                <span>Settings &amp; MCP</span>
              </button>
              <button
                type="button"
                className="ade-host-status w-full text-left cursor-pointer"
                onClick={() => setEnvPaletteOpen(true)}
                title="Switch environment (This device / SSH / Remote)"
              >
                <span className={`ade-dot ${runtime?.online ? "ade-dot-completed" : "ade-dot-waiting"}`} />
                <Server className="size-3 shrink-0" />
                <span className="ade-truncate flex-1">{activeEnvironmentName}</span>
                {stream.sseConnected ? <span className="ade-pill ade-pill-ok !text-[9.5px] !py-0">live</span> : null}
              </button>
            </div>
          </aside>
          <div
            className="ade-split-divider"
            onPointerDown={() => { sidebarDragging.current = true }}
            title="Drag to resize sidebar"
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-3 px-1.5 border-r border-[rgb(var(--border))] bg-[rgb(var(--nav))]">
          <button type="button" className="ade-icon-btn" onClick={() => setSidebarOpen(true)} title="Expand sidebar">
            <PanelLeft className="size-4" />
          </button>
          <button type="button" className="ade-icon-btn" onClick={() => { setNewSessionOpen(true); setScreen("work") }} title="New session">
            <Plus className="size-4" />
          </button>
          <button type="button" className="ade-icon-btn" onClick={() => setCommandOpen(true)} title="Command Center (Cmd+K)">
            <Search className="size-4" />
          </button>
          <button type="button" className="ade-icon-btn" onClick={() => { previousScreen.current = screen; setScreen("factory") }} title="Software Factory">
            <Workflow className="size-4" />
          </button>
          <button
            type="button"
            className="ade-icon-btn"
            onClick={() => { setNewSessionOpen(false); setScreen("work"); setExternalOpenRequest({ id: "browser", kind: "browser", title: "Browser" }) }}
            title="Built-in Browser"
          >
            <Globe className="size-4" />
          </button>
          <button type="button" className="ade-icon-btn mt-auto" onClick={() => { previousScreen.current = screen; setScreen("settings") }} title="Settings">
            <Settings2 className="size-4" />
          </button>
        </div>
      )}

      {/* Main Column */}
      <div className="ade-main-column">
        {runtimeError && screen !== "settings" ? (
          <div className="ade-banner-error rounded-none border-x-0 border-t-0">
            <Sparkles className="size-3.5 shrink-0" />
            <span className="flex-1">{runtimeError}</span>
            <button type="button" className="ade-chip-btn" onClick={() => setScreen("settings")}>Open Settings</button>
          </div>
        ) : null}

        {screen === "settings" ? (
          <SettingsView
            settings={settings}
            resolved={resolved}
            error={settingsError}
            runtimeError={runtimeError}
            runtime={runtime}
            matchingRuntime={matchingRuntime}
            providerName={providerName}
            selectedModel={selectedModel}
            selectedProvider={effectiveProvider}
            modelCatalog={effectiveCatalog}
            onModelsChanged={() => { void loadModelCatalog(); void loadHealth() }}
            sending={sending}
            credentialChangesBlocked={sessions.some(s => s.status === "working")}
            connections={connections}
            projects={projects}
            activeEnvironmentName={activeEnvironmentName}
            initialCategory={settingsCategory}
            autoOpenAddEnvironment={settingsAutoOpenAddEnv}
            update={update}
            onBack={() => {
              setSettingsAutoOpenAddEnv(false)
              setScreen(previousScreen.current === "settings" ? "work" : previousScreen.current)
            }}
            onOpenProjects={() => setScreen("projects")}
            onWorktreeDiagnostics={() => setScreen("worktrees")}
            onEnvironmentChanged={(id, name, dir) => {
              setActiveEnvironmentId(id)
              setActiveEnvironmentName(name)
              setEnvironmentDirectory(dir)
              setEnvironmentVersion(v => v + 1)
            }}
            mcpServers={stream.mcpServers}
            approvalPolicy={stream.approvalPolicy}
            approvalRules={stream.approvalRules}
            browserState={stream.browserState}
            skillsCatalog={stream.skillsCatalog}
            onRefreshMcp={() => void stream.refreshMcp()}
            onChangeApprovalPolicy={p => stream.setApprovalPolicy(p)}
            onDeleteApprovalRule={stream.deleteApprovalRule}
          />
        ) : screen === "factory" ? (
          <FactoryView
            projects={projects}
            selectedProjectId={selectedProjectId}
            modelCatalog={effectiveCatalog}
            githubLogin={connections.githubConnection?.login ?? null}
            environmentId={activeEnvironmentId}
            terminalFontSize={settings.terminalFontSize}
            terminalScrollback={settings.terminalScrollback}
            browserState={stream.browserState}
            onSelectProject={setSelectedProjectId}
            onProjectSaved={saved => {
              setProjects(prev => {
                const exists = prev.some(p => p.id === saved.id)
                return exists ? prev.map(p => (p.id === saved.id ? saved : p)) : [...prev, saved]
              })
            }}
            onBrowserStateChange={stream.setBrowserState}
            onOpenExternal={stream.openExternalBrowser}
          />
        ) : screen === "worktrees" ? (
          <WorktreeDiagnostics
            state={worktrees}
            onBack={() => setScreen(previousScreen.current === "worktrees" ? "work" : previousScreen.current)}
          />
        ) : screen === "project" && selectedProject ? (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <ProjectStreamsWorkspace
              project={selectedProject}
              sessions={codingTasks.filter(t => t.projectId === selectedProject.id && !archivedIds.includes(t.id))}
              archivedSessions={codingTasks.filter(t => t.projectId === selectedProject.id && archivedIds.includes(t.id))}
              factoryRuns={factoryRuns.filter(r => r.run.projectId === selectedProject.id)}
              openStreamIds={openStreamIdsByProject[selectedProject.id] ?? []}
              focusedStreamId={focusedStreamId}
              activity={projectActivity}
              activityError={projectActivityError}
              settingsOpen={projectSettingsOpen}
              onToggleSettings={() => setProjectSettingsOpen(v => !v)}
              onFocusStream={streamId => setFocusedStreamId(streamId)}
              onCloseStreamPane={streamId => closeStreamPane(selectedProject.id, streamId)}
              onOpenStreamPane={streamId => openStreamPane(selectedProject.id, streamId)}
              onMaximizeSession={id => {
                clearUnread(id)
                setActiveSessionId(id)
                setNewSessionOpen(false)
                setScreen("work")
              }}
              onMaximizeFactoryRun={() => {
                setSelectedProjectId(selectedProject.id)
                setScreen("factory")
              }}
              onQuickStartStream={async prompt => {
                if (!prompt.trim()) {
                  setSelectedProjectId(selectedProject.id)
                  setNewSessionOpen(true)
                  setScreen("work")
                  return
                }
                const taskId = crypto.randomUUID()
                const start: TaskStart = {
                  id: taskId,
                  title: prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "New stream",
                  repository: selectedProject.repository || "",
                  kind: selectedProject.repository ? "worktree" : "none",
                  environmentId: activeEnvironmentId,
                  projectId: selectedProject.id,
                  ...(modelReady ? {
                    initialMessage: {
                      id: crypto.randomUUID(),
                      content: prompt,
                      provider: effectiveProvider,
                      model: selectedModel,
                      reasoning: settings.reasoning,
                    },
                  } : {}),
                }
                const res = await request<{ session: Conversation }>("/api/coding-tasks", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(start),
                })
                await loadSessions()
                if (!start.initialMessage) setRuntimeError(`${modelSetupMessage} The session was created without sending your message.`)
                if (res?.session?.id) {
                  openStreamPane(selectedProject.id, res.session.id)
                }
              }}
              onSendQuickMessage={handleSendQuickStreamMessage}
              onStartFactoryRun={opts => handleStartFactoryRunForProject(selectedProject, opts)}
              onFactoryRunAction={handleFactoryRunAction}
              onUnarchiveSession={id => void toggleArchive(id, true)}
              onOpenExternal={url => void stream.openExternalBrowser(url)}
              onStartSessionFromIssue={async issue => {
                const kind = selectedProject.repository ? settings.defaultWorkspaceKind : "none"
                await handleStartNewSession({
                  projectId: selectedProject.id,
                  kind,
                  repository: kind === "none" ? "" : selectedProject.repository || "",
                  prompt: `Work on GitHub issue #${issue.number}: ${issue.title}\n\n${(issue.body ?? "").slice(0, 6000)}`.trim(),
                  githubIssue: { url: issue.url, repository: issue.repository, number: issue.number, title: issue.title.slice(0, 300), state: issue.state, body: (issue.body ?? "").slice(0, 5000), truncated: (issue.body ?? "").length > 5000 },
                })
              }}
              onDeleteSession={sess => void handleDeleteSession(sess)}
              onOpenAgent={(sessionId, agent) => {
                setActiveSessionId(sessionId)
                setNewSessionOpen(false)
                setScreen("work")
                setExternalOpenRequest({ id: `subagent:${agent.id}`, kind: "subagent", title: agent.name, subagentId: agent.id })
              }}
            />
            <ProjectSettings
              key={selectedProject.id}
              project={selectedProject}
              environmentName={activeEnvironmentName}
              initialDraft={projectDrafts[selectedProject.id]}
              open={projectSettingsOpen}
              githubConnection={connections.githubConnection}
              githubStatusError={connections.githubStatusError}
              onOpenSettings={(draftInput) => {
                setProjectDrafts(prev => ({ ...prev, [selectedProject.id]: draftInput }))
                openSettingsSection("github", false)
              }}
              onSearchRepositories={searchGitHubRepositories}
              onClose={() => setProjectSettingsOpen(false)}
              onSave={(input) => handleSaveProject(input, selectedProject.id)}
            />
          </div>
        ) : screen === "projects" ? (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <ProjectsView
              projects={visibleProjects}
              project={null}
              features={[]}
              error={projectsError}
              activity={null}
              activityError=""
              onSelect={id => openProject(id, false)}
              onBack={() => { setSelectedProjectId(null); setScreen("projects") }}
              onOpenFeature={id => { setActiveSessionId(id); setNewSessionOpen(false); setScreen("work") }}
              onOpenAgent={(sessionId, agent) => {
                setActiveSessionId(sessionId)
                setNewSessionOpen(false)
                setScreen("work")
                setExternalOpenRequest({ id: `subagent:${agent.id}`, kind: "subagent", title: agent.name, subagentId: agent.id })
              }}
            />
          </div>
        ) : newSessionOpen ? (
          <NewSessionView
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            onAddProject={() => setAddProjectOpen(true)}
            onOpenEnvironmentPalette={() => setEnvPaletteOpen(true)}
            environmentName={activeEnvironmentName}
            modelCatalog={effectiveCatalog}
            selectedProvider={effectiveProvider}
            selectedModel={selectedModel}
            onSelectModel={(provider, id) => update({ provider, model: id })}
            reasoning={settings.reasoning}
            onSelectReasoning={level => update({ reasoning: level })}
            approvalPolicy={stream.approvalPolicy}
            onChangeApprovalPolicy={p => void stream.setApprovalPolicy(p)}
            onOpenSettings={() => openSettingsSection("models")}
            starting={creatingSession}
            error={launchError}
            onStart={handleStartNewSession}
            onLookupIssue={async (projectId, url) => {
              const res = await request<{ issue: GitHubIssue }>("/api/github/issues/lookup", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ projectId, url }),
              })
              return res.issue
            }}
          />
        ) : (
          <SplitWorkspace
            session={activeSession}
            timeline={stream.timeline}
            subagentTimelines={stream.subagentTimelines}
            subagents={stream.subagents}
            approvals={stream.approvals}
            approvalPolicy={stream.approvalPolicy}
            processes={stream.processes}
            gitSummary={stream.gitSummary}
            artifacts={stream.artifacts}
            tasks={stream.tasks}
            skillsCatalog={stream.skillsCatalog}
            browserState={stream.browserState}
            onBrowserStateChange={stream.setBrowserState}
            modelCatalog={effectiveCatalog}
            selectedProvider={effectiveProvider}
            selectedModel={selectedModel}
            onSelectModel={(provider, id) => update({ provider, model: id })}
            reasoning={settings.reasoning}
            onSelectReasoning={level => update({ reasoning: level })}
            onOpenSettings={() => openSettingsSection("models")}
            draft={draft}
            onDraftChange={setDraft}
            attachments={attachments}
            onAttachFiles={files => void handleAttachFiles(files)}
            onRemoveAttachment={id => setAttachments(prev => prev.filter(a => a.id !== id))}
            onSendMessage={text => void handleSendMessage(text)}
            onSteerSession={(text, mode) => void handleSteerSession(text, mode)}
            onAbortSession={() => void handleAbortSession()}
            onCompactSession={() => void handleCompactSession()}
            onResolveApproval={stream.resolveApproval}
            onChangeApprovalPolicy={p => void stream.setApprovalPolicy(p, activeSession.id)}
            onKillProcess={stream.killProcess}
            onRefreshProcesses={() => void stream.refreshProcesses(activeSession.id)}
            onRefreshGit={() => void stream.refreshGit(activeSession.id)}
            onMessageSubagent={stream.messageSubagent}
            onStopSubagent={stream.stopSubagent}
            onOpenExternalBrowser={stream.openExternalBrowser}
            onReviewArtifact={handleReviewArtifact}
            terminalFontSize={settings.terminalFontSize}
            terminalScrollback={settings.terminalScrollback}
            terminalAutoStart={settings.terminalAutoStart}
            prDraftDefault={settings.prDraft}
            environmentId={activeEnvironmentId}
            externalOpenRequest={externalOpenRequest}
            onClearExternalOpenRequest={() => setExternalOpenRequest(null)}
            textareaRef={composerRef}
          />
        )}
      </div>

      <CommandCenter
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        projects={projects}
        sessions={sessions}
        subagents={stream.subagents}
        hasActiveWorkspace={hasWorkspace}
        onSelectProject={id => { setSelectedProjectId(id); setProjectSettingsOpen(true); setScreen("project") }}
        onSelectSession={sess => { setActiveSessionId(sess.id); setNewSessionOpen(false); setScreen("work") }}
        onNewSession={() => { setNewSessionOpen(true); setScreen("work") }}
        onOpenPanel={kind => {
          setNewSessionOpen(false)
          setScreen("work")
          setExternalOpenRequest({ id: kind, kind, title: kind[0].toUpperCase() + kind.slice(1) })
        }}
        onOpenSubagent={id => {
          const found = stream.subagents.find(s => s.id === id)
          setNewSessionOpen(false)
          setScreen("work")
          setExternalOpenRequest({ id: `subagent:${id}`, kind: "subagent", title: found?.name || "Subagent", subagentId: id })
        }}
        onOpenExternalBrowser={url => void stream.openExternalBrowser(url)}
        onOpenSettings={() => { previousScreen.current = screen; setScreen("settings") }}
      />

      <AddProjectWizard
        open={addProjectOpen}
        githubLogin={connections.githubConnection?.login ?? null}
        onClose={() => setAddProjectOpen(false)}
        onCreated={saved => {
          setProjects(prev => (prev.some(p => p.id === saved.id) ? prev.map(p => (p.id === saved.id ? saved : p)) : [...prev, saved]))
          openProject(saved.id, false)
        }}
      />

      <EnvironmentPalette
        open={envPaletteOpen}
        environments={environmentDirectory.environments}
        activeId={activeEnvironmentId}
        onSelect={async env => {
          const dir = await request<EnvironmentDirectory>("/api/environments/active", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: env.id }),
          })
          setEnvironmentDirectory(dir)
          setActiveEnvironmentId(dir.activeId)
          setActiveEnvironmentName(dir.environments.find(e => e.id === dir.activeId)?.name ?? env.name)
          setEnvironmentVersion(v => v + 1)
        }}
        onManageEnvironments={() => openSettingsSection("environments", false)}
        onAddHost={() => openSettingsSection("environments", true)}
        onClose={() => setEnvPaletteOpen(false)}
      />

      <SidebarContextMenu
        target={contextMenu}
        projects={visibleProjects}
        isPinned={id => pinnedIds.includes(id)}
        isUnread={id => unreadIds.includes(id)}
        isArchived={id => archivedIds.includes(id)}
        onClose={() => setContextMenu(null)}
        onOpenSplitView={sess => {
          clearUnread(sess.id)
          if (sess.projectId) {
            openProject(sess.projectId, false)
            openStreamPane(sess.projectId, sess.id)
          } else {
            setActiveSessionId(sess.id)
            setNewSessionOpen(false)
            setScreen("work")
            setExternalOpenRequest({ id: "diff", kind: "diff", title: "Diff" })
          }
        }}
        onOpenNewWindow={sess => {
          const url = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sess.id)}`
          window.open(url, "_blank", "noopener")
        }}
        onOpenExternalApp={(app, path) => void handleOpenExternalApp(app, path)}
        onContinueInCloud={() => openSettingsSection("environments", true)}
        onTogglePin={togglePin}
        onToggleUnread={toggleUnread}
        onRenameSession={sess => {
          setRenamingId(sess.id)
          setRenameText(sess.label)
        }}
        onForkSession={sess => void handleForkSession(sess)}
        onMoveToSection={(sess, mode) => void handleMoveSession(sess, { mode })}
        onMoveUnderProject={(sess, projectId) => void handleMoveSession(sess, { projectId })}
        onToggleArchiveSession={toggleArchive}
        onDeleteSession={sess => void handleDeleteSession(sess)}
        onNewProjectStream={project => {
          setSelectedProjectId(project.id)
          setNewSessionOpen(true)
          setScreen("work")
        }}
        onOpenProjectSettings={project => openProject(project.id, true)}
        onToggleArchiveProject={project => toggleArchive(`project:${project.id}`)}
        onDeleteProject={project => void handleDeleteProject(project)}
      />
    </div>
  )
}
