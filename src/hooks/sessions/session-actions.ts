import { harnessEntry, harnessLabel, type SessionEngineId } from "@ade/protocol"
import { request } from "../../api"
import type { Conversation, GitHubIssue, StartFrom, TaskStart } from "../../app-types"
import { clearPendingStart, pendingStarts, storePendingStart } from "../../pending-task-starts"
import type { Project } from "../../ProjectsView"
import { terminalPromptStorageKey } from "../../terminal-mode"

export type SessionAttachment = { id: string; name: string; content: string }
export type { SessionEngineId }

export type StartNewSessionInput = {
  projectId: string | null
  kind: TaskStart["kind"]
  repository: string
  prompt: string
  githubIssue?: GitHubIssue
  engine?: SessionEngineId
  interactionMode?: "chat" | "terminal"
  startFrom?: StartFrom
  /** Session name when there is no prompt to name it after (e.g. "PR #12: Fix login"). */
  title?: string
  /** Best of N: one agent per attempt; each gets its own worktree and the same task. */
  attempts?: SessionEngineId[]
  runOn?: "local" | "docker" | "wsl" | "ssh" | "boat"
  blueprintId?: string
}

const JSON_HEADERS = { "content-type": "application/json" }

export async function fetchSessionsApi(signal?: AbortSignal): Promise<Conversation[]> {
  const data = await request<{ sessions: Conversation[] }>("/api/sessions", { signal })
  return data.sessions ?? []
}

export function replayPendingStartsApi(environmentId: string, onReplayed: () => void) {
  const pending = Object.values(pendingStarts()).filter(s => (s.environmentId ?? "local") === environmentId)
  for (const start of pending) {
    void request<{ session: Conversation }>("/api/coding-tasks", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(start),
    }).then(() => {
      clearPendingStart(start.id)
      onReplayed()
    }).catch(() => {
      // Leave for manual retry if runtime offline.
    })
  }
}

export async function archiveEntityApi(params: {
  isProject: boolean
  targetId: string
  archived: boolean
  removeWorktree: boolean
}): Promise<{ worktreeWarning: string | null }> {
  const { isProject, targetId, archived, removeWorktree } = params
  const result = await request<{ worktreeError?: string; sessions?: { worktreeError?: string }[] }>(
    isProject ? `/api/projects/${encodeURIComponent(targetId)}/archive` : `/api/sessions/${encodeURIComponent(targetId)}/archive`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(
        isProject
          ? { archived, removeWorktrees: removeWorktree }
          : { archived, removeWorktree },
      ),
    },
  )
  const kept = [result.worktreeError, ...(result.sessions ?? []).map(s => s.worktreeError)].filter(Boolean)
  return { worktreeWarning: kept[0] ?? null }
}

export async function readAttachedFiles(fileList: FileList | null): Promise<{
  added: SessionAttachment[]
  errors: string[]
}> {
  if (!fileList) return { added: [], errors: [] }
  const added: SessionAttachment[] = []
  const errors: string[] = []
  for (const file of Array.from(fileList).slice(0, 6)) {
    if (file.size > 64_000) continue
    try {
      const text = await file.text()
      added.push({ id: crypto.randomUUID(), name: file.name, content: text })
    } catch (err) {
      console.warn("[ADE] Skipped unreadable attached file:", file.name, err instanceof Error ? err.message : String(err))
      errors.push(`Could not read attached file "${file.name}".`)
    }
  }
  return { added, errors }
}

export async function postSessionMessageApi(params: {
  session: Conversation
  isCodingTask: boolean
  content: string
  provider: string
  model: string
  reasoning: string
  truncate?: boolean
}) {
  const { session, isCodingTask, content, provider, model, reasoning, truncate = true } = params
  const endpoint = session.chatThread
    ? `/api/chat-threads/${encodeURIComponent(session.id)}/messages`
    : isCodingTask
      ? `/api/coding-tasks/${encodeURIComponent(session.id)}/messages`
      : `/api/sessions/${session.mode}/messages`
  await request<{ session: Conversation }>(endpoint, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      content: truncate ? content.slice(0, 8000) : content,
      provider,
      model,
      reasoning,
      async: true,
    }),
  })
}

export async function createCodingTaskApi(params: {
  input: StartNewSessionInput
  engine: SessionEngineId | undefined
  title: string
  attemptGroup?: string
  environmentId: string
  modelReady: boolean
  provider: string
  model: string
  reasoning: string
  onAsyncMessageError: (message: string) => void
}) {
  const { input, engine, title, attemptGroup, environmentId, modelReady, provider, model, reasoning, onAsyncMessageError } = params
  const external = Boolean(engine && engine !== "pi" && input.kind !== "none")
  const terminalOnly = Boolean(engine && engine !== "pi" && !harnessEntry(engine).modes.includes("chat"))
  const interactionMode: "chat" | "terminal" = external && (input.interactionMode === "terminal" || terminalOnly) ? "terminal" : "chat"
  const taskId = crypto.randomUUID()
  const start: TaskStart = {
    id: taskId,
    title,
    repository: input.repository,
    kind: input.kind,
    environmentId,
    projectId: input.projectId,
    githubIssue: input.githubIssue,
    ...(input.startFrom ? { startFrom: input.startFrom } : {}),
    ...(attemptGroup ? { attemptGroup } : {}),
    ...(input.runOn ? { runOn: input.runOn } : {}),
    ...(input.blueprintId ? { blueprintId: input.blueprintId } : {}),
    ...(!external && modelReady && input.prompt.trim()
      ? {
          initialMessage: {
            id: crypto.randomUUID(),
            content: input.prompt,
            provider,
            model,
            reasoning,
          },
        }
      : {}),
  }
  storePendingStart(start)
  try {
    const res = await request<{ session: Conversation }>("/api/coding-tasks", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(start),
    })
    clearPendingStart(taskId)
    if (external) {
      await request(`/api/sessions/${encodeURIComponent(taskId)}/engine`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ engine, interactionMode }),
      })
      if (interactionMode === "terminal") {
        if (input.prompt.trim() && typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(terminalPromptStorageKey(res.session.id), input.prompt.trim())
        }
      } else if (input.prompt.trim()) {
        // Don't wait for the agent's turn; several attempts run at the same time.
        void request(`/api/coding-tasks/${encodeURIComponent(taskId)}/messages`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ content: input.prompt }),
        }).catch(err => onAsyncMessageError(err instanceof Error ? err.message : "Could not send the task to the agent."))
      }
    }
    return { id: res.session.id, waitingForModel: !external && !start.initialMessage && Boolean(input.prompt.trim()) }
  } catch (err) {
    clearPendingStart(taskId)
    throw err
  }
}

