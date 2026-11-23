// Services behind the agent workflow features (Inbox, project scripts, checkpoints, Claude Code/Codex).
import { resolve } from "node:path";
import { createInbox } from "./inbox.ts";
import { copyIntoWorktree, ProjectScriptStore, ScriptRunner } from "./project-scripts.ts";
import { createCheckpoints } from "./checkpoints.ts";
import { EngineManager } from "./engines.ts";
import { UsageTracker } from "./usage.ts";
import type { LocalAgentHost } from "./host.ts";
import type { WorktreeManager } from "./worktrees.ts";
import type { createSessionGit } from "./session-git.ts";
import type { Conversation } from "../packages/protocol/index.ts";

export function createAgentWorkflow({ host, worktreeManager, sessionGit }: {
	host: LocalAgentHost;
	worktreeManager: WorktreeManager;
	sessionGit: ReturnType<typeof createSessionGit>;
}) {
	const stateDirectory = worktreeManager?.root ? resolve(worktreeManager.root, "..") : process.cwd();
	const scripts = new ProjectScriptStore(stateDirectory);
	const scriptRunner = new ScriptRunner({ events: host.events });
	const checkpoints = createCheckpoints();
	const engines = new EngineManager({ stateDirectory, events: host.events });
	/** Sessions as the UI sees them: sessions run by Claude Code or Codex report that engine's status. */
	const viewSessions = (): Conversation[] => host.sessions().map(session => {
		const engine = engines.get(session.id);
		if (!engine) return session;
		const working = engines.isWorking(session.id);
		return {
			...session,
			engine: engine.engine,
			status: working ? "working" : session.status,
			updatedAt: Math.max(session.updatedAt ?? 0, engine.updatedAt),
			lastTurnStatus: working ? "pending" : engine.lastStatus,
		};
	});
	const inbox = createInbox({
		sessions: viewSessions,
		getWorkspacePath: id => host.getWorkspacePath(id),
		getWorkspaceBase: id => host.getWorkspaceBase(id),
		approvals: host.approvals,
	}, sessionGit);
	/** New worktree sessions: copy configured files from the project checkout, then run the setup script. */
	function prepareWorktree(session: Conversation) {
		const workspace = session.workspace;
		if (workspace?.kind !== "worktree" || workspace.status !== "ready" || !workspace.path || !session.projectId) return;
		if (scriptRunner.state(session.id, "setup").status !== "idle") return;
		const project = host.projects().find(item => item?.id === session.projectId);
		if (!project?.repository) return;
		const effective = scripts.effective(project.id, project.repository);
		const copied = effective.copy.length ? copyIntoWorktree(project.repository, workspace.path, effective.copy) : [];
		if (!effective.setup) return;
		void scriptRunner.start(session.id, "setup", effective.setup, workspace.path, { ADE_PROJECT_ROOT: project.repository })
			.then(state => { if (copied.length) state.output = `Copied from the project: ${copied.join(", ")}\n\n${state.output}`; })
			.catch(() => undefined);
	}
	/** Every agent reports its running token/cost totals with each timeline update; keep a ledger of them. */
	const usage = new UsageTracker(stateDirectory);
	const projectOf = new Map<string, string | null>();
	host.events?.subscribe?.(event => {
		if (event.type !== "timeline.update" || !event.sessionId) return;
		const payload = event.payload as { conversationId?: unknown; usage?: unknown } | null;
		if (!payload?.usage) return;
		if (!projectOf.has(event.sessionId)) projectOf.set(event.sessionId, host.sessions().find(item => item.id === event.sessionId)?.projectId ?? null);
		usage.record(event.sessionId, String(payload.conversationId ?? "0"), payload.usage, projectOf.get(event.sessionId) ?? null);
	});
	// Claude Code / Codex sessions keep their totals on disk; count any that predate the ledger.
	for (const session of host.sessions?.() ?? []) {
		const engine = engines.get(session.id);
		if (engine) usage.record(session.id, "0", engine.usage, session.projectId ?? null);
	}
	return { inbox, scripts, scriptRunner, checkpoints, engines, viewSessions, prepareWorktree, usage };
}
