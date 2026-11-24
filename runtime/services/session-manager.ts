import { existsSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, LiveDoc, ROOT_CONVERSATION_ID, UsageDoc } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { ApprovalManager } from "../approvals.ts";
import type { ArtifactManager } from "../artifacts.ts";
import { createBrowserTools, type BrowserManager } from "../browser.ts";
import { createWorkspaceTools } from "../coding-tools.ts";
import type { ChatThreadStore } from "../db/chat-thread-store.ts";
import type { ProjectStore } from "../db/project-store.ts";
import type { TaskStore } from "../db/task-store.ts";
import type { TurnStore } from "../db/turn-store.ts";
import {
	MODES,
	plainText,
	toConversationId,
	type ConversationIdParam,
	type ModelConfigResult,
	type OpenSession,
	type SessionMode,
	type WatchHandle,
	type WatchViewLike,
} from "../db/types.ts";
import type { RuntimeEventBus } from "../events.ts";
import { badRequest, conflict, notFound } from "../http-error.ts";
import { logger } from "../log.ts";
import type { McpManager } from "../mcp.ts";
import { createSearchTools } from "../search-tools.ts";
import { createShellTools, type ProcessManager } from "../shell-tools.ts";
import { buildSkillsAndRulesPrompt, createSkillsExtension, discoverSkillsAndRules } from "../skills.ts";
import { createSubagentTools } from "../subagents.ts";
import type { SessionBlueprints } from "../session-blueprints.ts";
import { TEAM_INSTRUCTIONS, type TeamBoard } from "../team-board.ts";
import { createTeamTools } from "../team-tools.ts";
import {
	projectTimeline,
	type ConversationTimelineSnapshot,
	type LiveStateLike,
	type TimelineEntryLike,
	type UsageLike,
} from "../timeline.ts";
import type { WorktreeManager } from "../worktrees.ts";

export class SessionManager {
	#stateDirectory: string;
	#events: RuntimeEventBus;
	#approvals: ApprovalManager;
	#processes: ProcessManager;
	#artifacts: ArtifactManager;
	#browser: BrowserManager;
	#mcp: McpManager;
	#projects: ProjectStore;
	#tasks: TaskStore;
	#chats: ChatThreadStore;
	#turns: TurnStore;
	#worktreeManager?: WorktreeManager;
	#safeErrorMessage: (error: unknown) => string;
	#blueprints?: SessionBlueprints;
	#team?: TeamBoard;
	#sessions = new Map<string, OpenSession>();
	#opening = new Map<string, Promise<OpenSession>>();
	#watches = new Map<string, WatchHandle>();

	constructor(opts: {
		stateDirectory: string;
		events: RuntimeEventBus;
		approvals: ApprovalManager;
		processes: ProcessManager;
		artifacts: ArtifactManager;
		browser: BrowserManager;
		mcp: McpManager;
		projects: ProjectStore;
		tasks: TaskStore;
		chats: ChatThreadStore;
		turns: TurnStore;
		worktreeManager?: WorktreeManager;
		safeErrorMessage: (error: unknown) => string;
		blueprints?: SessionBlueprints;
		team?: TeamBoard;
	}) {
		this.#stateDirectory = opts.stateDirectory;
		this.#events = opts.events;
		this.#approvals = opts.approvals;
		this.#processes = opts.processes;
		this.#artifacts = opts.artifacts;
		this.#browser = opts.browser;
		this.#mcp = opts.mcp;
		this.#projects = opts.projects;
		this.#tasks = opts.tasks;
		this.#chats = opts.chats;
		this.#turns = opts.turns;
		this.#worktreeManager = opts.worktreeManager;
		this.#safeErrorMessage = opts.safeErrorMessage;
		this.#blueprints = opts.blueprints;
		this.#team = opts.team;
	}

	setWorktreeManager(manager: WorktreeManager): void {
		this.#worktreeManager = manager;
	}

