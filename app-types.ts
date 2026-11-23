// Re-export shared ADE protocol & HTTP API contract types from packages/protocol
export type {
  ApprovalPolicy,
  ApprovalRule,
  ArtifactKind,
  ArtifactStatus,
  BlueprintRunState,
  BlueprintRunStatus,
  BlueprintStage,
  CaptainEndpointConfig,
  CaptainEvent,
  CaptainEventType,
  ContextIsolation,
  Conversation,
  ConversationMessage,
  ConversationWorkspace,
  CopilotSignIn,
  DeploymentFlavor,
  EnvironmentDirectory,
  EnvironmentSummary,
  EscalationCard,
  EscalationKind,
  EuCompliancePolicy,
  FactoryBlueprint,
  GitFileChange,
  GitHubConnection,
  GitHubIssue,
  GitHubIssueSummary,
  GitHubRepository,
  GitHubRepositoryPage,
  ManagedProcessSummary,
  ModelCredential,
  ModelCredentialProvider,
  ModelProfileId,
  ModelRef,
  ModelRole,
  ModelRoutingConfig,
  PendingApproval,
  Project,
  ProjectInput,
  ProviderCatalogEntry,
  ProviderTool,
  RepoMicroSkill,
  ResolvedModel,
  RuntimeHealth,
  SandboxHandle,
  SandboxProviderKind,
  SessionArtifact,
  SessionTaskItem,
  StageRunState,
  StageStatus,
  StageVerdict,
  TokenSavingsReport,
  WorkspaceEntry,
  WorkspaceGitSummary,
} from "./packages/protocol/index.ts"
import type { GitHubIssue } from "./packages/protocol/index.ts"

export type Screen = "inbox" | "projects" | "project" | "work" | "factory" | "settings" | "worktrees" | "attempts"

export type TaskStart = {
  id: string
  title: string
  repository: string
  kind: "none" | "checkout" | "worktree"
  environmentId?: string
  projectId?: string | null
  githubIssue?: GitHubIssue
  /** Check out an existing branch or pull request instead of creating a new branch. */
  startFrom?: StartFrom
  /** Shared by parallel attempts at the same task (best of N). */
  attemptGroup?: string
  initialMessage?: { id: string; content: string; provider: string; model: string; reasoning: string }
}

export type StartFrom = { branch: string } | { pullRequest: number }

// --- Rich ADE Streaming, Subagent, Browser, Skills & MCP UI Types ---

export type TimelineToolCall = {
  callId: string
  name: string
  arguments: Record<string, unknown>
  status: "pending" | "running" | "sleeping" | "waiting" | "done" | "error"
  output: string
  isError: boolean
  details?: unknown
}

export type TimelineItem =
  | { id: string; kind: "user"; content: string; createdAt: number }
  | { id: string; kind: "assistant"; thinking: string; text: string; toolCalls: TimelineToolCall[]; streaming?: boolean; createdAt: number }
  | { id: string; kind: "compaction"; summary: string; createdAt: number }
  | { id: string; kind: "error"; message: string; createdAt: number }

export type ConversationTimelineSnapshot = {
  sessionId: string
  conversationId: string
  busy: boolean
  items: TimelineItem[]
  liveTools: TimelineToolCall[]
  runFailure?: { reason: string; detail?: string } | null
  usage?: { inputTokens: number; outputTokens: number; totalCost?: number } | null
  isSubagent?: boolean
}

export type SubagentInfo = {
  id: string
  parentId: string
  assignmentId: string
  name: string
  role?: string
  mode?: "readonly" | "workspace" | "worktree"
  background?: boolean
  workspacePath?: string | null
  branch?: string | null
  createdAt?: number
  assignment: string
  status: "running" | "waiting" | "completed" | "failed" | "blocked" | "unknown"
  model: string | null
  reasoning: string
  error: string | null
  liveTools?: TimelineToolCall[]
  timeline?: TimelineItem[]
  messages: { id: string; role: "user" | "assistant"; content: string }[]
}

export type BrowserViewport = { width: number; height: number; preset: "desktop" | "tablet" | "mobile" }

export type BrowserState = {
  available: boolean
  chromePath: string | null
  running: boolean
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  agentDriving: boolean
  viewport: BrowserViewport
  lastFrame: string | null
  error: string | null
}

export type SkillsAndRulesCatalog = {
  skills: { name: string; description: string; path: string; scope: "global" | "workspace" }[]
  rules: { name: string; path: string; scope: "global" | "workspace"; content: string }[]
  commands: { name: string; description: string; prompt: string; scope: "builtin" | "global" | "workspace" }[]
}

export type McpServerStatus = {
  id: string
  name: string
  transport: "stdio" | "http"
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  status: "disconnected" | "connecting" | "connected" | "error"
  error: string | null
  tools: { name: string; description: string }[]
}

// --- Paseo-style Split-Pane & Tabbed Workspace Model ---

export type WorkspaceTabKind =
  | "lead"
  | "subagent"
  | "files"
  | "file"
  | "diff"
  | "browser"
  | "artifact"
  | "terminal"
  | "processes"
  | "pr"
  | "run"
  | "transcript"
  | "progress"

export type WorkspaceTab = {
  id: string
  kind: WorkspaceTabKind
  title: string
  closable?: boolean
  subagentId?: string
  filePath?: string
  artifactId?: string
  initialUrl?: string
}
