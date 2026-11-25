import { useCallback, useEffect, useMemo, useState } from "react"
import type { Conversation } from "../app-types"
import type { Project } from "../ProjectsView"
import type { Settings } from "../useSettings"
import { usePolling } from "./usePolling"
import { useSessionPreferences } from "./sessions/useSessionPreferences"
import {
  abortSessionApi, archiveEntityApi, compactSessionApi, createChatThreadApi, deleteSessionApi,
  fetchSessionsApi, forkSessionApi, moveSessionApi, openExternalAppApi, postSessionMessageApi,
  quickStartProjectStreamApi, readAttachedFiles, renameSessionApi, replayPendingStartsApi,
  startSessionOrAttemptsApi, steerSessionApi, type SessionAttachment, type StartNewSessionInput,
} from "./sessions/session-actions"

export { useDesktopNotifications } from "./sessions/useDesktopNotifications"

const FALLBACK_SESSION: Conversation = {
  id: "coding",
  mode: "coding",
  label: "Coding chat",
  status: "idle",
  messages: [],
}

export type UseSessionsParams = {
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
  /** Show the comparison of parallel attempts started together. */
  onOpenAttempts?: (attemptGroup: string) => void
  onOpenStreamPane: (projectId: string, streamId: string) => void
  onError: (msg: string) => void
}

