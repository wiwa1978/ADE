// Shared ADE Software Factory protocol & architectural seam contracts.
// Strictly runtime-agnostic (zero Node or browser-DOM dependencies) so it compiles
// cleanly in Node, Tauri/React, Cloudflare Workers/Durable Objects, and celld.dev.

export type DeploymentFlavor = "local" | "remote";

export type CaptainEndpointConfig = {
  flavor: DeploymentFlavor;
  /** HTTP origin, e.g. "" (same-origin Vite proxy), "http://127.0.0.1:4319", or "https://cloud.ade.dev" */
  baseUrl: string;
  /** Optional WebSocket URL for live multi-device streaming */
  wsUrl?: string;
  /** Optional bearer token for Flavor 2 remote Captain or Flavor 1 mobile relay */
  authToken?: string;
  /** Optional region pin for EU compliance */
  region?: "local" | "eu" | "global";
};

// ---------------------------------------------------------------------------
// Seam 4: Model Routing, Profiles & EU-Only Policy Guard
// ---------------------------------------------------------------------------

export type ReasoningLevel = "off" | "low" | "medium" | "high";

export type ModelRole = "fast" | "reasoning" | "coding" | "adversarial_critic";

export type ModelProfileId =
  | "balanced"
  | "max-quality"
  | "budget"
  | "eu-only"
  | "eu-sovereign"
  | "local-ollama";

export type ModelRef = {
  provider: string;
  model: string;
  reasoning?: ReasoningLevel;
  /** Optional explicit endpoint region tag for compliance verification */
  endpointRegion?: "eu" | "us" | "global" | "local";
};

export type EuCompliancePolicy = {
  /** When true, fail-closed: reject any model/endpoint outside the EU/local allowlist */
  euOnlyMode: boolean;
  /** When true, enforce CLOUD-Act-free EU-owned providers ONLY (Mistral / EU self-hosted GPU / local) */
  cloudActFree?: boolean;
  /** Allow local loopback inference (e.g. Ollama / LM Studio) under EU-Only Mode */
  allowLocalLoopback?: boolean;
  /** Extra custom EU-verified provider IDs configured by an org */
  extraAllowedProviders?: string[];
};

export type ModelRoutingConfig = {
  profile: ModelProfileId;
  appDefault: ModelRef;
  projectOverride?: Partial<ModelRef>;
  /** Role defaults derived from profile or user settings */
  roleDefaults?: Partial<Record<ModelRole, ModelRef>>;
  /** Per-blueprint-stage explicit overrides (e.g. { specify: ..., review: ... }) */
  stageOverrides?: Record<string, ModelRef>;
  /** Per-run or per-subagent explicit overrides */
  runOverrides?: Record<string, ModelRef>;
  compliance: EuCompliancePolicy;
};

export type ResolvedModel = {
  ref: ModelRef;
  source: "run-override" | "stage-override" | "role-default" | "project-override" | "app-default";
  euCompliant: boolean;
};

// ---------------------------------------------------------------------------
// Seam 1: Declarative Factory Blueprints (BlueprintEngine)
// ---------------------------------------------------------------------------

export type StageExecutor =
  | "captain"
  | "subagent"
  | "parallel_subagents"
  | "deterministic_hook";

export type ContextIsolation = "elephant" | "goldfish";

export type ApprovalGateMode = "never" | "before" | "after";

export type BlueprintStage = {
  id: string;
  name: string;
  description: string;
  executor: StageExecutor;
  /** elephant = full Captain history; goldfish = zero chat memory + full read-only repo access */
  contextIsolation: ContextIsolation;
  /** false = Brain-only ($0 VM, <1s start); true = attach Docker/Boat sandbox on demand */
  requiresSandbox: boolean;
  /** Batch multi-file reads via @earendil-works/pi-codemode */
  useCodeMode: boolean;
  /** Stage-scoped tool pruning (TokenEconomizer pattern) */
  allowedToolGroups: string[];
  personaPrompt?: string;
  artifactPathPattern?: string;
  approvalGate: ApprovalGateMode;
  deterministicChecks?: string[];
  defaultModelRole: ModelRole;
  modelOverride?: ModelRef;
  workerHarness?: "pi" | "claude-code" | "codex";
  maxParallelSubagents?: number;
  /** Optional target stage ID to loop back to when an audit stage returns CHANGES_REQUESTED */
  onChangesRequestedStageId?: string;
};