export async function startSessionOrAttemptsApi(params: {
  input: StartNewSessionInput
  environmentId: string
  modelReady: boolean
  provider: string
  model: string
  reasoning: string
  onAsyncMessageError: (message: string) => void
}): Promise<
  | { kind: "attempts"; attemptGroup: string; failedCount: number; totalCount: number }
  | { kind: "single"; id: string; waitingForModel: boolean }
> {
  const { input, environmentId, modelReady, provider, model, reasoning, onAsyncMessageError } = params
  const fallbackTitle = input.interactionMode === "terminal" && input.engine && input.engine !== "pi"
    ? `${harnessLabel(input.engine)} terminal`
    : "New session"
  const baseTitle = (input.title || input.prompt).replace(/\s+/g, " ").trim().slice(0, 72) || fallbackTitle
  const attempts = input.attempts && input.attempts.length > 1 && input.kind === "worktree" && !input.startFrom && input.interactionMode !== "terminal"
    ? input.attempts.slice(0, 4)
    : null
  const attemptGroup = attempts ? crypto.randomUUID() : undefined

  const createOne = (engine: SessionEngineId | undefined, title: string) =>
    createCodingTaskApi({
      input, engine, title, attemptGroup, environmentId, modelReady, provider, model, reasoning, onAsyncMessageError,
    })

  if (attempts && attemptGroup) {
    const letters = "ABCD"
    const results: PromiseSettledResult<{ id: string; waitingForModel: boolean }>[] = []
    for (const [index, engine] of attempts.entries()) {
      results.push(await createOne(engine, `${baseTitle} · ${letters[index]}`).then(
        value => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      ))
    }
    const failed = results.filter(result => result.status === "rejected")
    if (failed.length === results.length) throw (failed[0] as PromiseRejectedResult).reason
    return { kind: "attempts", attemptGroup, failedCount: failed.length, totalCount: results.length }
  }
  const created = await createOne(input.engine, baseTitle)
  return { kind: "single", ...created }
}

export async function quickStartProjectStreamApi(params: {
  project: Project
  prompt: string
  defaultWorkspaceKind: "worktree" | "checkout" | "none"
  environmentId: string
  modelReady: boolean
  provider: string
  model: string
  reasoning: string
}) {
  const { project, prompt, defaultWorkspaceKind, environmentId, modelReady, provider, model, reasoning } = params
  const taskId = crypto.randomUUID()
  const start: TaskStart = {
    id: taskId,
    title: prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "New session",
    repository: project.repository && defaultWorkspaceKind !== "none" ? project.repository : "",
    kind: project.repository ? defaultWorkspaceKind : "none",
    environmentId,
    projectId: project.id,
    ...(modelReady
      ? {
          initialMessage: {
            id: crypto.randomUUID(),
            content: prompt,
            provider,
            model,
            reasoning,
          },
        }
      : {}),
  }
  const res = await request<{ session: Conversation }>("/api/coding-tasks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(start),
  })
  return { sessionId: res?.session?.id ?? null, sentInitialMessage: Boolean(start.initialMessage) }
}

export async function steerSessionApi(sessionId: string, content: string, mode: "steer" | "follow-up") {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}/steer`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ content, mode }),
  })
}

export async function abortSessionApi(sessionId: string) {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: "{}",
  })
}

export async function compactSessionApi(sessionId: string) {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}/compact`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: "{}",
  })
}

export async function createChatThreadApi(mode: "coding" | "personal"): Promise<Conversation> {
  const res = await request<{ session: Conversation }>("/api/chat-threads", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ id: crypto.randomUUID(), mode }),
  })
  return res.session
}

export async function renameSessionApi(session: Conversation, title: string) {
  const endpoint = session.chatThread
    ? `/api/chat-threads/${encodeURIComponent(session.id)}`
    : `/api/coding-tasks/${encodeURIComponent(session.id)}`
  await request(endpoint, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ title }),
  })
}

export async function forkSessionApi(sessionId: string): Promise<string | null> {
  const res = await request<{ session: Conversation }>(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: "{}",
  })
  return res?.session?.id ?? null
}

export async function moveSessionApi(sessionId: string, opts: { mode?: "coding" | "personal"; projectId?: string | null }) {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}/move`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(opts),
  })
}

export async function deleteSessionApi(session: Conversation) {
  const endpoint = session.chatThread
    ? `/api/chat-threads/${encodeURIComponent(session.id)}`
    : `/api/coding-tasks/${encodeURIComponent(session.id)}`
  await request(endpoint, { method: "DELETE" })
}

export async function openExternalAppApi(app: "cursor" | "vscode" | "windsurf" | "finder", path?: string | null) {
  await request("/api/system/open-in", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ app, path: path || undefined }),
  })
}
