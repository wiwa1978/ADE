// Services behind the agent workflow features (Inbox, project scripts, checkpoints, Claude Code/Codex).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { packageManagerFor, resolveChecks, runChecks } from "./stage-checks.ts";
import { ProjectSecrets, setSecretResolver } from "./project-secrets.ts";
import { ExecutionTargets, sessionTarget, setExecutionTargets } from "./execution-targets.ts";
import { setExternalSubagentRunner } from "./subagent-harness.ts";
import { SubagentPolicyStore, type SubagentHarness } from "./subagent-policy.ts";
import { checkFailedPrompt } from "@ade/protocol/agent-prompts.ts";
import { createInbox } from "./inbox.ts";
import { copyIntoWorktree, ProjectScriptStore, ScriptRunner } from "./project-scripts.ts";
import { createCheckpoints } from "./checkpoints.ts";
import { copySkillsForCli, writeClaudeMcpConfig } from "./cli-capabilities.ts";
import { EngineManager, type EngineId } from "./engines.ts";
import { effectiveSkills, scanSkillLandscape } from "./skill-catalog.ts";
import { UsageTracker } from "./usage.ts";
import { LimitGuard } from "./limits.ts";
import { CONTINUE_PROMPT, UsageLimitWaiter } from "./usage-limits.ts";
import { SubagentScheduler } from "./scheduler.ts";
import { AutomationStore } from "./automations.ts";
import { Integrations, type SlackEvents } from "./integrations.ts";
import { createAutomationRunner } from "./automation-runner.ts";
import type { LocalAgentHost } from "./host.ts";
import type { WorktreeManager } from "./worktrees.ts";
import type { createSessionGit } from "./session-git.ts";
import type { Conversation } from "@ade/protocol";

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
		if (typeof host.findProjectForCwd === "function") return host.findProjectForCwd(cwd);
		const real = (path: string) => { try { return realpathSync.native(path); } catch { return resolve(path); } };
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
	/** Active skills go into the CLI's skills folder. Claude Code also gets only the MCP servers that are on. */
	const cliMcpConfig = (sessionId: string, workspace: string, engine: EngineId) => {
		if (engine !== "claude-code" && engine !== "codex") return null;
		const projectId = host.sessionProjectId(sessionId);
		const scope = { workspace, projectId };
		const skills = effectiveSkills(scanSkillLandscape({ workspace, sources: host.skillLibrary.list() }))
			.filter(skill => host.capabilities.isActive("skill", skill.name, projectId) && !skill.shadowedBy);
		copySkillsForCli(workspace, engine, skills.map(skill => ({ name: skill.name, dir: skill.dir })));
		return engine === "claude-code" ? writeClaudeMcpConfig(sessionId, host.mcp.handoff(scope)) : null;
	};
	engines.setGuard((engine, sessionId) => {
		const projectId = sessionId ? host.sessionProjectId?.(sessionId) : null;
		const project = projectId ? (host.projects?.() ?? []).find(p => p.id === projectId) : null;
		return host.eu.engineBlock(engine, Boolean(project?.euOnlyMode || project?.cloudActFree));
	});
	const overlayEngine = (session: Conversation): Conversation => {
		const engine = engines.get(session.id);
		if (!engine) return session;
		const working = engines.isWorking(session.id);
		return {
			...session,
			engine: engine.engine,
			...(engine.interactionMode ? { interactionMode: engine.interactionMode } : {}),
			status: working ? "working" : session.status,
			updatedAt: Math.max(session.updatedAt ?? 0, engine.updatedAt),
			lastTurnStatus: working ? "pending" : engine.lastStatus,
		};
	};
	/** Sessions as the UI sees them: sessions run by Claude Code or Codex report that engine's status. */
	const viewSessions = (): Conversation[] => host.sessions().map(overlayEngine);
	/** O(1) single-session view without scanning all sessions and turns. */
	const viewSession = (sessionId: string): Conversation | undefined => {
		const session = typeof host.getSession === "function"
			? host.getSession(sessionId)
			: host.sessions?.().find(item => item.id === sessionId);
		return session ? overlayEngine(session) : undefined;
	};
	const sessionWorkspaces = () => (typeof host.listSessionWorkspaces === "function"
		? host.listSessionWorkspaces()
		: (host.sessions?.() ?? []).map(item => ({
			id: item.id,
			path: item.workspace?.path ?? null,
			repository: item.workspace?.repository ?? "",
			archivedAt: item.archivedAt ?? null,
		})));
	const inbox = createInbox({
		sessions: viewSessions,
		getWorkspacePath: id => host.getWorkspacePath(id),
		getWorkspaceBase: id => host.getWorkspaceBase(id),
		approvals: host.approvals,
	}, sessionGit);
	/** New worktree sessions: copy configured files from the project checkout, then run the setup script. */
	const integrations = new Integrations(stateDirectory);
	// Where each session's commands run: this computer, Docker, WSL2, an SSH host or a Cloud VM.
	const executionTargets = new ExecutionTargets(stateDirectory, {
		worktreesRoot: worktreeManager?.root ?? null,
		boat: () => integrations.boatApi(),
		cloud: {
			driver: id => integrations.cloudDriver(id),
			values: id => integrations.cloudProviderValues(id),
			configuredIds: () => integrations.cloudProviderStatuses().filter(p => p.configured).map(p => p.id),
		},
	});
	setExecutionTargets(
		executionTargets,
		cwd => executionTargets.sessionForPath(cwd, sessionWorkspaces()),
		sessionId => {
			const path = typeof host.getWorkspacePath === "function"
				? host.getWorkspacePath(sessionId)
				: host.sessions?.().find(item => item.id === sessionId)?.workspace?.path ?? null;
			return path ? [path] : [];
		},
	);
	// Containers stop when the computer restarts; start them again for Docker sessions that are still open.
	// Cloud VMs stay asleep until a command or message wakes them.
	for (const session of sessionWorkspaces()) {
		const target = executionTargets.session(session.id);
		if (target.target === "docker" && session.path && !session.archivedAt) {
			void executionTargets.ensure(session.id, { workspace: session.path, repository: session.repository }).catch(() => undefined);
		}
	}

	function prepareWorktree(session: Conversation) {
		const workspace = session.workspace;
		if (workspace?.kind !== "worktree" || workspace.status !== "ready" || !workspace.path || !session.projectId) return;
		if (scriptRunner.state(session.id, "setup").status !== "idle") return;
		const project = host.projects().find(item => item?.id === session.projectId);
		if (!project?.repository) return;
		const effective = scripts.effective(project.id, project.repository);
		const copied = effective.copy.length ? copyIntoWorktree(project.repository, workspace.path, effective.copy) : [];
		if (!effective.setup) return;
		// A Docker session runs setup inside its container, so wait until the container is up.
		const ready = executionTargets.isDocker(session.id)
			? executionTargets.ensure(session.id, { workspace: workspace.path, repository: workspace.repository })
			: Promise.resolve(null);
		void ready
			.then(() => scriptRunner.start(session.id, "setup", effective.setup, workspace.path!, { ADE_PROJECT_ROOT: project.repository! }))
			.then(state => { if (copied.length) state.output = `Copied from the project: ${copied.join(", ")}\n\n${state.output}`; })
			.catch(() => undefined);
	}
	/**
	 * Send a message to a session's agent the way the composer does: snapshot the workspace for
	 * rewinding, then hand it to Claude Code / Codex or the ADE agent.
	 */
	async function sendToAgent(sessionId: string, content: string, options: { id?: string; provider?: string; model?: string; reasoning?: string; async?: boolean } = { async: true }) {
		// Once today's budget is spent, nothing new starts (automations and hand-backs included).
		limitGuard.assertCanStart();
		const workspace = host.getWorkspacePath(sessionId);
		if (workspace) {
			await executionTargets.wakeIfSleeping(sessionId, { workspace }).catch(() => undefined);
			await checkpoints.create(sessionId, workspace, content).catch(() => null);
		}
		inbox.invalidate(sessionId);
		if (engines.get(sessionId)) {
			if (!workspace) throw Object.assign(new Error("Session has no ready workspace."), { statusCode: 404 });
			const engine = engines.get(sessionId)!.engine;
			engines.send(sessionId, workspace, content, host.approvals.policy(sessionId), null, cliMcpConfig(sessionId, workspace, engine));
			return viewSession(sessionId);
		}
		return host.send("coding", { ...options, content }, sessionId);
	}

	const unsubscribers: Array<() => void> = [];
	const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
	const subscribeEvent = (listener: Parameters<NonNullable<typeof host.events>["subscribe"]>[0]) => {
		const unsub = host.events?.subscribe?.(listener);
		if (typeof unsub === "function") unsubscribers.push(unsub);
	};
	const scheduleOnce = (fn: () => void, ms: number) => {
		const timer = setTimeout(() => {
			pendingTimers.delete(timer);
			fn();
		}, ms);
		timer.unref?.();
		pendingTimers.add(timer);
	};

	// Hook: after an agent turn ends, run the project's check command (lint, typecheck, tests) in the
	// workspace. With auto-fix on, a failing check goes back to the agent, at most twice in a row.
	// Slack notifications (R14): turn finished or failed, approval needed, automation started.
	const lastNotified = new Map<string, number>();
	const notify = (event: keyof SlackEvents, sessionId: string, describe: (label: string, project: string) => string) => {
		if (!integrations.wants(event)) return;
		const key = `${sessionId}:${event}`;
		if (Date.now() - (lastNotified.get(key) ?? 0) < 30_000) return;
		lastNotified.set(key, Date.now());
		const session = viewSession(sessionId);
		if (!session || session.id === "coding" || session.id === "personal") return;
		const project = host.projects?.().find(item => item?.id === session.projectId)?.name ?? "No project";
		void integrations.notify(describe(session.label, project)).catch(() => undefined);
	};
	subscribeEvent(event => {
		if (event.type === "approval.requested" && event.sessionId) notify("needsApproval", event.sessionId, (label, project) => `⏸ *${label}* (${project}) is waiting for your approval in ADE.`);
		// A blueprint stage waits for Approve / Request changes.
		if (event.type === "stages.update" && event.sessionId) {
			inbox.invalidate(event.sessionId);
			const stage = (event.payload as { summary?: { stage?: { name: string; status: string } } | null } | null)?.summary?.stage;
			if (stage?.status === "awaiting_approval") notify("needsApproval", event.sessionId, (label, project) => `⏸ *${label}* (${project}): stage “${stage.name}” is ready for your approval in ADE.`);
		}
	});

	const agentBusy = new Map<string, boolean>();
	const autoFixStreak = new Map<string, number>();
	function runCheck(sessionId: string) {
		const session = viewSession(sessionId);
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
	// Stage checks: when the agent finishes a stage that has checks (build, lint, test…), ADE runs them
	// itself in the session's workspace (with the same runner as the project's check script, so the
	// output also shows in Run) and refuses the stage while one fails. See stage-checks.ts.
	const runOneCheck = async (sessionId: string, workspace: string, command: string, env: Record<string, string>) => {
		const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
		// An earlier check (after a turn, or another stage's) may still be running: let it finish first.
		for (let waited = 0; scriptRunner.state(sessionId, "check").status === "running" && waited < 300_000; waited += 500) await sleep(500);
		if (scriptRunner.state(sessionId, "check").status === "running") return { exitCode: 1, output: "Another check was still running after 5 minutes." };
		let finished!: (result: { exitCode: number | null; output: string }) => void;
		const done = new Promise<{ exitCode: number | null; output: string }>(resolveDone => { finished = resolveDone; });
		const timer = setTimeout(() => scriptRunner.stop(sessionId, "check"), 10 * 60_000);
		timer.unref?.();
		try {
			await scriptRunner.start(sessionId, "check", command, workspace, env, state => {
				clearTimeout(timer);
				finished({ exitCode: state.status === "stopped" ? 1 : state.exitCode, output: state.status === "stopped" ? `${state.output}\nStopped: the check ran longer than 10 minutes.` : state.output });
			});
		} catch (error) {
			clearTimeout(timer);
			finished({ exitCode: 1, output: error instanceof Error ? error.message : String(error) });
		}
		return done;
	};
	host.blueprints?.setChecker(async (sessionId, stage) => {
		const workspace = host.getWorkspacePath(sessionId);
		const session = viewSession(sessionId);
		if (!workspace || !session) return null;
		const project = session.projectId ? host.projects().find(item => item?.id === session.projectId) : null;
		const projectCheck = project ? scripts.effective(project.id, project.repository).check : "";
		let packageScripts: Record<string, string> | null = null;
		try {
			const parsed = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as { scripts?: Record<string, string> };
			packageScripts = parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : null;
		} catch {
			packageScripts = null;
		}
		const plan = resolveChecks({ words: stage.deterministicChecks ?? [], projectCheck, packageScripts, packageManager: packageManagerFor({ has: name => existsSync(join(workspace, name)) }) });
		const env: Record<string, string> = project?.repository ? { ADE_PROJECT_ROOT: project.repository } : {};
		return runChecks(plan, command => runOneCheck(sessionId, workspace, command, env));
	});

	subscribeEvent(event => {
		if (event.type !== "timeline.update" || !event.sessionId) return;
		const payload = event.payload as { busy?: unknown; isSubagent?: unknown } | null;
		if (!payload || payload.isSubagent) return;
		const was = agentBusy.get(event.sessionId) ?? false;
		const now = Boolean(payload.busy);
		agentBusy.set(event.sessionId, now);
		if (!was && now) {
			limitGuard.started(event.sessionId);
			usageWaiter.cancel(event.sessionId);
		}
		if (was && !now) {
			limitGuard.finished(event.sessionId);
			afterRun(event.sessionId);
		}
		if (now) limitGuard.check(event.sessionId);
		if (was && !now) {
			runCheck(event.sessionId);
			const sessionId = event.sessionId;
			// A stage was finished and the agent stopped before starting the next: start it.
			scheduleOnce(() => {
				try {
					const nudge = host.blueprints.takeAutoAdvance(sessionId);
					if (!nudge || limitGuard.stopped(sessionId) || usageWaiter.waiting(sessionId) || viewSession(sessionId)?.lastTurnStatus !== "completed") return;
					void sendToAgent(sessionId, nudge, { async: true }).catch(() => undefined);
				} catch {
					// The runtime may be shutting down.
				}
			}, 600);
			// Give the turn's final status a moment to be stored before reading it.
			if (integrations.wants("finished") || integrations.wants("failed")) {
				scheduleOnce(() => {
					try {
						const failed = viewSession(sessionId)?.lastTurnStatus === "failed";
						if (failed) notify("failed", sessionId, (label, project) => `❌ *${label}* (${project}): the agent's turn failed.`);
						else notify("finished", sessionId, (label, project) => `✅ *${label}* (${project}) is done and ready to review.`);
					} catch {
						// The runtime may be shutting down.
					}
				}, 1500);
			}
		}
	});

	/** Every agent reports its running token/cost totals with each timeline update; keep a ledger of them. */
	const usage = new UsageTracker(stateDirectory);
	// Limits for unattended work: stop a task that runs too long or costs too much, and stop
	// everything once the day's budget is spent (Settings → Agents & permissions).
	const limitGuard = new LimitGuard(stateDirectory, {
		sessionCost: id => usage.sessionCost(id),
		todayCost: () => usage.todayCost(),
		stop: id => {
			if (engines.get(id)) engines.abort(id);
			else void Promise.resolve(host.abortSession?.(id)).catch(() => undefined);
			engines.abortMatching(`sub-${id}-`);
			scheduler.cancelMatching(subagentKey(id, ""));
		},
		notify: (id, stop) => {
			host.events?.emit?.("sessions.changed", { id, limit: stop });
			notify("failed", id, (label, project) => `⏹ *${label}* (${project}): ${stop.reason}`);
		},
	});
	limitGuard.start();

	// Usage limits: when the provider says "limit reached", continue on the fallback model if one is
	// set, otherwise wait for the reset and tell the agent to continue (overnight work keeps going).
	const resumeSubagent = new Map<string, (resumed: boolean) => void>();
	const usageWaiter = new UsageLimitWaiter({
		fallback: () => {
			const { fallbackProvider, fallbackModel } = limitGuard.get();
			return fallbackProvider && fallbackModel ? { provider: fallbackProvider, model: fallbackModel } : null;
		},
		resume: (id, model) => {
			if (id.startsWith("sub-")) {
				const state = engines.get(id);
				const resolveResume = resumeSubagent.get(id);
				resumeSubagent.delete(id);
				try {
					const parent = state?.parent;
					if (!parent?.cwd) throw new Error("gone");
					void scheduler.submit(id, () => engines.send(id, parent.cwd!, CONTINUE_PROMPT, host.approvals.policy(parent.sessionId), subagentModel(state!.engine), cliMcpConfig(parent.sessionId, parent.cwd!, state!.engine)), countsHere(parent.sessionId)).then(started => resolveResume?.(started));
				} catch {
					resolveResume?.(false);
				}
				return;
			}
			const last = host.latestTurn?.(id);
			void sendToAgent(id, CONTINUE_PROMPT, { async: true, ...(model ? { provider: model.provider, model: model.model } : {}), ...(last?.reasoning ? { reasoning: last.reasoning } : {}) }).catch(() => undefined);
		},
		notify: (id, wait, message) => {
			if (id.startsWith("sub-")) {
				if (!wait) {
					resumeSubagent.get(id)?.(false);
					resumeSubagent.delete(id);
				}
				const parent = engines.get(id)?.parent;
				if (parent) host.events?.emit?.("subagents.update", { sessionId: parent.sessionId, subagentId: parent.conversationId, busy: false, usageWait: wait }, parent.sessionId);
				return;
			}
			host.events?.emit?.("sessions.changed", { id, usageWait: wait });
			if (message) notify("failed", id, (label, project) => `⏳ *${label}* (${project}): ${message}`);
		},
	});
	/** The error text of an engine's last run (Claude Code / Codex). */
	const engineFailure = (key: string) => (engines.get(key)?.items ?? []).slice(-3).map(item => item.kind === "error" ? item.message : item.kind === "assistant" ? item.text : "").join("\n");
	/** A session's agent finished: on a usage limit, wait or fall back; otherwise reset the count. */
	function afterRun(sessionId: string) {
		// Give the turn's final status a moment to be stored before reading it.
		scheduleOnce(() => {
			try {
				if (limitGuard.stopped(sessionId)) return;
				const engine = engines.get(sessionId);
				if (engine) {
					if (engine.lastStatus === "failed" && usageWaiter.failed(sessionId, engineFailure(sessionId), null, { fallback: false })) return;
				} else {
					const turn = host.latestTurn?.(sessionId);
					if (turn?.status === "failed" && usageWaiter.failed(sessionId, turn.error ?? "", turn.provider ? { provider: turn.provider, model: turn.model } : null)) return;
				}
				usageWaiter.succeeded(sessionId);
			} catch {
				// The runtime may be shutting down.
			}
		}, 1000);
	}
	const projectOf = new Map<string, string | null>();
	subscribeEvent(event => {
		if (event.type !== "timeline.update" || !event.sessionId) return;
		const payload = event.payload as { conversationId?: unknown; usage?: unknown } | null;
		if (!payload?.usage) return;
		if (!projectOf.has(event.sessionId)) {
			const session = typeof host.getSession === "function"
				? host.getSession(event.sessionId)
				: host.sessions?.().find(item => item.id === event.sessionId);
			projectOf.set(event.sessionId, session?.projectId ?? null);
		}
		usage.record(event.sessionId, String(payload.conversationId ?? "0"), payload.usage, projectOf.get(event.sessionId) ?? null);
	});
	// Claude Code / Codex sessions keep their totals on disk; count any that predate the ledger.
	for (const session of host.sessions?.() ?? []) {
		const engine = engines.get(session.id);
		if (engine) usage.record(session.id, "0", engine.usage, session.projectId ?? null);
	}
	// Subagents on other harnesses. The main agent is always Pi Durable; its subagents can run on
	// Pi (any model), Claude Code or Codex, as the user allows (Settings → Subagents).
	const subagentPolicies = new SubagentPolicyStore(stateDirectory);
	const subagentKey = (sessionId: string, conversationId: string) => `sub-${sessionId}-${conversationId}`.replace(/[^\w-]/g, "");
	// Heavy subagents start when this machine has room (Settings → Agents & permissions → subagents at once).
	const scheduler = new SubagentScheduler({
		settings: () => ({ maxConcurrent: limitGuard.get().maxSubagents }),
		onChange: key => {
			const parent = engines.get(key)?.parent;
			if (parent) host.events?.emit?.("subagents.update", { sessionId: parent.sessionId, subagentId: parent.conversationId, busy: engines.isWorking(key), queued: scheduler.position(key) }, parent.sessionId);
		},
	});
	scheduler.start();
	/** Runs on this machine's memory: here, in Docker or in WSL2 (not on an SSH host or Cloud VM). */
	const countsHere = (sessionId: string) => !["ssh", "boat", "cloud"].includes(sessionTarget(sessionId));
	const subagentStarts = new Map<string, Promise<boolean>>();
	const cleanupSessionState = (sessionId: string) => {
		agentBusy.delete(sessionId);
		autoFixStreak.delete(sessionId);
		projectOf.delete(sessionId);
		usageWaiter.cancel(sessionId);
		limitGuard.finished(sessionId);
		const notifyPrefix = `${sessionId}:`;
		for (const key of [...lastNotified.keys()]) {
			if (key.startsWith(notifyPrefix)) lastNotified.delete(key);
		}
		const subPrefix = subagentKey(sessionId, "");
		for (const key of [...subagentStarts.keys()]) {
			if (key.startsWith(subPrefix)) subagentStarts.delete(key);
		}
		for (const [key, resolveResume] of [...resumeSubagent.entries()]) {
			if (key.startsWith(subPrefix)) {
				resumeSubagent.delete(key);
				resolveResume(false);
			}
		}
		scheduler.cancelMatching(subPrefix);
	};
	subscribeEvent(event => {
		if (event.type !== "sessions.changed") return;
		const payload = event.payload as { id?: unknown; archivedAt?: unknown; deleted?: unknown } | null;
		const id = payload?.id;
		if (typeof id === "string") {
			if (id.startsWith("sub-") && !engines.isWorking(id)) {
				scheduler.finished(id);
				subagentStarts.delete(id);
			}
			if (payload?.deleted === true || (typeof payload?.archivedAt === "number" && payload.archivedAt > 0)) {
				cleanupSessionState(id);
			}
		}
	});
	const subagentModel = (engine: string) => {
		const policy = subagentPolicies.get();
		return (engine === "claude-code" ? policy.claudeModel : policy.codexModel) || null;
	};
	setExternalSubagentRunner({
		installed(sessionId) {
			const set = new Set<SubagentHarness>(["pi"]);
			for (const engine of engines.available()) {
				if ((engine.id === "claude-code" || engine.id === "codex") && engine.available) set.add(engine.id);
			}
			// On a container, VM or WSL, ADE installs the CLI there with npm when it's first used.
			if (sessionTarget(sessionId) !== "local") { set.add("claude-code"); set.add("codex"); }
			return set;
		},
		start({ sessionId, conversationId, harness, cwd, task, readOnly }) {
			const key = subagentKey(sessionId, conversationId);
			const existing = engines.get(key);
			if (engines.isWorking(key) || existing?.lastStatus === "completed") return;
			if (scheduler.position(key)) return;
			engines.setEngine(key, harness, { sessionId, conversationId, cwd });
			// A read-only subagent can't change files; others follow the session's approval setting.
			const approval = readOnly ? "ask" : host.approvals.policy(sessionId);
			const prompt = existing?.items.length ? "ADE restarted while you were working. Continue the task where you left off, then give your report." : task;
			subagentStarts.set(key, scheduler.submit(key, () => engines.send(key, cwd, prompt, approval, subagentModel(harness), cliMcpConfig(sessionId, cwd, harness)), countsHere(sessionId)));
		},
		message(sessionId, conversationId, text) {
			const key = subagentKey(sessionId, conversationId);
			const state = engines.get(key);
			const parent = state?.parent;
			if (!parent?.cwd) throw Object.assign(new Error("That subagent isn't available anymore."), { statusCode: 404 });
			if (scheduler.position(key)) throw Object.assign(new Error("That subagent is still queued; it gets your task when it starts."), { statusCode: 409 });
			usageWaiter.cancel(key);
			subagentStarts.set(key, scheduler.submit(key, () => engines.send(key, parent.cwd!, text, host.approvals.policy(sessionId), subagentModel(state!.engine), cliMcpConfig(sessionId, parent.cwd!, state!.engine)), countsHere(sessionId)));
		},
		// A subagent that hits a usage limit waits for the reset and continues; the main agent keeps waiting for its report.
		async wait(sessionId, conversationId) {
			const key = subagentKey(sessionId, conversationId);
			// Queued: wait for its turn first (false = stopped before it started).
			const started = subagentStarts.get(key);
			if (started && !await started) return { status: "failed" as const, text: "Stopped before it started." };
			for (;;) {
				const result = await engines.waitFor(key);
				if (result.status !== "failed" || limitGuard.stopped(sessionId)) {
					if (result.status !== "failed") usageWaiter.succeeded(key);
					return result;
				}
				const resumed = new Promise<boolean>(resolveResume => resumeSubagent.set(key, resolveResume));
				if (!usageWaiter.failed(key, engineFailure(key), null, { fallback: false })) {
					resumeSubagent.delete(key);
					return result;
				}
				if (!await resumed) return result;
			}
		},
		stop: (sessionId, conversationId) => {
			const key = subagentKey(sessionId, conversationId);
			usageWaiter.cancel(key);
			if (scheduler.cancel(key)) return true;
			return engines.abort(key).ok;
		},
	}, () => subagentPolicies.get());

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
			notify("automations", sessionId, (label, project) => `🤖 Automation started *${label}* (${project}).`);
		},
	});
	executionTargets.startIdleSweep(60_000, sessionId => Boolean(agentBusy.get(sessionId)));
	const dispose = () => {
		for (const unsub of unsubscribers.splice(0)) unsub();
		for (const timer of pendingTimers) clearTimeout(timer);
		pendingTimers.clear();
		executionTargets.stopIdleSweep();
		limitGuard.stopTimer();
		scheduler.stop();
		usageWaiter.stop();
		scriptRunner.stopAll();
		engines.abortAll();
		usage.flush();
		automationRunner.stop();
		for (const resolveResume of resumeSubagent.values()) resolveResume(false);
		resumeSubagent.clear();
		lastNotified.clear();
		agentBusy.clear();
		autoFixStreak.clear();
		projectOf.clear();
		subagentStarts.clear();
	};
	return { inbox, scripts, scriptRunner, checkpoints, engines, viewSessions, prepareWorktree, usage, secrets, sendToAgent, runCheck, automations, automationRunner, integrations, executionTargets, subagentPolicies, subagentKey, limitGuard, usageWaiter, scheduler, dispose };
}