export function useSessions(params: UseSessionsParams) {
  const {
    activeSessionId, selectedProjectId, activeEnvironmentId, environmentVersion, projects,
    settings, effectiveProvider, selectedModel, modelReady, modelSetupMessage, onLoadProjects,
    onOpenSession, onSessionArchived, onProjectArchived, onExpandProject, onError, onOpenAttempts,
  } = params

  const [sessions, setSessions] = useState<Conversation[]>([])
  const [creatingSession, setCreatingSession] = useState(false)
  const [launchError, setLaunchError] = useState("")
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<SessionAttachment[]>([])

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId) ?? sessions[0] ?? FALLBACK_SESSION,
    [sessions, activeSessionId],
  )
  const isCodingTask = Boolean(
    activeSession.workspace || (activeSession.id !== "coding" && activeSession.id !== "personal" && !activeSession.chatThread),
  )
  const hasWorkspace = Boolean(activeSession.workspace?.path && activeSession.workspace.status === "ready")

  const loadSessions = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchSessionsApi(signal)
      if (!signal?.aborted) setSessions(next)
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) return
      console.warn("[ADE] Could not load sessions:", err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => loadSessions(controller.signal))
    return () => controller.abort()
  }, [environmentVersion, loadSessions])

  // Sessions can start in the background (automations); refresh periodically while tab is visible.
  usePolling(loadSessions, 20_000, { immediate: false })

  useEffect(() => {
    replayPendingStartsApi(activeEnvironmentId, () => { void loadSessions() })
  }, [activeEnvironmentId, loadSessions])

  const prefs = useSessionPreferences({
    sessions,
    projects,
    archiveRemovesWorktree: settings.archiveRemovesWorktree,
    loadSessions,
    onLoadProjects,
  })

  const toggleArchive = useCallback(async (id: string, archivedNow?: boolean) => {
    const isProject = id.startsWith("project:")
    const targetId = isProject ? id.slice("project:".length) : id
    const currentlyArchived = archivedNow ?? (isProject
      ? Boolean(projects.find(p => p.id === targetId)?.archivedAt)
      : Boolean(sessions.find(s => s.id === targetId)?.archivedAt))
    try {
      const { worktreeWarning } = await archiveEntityApi({
        isProject, targetId, archived: !currentlyArchived, removeWorktree: settings.archiveRemovesWorktree,
      })
      if (worktreeWarning) onError(`Archived, but a worktree was kept: ${worktreeWarning}`)
      if (!currentlyArchived && !isProject && activeSessionId === targetId) onSessionArchived(targetId)
      if (!currentlyArchived && isProject && selectedProjectId === targetId) onProjectArchived(targetId)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not change the archive state.")
    } finally {
      await Promise.all([loadSessions(), onLoadProjects()])
    }
  }, [projects, sessions, settings.archiveRemovesWorktree, activeSessionId, selectedProjectId, loadSessions, onLoadProjects, onSessionArchived, onProjectArchived, onError])

  const attachFiles = useCallback(async (fileList: FileList | null) => {
    const { added, errors } = await readAttachedFiles(fileList)
    for (const err of errors) onError(err)
    if (added.length) setAttachments(prev => [...prev, ...added])
  }, [onError])

  const postMessage = useCallback(async (content: string) => {
    await postSessionMessageApi({
      session: activeSession, isCodingTask, content,
      provider: effectiveProvider, model: selectedModel, reasoning: settings.reasoning,
    })
    await loadSessions()
  }, [effectiveProvider, selectedModel, settings.reasoning, activeSession, isCodingTask, loadSessions])

  const askAgent = useCallback(async (text: string, onAfterSend?: (sessionId: string) => void) => {
    try {
      await postMessage(text)
      onAfterSend?.(activeSession.id)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not send the message to the agent.")
      throw err
    }
  }, [postMessage, activeSession.id, onError])

  const sendMessage = useCallback(async (text: string, onAfterSend?: (sessionId: string) => void) => {
    const attachmentBlock = attachments.length
      ? `\n\n${attachments.map(a => `--- Attached file: ${a.name} ---\n\`\`\`\n${a.content}\n\`\`\``).join("\n\n")}`
      : ""
    setDraft("")
    setAttachments([])
    setSending(true)
    try {
      await postMessage(`${text}${attachmentBlock}`.slice(0, 8000))
      onAfterSend?.(activeSession.id)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not send message.")
    } finally {
      setSending(false)
    }
  }, [attachments, postMessage, activeSession.id, onError])

  const steerSession = useCallback(async (text: string, mode: "steer" | "follow-up") => {
    setDraft("")
    try { await steerSessionApi(activeSession.id, text, mode) }
    catch (err) { onError(err instanceof Error ? err.message : "Could not steer session.") }
  }, [activeSession.id, onError])

  const abortSession = useCallback(async (targetSessionId?: string) => {
    try { await abortSessionApi(targetSessionId ?? activeSession.id); await loadSessions() }
    catch (err) { onError(err instanceof Error ? err.message : "Could not stop session.") }
  }, [activeSession.id, loadSessions, onError])

  const compactSession = useCallback(async () => {
    try { await compactSessionApi(activeSession.id) }
    catch (err) { onError(err instanceof Error ? err.message : "Could not compact session.") }
  }, [activeSession.id, onError])

  const startNewSession = useCallback(async (input: StartNewSessionInput) => {
    setCreatingSession(true)
    setLaunchError("")
    try {
      const outcome = await startSessionOrAttemptsApi({
        input, environmentId: activeEnvironmentId, modelReady,
        provider: effectiveProvider, model: selectedModel, reasoning: settings.reasoning,
        onAsyncMessageError: onError,
      })
      await loadSessions()
      if (outcome.kind === "attempts") {
        if (outcome.failedCount) onError(`${outcome.failedCount} of ${outcome.totalCount} attempts could not start.`)
        if (input.projectId) onExpandProject(input.projectId)
        onOpenAttempts?.(outcome.attemptGroup)
        return
      }
      if (outcome.waitingForModel) {
        setDraft(input.prompt)
        onError(`${modelSetupMessage} Your message is waiting in the composer.`)
      }
      onOpenSession(outcome.id)
      if (input.projectId) onExpandProject(input.projectId)
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Could not create session.")
    } finally {
      setCreatingSession(false)
    }
  }, [activeEnvironmentId, modelReady, effectiveProvider, selectedModel, settings.reasoning, loadSessions, modelSetupMessage, onError, onOpenSession, onExpandProject, onOpenAttempts])

  const quickStartStream = useCallback(async (project: Project, prompt: string) => {
    const { sessionId, sentInitialMessage } = await quickStartProjectStreamApi({
      project, prompt, defaultWorkspaceKind: settings.defaultWorkspaceKind, environmentId: activeEnvironmentId,
      modelReady, provider: effectiveProvider, model: selectedModel, reasoning: settings.reasoning,
    })
    await loadSessions()
    if (!sentInitialMessage) onError(`${modelSetupMessage} The session was created without sending your message.`)
    if (sessionId) { onExpandProject(project.id); onOpenSession(sessionId) }
  }, [activeEnvironmentId, modelReady, effectiveProvider, selectedModel, settings.reasoning, settings.defaultWorkspaceKind, loadSessions, modelSetupMessage, onError, onExpandProject, onOpenSession])

  const createChatThread = useCallback(async (mode: "coding" | "personal") => {
    try { const created = await createChatThreadApi(mode); await loadSessions(); onOpenSession(created.id) }
    catch (err) { onError(err instanceof Error ? err.message : "Could not create chat.") }
  }, [loadSessions, onOpenSession, onError])

  const renameSession = useCallback(async (session: Conversation, nextTitle: string) => {
    const trimmed = nextTitle.trim()
    if (!trimmed || trimmed === session.label) return
    try { await renameSessionApi(session, trimmed); await loadSessions() }
    catch (err) { onError(err instanceof Error ? err.message : "Could not rename session.") }
  }, [loadSessions, onError])

  const forkSession = useCallback(async (sess: Conversation) => {
    try { const nextId = await forkSessionApi(sess.id); await loadSessions(); if (nextId) onOpenSession(nextId) }
    catch (err) { onError(err instanceof Error ? err.message : "Could not fork chat.") }
  }, [loadSessions, onOpenSession, onError])

  const moveSession = useCallback(async (sess: Conversation, opts: { mode?: "coding" | "personal"; projectId?: string | null }) => {
    try { await moveSessionApi(sess.id, opts); await loadSessions(); if (opts.projectId) onExpandProject(opts.projectId) }
    catch (err) { onError(err instanceof Error ? err.message : "Could not move chat.") }
  }, [loadSessions, onExpandProject, onError])

  const deleteSession = useCallback(async (sess: Conversation) => {
    try { await deleteSessionApi(sess); await loadSessions(); if (activeSessionId === sess.id) onSessionArchived(sess.id) }
    catch (err) { onError(err instanceof Error ? err.message : "Could not delete session.") }
  }, [activeSessionId, loadSessions, onSessionArchived, onError])

  const sendQuickStreamMessage = useCallback(async (sess: Conversation, text: string) => {
    await postSessionMessageApi({
      session: sess, isCodingTask: sess.id !== "coding" && sess.id !== "personal", content: text,
      provider: effectiveProvider, model: selectedModel, reasoning: settings.reasoning, truncate: false,
    })
    await loadSessions()
  }, [effectiveProvider, selectedModel, settings.reasoning, loadSessions])

  const openExternalApp = useCallback(async (app: "cursor" | "vscode" | "windsurf" | "finder", path?: string | null) => {
    try { await openExternalAppApi(app, path) }
    catch (err) { onError(err instanceof Error ? err.message : `Could not open in ${app}.`) }
  }, [onError])

  return {
    sessions, activeSession, isCodingTask, hasWorkspace, creatingSession, launchError, sending,
    draft, setDraft, attachments, setAttachments, ...prefs, loadSessions, toggleArchive,
    attachFiles, sendMessage, askAgent, steerSession, abortSession, compactSession,
    startNewSession, quickStartStream, createChatThread, renameSession, forkSession,
    moveSession, deleteSession, sendQuickStreamMessage, openExternalApp,
  }
}
