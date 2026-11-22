// Re-export shared ADE Software Factory protocol & seam contracts
export type {
  BlueprintRunState,
  BlueprintRunStatus,
  BlueprintStage,
  CaptainEndpointConfig,
  CaptainEvent,
  CaptainEventType,
  ContextIsolation,
  DeploymentFlavor,
  EscalationCard,
  EscalationKind,
  EuCompliancePolicy,
  FactoryBlueprint,
  ModelProfileId,
  ModelRef,
  ModelRole,
  ModelRoutingConfig,
  RepoMicroSkill,
  ResolvedModel,
  SandboxHandle,
  SandboxProviderKind,
  StageRunState,
  StageStatus,
  StageVerdict,
  TokenSavingsReport,
} from "./packages/protocol/index.ts"

export type Screen = "projects" | "project" | "work" | "factory" | "settings" | "worktrees"

export type CopilotSignIn = { status: "idle" | "waiting" | "complete" | "failed"; code?: string; url?: string; message?: string }
export type ModelCredentialProvider = "openai" | "anthropic" | "radius" | "compatible"
export type ModelCredential = { provider: ModelCredentialProvider; source: "saved" | "environment" | "none" }

export type EnvironmentSummary = {
  id: string
  name: string
  kind: "local" | "ssh"
  status: "connected" | "disconnected" | "error"
  active: boolean
  sshHost?: string
  sshPort?: number
  remotePort?: number
}
export type EnvironmentDirectory = { activeId: string; environments: EnvironmentSummary[] }

export type ProviderCatalogEntry = {
  id: string
  name: string
  kind?: "cli" | "api"
  configured: boolean
  enabled?: boolean
  defaultModel: string
  setupMessage: string
  models: { id: string; name: string }[]
}

export type RuntimeHealth = {
  online: boolean
  harness: string
  provider: string
  configured: boolean
  defaultModel: string
  models: { id: string; name: string }[]
  providers: { id: string; name: string }[]
  copilotSignedIn: boolean
  copilotSignIn?: CopilotSignIn
  message: string
}

export type ProviderTool = {
  id: string
  name: string
  command: string | null
  kind: "cli" | "api"
  install: string | null
  installed: boolean
  available: boolean
  modelCount: number | null
  enabled: boolean
  models?: { id: string; name: string }[]
}

export type ConversationMessage = {
  id: string
  role: "user" | "assistant" | "error"
  content: string
  status: "pending" | "completed" | "failed" | "blocked"
  createdAt: number
}

export type GitHubIssue = {
  url: string
  repository: string
  number: number
  title: string
  state: "open" | "closed"
  body: string
  truncated: boolean
}

export type Conversation = {
  id: string
  mode: "coding" | "personal"
  label: string
  environmentId?: string
  chatThread?: boolean
  projectId?: string | null
  githubIssue?: Pick<GitHubIssue, "url" | "repository" | "number" | "title" | "state">
  status: "working" | "idle"
  archivedAt?: number | null
  workspace?: { kind: "none" | "checkout" | "worktree"; path: string | null; repository: string; branch: string | null; status: "provisioning" | "ready" | "attention" | "archived"; message: string | null; removed?: boolean }
  messages: ConversationMessage[]
}

export type TaskStart = {
  id: string
  title: string
  repository: string
  kind: "none" | "checkout" | "worktree"
  environmentId?: string
  projectId?: string | null
  githubIssue?: GitHubIssue
  initialMessage?: { id: string; content: string; provider: string; model: string; reasoning: string }
}

// --- Rich ADE Streaming, Subagent, Approval, Workspace, Browser, Artifact, Skills & MCP Types ---

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

export type ApprovalPolicy = "ask" | "auto-safe" | "auto-all"

export type PendingApproval = {
  id: string
  sessionId: string
  taskId: string
  signalKey: string
  toolName: string
  summary: string
  command?: string
  arguments: Record<string, unknown>
  suggestedPrefix?: string
  createdAt: number
}

export type ApprovalRule = {
  id: string
  toolName: string
  prefix: string
  createdAt: number
}

export type ManagedProcessSummary = {
  id: string
  sessionId: string
  command: string
  cwd: string
  background: boolean
  status: "running" | "exited" | "killed"
  exitCode: number | null
  startedAt: number
  endedAt: number | null
  outputTail: string
}

export type WorkspaceEntry = {
  name: string
  path: string
  kind: "file" | "directory"
  size?: number
}

export type GitFileChange = {
  path: string
  status: "modified" | "added" | "deleted" | "renamed" | "untracked"
  staged: boolean
  unstaged: boolean
  additions: number
  deletions: number
}

export type WorkspaceGitSummary = {
  isGitRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  additions: number
  deletions: number
  files: GitFileChange[]
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

export type SessionArtifact = {
  id: string
  sessionId: string
  title: string
  kind: "plan" | "markdown" | "html" | "walkthrough" | "diff"
  content: string
  status: "draft" | "awaiting_approval" | "approved" | "changes_requested"
  feedback: string | null
  createdAt: number
  updatedAt: number
}

export type SessionTaskItem = {
  id: string
  title: string
  status: "pending" | "in_progress" | "done" | "blocked"
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

export type WorkspaceTab = {
  id: string
  kind: WorkspaceTabKind
  title: string
  closable?: boolean
  // payload identifiers depending on kind
  subagentId?: string
  filePath?: string
  artifactId?: string
  initialUrl?: string
}
