import type { EnvironmentManager } from "../environments.ts";
import type { createGitHubRepositories } from "../github-repositories.ts";
import type { LocalAgentHost } from "../host.ts";
import { notFound } from "../http-error.ts";
import type { createSessionGit } from "../session-git.ts";
import type { TerminalManager } from "../terminals.ts";
import type { WorktreeManager } from "../worktrees.ts";

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
	cleanUpArchivedWorkspace: (
		session: { id: string; workspace: string | null; repository: string | null; kind: string | null },
		removeWorktreeRequested: boolean,
	) => Promise<ArchivedWorkspaceCleanup>;
	getGitHubRevision: () => number;
	bumpGitHubRevision: () => void;
};

export function requireWorkspace(host: LocalAgentHost, sessionId: string): string {
	const workspace = host.getWorkspacePath(sessionId);
	if (!workspace) throw notFound("Session has no ready workspace.");
	return workspace;
}
