import type { SessionState } from "../session-state"

export type ToolCategory = "read" | "edit" | "shell" | "search" | "browser" | "subagent" | "stage" | "mcp" | "other"

export type AgentHealth = "ok" | "delegating" | "quiet" | "stalled" | "slow-tool"

export type LaneEvent = {
  t: number
  cat: ToolCategory
  failed: boolean
}

export type FailedCallSummary = {
  id: string
  toolName: string
  program: string | null
  category: ToolCategory
  exitCode: number | null
  stageId: string | null
  at: number
  durationMs: number | null
}

export type CurrentToolInfo = {
  name: string
  program: string | null
  category: ToolCategory
  startedAt: number
  slow: boolean
}

export type FleetSubagent = {
  id: string
  name: string
  role: string
  harness: string
  model: string | null
  status: string
  health: AgentHealth
  healthSince: number | null
  startedAt: number | null
  endedAt: number | null
  lastActivityAt: number | null
  currentTool: CurrentToolInfo | null
  lane: LaneEvent[]
  recentFailures: FailedCallSummary[]
}

export type FleetSession = {
  sessionId: string
  title: string
  projectId: string | null
  projectName: string | null
  engine: string
  provider: string | null
  model: string | null
  state: SessionState
  needsYou: boolean
  waitingReason: string | null
  waitingSince: number | null
  health: AgentHealth
  healthSince: number | null
  blueprint: {
    id: string
    name: string
    stageId: string
    stageName: string
    stageStatus: string
    done: number
    total: number
  } | null
  currentTool: CurrentToolInfo | null
  lastActivityAt: number | null
  startedAt: number | null
  tokens: { input: number; output: number; cost: number }
  lane: LaneEvent[]
  recentFailures: FailedCallSummary[]
  subagents: FleetSubagent[]
  foldedSubagentsCount: number
}

export type ObservatoryLiveSnapshot = {
  at: number
  windowMin: number
  scope: "all" | "active" | "needs-you"
  kpis: {
    activeAgents: number
    needsYou: number
    oldestWaitMs: number | null
    topNeedsYouTitle: string | null
    topNeedsYouReason: string | null
    toolsPerMin: number
    toolsSparkline: number[]
    stalledCount: number
    slowToolsCount: number
    failedCalls: number
    tokensToday: number
    costToday: number
  }
  sessions: FleetSession[]
}

export type TraceSpanKind = "tool" | "subagent" | "wait" | "model"

export type TraceSpan = {
  id: string
  kind: TraceSpanKind
  label: string
  stageId: string | null
  category?: ToolCategory
  program?: string | null
  model?: string | null
  status: "running" | "done" | "error" | "waiting"
  exitCode?: number | null
  startedAt: number
  endedAt: number
  durationMs: number
  live: boolean
  foldedCount?: number
}

export type TraceStageBand = {
  id: string
  name: string
  status: string
  attempt: number
  gate: string
  goldfish: boolean
  checksOk: boolean | null
  reviewerModel: string | null
  reviewerIndependent: boolean | null
  startedAt: number | null
  endedAt: number | null
}

export type TraceFoldedGap = {
  startedAt: number
  endedAt: number
  durationMs: number
}

export type ObservatoryTaskTrace = {
  at: number
  sessionId: string
  title: string
  projectName: string | null
  blueprintName: string | null
  startedAt: number | null
  endedAt: number | null
  totalMs: number
  breakdown: {
    toolsMs: number
    modelMs: number
    waitingMs: number
    delegatingMs: number
  }
  stages: TraceStageBand[]
  spans: TraceSpan[]
  foldedGaps: TraceFoldedGap[]
}

export function formatDurationShort(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—"
  const sec = Math.floor(ms / 1000)
  if (sec < 1) return "<1s"
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`
  const hrs = Math.floor(min / 60)
  const remMin = min % 60
  return remMin > 0 ? `${hrs}h ${remMin}m` : `${hrs}h`
}

export function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}