export type FactoryBlueprint = {
  id: string;
  name: string;
  description: string;
  bestFor: "brownfield" | "greenfield" | "enterprise" | "fast";
  /** Optional repo-level constitution or living master spec path */
  constitutionPath?: string;
  /** Optional cross-issue decisions log path (Squad pattern, e.g. ".squad/decisions.md") */
  decisionsLogPath?: string;
  /** Optional repo-specific operational micro-skills path (TokenEconomizer pattern) */
  microSkillsPath?: string;
  stages: BlueprintStage[];
};

export type StageStatus =
  | "pending"
  | "awaiting_approval"
  | "running"
  | "completed"
  | "changes_requested"
  | "skipped"
  | "failed";

export type StageVerdict = {
  outcome: "pass" | "changes_requested" | "escalate_human";
  summary: string;
  findings?: {
    severity: "blocker" | "major" | "minor";
    file?: string;
    line?: number;
    message: string;
  }[];
};

export type StageRunState = {
  stageId: string;
  status: StageStatus;
  attempt: number;
  startedAt?: number;
  endedAt?: number;
  resolvedModel?: ResolvedModel;
  sandboxAttached: boolean;
  artifactPaths: string[];
  verdict?: StageVerdict;
  error?: string;
};

export type BlueprintRunStatus =
  | "idle"
  | "running"
  | "awaiting_human"
  | "completed"
  | "failed"
  | "cancelled";

export type BlueprintRunState = {
  runId: string;
  projectId: string;
  blueprintId: string;
  issueRef?: {
    repository: string;
    number: number;
    title: string;
    url: string;
  };
  status: BlueprintRunStatus;
  currentStageIndex: number;
  stages: StageRunState[];
  disabledStageIds: string[];
  maxAuditLoopbacks: number;
  auditLoopbacksUsed: number;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Single-Captain Escalation & Decision Cards
// ---------------------------------------------------------------------------

export type EscalationKind =
  | "approve_stage"
  | "choose_option"
  | "spec_conflict"
  | "loop_intervention"
  | "approve_pr";

export type SubagentEscalationInput = {
  subagentId: string;
  subagentName: string;
  stageId: string;
  kind: "question" | "spec_conflict" | "failure_loop" | "completed" | "failed";
  summary: string;
  options?: string[];
  file?: string;
  createdAt: number;
};

export type EscalationCard = {
  id: string;
  runId: string;
  stageId: string;
  kind: EscalationKind;
  title: string;
  summary: string;
  options: { id: string; label: string; recommended?: boolean }[];
  sourceSubagentIds: string[];
  status: "pending" | "resolved";
  resolution?: { optionId: string; note?: string; resolvedAt: number };
  createdAt: number;
};

// ---------------------------------------------------------------------------
// Seam 2: CaptainHost (Storage + Scheduler + Transport)
// ---------------------------------------------------------------------------

export type CaptainEventType =
  | "connected"
  | "run.updated"
  | "stage.started"
  | "stage.completed"
  | "stage.awaiting_approval"
  | "sandbox.attached"
  | "sandbox.detached"
  | "escalation.created"
  | "escalation.resolved"
  | "loop.intervened"
  | "pr.published";

export type CaptainEvent = {
  type: CaptainEventType;
  runId?: string;
  payload: unknown;
  timestamp: number;
};

export interface CaptainStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list<T>(prefix: string): Promise<{ key: string; value: T }[]>;
}

