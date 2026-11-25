// Shared ADE Software Factory protocol & architectural seam contracts.
// Strictly runtime-agnostic (zero Node or browser-DOM dependencies) so it compiles
// cleanly in Node, Tauri/React, Cloudflare Workers/Durable Objects, and celld.dev.

export * from "./schemas/index.ts";

import type {
	CaptainEvent,
	ModelRef,
} from "./schemas/index.ts";

// ---------------------------------------------------------------------------
// Seam 2: CaptainHost (Storage + Scheduler + Transport)
// ---------------------------------------------------------------------------

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
// Backwards-compatible flat UI DTOs (strict discriminated schemas also exported)
// ---------------------------------------------------------------------------

export type CopilotSignIn = {
	status: "idle" | "waiting" | "complete" | "failed";
	code?: string;
	url?: string;
	message?: string;
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
