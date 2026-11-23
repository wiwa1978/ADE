// Services behind the agent workflow features (Inbox, project scripts, checkpoints, Claude Code/Codex).
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { ProjectSecrets, setSecretResolver } from "./project-secrets.ts";
import { checkFailedPrompt } from "../packages/protocol/agent-prompts.ts";
import { createInbox } from "./inbox.ts";
import { copyIntoWorktree, ProjectScriptStore, ScriptRunner } from "./project-scripts.ts";
import { createCheckpoints } from "./checkpoints.ts";
import { EngineManager } from "./engines.ts";
import { UsageTracker } from "./usage.ts";
import { AutomationStore } from "./automations.ts";
import { createAutomationRunner } from "./automation-runner.ts";
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
	const secrets = new ProjectSecrets(stateDirectory);
	/** The project a working directory belongs to: a session's worktree or a project checkout (or a folder inside one). */
	const projectForCwd = (cwd: string): string | null => {
		const real = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
		const target = real(cwd);
		const inside = (root: string | null | undefined) => {
			if (!root) return false;
			const base = real(root);
			return target === base || target.startsWith(`${base}${sep}`);
		};
		for (const session of host.sessions?.() ?? []) {
			if (session.projectId && inside(session.workspace?.path)) return session.projectId;
		}
		return (host.projects?.() ?? []).find(project => project && inside(project.repository))?.id ?? null;
	};
	setSecretResolver(cwd => secrets.env(projectForCwd(cwd)));
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
	/**
	 * Send a message to a session's agent the way the composer does: snapshot the workspace for
	 * rewinding, then hand it to Claude Code / Codex or the ADE agent.
	 */
	async function sendToAgent(sessionId: string, content: string, options: { id?: string; provider?: string; model?: string; reasoning?: string; async?: boolean } = { async: true }) {
		const workspace = host.getWorkspacePath(sessionId);
		if (workspace) await checkpoints.create(sessionId, workspace, content).catch(() => null);
		inbox.invalidate(sessionId);
		if (engines.get(sessionId)) {
			if (!workspace) throw Object.assign(new Error("Session has no ready workspace."), { statusCode: 404 });
			engines.send(sessionId, workspace, content, host.approvals.policy(sessionId), null);
			return viewSessions().find(item => item.id === sessionId);
		}
		return host.send("coding", { ...options, content }, sessionId);
	}

	// Hook: after an agent turn ends, run the project's check command (lint, typecheck, tests) in the
	// workspace. With auto-fix on, a failing check goes back to the agent, at most twice in a row.
	const agentBusy = new Map<string, boolean>();
	const autoFixStreak = new Map<string, number>();
	function runCheck(sessionId: string) {
		const session = viewSessions().find(item => item.id === sessionId);
		const workspace = host.getWorkspacePath(sessionId);
		const project = session?.projectId ? host.projects().find(item => item?.id === session.projectId) : null;
		if (!session || !workspace || !project) return;
		const effective = scripts.effective(project.id, project.repository);
		if (!effective.check || scriptRunner.state(sessionId, "check").status === "running") return;
		void scriptRunner.start(sessionId, "check", effective.check, workspace, project.repository ? { ADE_PROJECT_ROOT: project.repository } : {}, state => {
			inbox.invalidate(sessionId);
			if (state.status === "succeeded") {
				autoFixStreak.delete(sessionId);
				return;
			}
			if (state.status !== "failed" || !effective.checkAutoFix) return;
			const streak = autoFixStreak.get(sessionId) ?? 0;
			if (streak >= 2) return;
			autoFixStreak.set(sessionId, streak + 1);
			void sendToAgent(sessionId, checkFailedPrompt(effective.check, state.output)).catch(() => undefined);
		}).catch(() => undefined);
	}
	host.events?.subscribe?.(event => {
		if (event.type !== "timeline.update" || !event.sessionId) return;
		const payload = event.payload as { busy?: unknown; isSubagent?: unknown } | null;
		if (!payload || payload.isSubagent) return;
		const was = agentBusy.get(event.sessionId) ?? false;
		const now = Boolean(payload.busy);
		agentBusy.set(event.sessionId, now);
		if (was && !now) runCheck(event.sessionId);
	});

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
	// Background agents: scheduled and issue-triggered automations (R11).
	const automations = new AutomationStore(stateDirectory);
	const automationRunner = createAutomationRunner({
		store: automations,
		projects: () => host.projects?.() ?? [],
		sessions: viewSessions,
		createSession: input => host.createCodingTask(input, worktreeManager),
		setEngine: (sessionId, engine) => { engines.setEngine(sessionId, engine); },
		prepareWorktree,
		sendToAgent: async (sessionId, content) => {
			await sendToAgent(sessionId, content, { async: true });
			host.events?.emit?.("sessions.changed", { id: sessionId, reason: "automation" });
		},
	});
	return { inbox, scripts, scriptRunner, checkpoints, engines, viewSessions, prepareWorktree, usage, secrets, sendToAgent, runCheck, automations, automationRunner };
}
