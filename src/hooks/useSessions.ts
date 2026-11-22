import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { request } from "../../api"
import type { Conversation, GitHubIssue, PendingApproval, TaskStart } from "../../app-types"
import { clearPendingStart, pendingStarts, storePendingStart } from "../../pending-task-starts"
import type { Project } from "../../ProjectsView"
import type { Settings } from "../../useSettings"

const FALLBACK_SESSION: Conversation = {
  id: "coding",
  mode: "coding",
  label: "Coding chat",
  status: "idle",
  messages: [],
}

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
  } catch (err) {
    // Storage can be unavailable in private mode or quota-exceeded environments.
    console.warn(`[ADE] Could not persist ${key}:`, err instanceof Error ? err.message : String(err))
  }
}

export function useSessions(params: {
  activeSessionId: string
  selectedProjectId: string | null
  activeEnvironmentId: string
  environmentVersion: number
  projects: Project[]
  settings: Settings
  effectiveProvider: string
  selectedModel: string
  modelReady: boolean
  modelSetupMessage: string
  onLoadProjects: () => Promise<void>
  onOpenSession: (id: string) => void
  onSessionArchived: (id: string) => void
  onProjectArchived: (projectId: string) => void
  onExpandProject: (projectId: string) => void
  onOpenStreamPane: (projectId: string, streamId: string) => void
  onError: (msg: string) => void
}) {
  const {
    activeSessionId,
    selectedProjectId,
    activeEnvironmentId,
    environmentVersion,
    projects,
    settings,
    effectiveProvider,
    selectedModel,
    modelReady,
    modelSetupMessage,
    onLoadProjects,
    onOpenSession,
    onSessionArchived,
    onProjectArchived,
    onExpandProject,
    onError,
  } = params

  const [sessions, setSessions] = useState<Conversation[]>([])
  const [creatingSession, setCreatingSession] = useState(false)
  const [launchError, setLaunchError] = useState("")
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<{ id: string; name: string; content: string }[]>([])
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => readStoredIds("ade.pinned-ids"))
  const [unreadIds, setUnreadIds] = useState<string[]>(() => readStoredIds("ade.unread-ids"))

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId) ?? sessions[0] ?? FALLBACK_SESSION,
    [sessions, activeSessionId],
  )
  const isCodingTask = Boolean(
    activeSession.workspace || (activeSession.id !== "coding" && activeSession.id !== "personal" && !activeSession.chatThread),
  )
  const hasWorkspace = Boolean(activeSession.workspace?.path && activeSession.workspace.status === "ready")

  const loadSessions = useCallback(async () => {
    try {
      const data = await request<{ sessions: Conversation[] }>("/api/sessions")
      setSessions(data.sessions ?? [])
    } catch (err) {
      // Health polling surfaces connection errors in the UI; log here for diagnostics.
      console.warn("[ADE] Could not load sessions:", err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void request<{ sessions: Conversation[] }>("/api/sessions")
      .then(data => { if (!cancelled) setSessions(data.sessions ?? []) })
      .catch(err => {
        if (!cancelled) console.warn("[ADE] Could not load sessions:", err instanceof Error ? err.message : String(err))
      })
    return () => { cancelled = true }
  }, [environmentVersion])

  // Replay any pending task starts stored before reload.
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
        // Leave for manual retry if runtime offline.
      })
    }
  }, [activeEnvironmentId, loadSessions])

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
          body: JSON.stringify(
            isProject
              ? { archived: !currentlyArchived, removeWorktrees: settings.archiveRemovesWorktree }
              : { archived: !currentlyArchived, removeWorktree: settings.archiveRemovesWorktree },
          ),
        },
      )
      const kept = [result.worktreeError, ...(result.sessions ?? []).map(s => s.worktreeError)].filter(Boolean)
      if (kept.length) onError(`Archived, but a worktree was kept: ${kept[0]}`)
      if (!currentlyArchived && !isProject && activeSessionId === targetId) onSessionArchived(targetId)
      if (!currentlyArchived && isProject && selectedProjectId === targetId) onProjectArchived(targetId)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not change the archive state.")
    } finally {
      await Promise.all([loadSessions(), onLoadProjects()])
    }
  }, [
    projects,
    sessions,
    settings.archiveRemovesWorktree,
    activeSessionId,
    selectedProjectId,
    loadSessions,
    onLoadProjects,
    onSessionArchived,
    onProjectArchived,
    onError,
  ])

  // One-time migration of the old browser-only archive list to the host.
  useEffect(() => {
    const legacy = readStoredIds("ade.archived-ids")
    if (!legacy.length || (!sessions.length && !projects.length)) return
    localStorage.removeItem("ade.archived-ids")
    const targets = legacy.filter(id =>
      id.startsWith("project:")
        ? projects.some(p => `project:${p.id}` === id && !p.archivedAt)
        : sessions.some(s => s.id === id && !s.archivedAt && s.id !== "coding" && s.id !== "personal"),
    )
    if (!targets.length) return
    void Promise.all(
      targets.map(id => {
        const isProject = id.startsWith("project:")
        const targetId = isProject ? id.slice("project:".length) : id
        return request(
          isProject ? `/api/projects/${encodeURIComponent(targetId)}/archive` : `/api/sessions/${encodeURIComponent(targetId)}/archive`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              isProject
                ? { archived: true, removeWorktrees: settings.archiveRemovesWorktree }
                : { archived: true, removeWorktree: settings.archiveRemovesWorktree },
            ),
          },
        ).catch(() => undefined)
      }),
    ).then(() => Promise.all([loadSessions(), onLoadProjects()]))
  }, [sessions, projects, settings.archiveRemovesWorktree, loadSessions, onLoadProjects])

  const attachFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return
    const added: { id: string; name: string; content: string }[] = []
    for (const file of Array.from(fileList).slice(0, 6)) {
      if (file.size > 64_000) continue
      try {
        const text = await file.text()
        added.push({ id: crypto.randomUUID(), name: file.name, content: text })
      } catch (err) {
        console.warn("[ADE] Skipped unreadable attached file:", file.name, err instanceof Error ? err.message : String(err))
        onError(`Could not read attached file "${file.name}".`)
      }
    }
    if (added.length) setAttachments(prev => [...prev, ...added])
  }, [onError])

  const sendMessage = useCallback(async (text: string, onAfterSend?: (sessionId: string) => void) => {
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
      onAfterSend?.(activeSession.id)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not send message.")
    } finally {
      setSending(false)
    }
  }, [attachments, effectiveProvider, selectedModel, settings.reasoning, activeSession, isCodingTask, loadSessions, onError])

  const steerSession = useCallback(async (text: string, mode: "steer" | "follow-up") => {
    setDraft("")
    try {
      await request(`/api/sessions/${encodeURIComponent(activeSession.id)}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text, mode }),
      })
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not steer session.")
    }
  }, [activeSession.id, onError])

  const abortSession = useCallback(async () => {
    try {
      await request(`/api/sessions/${encodeURIComponent(activeSession.id)}/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      await loadSessions()
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not stop session.")
    }
  }, [activeSession.id, loadSessions, onError])

  const compactSession = useCallback(async () => {
    try {
      await request(`/api/sessions/${encodeURIComponent(activeSession.id)}/compact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not compact session.")
    }
  }, [activeSession.id, onError])

  const startNewSession = useCallback(async (input: {
    projectId: string | null
    kind: TaskStart["kind"]
    repository: string
    prompt: string
    githubIssue?: GitHubIssue
    engine?: "pi" | "claude-code" | "codex"
  }) => {
    setCreatingSession(true)
    setLaunchError("")
    // Claude Code / Codex sessions get their task after the engine is chosen.
    const external = Boolean(input.engine && input.engine !== "pi" && input.kind !== "none")
    const taskId = crypto.randomUUID()
    const start: TaskStart = {
      id: taskId,
      title: input.prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "New session",
      repository: input.repository,
      kind: input.kind,
      environmentId: activeEnvironmentId,
      projectId: input.projectId,
      githubIssue: input.githubIssue,
      ...(!external && modelReady && input.prompt.trim()
        ? {
            initialMessage: {
              id: crypto.randomUUID(),
              content: input.prompt,
              provider: effectiveProvider,
              model: selectedModel,
              reasoning: settings.reasoning,
            },
          }
        : {}),
    }
    storePendingStart(start)
    try {
      const res = await request<{ session: Conversation }>("/api/coding-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(start),
      })
      clearPendingStart(taskId)
      if (external) {
        await request(`/api/sessions/${encodeURIComponent(taskId)}/engine`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine: input.engine }) })
        if (input.prompt.trim()) {
          await request(`/api/coding-tasks/${encodeURIComponent(taskId)}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: input.prompt }) })
        }
      }
      await loadSessions()
      if (!external && !start.initialMessage && input.prompt.trim()) {
        setDraft(input.prompt)
        onError(`${modelSetupMessage} Your message is waiting in the composer.`)
      }
      onOpenSession(res.session.id)
      if (input.projectId) onExpandProject(input.projectId)
    } catch (err) {
      clearPendingStart(taskId)
      setLaunchError(err instanceof Error ? err.message : "Could not create session.")
    } finally {
      setCreatingSession(false)
    }
  }, [activeEnvironmentId, modelReady, effectiveProvider, selectedModel, settings.reasoning, loadSessions, modelSetupMessage, onError, onOpenSession, onExpandProject])

  const quickStartStream = useCallback(async (project: Project, prompt: string) => {
    const taskId = crypto.randomUUID()
    const start: TaskStart = {
      id: taskId,
      title: prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "New session",
      repository: project.repository && settings.defaultWorkspaceKind !== "none" ? project.repository : "",
      kind: project.repository ? settings.defaultWorkspaceKind : "none",
      environmentId: activeEnvironmentId,
      projectId: project.id,
      ...(modelReady
        ? {
            initialMessage: {
              id: crypto.randomUUID(),
              content: prompt,
              provider: effectiveProvider,
              model: selectedModel,
              reasoning: settings.reasoning,
            },
          }
        : {}),
    }
    const res = await request<{ session: Conversation }>("/api/coding-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(start),
    })
    await loadSessions()
    if (!start.initialMessage) onError(`${modelSetupMessage} The session was created without sending your message.`)
    // Go straight to the new session, like starting one anywhere else.
    if (res?.session?.id) {
      onExpandProject(project.id)
      onOpenSession(res.session.id)
    }
  }, [activeEnvironmentId, modelReady, effectiveProvider, selectedModel, settings.reasoning, settings.defaultWorkspaceKind, loadSessions, modelSetupMessage, onError, onExpandProject, onOpenSession])

  const createChatThread = useCallback(async (mode: "coding" | "personal") => {
    try {
      const id = crypto.randomUUID()
      const res = await request<{ session: Conversation }>("/api/chat-threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, mode }),
      })
      await loadSessions()
      onOpenSession(res.session.id)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not create chat.")
    }
  }, [loadSessions, onOpenSession, onError])

  const renameSession = useCallback(async (session: Conversation, nextTitle: string) => {
    const trimmed = nextTitle.trim()
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
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not rename session.")
    }
  }, [loadSessions, onError])

  const forkSession = useCallback(async (sess: Conversation) => {
    try {
      const res = await request<{ session: Conversation }>(`/api/sessions/${encodeURIComponent(sess.id)}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      await loadSessions()
      if (res?.session?.id) onOpenSession(res.session.id)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not fork chat.")
    }
  }, [loadSessions, onOpenSession, onError])

  const moveSession = useCallback(async (sess: Conversation, opts: { mode?: "coding" | "personal"; projectId?: string | null }) => {
    try {
      await request(`/api/sessions/${encodeURIComponent(sess.id)}/move`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      })
      await loadSessions()
      if (opts.projectId) onExpandProject(opts.projectId)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not move chat.")
    }
  }, [loadSessions, onExpandProject, onError])

  const deleteSession = useCallback(async (sess: Conversation) => {
    const endpoint = sess.chatThread
      ? `/api/chat-threads/${encodeURIComponent(sess.id)}`
      : `/api/coding-tasks/${encodeURIComponent(sess.id)}`
    try {
      await request(endpoint, { method: "DELETE" })
      await loadSessions()
      if (activeSessionId === sess.id) onSessionArchived(sess.id)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not delete session.")
    }
  }, [activeSessionId, loadSessions, onSessionArchived, onError])

  const sendQuickStreamMessage = useCallback(async (sess: Conversation, text: string) => {
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

  const openExternalApp = useCallback(async (app: "cursor" | "vscode" | "windsurf" | "finder", path?: string | null) => {
    try {
      await request("/api/system/open-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app, path: path || undefined }),
      })
    } catch (err) {
      onError(err instanceof Error ? err.message : `Could not open in ${app}.`)
    }
  }, [onError])

  return {
    sessions,
    activeSession,
    isCodingTask,
    hasWorkspace,
    creatingSession,
    launchError,
    sending,
    draft,
    setDraft,
    attachments,
    setAttachments,
    pinnedIds,
    unreadIds,
    archivedIds,
    loadSessions,
    togglePin,
    toggleUnread,
    clearUnread,
    toggleArchive,
    attachFiles,
    sendMessage,
    steerSession,
    abortSession,
    compactSession,
    startNewSession,
    quickStartStream,
    createChatThread,
    renameSession,
    forkSession,
    moveSession,
    deleteSession,
    sendQuickStreamMessage,
    openExternalApp,
  }
}

export function useDesktopNotifications(params: {
  sessions: Conversation[]
  approvals: PendingApproval[]
  notifyOnFinish: boolean
  notifyOnApproval: boolean
  onOpenSession: (id: string) => void
}) {
  const { sessions, approvals, notifyOnFinish, notifyOnApproval, onOpenSession } = params
  const previousStatuses = useRef<Map<string, string>>(new Map())
  const notifiedApprovals = useRef<Set<string>>(new Set())

  useEffect(() => {
    const canNotify = typeof Notification !== "undefined" && Notification.permission === "granted" && !document.hasFocus()
    for (const sess of sessions) {
      const before = previousStatuses.current.get(sess.id)
      if (canNotify && notifyOnFinish && before === "working" && sess.status === "idle") {
        const last = [...sess.messages].reverse().find(m => m.role !== "user")
        const notification = new Notification(`${sess.label} finished`, {
          body: last?.role === "error" ? `Error: ${last.content.slice(0, 140)}` : "The agent is waiting for your next message.",
          tag: `finish-${sess.id}`,
        })
        notification.onclick = () => { window.focus(); onOpenSession(sess.id) }
      }
      previousStatuses.current.set(sess.id, sess.status)
    }
  }, [sessions, notifyOnFinish, onOpenSession])

  useEffect(() => {
    for (const approval of approvals) {
      if (notifiedApprovals.current.has(approval.id)) continue
      notifiedApprovals.current.add(approval.id)
      if (!notifyOnApproval || typeof Notification === "undefined" || Notification.permission !== "granted" || document.hasFocus()) continue
      const label = sessions.find(s => s.id === approval.sessionId)?.label
      const notification = new Notification(label ? `${label} needs approval` : "An agent needs approval", {
        body: approval.command ?? approval.summary ?? "Open ADE to allow or deny the request.",
        tag: `approval-${approval.id}`,
      })
      notification.onclick = () => { window.focus(); onOpenSession(approval.sessionId) }
    }
  }, [approvals, notifyOnApproval, sessions, onOpenSession])
}
