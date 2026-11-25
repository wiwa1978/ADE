import { useCallback, useEffect, useRef, useState } from "react"
import { z } from "zod"
import { request, requestJson } from "../api"
import { useEventStream } from "./useEventStream"
import { usePolling } from "./usePolling"
import type {
  ApprovalPolicy,
  ApprovalRule,
  BrowserState,
  ConversationTimelineSnapshot,
  ManagedProcessSummary,
  McpServerStatus,
  PendingApproval,
  SessionArtifact,
  SessionTaskItem,
  SkillsAndRulesCatalog,
  SubagentInfo,
  WorkspaceGitSummary,
} from "../app-types"

const EMPTY_GIT: WorkspaceGitSummary = {
  isGitRepo: false,
  branch: null,
  ahead: 0,
  behind: 0,
  additions: 0,
  deletions: 0,
  files: [],
}

const EMPTY_BROWSER: BrowserState = {
  available: false,
  chromePath: null,
  running: false,
  url: "about:blank",
  title: "New Tab",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  agentDriving: false,
  viewport: { width: 1280, height: 800, preset: "desktop" },
  lastFrame: null,
  error: null,
}

const EMPTY_SKILLS: SkillsAndRulesCatalog = {
  skills: [],
  rules: [],
  commands: [],
}

const TimelineToolCallSchema = z.object({
  callId: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "running", "sleeping", "waiting", "done", "error"]),
  output: z.string(),
  isError: z.boolean(),
  details: z.unknown().optional(),
})

const TimelineItemSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("user"), content: z.string(), createdAt: z.number() }),
  z.object({
    id: z.string(),
    kind: z.literal("assistant"),
    thinking: z.string(),
    text: z.string(),
    toolCalls: z.array(TimelineToolCallSchema),
    streaming: z.boolean().optional(),
    createdAt: z.number(),
  }),
  z.object({ id: z.string(), kind: z.literal("compaction"), summary: z.string(), createdAt: z.number() }),
  z.object({ id: z.string(), kind: z.literal("error"), message: z.string(), createdAt: z.number() }),
])

const TimelineSnapshotPayloadSchema = z.object({
  sessionId: z.string(),
  conversationId: z.string(),
  busy: z.boolean(),
  items: z.array(TimelineItemSchema),
  liveTools: z.array(TimelineToolCallSchema),
  runFailure: z.object({ reason: z.string(), detail: z.string().optional() }).nullable().optional(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), totalCost: z.number().optional() }).nullable().optional(),
  isSubagent: z.boolean().optional(),
})

const BrowserStatePayloadSchema = z.object({
  available: z.boolean(),
  chromePath: z.string().nullable(),
  running: z.boolean(),
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  agentDriving: z.boolean(),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
    preset: z.enum(["desktop", "tablet", "mobile"]),
  }),
  lastFrame: z.string().nullable(),
  error: z.string().nullable(),
})

const McpServerStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.enum(["stdio", "http"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean(),
  status: z.enum(["disconnected", "connecting", "connected", "error"]),
  error: z.string().nullable(),
  tools: z.array(z.object({ name: z.string(), description: z.string() })),
})

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return error instanceof DOMException && error.name === "AbortError"
}

function reportStreamWarning(scope: string, error: unknown, signal?: AbortSignal) {
  if (isAbortError(error, signal)) return
  console.warn(`[ADE runtime stream] ${scope}:`, error instanceof Error ? error.message : String(error))
}

