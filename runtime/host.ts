import type { DatabaseSync } from "node:sqlite";
import { ApprovalManager } from "./approvals.ts";
import { ArtifactManager } from "./artifacts.ts";
import { BrowserManager } from "./browser.ts";
import { ChatThreadStore } from "./db/chat-thread-store.ts";
import { ProjectStore, type SaveProjectInput } from "./db/project-store.ts";
import { openHostDatabase } from "./db/schema.ts";
import { TaskStore, type CreateCodingTaskInput } from "./db/task-store.ts";
import { TurnStore } from "./db/turn-store.ts";
import {
	detectGitHubRemoteFromCheckout,
	MODES,
	sessionBranchName,
	type SessionMode,
} from "./db/types.ts";
import { RuntimeEventBus } from "./events.ts";
import { badRequest, notFound } from "./http-error.ts";
import { McpManager } from "./mcp.ts";
import { CapabilitySettings } from "./capabilities.ts";
import { configureSkillCatalog } from "./skill-catalog.ts";
import { SkillLibrary } from "./skill-library.ts";
import { ModelConfigService, type ModelConfigFactory } from "./services/model-config-service.ts";
import { SessionManager } from "./services/session-manager.ts";
import { TurnExecutor } from "./services/turn-executor.ts";
import { ProcessManager } from "./shell-tools.ts";
import type { ConversationTimelineSnapshot } from "./timeline.ts";
import type { WorktreeManager } from "./worktrees.ts";
import { createStartFrom } from "./start-from.ts";
import { SessionBlueprints } from "./session-blueprints.ts";
import { EuPolicy, hostRegion } from "./eu-policy.ts";
import { ModelRouting } from "./model-routing.ts";
import { TeamBoard } from "./team-board.ts";

const startFromService = createStartFrom();

export { detectGitHubRemoteFromCheckout, sessionBranchName, type SessionMode };

export class LocalAgentHost {
	#db: DatabaseSync;
	#projects: ProjectStore;
	#turns: TurnStore;
	#tasks: TaskStore;
	#chats: ChatThreadStore;
	#models: ModelConfigService;
	#sessionManager: SessionManager;
	#turnExecutor: TurnExecutor;

	readonly events: RuntimeEventBus;
	readonly approvals: ApprovalManager;
	readonly processes: ProcessManager;
	readonly artifacts: ArtifactManager;
	readonly browser: BrowserManager;
	readonly mcp: McpManager;
	/** Which skills and MCP servers are on (globally and per project; on unless turned off). */
	readonly capabilities: CapabilitySettings;
	/** Skills from Git repositories and skills written in ADE. */
	readonly skillLibrary: SkillLibrary;
	/** Each session's way of working (Vibe or a blueprint) and its stage progress. */
	readonly blueprints: SessionBlueprints;
	/** EU-only mode: what may leave the EU (models, agent CLIs, tool servers). */
	readonly eu: EuPolicy;
	readonly routing: ModelRouting;
	/** Each session's team board: tasks, plans, posts, file claims and the flow events. */
	readonly team: TeamBoard;

