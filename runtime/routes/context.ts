import type { EnvironmentManager } from "../environments.ts";
import type { createGitHubRepositories } from "../github-repositories.ts";
import type { LocalAgentHost } from "../host.ts";
import { notFound } from "../http-error.ts";
import type { createSessionGit } from "../session-git.ts";
import type { TerminalManager } from "../terminals.ts";
import type { WorktreeManager } from "../worktrees.ts";
import type { Inbox } from "../inbox.ts";
import type { ProjectScriptStore, ScriptRunner } from "../project-scripts.ts";
import type { Checkpoints } from "../checkpoints.ts";
import type { EngineManager } from "../engines.ts";
import type { Conversation } from "@ade/protocol";

export type ArchivedWorkspaceCleanup = {
	terminalsClosed: number;
	worktreeRemoved: boolean;
	worktreeError?: string;
};

export type RouteDeps = {
	host: LocalAgentHost;
	worktreeManager: WorktreeManager;
	environments?: EnvironmentManager;
	terminals?: TerminalManager;
	githubRepositories: ReturnType<typeof createGitHubRepositories>;
	sessionGit: ReturnType<typeof createSessionGit>;
	usage: import("../usage.ts").UsageTracker;
	secrets: import("../project-secrets.ts").ProjectSecrets;
	sendToAgent: ReturnType<typeof import("../agent-workflow.ts").createAgentWorkflow>["sendToAgent"];
	runCheck: (sessionId: string) => void;
	automations: import("../automations.ts").AutomationStore;
	automationRunner: import("../automation-runner.ts").AutomationRunner;
	integrations: import("../integrations.ts").Integrations;
	executionTargets: import("../execution-targets.ts").ExecutionTargets;
	subagentPolicies: import("../subagent-policy.ts").SubagentPolicyStore;
	subagentKey: (sessionId: string, conversationId: string) => string;
	limitGuard: import("../limits.ts").LimitGuard;
	usageWaiter: import("../usage-limits.ts").UsageLimitWaiter;
	scheduler: import("../scheduler.ts").SubagentScheduler;
	cleanUpArchivedWorkspace: (
		session: { id: string; workspace: string | null; repository: string | null; kind: string | null },
		removeWorktreeRequested: boolean,
	) => Promise<ArchivedWorkspaceCleanup>;
	getGitHubRevision: () => number;
	bumpGitHubRevision: () => void;
	/** Session attention states (Inbox). */
	inbox: Inbox;
	/** Per-project setup/run scripts and their running processes. */
	scripts: ProjectScriptStore;
	scriptRunner: ScriptRunner;
	/** Workspace snapshots before each agent turn. */
	checkpoints: Checkpoints;
	/** Claude Code / Codex sessions. */
	engines: EngineManager;
	/** Sessions as the UI sees them (engine sessions report their engine's status). */
	viewSessions: () => Conversation[];
	/** Copy configured files into a new worktree and start the project's setup script. */
	prepareWorktree: (session: Conversation) => void;
	/** Phone pairing & remote mobile bridge manager. */
	mobilePairing?: import("../mobile-pairing.ts").MobilePairingManager;
};

export function requireWorkspace(host: LocalAgentHost, sessionId: string): string {
	const workspace = host.getWorkspacePath(sessionId);
	if (!workspace) throw notFound("Session has no ready workspace.");
	return workspace;
}
