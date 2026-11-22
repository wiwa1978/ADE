import { useCallback, useEffect, useRef, useState } from "react"
import { request } from "../../api"
import { useEventStream } from "./useEventStream"
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
} from "../../app-types"

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

function reportStreamWarning(scope: string, error: unknown) {
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

  const refreshTimeline = useCallback(async (targetId: string) => {
    try {
      const snap = await request<ConversationTimelineSnapshot>(`/api/sessions/${encodeURIComponent(targetId)}/timeline`)
      if (sessionIdRef.current === targetId) setTimeline(snap)
    } catch (error) {
      reportStreamWarning("refreshTimeline", error)
    }
  }, [])

  const refreshSubagents = useCallback(async (targetId: string) => {
    try {
      const data = await request<{ agents: SubagentInfo[] }>(`/api/coding-tasks/${encodeURIComponent(targetId)}/agents`)
      if (sessionIdRef.current === targetId) setSubagents(data.agents ?? [])
    } catch (error) {
      reportStreamWarning("refreshSubagents", error)
    }
  }, [])

  const refreshApprovals = useCallback(async (targetId: string | null) => {
    try {
      const qs = targetId ? `?sessionId=${encodeURIComponent(targetId)}` : ""
      const data = await request<{ pending: PendingApproval[]; policy: ApprovalPolicy; rules: ApprovalRule[] }>(`/api/approvals${qs}`)
      setApprovals(data.pending ?? [])
      if (data.policy) setApprovalPolicyState(data.policy)
      setApprovalRules(data.rules ?? [])
    } catch (error) {
      reportStreamWarning("refreshApprovals", error)
    }
  }, [])

  const refreshProcesses = useCallback(async (targetId: string | null) => {
    try {
      const qs = targetId ? `?sessionId=${encodeURIComponent(targetId)}` : ""
      const data = await request<{ processes: ManagedProcessSummary[] }>(`/api/processes${qs}`)
      setProcesses(data.processes ?? [])
    } catch (error) {
      reportStreamWarning("refreshProcesses", error)
    }
  }, [])

  const refreshGit = useCallback(async (targetId: string) => {
    try {
      const data = await request<WorkspaceGitSummary>(`/api/workspace/git?sessionId=${encodeURIComponent(targetId)}`)
      if (sessionIdRef.current === targetId) setGitSummary(data)
    } catch (error) {
      reportStreamWarning("refreshGit", error)
      if (sessionIdRef.current === targetId) setGitSummary(EMPTY_GIT)
    }
  }, [])

  const refreshArtifactsAndTasks = useCallback(async (targetId: string) => {
    try {
      const [artRes, taskRes] = await Promise.all([
        request<{ artifacts: SessionArtifact[] }>(`/api/sessions/${encodeURIComponent(targetId)}/artifacts`),
        request<{ tasks: SessionTaskItem[] }>(`/api/sessions/${encodeURIComponent(targetId)}/tasks`),
      ])
      if (sessionIdRef.current === targetId) {
        setArtifacts(artRes.artifacts ?? [])
        setTasks(taskRes.tasks ?? [])
      }
    } catch (error) {
      reportStreamWarning("refreshArtifactsAndTasks", error)
    }
  }, [])

  const refreshMcp = useCallback(async () => {
    try {
      const data = await request<{ servers: McpServerStatus[] }>("/api/mcp")
      setMcpServers(data.servers ?? [])
    } catch (error) {
      reportStreamWarning("refreshMcp", error)
    }
  }, [])

  // Initial load on session / environment switch
  useEffect(() => {
    let cancelled = false
    const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""
    void request<{ pending: PendingApproval[]; policy: ApprovalPolicy; rules: ApprovalRule[] }>(`/api/approvals${qs}`)
      .then(data => {
        if (cancelled) return
        setApprovals(data.pending ?? [])
        if (data.policy) setApprovalPolicyState(data.policy)
        setApprovalRules(data.rules ?? [])
      })
      .catch(error => reportStreamWarning("refreshApprovals", error))
    void request<{ processes: ManagedProcessSummary[] }>(`/api/processes${qs}`)
      .then(data => { if (!cancelled) setProcesses(data.processes ?? []) })
      .catch(error => reportStreamWarning("refreshProcesses", error))
    void request<SkillsAndRulesCatalog>(`/api/skills${qs}`)
      .then(data => { if (!cancelled) setSkillsCatalog(data) })
      .catch(error => reportStreamWarning("refreshSkills", error))
    void request<BrowserState>("/api/browser/status")
      .then(data => { if (!cancelled) setBrowserState(data) })
      .catch(error => reportStreamWarning("refreshBrowser", error))
    void request<{ servers: McpServerStatus[] }>("/api/mcp")
      .then(data => { if (!cancelled) setMcpServers(data.servers ?? []) })
      .catch(error => reportStreamWarning("refreshMcp", error))
    if (!sessionId) return () => { cancelled = true }
    void request<ConversationTimelineSnapshot>(`/api/sessions/${encodeURIComponent(sessionId)}/timeline`)
      .then(snap => { if (!cancelled) setTimeline(snap) })
      .catch(error => reportStreamWarning("refreshTimeline", error))
    void Promise.all([
      request<{ artifacts: SessionArtifact[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`),
      request<{ tasks: SessionTaskItem[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/tasks`),
    ])
      .then(([artRes, taskRes]) => {
        if (cancelled) return
        setArtifacts(artRes.artifacts ?? [])
        setTasks(taskRes.tasks ?? [])
      })
      .catch(error => reportStreamWarning("refreshArtifactsAndTasks", error))
    if (isCodingTask) {
      void request<{ agents: SubagentInfo[] }>(`/api/coding-tasks/${encodeURIComponent(sessionId)}/agents`)
        .then(data => { if (!cancelled) setSubagents(data.agents ?? []) })
        .catch(error => reportStreamWarning("refreshSubagents", error))
    }
    if (hasWorkspace) {
      void request<WorkspaceGitSummary>(`/api/workspace/git?sessionId=${encodeURIComponent(sessionId)}`)
        .then(data => { if (!cancelled) setGitSummary(data) })
        .catch(error => {
          reportStreamWarning("refreshGit", error)
          if (!cancelled) setGitSummary(EMPTY_GIT)
        })
    }
    return () => { cancelled = true }
  }, [sessionId, hasWorkspace, isCodingTask, environmentVersion])

  // Subscribe to the shared EventSource stream by event type
  useEffect(() => {
    const unsubs = [
      eventStream.subscribe("sessions.changed", () => {
        callbacksRef.current.onSessionsChanged?.()
        const sid = sessionIdRef.current
        if (sid) {
          void refreshTimeline(sid)
          if (hasWorkspace) void refreshGit(sid)
        }
      }),
      eventStream.subscribe("timeline.update", (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          const snap = parsed.payload as ConversationTimelineSnapshot
          if (!snap || snap.sessionId !== sessionIdRef.current) return
          if (snap.isSubagent) {
            setSubagentTimelines(prev => ({ ...prev, [snap.conversationId]: snap }))
          } else {
            setTimeline(snap)
          }
        } catch (error) {
          reportStreamWarning("timeline.update parse", error)
        }
      }),
      eventStream.subscribe("subagents.update", (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          const sid = sessionIdRef.current
          if (sid && (!parsed.sessionId || parsed.sessionId === sid)) {
            void refreshSubagents(sid)
          }
        } catch (error) {
          reportStreamWarning("subagents.update parse", error)
        }
      }),
      eventStream.subscribe("approval.requested", (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          const item = parsed.payload as PendingApproval
          setApprovals(prev => (prev.some(p => p.id === item.id) ? prev : [...prev, item]))
        } catch (error) {
          reportStreamWarning("approval.requested parse", error)
        }
      }),
      eventStream.subscribe("approval.resolved", (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          const item = parsed.payload as PendingApproval
          setApprovals(prev => prev.filter(p => p.id !== item.id))
          void refreshApprovals(sessionIdRef.current)
        } catch (error) {
          reportStreamWarning("approval.resolved parse", error)
        }
      }),
      eventStream.subscribe("processes.update", (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          if (!parsed.sessionId || parsed.sessionId === sessionIdRef.current) {
            setProcesses(parsed.payload?.processes ?? [])
          }
        } catch (error) {
          reportStreamWarning("processes.update parse", error)
        }
      }),
      eventStream.subscribe("artifacts.update", (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          if (parsed.sessionId === sessionIdRef.current) {
            setArtifacts(parsed.payload?.artifacts ?? [])
            if (parsed.payload?.activeArtifactId) {
              callbacksRef.current.onArtifactUpdated?.(parsed.payload.activeArtifactId)
            }
          }
        } catch (error) {
          reportStreamWarning("artifacts.update parse", error)
        }
      }),
      eventStream.subscribe("tasks.update", (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          if (parsed.sessionId === sessionIdRef.current) {
            setTasks(parsed.payload?.tasks ?? [])
          }
        } catch (error) {
          reportStreamWarning("tasks.update parse", error)
        }
      }),
      eventStream.subscribe("browser.update", (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          const next = parsed.payload as BrowserState
          setBrowserState(next)
          if (next.agentDriving) callbacksRef.current.onAgentBrowserDriving?.()
        } catch (error) {
          reportStreamWarning("browser.update parse", error)
        }
      }),
      eventStream.subscribe("browser.frame", (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          if (parsed.payload?.frame) {
            setBrowserState(prev => ({ ...prev, lastFrame: parsed.payload.frame }))
          }
        } catch (error) {
          reportStreamWarning("browser.frame parse", error)
        }
      }),
      eventStream.subscribe("mcp.update", (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          setMcpServers(parsed.payload?.servers ?? [])
        } catch (error) {
          reportStreamWarning("mcp.update parse", error)
        }
      }),
    ]
    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [eventStream, hasWorkspace, refreshApprovals, refreshGit, refreshSubagents, refreshTimeline])

  // Periodic light git refresh when workspace is open
  useEffect(() => {
    if (!sessionId || !hasWorkspace) return
    const timer = setInterval(() => {
      void refreshGit(sessionId)
    }, 8000)
    return () => clearInterval(timer)
  }, [sessionId, hasWorkspace, refreshGit])

  const resolveApproval = useCallback(async (id: string, decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => {
    await request(`/api/approvals/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decision),
    })
    setApprovals(prev => prev.filter(a => a.id !== id))
    await refreshApprovals(sessionIdRef.current)
  }, [refreshApprovals])

  const setApprovalPolicy = useCallback(async (policy: ApprovalPolicy, targetSessionId?: string) => {
    const res = await request<{ policy: ApprovalPolicy }>("/api/approvals/policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy, sessionId: targetSessionId }),
    })
    setApprovalPolicyState(res.policy)
  }, [])

  const deleteApprovalRule = useCallback(async (id: string) => {
    const res = await request<{ rules: ApprovalRule[] }>(`/api/approvals/rules/${encodeURIComponent(id)}`, { method: "DELETE" })
    setApprovalRules(res.rules ?? [])
  }, [])

  const killProcess = useCallback(async (id: string) => {
    await request(`/api/processes/${encodeURIComponent(id)}/kill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    await refreshProcesses(sessionIdRef.current)
  }, [refreshProcesses])

  const messageSubagent = useCallback(async (subagentId: string, message: string, mode: "steer" | "follow-up" = "follow-up") => {
    if (!sessionIdRef.current) return
    await request(`/api/sessions/${encodeURIComponent(sessionIdRef.current)}/subagents/${encodeURIComponent(subagentId)}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, mode }),
    })
    await refreshSubagents(sessionIdRef.current)
  }, [refreshSubagents])

  const stopSubagent = useCallback(async (subagentId: string) => {
    if (!sessionIdRef.current) return
    await request(`/api/sessions/${encodeURIComponent(sessionIdRef.current)}/subagents/${encodeURIComponent(subagentId)}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    await refreshSubagents(sessionIdRef.current)
  }, [refreshSubagents])

  const openExternalBrowser = useCallback(async (url: string) => {
    try {
      await request("/api/browser/open-external", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      })
    } catch {
      window.open(url, "_blank", "noopener,noreferrer")
    }
  }, [])

  const reviewArtifact = useCallback(async (id: string, decision: "approved" | "changes_requested", feedback?: string) => {
    const res = await request<{ artifact: SessionArtifact }>(`/api/artifacts/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, feedback }),
    })
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
    killProcess,
    messageSubagent,
    stopSubagent,
    openExternalBrowser,
    reviewArtifact,
  }
}