	constructor({ stateDirectory, environment = process.env, modelConfigFactory, githubIssueFetcher = fetch, worktreeManager, skillsHome }: {
		stateDirectory: string;
		/** Home folder to look for skills and MCP configs in (tests point this at a temp folder). */
		skillsHome?: string;
		environment?: NodeJS.ProcessEnv;
		modelConfigFactory?: ModelConfigFactory;
		githubIssueFetcher?: typeof fetch;
		worktreeManager?: WorktreeManager;
	}) {
		if (!stateDirectory) throw new Error("A state directory is required");
		this.#db = openHostDatabase(stateDirectory);
		this.events = new RuntimeEventBus();
		this.approvals = new ApprovalManager(this.#db, this.events);
		this.processes = new ProcessManager(this.events);
		this.artifacts = new ArtifactManager(this.#db, this.events);
		this.browser = new BrowserManager(stateDirectory, this.events);
		this.capabilities = new CapabilitySettings(this.#db);
		this.skillLibrary = new SkillLibrary({ db: this.#db, home: skillsHome });
		// The catalog is module-wide; once this host is closed its database is too, so look no further than an empty list.
		configureSkillCatalog({ sources: () => { try { return this.skillLibrary.list(); } catch { return []; } }, home: skillsHome });
		this.mcp = new McpManager(this.#db, this.events, { capabilities: this.capabilities, home: skillsHome });

		this.blueprints = new SessionBlueprints(this.#db, this.events);
		this.approvals.setGate((sessionId, toolName, args, isLead) => this.blueprints.toolBlockReason(sessionId, toolName, args, isLead));
		this.blueprints.setWorkspace(sessionId => this.#tasks.getWorkspacePath(sessionId));
		this.team = new TeamBoard(stateDirectory, this.events);
		this.#models = new ModelConfigService({ db: this.#db, stateDirectory, environment, modelConfigFactory });
		this.eu = new EuPolicy(stateDirectory, () => this.#models.compatibleUrl());
		this.routing = new ModelRouting(async () => (await this.#models.modelCatalog()).providers.map(provider => ({ id: provider.id, configured: provider.configured, defaultModel: provider.defaultModel, models: provider.models })), this.eu);
		this.mcp.setGuard(server => this.eu.blockReason("mcp", server.id, server.transport === "http" && server.url ? hostRegion(server.url, false) : "local"));
		this.#projects = new ProjectStore(this.#db, githubIssueFetcher);
		this.#turns = new TurnStore(this.#db);
		this.#tasks = new TaskStore({
			db: this.#db,
			projects: this.#projects,
			turns: this.#turns,
			safeErrorMessage: (error) => this.safeErrorMessage(error),
		});
		this.#chats = new ChatThreadStore({
			db: this.#db,
			projects: this.#projects,
			tasks: this.#tasks,
			turns: this.#turns,
		});
		this.#sessionManager = new SessionManager({
			stateDirectory,
			events: this.events,
			approvals: this.approvals,
			processes: this.processes,
			artifacts: this.artifacts,
			browser: this.browser,
			mcp: this.mcp,
			projects: this.#projects,
			tasks: this.#tasks,
			chats: this.#chats,
			turns: this.#turns,
			worktreeManager,
			safeErrorMessage: (error) => this.safeErrorMessage(error),
			blueprints: this.blueprints,
			team: this.team,
			eu: this.eu,
			routing: this.routing,
			capabilities: this.capabilities,
		});
		this.#turnExecutor = new TurnExecutor({
			db: this.#db,
			events: this.events,
			tasks: this.#tasks,
			chats: this.#chats,
			turns: this.#turns,
			models: this.#models,
			sessions: this.#sessionManager,
			listSessions: () => this.sessions(),
			gateNote: taskId => this.blueprints.gateNote(taskId),
			guardProvider: provider => this.eu.guardProvider(provider),
		});
	}

	// --- Projects & GitHub ---

	projects() {
		return this.#projects.list();
	}

	saveProject(input: SaveProjectInput | null | undefined, id?: string) {
		return this.#projects.save(input, id);
	}

	deleteProject(id: string) {
		return this.#projects.delete(id);
	}

	async setProjectArchived(id: string, archived: boolean) {
		if (!this.#projects.get(id)) throw notFound("Project not found.");
		const sessions = [];
		if (archived) {
			for (const task of this.#tasks.listActiveIdsForProject(id)) {
				sessions.push(await this.setSessionArchived(task.id, true));
			}
		}
		const project = this.#projects.setArchivedTimestamp(id, archived ? Date.now() : null);
		return { project, sessions };
	}

	githubConnection() {
		return this.#projects.githubConnection();
	}

	githubAutoConnectEnabled() {
		return this.#projects.githubAutoConnectEnabled();
	}

	connectGitHub(login: unknown) {
		return this.#projects.connectGitHub(login);
	}

	disconnectGitHub() {
		return this.#projects.disconnectGitHub();
	}

	lookupGitHubIssue(projectId: unknown, url: unknown) {
		return this.#projects.lookupGitHubIssue(projectId, url);
	}

	// --- Sessions, Tasks & Chat Threads ---

	sessions() {
		const tasks = this.#tasks.list();
		const byId = new Map(tasks.map(task => [task.id, task]));
		return this.#turns.listSessions(
			tasks,
			this.#chats.list(),
			(id) => this.#turnExecutor.isActiveOrRecovering(id),
		).map(session => {
			const row = byId.get(session.id);
			const blueprint = row ? this.blueprints.summaryOf(row) : null;
			return blueprint ? { ...session, blueprint } : session;
		});
	}

	getSession(id: string) {
		const task = this.#tasks.get(id) ?? null;
		const chat = task ? null : (this.#chats.get(id) ?? null);
		const session = this.#turns.getSession(id, task, chat, (sid) => this.#turnExecutor.isActiveOrRecovering(sid));
		if (!session) return undefined;
		const blueprint = task ? this.blueprints.summaryOf(task) : null;
		return blueprint ? { ...session, blueprint } : session;
	}

	findProjectForCwd(cwd: string): string | null {
		return this.#tasks.findProjectForCwd(cwd);
	}

	listSessionWorkspaces() {
		return this.#tasks.listWorkspaces();
	}

	async createCodingTask(input: CreateCodingTaskInput | null | undefined, manager: WorktreeManager) {
		const id = await this.#tasks.create(input, manager, {
			isClosing: () => this.#turnExecutor.isClosing(),
			getCredentialRevision: () => this.#models.credentialRevision,
			isCredentialChangeBusy: () => this.#models.credentialChangeBusy,
			getModelConfig: (provider) => this.#models.getConfig(provider),
			resumeInitialTurn: (taskId, savedTurn, config) => this.#turnExecutor.resumeInitialTurn(taskId, savedTurn, config),
			prepareBranch: (repository, startFrom) => startFromService.prepare(repository, startFrom),
		});
		return this.getSession(id);
	}

	renameCodingTask(id: string, title: unknown) {
		this.#tasks.rename(id, title);
		return this.getSession(id);
	}

	deleteCodingTask(id: string) {
		const result = this.#tasks.delete(id);
		void this.#sessionManager.evict(id);
		this.events.emit("sessions.changed", { id, deleted: true });
		return result;
	}

	createChatThread(input: { id?: unknown; mode?: unknown } | null | undefined) {
		const id = this.#chats.create(input);
		return this.getSession(id);
	}

	renameChatThread(id: string, title: unknown) {
		this.#chats.rename(id, title);
		return this.getSession(id);
	}

	deleteChatThread(id: string) {
		const result = this.#chats.delete(id);
		void this.#sessionManager.evict(id);
		this.events.emit("sessions.changed", { id, deleted: true });
		return result;
	}

	async setSessionArchived(id: string, archived: boolean): Promise<{ id: string; archivedAt: number | null; workspace: string | null; repository: string | null; kind: string | null }> {
		if (Object.hasOwn(MODES, id)) throw badRequest("Built-in chats cannot be archived.");
		const task = this.#tasks.get(id);
		const chat = task ? null : this.#chats.get(id);
		if (!task && !chat) throw notFound("Session not found.");
		if (archived && this.#turnExecutor.isActiveOrRecovering(id)) await this.abortSession(id).catch(() => ({ ok: false }));
		if (archived) await this.#sessionManager.evict(id);
		const archivedAt = archived ? Date.now() : null;
		if (task) this.#tasks.setArchivedAt(id, archivedAt);
		else this.#chats.setArchivedAt(id, archivedAt);
		this.events.emit("sessions.changed", { id, archivedAt });
		return { id, archivedAt, workspace: task?.workspace ?? null, repository: task?.repository ?? null, kind: task?.kind ?? null };
	}

	forkSession(sourceId: string) {
		const newId = this.#chats.forkSession(sourceId);
		return this.getSession(newId);
	}

	moveSession(sourceId: string, opts: { mode?: "coding" | "personal"; projectId?: string | null }) {
		const id = this.#chats.moveSession(sourceId, opts);
		return this.getSession(id);
	}

	markWorktreeRemoved(id: string) {
		this.#tasks.markWorktreeRemoved(id);
	}

	removedWorktree(id: string) {
		return this.#tasks.removedWorktree(id);
	}

	markWorktreeRestored(id: string) {
		this.#tasks.markWorktreeRestored(id);
	}

	setWorktreeManager(manager: WorktreeManager): void {
		this.#sessionManager.setWorktreeManager(manager);
	}

	/** The turns the Inbox brief draws on: what was first asked, the last answer, and the latest turn. */
	turnsOverview(sessionId: string) {
		return {
			first: this.#turns.firstForSession(sessionId) ?? null,
			lastAnswered: this.#turns.latestCompletedForSession(sessionId) ?? null,
			latest: this.#turns.latestForSession(sessionId) ?? null,
		};
	}

	latestTurn(sessionId: string) {
		return this.#turns.latestForSession(sessionId) ?? null;
	}

	/** The project a session belongs to, if any. */
	sessionProjectId(sessionId: string): string | null {
		return this.#tasks.get(sessionId)?.projectId ?? null;
	}

	getWorkspacePath(sessionId: string): string | null {
		return this.#tasks.getWorkspacePath(sessionId);
	}

	getWorkspaceBase(sessionId: string): string | null {
		return this.#tasks.getWorkspaceBase(sessionId);
	}

	// --- Timeline, Subagents & Live Session Controls ---

	getTimeline(sessionId: string, conversationId?: string): Promise<ConversationTimelineSnapshot> {
		return this.#sessionManager.getTimeline(sessionId, conversationId);
	}

	steerOrFollowUp(sessionId: string, content: string, mode: "steer" | "follow-up" = "steer") {
		return this.#sessionManager.steerOrFollowUp(sessionId, content, mode);
	}

	abortSession(sessionId: string) {
		this.blueprints.cancelAutoAdvance(sessionId);
		return this.#sessionManager.abortSession(sessionId);
	}

	compactSession(sessionId: string, instructions?: string) {
		return this.#sessionManager.compactSession(sessionId, instructions);
	}

	messageSubagent(sessionId: string, subagentId: string, message: string, mode: "steer" | "follow-up" = "follow-up") {
		return this.#sessionManager.messageSubagent(sessionId, subagentId, message, mode);
	}

	stopSubagent(sessionId: string, subagentId: string) {
		return this.#sessionManager.stopSubagent(sessionId, subagentId);
	}

	featureAgents(taskId: string) {
		return this.#sessionManager.featureAgents(taskId);
	}

	projectAgents(projectId: string) {
		return this.#sessionManager.projectAgents(projectId);
	}

	// --- Models, Health & Credentials ---

	modelCatalog() {
		return this.#models.modelCatalog();
	}

	health(provider?: string) {
		return this.#models.health(provider);
	}

	copilotAuth(action: unknown) {
		return this.#models.copilotAuth(action, () => this.#turnExecutor.hasActive());
	}

	safeErrorMessage(error: unknown) {
		return this.#models.safeErrorMessage(error);
	}

	modelCredentials(input: { action?: unknown; provider?: unknown; key?: unknown; url?: unknown; model?: unknown } | null | undefined) {
		return this.#models.modelCredentials(input, {
			hasActive: () => this.#turnExecutor.hasActive(),
			hasRecovering: () => this.#turnExecutor.hasRecovering(),
			hasProvisioning: () => this.#tasks.hasProvisioning(),
		});
	}

	providerTools(input: { action?: unknown; id?: unknown; enabled?: unknown } | null | undefined) {
		return this.#models.providerTools(input);
	}

	// --- Turn Execution, Recovery & Shutdown ---

	send(
		mode: string,
		input: { id?: unknown; content?: unknown; provider?: unknown; model?: unknown; reasoning?: unknown; async?: unknown } | null | undefined,
		taskId: string | null = null,
		chatId: string | null = null,
	) {
		return this.#turnExecutor.send(mode, input, taskId, chatId);
	}

	recover(manager?: WorktreeManager) {
		return this.#turnExecutor.recover(manager);
	}

	async close() {
		this.#turnExecutor.beginClosing();
		await this.#models.cancelSignIn();
		await this.#turnExecutor.awaitActive();
		await this.#sessionManager.close();
		this.processes.close();
		this.browser.close();
		this.mcp.close();
		this.events.close();
		this.#db.close();
	}
}