	#sessionDbPath(sessionId: string): string | null {
		if (Object.hasOwn(MODES, sessionId)) return join(this.#stateDirectory, `${sessionId}.sqlite`);
		if (this.#tasks.exists(sessionId)) return join(this.#stateDirectory, `coding-task-${sessionId}.sqlite`);
		if (this.#chats.exists(sessionId)) return join(this.#stateDirectory, `chat-thread-${sessionId}.sqlite`);
		return null;
	}

	async watchConversation(sessionId: string, harness: Harness, conversationId: string | number, isSubagent: boolean): Promise<void> {
		const convKey = String(conversationId);
		const watchKey = `${sessionId}:${convKey}`;
		if (this.#watches.has(watchKey)) return;
		try {
			const conv = await harness.conversation(toConversationId(conversationId), context);
			if (!conv) return;
			const watch = await conv.watch(context, { min: 100, max: 200 });
			this.#watches.set(watchKey, watch);
			const emitView = (view: WatchViewLike | undefined) => {
				const snapshot = projectTimeline({
					sessionId,
					conversationId: convKey,
					entries: view?.entries ?? [],
					live: view?.docs?.["pi.live"] as LiveStateLike | undefined,
					usage: view?.docs?.["pi.usage"] as UsageLike | undefined,
				});
				this.#events.emit("timeline.update", { ...snapshot, isSubagent }, sessionId);
				if (isSubagent) {
					this.#events.emit("subagents.update", { sessionId, subagentId: convKey, busy: snapshot.busy }, sessionId);
				}
			};
			emitView(watch.value as unknown as WatchViewLike | undefined);
			watch.start(async (call) => {
				if (call.kind === "value") emitView(call.value as unknown as WatchViewLike | undefined);
			});
		} catch (error) {
			logger.warn("Failed to watch conversation; live timeline updates stopped", {
				error,
				sessionId,
				context: { conversationId: convKey, isSubagent },
			});
			this.#events.emit("sessions.changed", { sessionId, watchError: error instanceof Error ? error.message : String(error) }, sessionId);
		}
	}

	async openSession(
		mode: SessionMode,
		config: ModelConfigResult,
		modelId: string,
		reasoning: string,
		taskId: string | null,
		chatId: string | null,
	): Promise<OpenSession> {
		const key = chatId ?? taskId ?? mode;
		const task = taskId ? this.#tasks.get(taskId) ?? null : null;
		if (taskId) {
			if (!task || task.status !== "ready") throw new Error("The task workspace is unavailable.");
			await this.#tasks.verifyWorkspace(task);
		}
		const skillsCatalog = discoverSkillsAndRules(task?.workspace ?? null);
		const skillsPrompt = buildSkillsAndRulesPrompt(skillsCatalog);
		const baseInstructions = task
			? `You are ADE's coding lead inside an Agentic Development Environment. ${task.workspace ? "You have full workspace tools (list_files, read, write, edit, grep_search, find_files) and shell command tools (run_command, manage_process) in the bound workspace." : "This session has no bound local workspace: do not claim local file access."} You can spawn 1 or more parallel subagents using spawn_subagent (readonly, workspace, or isolated worktree mode; foreground or background) and coordinate with message_subagent, wait_subagent, list_subagents, and stop_subagent. You also have built-in browser tools (browser_navigate, browser_snapshot, browser_click, browser_type, browser_scroll, browser_screenshot, browser_eval, browser_open_external), structured artifact tools (write_artifact, update_tasks), and skills (read_skill). Keep responses concise and well-structured.`
			: MODES[mode].instructions;
		// The session's blueprint: which stage it's in and what to do there (none for Vibe).
		const stagePrompt = task ? this.#blueprints?.instructions(task.id) ?? null : null;
		// The team board: the main agent leads it (tasks, plans, answers); subagents work from it.
		const teamPrompt = task && this.#team ? `${TEAM_INSTRUCTIONS} You are the lead: when work splits into parts for subagents, put them on the task board first (team_tasks add, with an owner and what each waits for), then start the subagents; check team_read for questions and plans waiting for you, review done tasks, and send back what isn't right.` : null;
		const instructions = [baseInstructions, skillsPrompt, stagePrompt, teamPrompt].filter(Boolean).join("\n\n");
		const openSession = this.#sessions.get(key);
		const thinkingLevel = reasoning as "none" | "off" | "low" | "medium" | "high" | "xhigh" | "max";
		if (openSession) {
			await openSession.root.configure({
				model: { provider: config.provider, modelId },
				thinkingLevel: thinkingLevel as never,
				instructions,
			}, context);
			return openSession;
		}
		const inFlight = this.#opening.get(key);
		if (inFlight) {
			const session = await inFlight;
			await session.root.configure({
				model: { provider: config.provider, modelId },
				thinkingLevel: thinkingLevel as never,
				instructions,
			}, context);
			return session;
		}
		const openPromise = (async (): Promise<OpenSession> => {
			const registry = createRegistry();
			const identity = task?.workspace && task.workspaceDev && task.workspaceIno ? { dev: task.workspaceDev, ino: task.workspaceIno } : null;
			const workspaceExt = task?.workspace && identity ? createWorkspaceTools(task.workspace, identity) : null;
			const searchExt = task?.workspace && identity ? createSearchTools(task.workspace, identity) : null;
			const shellExt = task?.workspace && identity ? createShellTools({ sessionId: key, workspace: task.workspace, identity, processes: this.#processes }) : null;
			if (workspaceExt) registry.install(workspaceExt);
			if (searchExt) registry.install(searchExt);
			if (shellExt) registry.install(shellExt);
			const teamExt = task && this.#team ? createTeamTools({
				sessionId: key,
				board: this.#team,
				agents: async () => (await this.featureAgents(task.id)).map(agent => ({ id: String(agent.id), name: agent.name })),
			}) : null;
			if (teamExt) registry.install(teamExt);
			if (task) {
				const wsTools = workspaceExt?.tools ?? [];
				registry.install(createSubagentTools({
					sessionId: key,
					workspace: task.workspace ?? null,
					workspaceIdentity: identity,
					repository: task.repository ?? null,
					readTools: wsTools.filter(tool => ["read", "list_files"].includes(tool.name)),
					workspaceTools: wsTools,
					searchTools: searchExt?.tools ?? [],
					shellTools: shellExt?.tools ?? [],
					worktreeManager: this.#worktreeManager,
					processes: this.#processes,
					events: this.#events,
					teamTools: teamExt?.tools ?? [],
					onSubagentCreated: (convId) => {
						const current = this.#sessions.get(key);
						if (current) void this.watchConversation(key, current.harness, convId, true);
					},
				}));
			}
			if (task || mode === "coding") {
				registry.install(createBrowserTools(this.#browser));
			}
			registry.install(this.#artifacts.createExtension(key));
			if (task && this.#blueprints) registry.install(this.#blueprints.createExtension(key));
			registry.install(createSkillsExtension(task?.workspace ?? null));
			const mcpExt = this.#mcp.createExtension();
			if (mcpExt) registry.install(mcpExt);

			let harnessRef: Harness | null = null;
			registry.install(this.#approvals.createExtension(key, () => harnessRef));

			const workspaceDir = task?.workspace ?? undefined;
			const harness = await Harness.open(
				await openNodeSqliteStorage(join(this.#stateDirectory, chatId ? `chat-thread-${chatId}.sqlite` : task ? `coding-task-${taskId}.sqlite` : `${mode}.sqlite`)),
				{ models: config.models, registry, ...(workspaceDir ? { env: () => new NodeExecutionEnv({ cwd: workspaceDir }) } : {}) },
				context,
			);
			harnessRef = harness;
			try {
				const root = await harness.root(context, {
					agent: {
						model: { provider: config.provider, modelId },
						thinkingLevel: thinkingLevel as never,
						instructions,
					},
				});
				await root.configure({
					model: { provider: config.provider, modelId },
					thinkingLevel: thinkingLevel as never,
					instructions,
				}, context);
				const session: OpenSession = { harness, root };
				this.#sessions.set(key, session);
				harness.resume();
				await this.watchConversation(key, harness, ROOT_CONVERSATION_ID, false);
				return session;
			} catch (error) {
				await harness.close(context);
				throw error;
			}
		})();
		this.#opening.set(key, openPromise);
		try {
			return await openPromise;
		} finally {
			if (this.#opening.get(key) === openPromise) this.#opening.delete(key);
		}
	}

	/** Stop watches and close the open Harness for an archived or deleted session. */
	async evict(id: string): Promise<void> {
		const pending = this.#opening.get(id);
		if (pending) {
			await pending.catch(() => undefined);
		}
		const prefix = `${id}:`;
		for (const [watchKey, watch] of [...this.#watches.entries()]) {
			if (!watchKey.startsWith(prefix)) continue;
			this.#watches.delete(watchKey);
			try {
				await watch.stop();
			} catch (error) {
				logger.debug("Failed to stop conversation watch during session eviction", { error, sessionId: id });
			}
		}
		const session = this.#sessions.get(id);
		if (!session) return;
		this.#sessions.delete(id);
		try {
			await session.harness.close(context);
		} catch (error) {
			logger.debug("Failed to close session harness during eviction", { error, sessionId: id });
		}
	}

	async getTimeline(sessionId: string, conversationId?: string): Promise<ConversationTimelineSnapshot> {
		const open = this.#sessions.get(sessionId);
		const dbPath = this.#sessionDbPath(sessionId);
		const targetId: ConversationIdParam = conversationId !== undefined ? toConversationId(conversationId) : ROOT_CONVERSATION_ID;
		if (!open && (!dbPath || !existsSync(dbPath))) {
			return { sessionId, conversationId: String(targetId), busy: false, items: [], liveTools: [], runFailure: null, usage: null };
		}
		const ownReader = !open;
		const harness = open?.harness ?? await Harness.open(
			await openNodeSqliteStorage(dbPath!),
			{ models: createModels(), registry: createRegistry(), readOnly: true },
			context,
		);
		try {
			const conv = await harness.conversation(targetId, context);
			if (!conv) {
				return { sessionId, conversationId: String(targetId), busy: false, items: [], liveTools: [], runFailure: null, usage: null };
			}
			const { items: entries } = await conv.entries({ order: "ascending" }, 400, undefined, context);
			const live = (await harness.snapshot(LiveDoc, targetId, context)) as LiveStateLike | undefined;
			const usage = (await harness.snapshot(UsageDoc, targetId, context)) as UsageLike | undefined;
			return projectTimeline({ sessionId, conversationId: String(targetId), entries: entries as unknown as TimelineEntryLike[], live, usage });
		} finally {
			if (ownReader) await harness.close(context);
		}
	}

	async steerOrFollowUp(sessionId: string, content: string, mode: "steer" | "follow-up" = "steer"): Promise<{ ok: boolean; mode: string }> {
		const trimmed = typeof content === "string" ? content.trim() : "";
		if (!trimmed || trimmed.length > 8000) throw badRequest("Enter a message between 1 and 8000 characters.");
		const open = this.#sessions.get(sessionId);
		if (!open) throw conflict("Session is not currently active.");
		const whenBusy = mode === "steer" ? "steer" : "followUp";
		await open.root.submit({ type: "input", content: trimmed, whenBusy }, context);
		this.#events.emit("sessions.changed", { sessionId }, sessionId);
		return { ok: true, mode };
	}

	async abortSession(sessionId: string): Promise<{ ok: boolean }> {
		const open = this.#sessions.get(sessionId);
		if (!open) return { ok: true };
		await open.root.abort(context);
		this.#events.emit("sessions.changed", { sessionId }, sessionId);
		return { ok: true };
	}

	async compactSession(sessionId: string, instructions?: string): Promise<{ ok: boolean }> {
		const open = this.#sessions.get(sessionId);
		if (!open) throw conflict("Open or send a message in this session before compacting.");
		await open.root.compact(instructions, context);
		return { ok: true };
	}

	async messageSubagent(sessionId: string, subagentId: string, message: string, mode: "steer" | "follow-up" = "follow-up"): Promise<{ ok: boolean }> {
		const trimmed = typeof message === "string" ? message.trim() : "";
		if (!trimmed) throw badRequest("Provide a message for the subagent.");
		const open = this.#sessions.get(sessionId);
		if (!open) throw conflict("Session is not currently open.");
		const convId = toConversationId(subagentId);
		const conv = await open.harness.conversation(convId, context);
		if (!conv) throw notFound("Subagent not found.");
		await this.watchConversation(sessionId, open.harness, convId, true);
		const whenBusy = mode === "steer" ? "steer" : "followUp";
		await conv.submit({ type: "input", content: trimmed, whenBusy }, context);
		this.#events.emit("subagents.update", { sessionId, subagentId: String(convId) }, sessionId);
		return { ok: true };
	}

	async stopSubagent(sessionId: string, subagentId: string): Promise<{ ok: boolean }> {
		const open = this.#sessions.get(sessionId);
		if (!open) return { ok: true };
		const convId = toConversationId(subagentId);
		const conv = await open.harness.conversation(convId, context);
		if (!conv) throw notFound("Subagent not found.");
		await conv.abort(context);
		this.#events.emit("subagents.update", { sessionId, subagentId: String(convId) }, sessionId);
		return { ok: true };
	}

	async featureAgents(taskId: string) {
		const task = this.#tasks.get(taskId);
		if (!task) throw notFound("Feature not found.");
		const path = join(this.#stateDirectory, `coding-task-${taskId}.sqlite`);
		let harness = this.#sessions.get(taskId)?.harness;
		if (!harness && !existsSync(path)) {
			if (this.#turns.hasAnyForTask(taskId)) {
				throw new Error("The session's durable activity database is unavailable.");
			}
			return [];
		}
		const ownReader = !harness;
		if (ownReader) harness = await Harness.open(await openNodeSqliteStorage(path), { models: createModels(), registry: createRegistry(), readOnly: true }, context);
		if (!harness) return [];
		try {
			const live = await harness.inspect(context);
			const agents = [];
			let cursor: Parameters<Parameters<Harness["commit"]>[0]>[0] extends { scanConversations: (f: never, l: number, c?: infer C) => unknown } ? C | undefined : undefined;
			do {
				const page = await harness.commit(tx => tx.scanConversations({}, 100, cursor), context);
				for (const record of page.items) {
					if (record.id === ROOT_CONVERSATION_ID) continue;
					const conversation = await harness.conversation(record.id, context);
					if (!conversation) continue;
					const transcript = await conversation.context(context);
					const entries = await harness.commit(tx => tx.scanEntries({ conversationId: record.id, order: "ascending" }, 20), context);
					const metadata = entries.items.find(entry => entry.kind === "ade.assignment")?.data as {
						name?: string;
						role?: string;
						mode?: string;
						background?: boolean;
						workspacePath?: string | null;
						branch?: string | null;
						createdAt?: number;
						task?: string;
						harness?: string;
					} | undefined;
					if (!record.owner && !metadata) continue;
					const latest = record.owner
						? await harness.commit(tx => tx.submissionByRequest(record.id, `ade-delegate:${record.owner!.taskId}`), context)
						: null;
					const tasks = live.tasks.filter(item => item.record.conversationId === record.id);
					const pending = live.submissions.some(item => item.conversationId === record.id);
					const liveDoc = await harness.snapshot(LiveDoc, record.id, context);
					const { items: rawEntries } = await conversation.entries({ order: "ascending" }, 200, undefined, context);
					const timeline = projectTimeline({ sessionId: taskId, conversationId: String(record.id), entries: rawEntries as unknown as TimelineEntryLike[], live: liveDoc as LiveStateLike | undefined });
					const hasAssistantReply = transcript.messages.some((m) => m.role === "assistant" && plainText(m.content).trim());
					const status = ownReader && (tasks.length || pending) ? "unknown"
						: tasks.some(item => item.state.kind === "blocked") ? "blocked"
						: tasks.some(item => item.state.kind === "running") || Boolean(liveDoc?.run) ? "running"
							: tasks.length || pending ? "waiting"
							: latest?.status === "unanswered" || liveDoc?.runFailure ? "failed"
							: latest?.status === "done" || hasAssistantReply ? "completed" : "unknown";
					const agent = await conversation.agent(context);
					agents.push({
						id: record.id,
						parentId: record.owner?.conversationId ?? ROOT_CONVERSATION_ID,
						assignmentId: record.owner?.taskId ?? record.id,
						name: metadata?.name ?? "Subagent",
						role: metadata?.role ?? "Subagent",
						mode: metadata?.mode ?? "readonly",
						background: Boolean(metadata?.background),
						workspacePath: metadata?.workspacePath ?? null,
						branch: metadata?.branch ?? null,
						createdAt: metadata?.createdAt ?? Date.now(),
						assignment: metadata?.task ?? "",
						harness: metadata?.harness ?? "pi",
						status,
						model: agent.model?.modelId ?? null,
						reasoning: agent.thinkingLevel,
						error: latest?.status === "unanswered" ? latest.reason : (liveDoc?.runFailure?.detail ?? liveDoc?.runFailure?.reason ?? null),
						liveTools: timeline.liveTools,
						timeline: timeline.items,
						messages: transcript.messages.filter(message => ["user", "assistant"].includes(message.role))
							.map((message, index) => ({ id: `${record.id}:${index}`, role: message.role, content: plainText(message.content) }))
							.filter(message => message.content),
					});
				}
				cursor = page.next;
			} while (cursor);
			return agents;
		} finally {
			if (ownReader) await harness.close(context);
		}
	}

	async projectAgents(projectId: string) {
		if (!this.#projects.exists(projectId)) throw notFound("Project not found.");
		const sessions = this.#tasks.listForProject(projectId);
		const agents = [];
		const errors = [];
		for (const session of sessions) {
			try {
				for (const agent of await this.featureAgents(session.id)) {
					agents.push({ ...agent, sessionId: session.id, sessionName: session.title });
				}
			} catch (error) {
				errors.push({ sessionId: session.id, sessionName: session.title, message: this.#safeErrorMessage(error) });
			}
		}
		return { agents, errors, observedAt: Date.now() };
	}

	async close(): Promise<void> {
		for (const watch of this.#watches.values()) {
			try {
				await watch.stop();
			} catch (error) {
				logger.debug("Failed to stop conversation watch during host close", { error });
			}
		}
		this.#watches.clear();
		await Promise.all([...this.#sessions.values()].map(({ harness }) => harness.close(context)));
		this.#sessions.clear();
	}
}