export function useRuntimeStream(opts: {
  sessionId: string | null
  hasWorkspace: boolean
  isCodingTask: boolean
  environmentVersion: number
  onSessionsChanged?: () => void
  onAgentBrowserDriving?: () => void
  onArtifactUpdated?: (artifactId: string) => void
}) {
  const { sessionId, hasWorkspace, isCodingTask, environmentVersion, onSessionsChanged, onAgentBrowserDriving, onArtifactUpdated } = opts
  const [timeline, setTimeline] = useState<ConversationTimelineSnapshot | null>(null)
  const [subagentTimelines, setSubagentTimelines] = useState<Record<string, ConversationTimelineSnapshot>>({})
  const [subagents, setSubagents] = useState<SubagentInfo[]>([])
  const [approvals, setApprovals] = useState<PendingApproval[]>([])
  const [approvalPolicy, setApprovalPolicyState] = useState<ApprovalPolicy>("auto-safe")
  const [approvalRules, setApprovalRules] = useState<ApprovalRule[]>([])
  const [processes, setProcesses] = useState<ManagedProcessSummary[]>([])
  const [gitSummary, setGitSummary] = useState<WorkspaceGitSummary>(EMPTY_GIT)
  const [artifacts, setArtifacts] = useState<SessionArtifact[]>([])
  const [tasks, setTasks] = useState<SessionTaskItem[]>([])
  const [skillsCatalog, setSkillsCatalog] = useState<SkillsAndRulesCatalog>(EMPTY_SKILLS)
  const [browserState, setBrowserState] = useState<BrowserState>(EMPTY_BROWSER)
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([])
  const eventStream = useEventStream()
  const sseConnected = eventStream.connected
  const streamResetKey = `${sessionId ?? ""}:${environmentVersion}`
  const [prevStreamResetKey, setPrevStreamResetKey] = useState(streamResetKey)

  if (streamResetKey !== prevStreamResetKey) {
    setPrevStreamResetKey(streamResetKey)
    setTimeline(null)
    setSubagentTimelines({})
    setSubagents([])
    setArtifacts([])
    setTasks([])
    setGitSummary(EMPTY_GIT)
  }

  const callbacksRef = useRef({ onSessionsChanged, onAgentBrowserDriving, onArtifactUpdated })
  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    callbacksRef.current = { onSessionsChanged, onAgentBrowserDriving, onArtifactUpdated }
    sessionIdRef.current = sessionId
  })

  const refreshTimeline = useCallback(async (targetId: string, signal?: AbortSignal) => {
    try {
      const snap = await request<ConversationTimelineSnapshot>(`/api/sessions/${encodeURIComponent(targetId)}/timeline`, { signal })
      if (!signal?.aborted && sessionIdRef.current === targetId) setTimeline(snap)
    } catch (error) {
      reportStreamWarning("refreshTimeline", error, signal)
    }
  }, [])

  const refreshSubagents = useCallback(async (targetId: string, signal?: AbortSignal) => {
    try {
      const data = await request<{ agents: SubagentInfo[] }>(`/api/coding-tasks/${encodeURIComponent(targetId)}/agents`, { signal })
      if (!signal?.aborted && sessionIdRef.current === targetId) setSubagents(data.agents ?? [])
    } catch (error) {
      reportStreamWarning("refreshSubagents", error, signal)
    }
  }, [])

  const refreshApprovals = useCallback(async (targetId: string | null, signal?: AbortSignal) => {
    try {
      const qs = targetId ? `?sessionId=${encodeURIComponent(targetId)}` : ""
      const data = await request<{ pending: PendingApproval[]; policy: ApprovalPolicy; rules: ApprovalRule[] }>(`/api/approvals${qs}`, { signal })
      if (signal?.aborted) return
      setApprovals(data.pending ?? [])
      if (data.policy) setApprovalPolicyState(data.policy)
      setApprovalRules(data.rules ?? [])
    } catch (error) {
      reportStreamWarning("refreshApprovals", error, signal)
    }
  }, [])

  const refreshProcesses = useCallback(async (targetId: string | null, signal?: AbortSignal) => {
    try {
      const qs = targetId ? `?sessionId=${encodeURIComponent(targetId)}` : ""
      const data = await request<{ processes: ManagedProcessSummary[] }>(`/api/processes${qs}`, { signal })
      if (!signal?.aborted) setProcesses(data.processes ?? [])
    } catch (error) {
      reportStreamWarning("refreshProcesses", error, signal)
    }
  }, [])

  const refreshGit = useCallback(async (targetId: string, signal?: AbortSignal) => {
    try {
      const data = await request<WorkspaceGitSummary>(`/api/workspace/git?sessionId=${encodeURIComponent(targetId)}`, { signal })
      if (!signal?.aborted && sessionIdRef.current === targetId) setGitSummary(data)
    } catch (error) {
      if (isAbortError(error, signal)) return
      reportStreamWarning("refreshGit", error, signal)
      if (sessionIdRef.current === targetId) setGitSummary(EMPTY_GIT)
    }
  }, [])

  const refreshArtifactsAndTasks = useCallback(async (targetId: string, signal?: AbortSignal) => {
    try {
      const [artRes, taskRes] = await Promise.all([
        request<{ artifacts: SessionArtifact[] }>(`/api/sessions/${encodeURIComponent(targetId)}/artifacts`, { signal }),
        request<{ tasks: SessionTaskItem[] }>(`/api/sessions/${encodeURIComponent(targetId)}/tasks`, { signal }),
      ])
      if (!signal?.aborted && sessionIdRef.current === targetId) {
        setArtifacts(artRes.artifacts ?? [])
        setTasks(taskRes.tasks ?? [])
      }
    } catch (error) {
      reportStreamWarning("refreshArtifactsAndTasks", error, signal)
    }
  }, [])

  const refreshMcp = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await request<{ servers: McpServerStatus[] }>("/api/mcp", { signal })
      if (!signal?.aborted) setMcpServers(data.servers ?? [])
    } catch (error) {
      reportStreamWarning("refreshMcp", error, signal)
    }
  }, [])

  // Load environment-wide state once per environment; live updates arrive over SSE.
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    void request<BrowserState>("/api/browser/status", { signal })
      .then(data => { if (!signal.aborted) setBrowserState(data) })
      .catch(error => reportStreamWarning("refreshBrowser", error, signal))
    void request<{ servers: McpServerStatus[] }>("/api/mcp", { signal })
      .then(data => { if (!signal.aborted) setMcpServers(data.servers ?? []) })
      .catch(error => reportStreamWarning("refreshMcp", error, signal))
    return () => controller.abort()
  }, [environmentVersion])

  // Initial load on session / environment switch (aborts stale in-flight fetches)
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""
    void request<{ pending: PendingApproval[]; policy: ApprovalPolicy; rules: ApprovalRule[] }>(`/api/approvals${qs}`, { signal })
      .then(data => {
        if (signal.aborted) return
        setApprovals(data.pending ?? [])
        if (data.policy) setApprovalPolicyState(data.policy)
        setApprovalRules(data.rules ?? [])
      })
      .catch(error => reportStreamWarning("refreshApprovals", error, signal))
    void request<{ processes: ManagedProcessSummary[] }>(`/api/processes${qs}`, { signal })
      .then(data => { if (!signal.aborted) setProcesses(data.processes ?? []) })
      .catch(error => reportStreamWarning("refreshProcesses", error, signal))
    void request<SkillsAndRulesCatalog>(`/api/skills${qs}`, { signal })
      .then(data => { if (!signal.aborted) setSkillsCatalog(data) })
      .catch(error => reportStreamWarning("refreshSkills", error, signal))
    if (!sessionId) return () => controller.abort()
    void request<ConversationTimelineSnapshot>(`/api/sessions/${encodeURIComponent(sessionId)}/timeline`, { signal })
      .then(snap => { if (!signal.aborted) setTimeline(snap) })
      .catch(error => reportStreamWarning("refreshTimeline", error, signal))
    void Promise.all([
      request<{ artifacts: SessionArtifact[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`, { signal }),
      request<{ tasks: SessionTaskItem[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/tasks`, { signal }),
    ])
      .then(([artRes, taskRes]) => {
        if (signal.aborted) return
        setArtifacts(artRes.artifacts ?? [])
        setTasks(taskRes.tasks ?? [])
      })
      .catch(error => reportStreamWarning("refreshArtifactsAndTasks", error, signal))
    if (isCodingTask) {
      void request<{ agents: SubagentInfo[] }>(`/api/coding-tasks/${encodeURIComponent(sessionId)}/agents`, { signal })
        .then(data => { if (!signal.aborted) setSubagents(data.agents ?? []) })
        .catch(error => reportStreamWarning("refreshSubagents", error, signal))
    }
    if (hasWorkspace) {
      void request<WorkspaceGitSummary>(`/api/workspace/git?sessionId=${encodeURIComponent(sessionId)}`, { signal })
        .then(data => { if (!signal.aborted) setGitSummary(data) })
        .catch(error => {
          if (isAbortError(error, signal)) return
          reportStreamWarning("refreshGit", error, signal)
          setGitSummary(EMPTY_GIT)
        })
    }
    return () => controller.abort()
  }, [sessionId, hasWorkspace, isCodingTask, environmentVersion])

  // Subscribe to the shared EventSource stream with Zod-validated payloads
  useEffect(() => {
    const unsubs = [
      eventStream.subscribeTyped("sessions.changed", () => {
        callbacksRef.current.onSessionsChanged?.()
        const sid = sessionIdRef.current
        if (sid) {
          void refreshTimeline(sid)
          if (hasWorkspace) void refreshGit(sid)
        }
      }),
      eventStream.subscribeTyped("timeline.update", (ev) => {
        const parsed = TimelineSnapshotPayloadSchema.safeParse(ev.payload)
        if (!parsed.success) {
          reportStreamWarning("timeline.update schema", new Error(parsed.error.issues[0]?.message ?? "invalid snapshot"))
          return
        }
        const snap = parsed.data
        if (snap.sessionId !== sessionIdRef.current) return
        if (snap.isSubagent) {
          setSubagentTimelines(prev => ({ ...prev, [snap.conversationId]: snap }))
        } else {
          setTimeline(snap)
        }
      }),
      eventStream.subscribeTyped("subagents.update", (ev) => {
        const sid = sessionIdRef.current
        const eventSessionId = ev.sessionId ?? ev.payload.sessionId
        if (sid && (!eventSessionId || eventSessionId === sid)) {
          void refreshSubagents(sid)
        }
      }),
      eventStream.subscribeTyped("approval.requested", (ev) => {
        const item = ev.payload
        setApprovals(prev => (prev.some(p => p.id === item.id) ? prev : [...prev, item]))
      }),
      eventStream.subscribeTyped("approval.resolved", (ev) => {
        const item = ev.payload
        setApprovals(prev => prev.filter(p => p.id !== item.id))
        void refreshApprovals(sessionIdRef.current)
      }),
      eventStream.subscribeTyped("processes.update", (ev) => {
        if ("processes" in ev.payload && (!ev.sessionId || ev.sessionId === sessionIdRef.current)) {
          setProcesses(ev.payload.processes)
        }
      }),
      eventStream.subscribeTyped("artifacts.update", (ev) => {
        const eventSessionId = ev.sessionId ?? ev.payload.sessionId
        if (eventSessionId === sessionIdRef.current) {
          setArtifacts(ev.payload.artifacts)
          if (ev.payload.activeArtifactId) {
            callbacksRef.current.onArtifactUpdated?.(ev.payload.activeArtifactId)
          }
        }
      }),
      eventStream.subscribeTyped("tasks.update", (ev) => {
        const eventSessionId = ev.sessionId ?? ev.payload.sessionId
        if (eventSessionId === sessionIdRef.current) {
          setTasks(ev.payload.tasks)
        }
      }),
      eventStream.subscribeTyped("browser.update", (ev) => {
        const parsed = BrowserStatePayloadSchema.safeParse(ev.payload)
        if (!parsed.success) {
          reportStreamWarning("browser.update schema", new Error(parsed.error.issues[0]?.message ?? "invalid browser state"))
          return
        }
        setBrowserState(parsed.data)
        if (parsed.data.agentDriving) callbacksRef.current.onAgentBrowserDriving?.()
      }),
      eventStream.subscribeTyped("browser.frame", (ev) => {
        if (ev.payload.frame) {
          setBrowserState(prev => ({ ...prev, lastFrame: ev.payload.frame }))
        }
      }),
      eventStream.subscribeTyped("mcp.update", (ev) => {
        const parsed = z.array(McpServerStatusSchema).safeParse(ev.payload.servers)
        if (!parsed.success) {
          reportStreamWarning("mcp.update schema", new Error(parsed.error.issues[0]?.message ?? "invalid mcp servers"))
          return
        }
        setMcpServers(parsed.data)
      }),
    ]
    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [eventStream, hasWorkspace, refreshApprovals, refreshGit, refreshSubagents, refreshTimeline])

  // Periodic light git refresh when workspace is open (visibility-aware)
  usePolling(
    (signal) => {
      if (sessionId) return refreshGit(sessionId, signal)
    },
    8_000,
    { enabled: Boolean(sessionId && hasWorkspace), immediate: false },
  )

  const resolveApproval = useCallback(async (id: string, decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => {
    await requestJson(`/api/approvals/${encodeURIComponent(id)}/resolve`, "POST", decision)
    setApprovals(prev => prev.filter(a => a.id !== id))
    await refreshApprovals(sessionIdRef.current)
  }, [refreshApprovals])

  const setApprovalPolicy = useCallback(async (policy: ApprovalPolicy, targetSessionId?: string) => {
    const res = await requestJson<{ policy: ApprovalPolicy }>("/api/approvals/policy", "POST", { policy, sessionId: targetSessionId })
    setApprovalPolicyState(res.policy)
  }, [])

  const deleteApprovalRule = useCallback(async (id: string) => {
    const res = await request<{ rules: ApprovalRule[] }>(`/api/approvals/rules/${encodeURIComponent(id)}`, { method: "DELETE" })
    setApprovalRules(res.rules ?? [])
  }, [])

  const addApprovalRule = useCallback(async (prefix: string, effect: "allow" | "deny") => {
    const res = await requestJson<{ rules: ApprovalRule[] }>("/api/approvals/rules", "POST", { toolName: "run_command", prefix, effect })
    setApprovalRules(res.rules ?? [])
  }, [])

  const killProcess = useCallback(async (id: string) => {
    await requestJson(`/api/processes/${encodeURIComponent(id)}/kill`, "POST")
    await refreshProcesses(sessionIdRef.current)
  }, [refreshProcesses])

  const messageSubagent = useCallback(async (subagentId: string, message: string, mode: "steer" | "follow-up" = "follow-up") => {
    if (!sessionIdRef.current) return
    await requestJson(`/api/sessions/${encodeURIComponent(sessionIdRef.current)}/subagents/${encodeURIComponent(subagentId)}/message`, "POST", { message, mode })
    await refreshSubagents(sessionIdRef.current)
  }, [refreshSubagents])

  const stopSubagent = useCallback(async (subagentId: string) => {
    if (!sessionIdRef.current) return
    await requestJson(`/api/sessions/${encodeURIComponent(sessionIdRef.current)}/subagents/${encodeURIComponent(subagentId)}/stop`, "POST")
    await refreshSubagents(sessionIdRef.current)
  }, [refreshSubagents])

  const openExternalBrowser = useCallback(async (url: string) => {
    try {
      await requestJson("/api/browser/open-external", "POST", { url })
    } catch {
      window.open(url, "_blank", "noopener,noreferrer")
    }
  }, [])

  const reviewArtifact = useCallback(async (id: string, decision: "approved" | "changes_requested", feedback?: string) => {
    const res = await requestJson<{ artifact: SessionArtifact }>(`/api/artifacts/${encodeURIComponent(id)}/review`, "POST", { decision, feedback })
    setArtifacts(prev => prev.map(a => a.id === id ? res.artifact : a))
    return res.artifact
  }, [])

  return {
    sseConnected,
    timeline,
    subagentTimelines,
    subagents,
    approvals,
    approvalPolicy,
    approvalRules,
    processes,
    gitSummary,
    artifacts,
    tasks,
    skillsCatalog,
    browserState,
    setBrowserState,
    mcpServers,
    refreshTimeline,
    refreshSubagents,
    refreshGit,
    refreshProcesses,
    refreshArtifactsAndTasks,
    refreshMcp,
    resolveApproval,
    setApprovalPolicy,
    deleteApprovalRule,
    addApprovalRule,
    killProcess,
    messageSubagent,
    stopSubagent,
    openExternalBrowser,
    reviewArtifact,
  }
}