export interface CaptainScheduler {
  schedule(id: string, delayMs: number, payload?: unknown): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface CaptainTransport {
  broadcast(event: CaptainEvent): Promise<void>;
}

export interface CaptainHost {
  readonly kind: "node-sqlite" | "cloudflare-do" | "celld" | "eu-container" | "memory";
  readonly region: "local" | "eu" | "global";
  readonly storage: CaptainStorage;
  readonly scheduler: CaptainScheduler;
  readonly transport: CaptainTransport;
}

// ---------------------------------------------------------------------------
// Seam 3: SandboxProvider (Lazy Hands-on-Demand Worker Execution)
// ---------------------------------------------------------------------------

export type SandboxProviderKind = "docker" | "boat" | "azure-aca" | "local-hand" | "memory";

export type SandboxHandle = {
  id: string;
  provider: SandboxProviderKind;
  status: "starting" | "running" | "paused" | "stopped";
  region: "local" | "eu" | "global";
  previewUrls?: Record<number, string>;
  createdAt: number;
};

export type SandboxCreateOptions = {
  runId: string;
  repoUrl: string;
  baseBranch: string;
  workBranch: string;
  envSecrets?: Record<string, string>;
  imageOrSnapshot?: string;
  region?: "local" | "eu" | "global";
  idleAutoPauseMs?: number;
};

export type SandboxExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type WorkerTaskSpec = {
  taskId: string;
  stageId: string;
  role: string;
  prompt: string;
  model: ModelRef;
  harness: "pi" | "claude-code" | "codex";
  allowedToolGroups: string[];
  microSkillsContext?: string;
};

export type WorkerCallbackEvent = {
  runId: string;
  taskId: string;
  kind: "progress" | "tool_result" | "question" | "spec_conflict" | "completed" | "failed";
  summary: string;
  data?: Record<string, unknown>;
  timestamp: number;
};

export interface SandboxProvider {
  readonly kind: SandboxProviderKind;
  create(opts: SandboxCreateOptions): Promise<SandboxHandle>;
  exec(id: string, cmd: string[], opts?: { timeoutMs?: number }): Promise<SandboxExecResult>;
  spawnWorker(id: string, task: WorkerTaskSpec, callbackUrl: string): Promise<{ workerRunId: string }>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  destroy(id: string): Promise<void>;
  getDiff(id: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// GitHub Integration Contract (gh CLI locally vs. GitHub App remotely)
// ---------------------------------------------------------------------------

export type GitHubIssueInput = {
  repository: string;
  number: number;
  title: string;
  body: string;
  url: string;
  state: "open" | "closed";
  labels?: string[];
};

export type PullRequestDraft = {
  repository: string;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  draft?: boolean;
};

export type PublishedPullRequest = {
  url: string;
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
};

export interface GitHubProvider {
  readonly kind: "gh-cli" | "github-app" | "memory";
  getIssue(repository: string, issueNumber: number): Promise<GitHubIssueInput>;
  readRepoFile(repository: string, ref: string, path: string): Promise<string | null>;
  publishPullRequest(draft: PullRequestDraft): Promise<PublishedPullRequest>;
}

// ---------------------------------------------------------------------------
// TokenEconomizer Types (Micro-Skills, Tool Pruning, Failure-Loop Watchdog)
// ---------------------------------------------------------------------------

export type ToolDescriptor = {
  name: string;
  group: string;
  description: string;
  estimatedSchemaTokens?: number;
};

export type ToolUsageRecord = {
  toolName: string;
  calls: number;
  sessionsSeen: number;
};

export type RepoMicroSkill = {
  id: string;
  repository: string;
  category: "test_command" | "build_command" | "lint_command" | "convention" | "pitfall";
  fact: string;
  confidence: number;
  learnedAt: number;
};

export type FailureObservation = {
  signature: string;
  stageId: string;
  subagentId: string;
  commandOrTool: string;
  errorExcerpt: string;
  timestamp: number;
};

export type TokenSavingsReport = {
  prunedToolTokensPerTurn: number;
  loopInterventions: number;
  sandboxMinutesAvoided: number;
  estimatedTokensSaved: number;
  estimatedUsdSaved: number;
};

// ---------------------------------------------------------------------------
// Shared Runtime HTTP API Contract Types (imported by both runtime/ and UI)
// ---------------------------------------------------------------------------

export type Project = {
  id: string;
  name: string;
  githubUrl: string | null;
  repository: string | null;
  blueprintId?: string;
  modelProfile?: string;
  euOnlyMode?: boolean;
  cloudActFree?: boolean;
  stageOverrides?: Record<string, { provider: string; model: string }>;
  archivedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
};

export type ProjectInput = {
  id: string;
  name: string;
  githubUrl: string;
  repository: string;
  blueprintId?: string;
  modelProfile?: string;
  euOnlyMode?: boolean;
  cloudActFree?: boolean;
  stageOverrides?: Record<string, { provider: string; model: string }>;
};

export type GitHubConnection = {
  login: string | null;
};

export type GitHubRepository = {
  fullName: string;
  private: boolean;
};

export type GitHubRepositoryPage = {
  repositories: GitHubRepository[];
  nextPage: number | null;
};

export type GitHubIssue = {
  url: string;
  repository: string;
  number: number;
  title: string;
  state: "open" | "closed";
  body: string;
  truncated: boolean;
};

export type GitHubIssueSummary = Pick<GitHubIssue, "url" | "repository" | "number" | "title" | "state">;

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  status: "pending" | "completed" | "failed" | "blocked";
  createdAt: number;
};

export type ConversationWorkspace = {
  kind: "none" | "checkout" | "worktree" | "existing";
  path: string | null;
  repository: string;
  branch: string | null;
  status: "provisioning" | "ready" | "attention" | "archived";
  message: string | null;
  removed?: boolean;
};

export type Conversation = {
  id: string;
  mode: "coding" | "personal";
  label: string;
  environmentId?: string;
  chatThread?: boolean;
  projectId?: string | null;
  githubIssue?: GitHubIssueSummary;
  status: "working" | "idle";
  archivedAt?: number | null;
  createdAt?: number | null;
  /** When the conversation last changed; used to sort sessions and the inbox. */
  updatedAt?: number | null;
  lastTurnStatus?: "pending" | "completed" | "failed" | "blocked" | null;
  /** Set when the session runs on Claude Code or Codex instead of ADE's built-in agent. */
  engine?: "claude-code" | "codex";
  workspace?: ConversationWorkspace;
  messages: ConversationMessage[];
};

export type CopilotSignIn = {
  status: "idle" | "waiting" | "complete" | "failed";
  code?: string;
  url?: string;
  message?: string;
};

export type ModelCredentialProvider = "openai" | "anthropic" | "radius" | "compatible";

export type ModelCredential = {
  provider: ModelCredentialProvider;
  source: "saved" | "environment" | "none";
};

export type EnvironmentSummary = {
  id: string;
  name: string;
  kind: "local" | "ssh";
  status: "connected" | "disconnected" | "error";
  active: boolean;
  sshHost?: string;
  sshPort?: number;
  remotePort?: number;
};

export type EnvironmentDirectory = {
  activeId: string;
  environments: EnvironmentSummary[];
};

export type ProviderCatalogEntry = {
  id: string;
  name: string;
  kind?: "cli" | "api";
  configured: boolean;
  enabled?: boolean;
  defaultModel: string;
  setupMessage: string;
  models: { id: string; name: string }[];
};

export type RuntimeHealth = {
  online: boolean;
  harness: string;
  provider: string;
  configured: boolean;
  defaultModel: string;
  models: { id: string; name: string }[];
  providers: { id: string; name: string }[];
  copilotSignedIn: boolean;
  copilotSignIn?: CopilotSignIn;
  message: string;
};

export type ProviderTool = {
  id: string;
  name: string;
  command: string | null;
  kind: "cli" | "api";
  install: string | null;
  installed: boolean;
  available: boolean;
  modelCount: number | null;
  enabled: boolean;
  models?: { id: string; name: string }[];
};

export type ApprovalPolicy = "ask" | "auto-safe" | "auto-all";

export type PendingApproval = {
  id: string;
  sessionId: string;
  taskId: string;
  signalKey: string;
  toolName: string;
  summary: string;
  command?: string;
  arguments: Record<string, unknown>;
  suggestedPrefix?: string;
  createdAt: number;
};

export type ApprovalRule = {
  id: string;
  toolName: string;
  prefix: string;
  createdAt: number;
};

export type ManagedProcessSummary = {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  background: boolean;
  status: "running" | "exited" | "killed";
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  outputTail: string;
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
};

export type GitFileChange = {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  unstaged: boolean;
  additions: number;
  deletions: number;
};

export type WorkspaceGitSummary = {
  isGitRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  additions: number;
  deletions: number;
  files: GitFileChange[];
};

export type ArtifactKind = "plan" | "markdown" | "html" | "walkthrough" | "diff";
export type ArtifactStatus = "draft" | "awaiting_approval" | "approved" | "changes_requested";

export type SessionArtifact = {
  id: string;
  sessionId: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  status: ArtifactStatus;
  feedback: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SessionTaskItem = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "blocked";
};
