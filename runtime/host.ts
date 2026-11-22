import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createRegistry, Harness, LiveDoc, ROOT_CONVERSATION_ID, UsageDoc } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createRuntimeModels, safeErrorMessage } from "./models.ts";
import { copilotId } from "./copilot-auth.ts";
import { createWorkspaceTools } from "./coding-tools.ts";
import { resolveBaseCommit, resolveCheckout, type WorktreeManager } from "./worktrees.ts";
import { createModels } from "@earendil-works/pi-ai/models";
import { lookupGitHubIssue, validateLinkedIssue } from "./github-issues.ts";
import { scanProviderTools } from "./provider-tools.ts";
import { RuntimeEventBus } from "./events.ts";
import { logger } from "./log.ts";
import { ApprovalManager } from "./approvals.ts";
import { createShellTools, ProcessManager } from "./shell-tools.ts";
import { createSearchTools } from "./search-tools.ts";
import { createSubagentTools } from "./subagents.ts";
import { BrowserManager, createBrowserTools } from "./browser.ts";
import { ArtifactManager } from "./artifacts.ts";
import { buildSkillsAndRulesPrompt, createSkillsExtension, discoverSkillsAndRules } from "./skills.ts";
import { McpManager } from "./mcp.ts";
import { projectTimeline, type ConversationTimelineSnapshot, type LiveStateLike, type TimelineEntryLike, type UsageLike } from "./timeline.ts";
import { CaptainCore } from "../packages/captain-core/index.ts";
import { createNodeSqliteCaptainHost } from "../packages/host-node/index.ts";
import { LocalFactoryRunner } from "./factory-runner.ts";
import { createPiFactoryStageExecutor } from "./factory-pi-executor.ts";
import { badGateway, badRequest, conflict, httpError, notFound, serviceUnavailable } from "./http-error.ts";

const modes = {
	coding: {
		label: "Coding lead",
		instructions: "You are ADE's coding lead. Help with software engineering requests, architecture, planning, and browser inspection. You can write artifacts (write_artifact), manage checklists (update_tasks), and use browser tools. If a question depends on local repository files not yet connected to a workspace, explain that clearly.",
	},
	personal: {
		label: "Personal agent",
		instructions: "You are ADE's personal agent. Help the user with questions, research, and planning. You can create structured artifacts (write_artifact) and checklists (update_tasks).",
	},
} as const;

export type SessionMode = keyof typeof modes;

type ProjectRow = {
	id: string;
	name: string;
	githubUrl: string | null;
	repository: string | null;
	createdAt: number;
	updatedAt: number;
	blueprintId: string | null;
	modelProfile: string | null;
	euOnlyMode: number | null;
	cloudActFree: number | null;
	stageOverridesJson: string | null;
	archivedAt: number | null;
};

type CodingTaskRow = {
	id: string;
	title: string;
	repository: string;
	kind: string;
	base: string;
	branch: string | null;
	workspace: string | null;
	status: string;
	message: string | null;
	createdAt: number;
	workspaceDev: string | null;
	workspaceIno: string | null;
	initialTurnId: string | null;
	projectId: string | null;
	initialTitle: string | null;
	issueUrl: string | null;
	issueRepository: string | null;
	issueNumber: number | null;
	issueTitle: string | null;
	issueState: string | null;
	archivedAt: number | null;
	worktreeRemoved: number;
};

type ChatThreadRow = {
	id: string;
	mode: SessionMode;
	title: string;
	manuallyNamed: number;
	createdAt: number;
	archivedAt: number | null;
};

type TurnRow = {
	id: string;
	mode: SessionMode;
	content: string;
	provider: string | null;
	model: string;
	reasoning: string;
	status: "pending" | "completed" | "failed" | "blocked";
	answer: string | null;
	error: string | null;
	createdAt: number;
	updatedAt: number;
	taskId: string | null;
	chatId: string | null;
};

type ModelConfigResult = {
	provider: string;
	defaultModel: string;
	availableModels: { id: string; name: string }[];
	configured: boolean;
	setupMessage: string;
	signedIn?: boolean;
	models: ReturnType<typeof createModels>;
	resolveModel(modelId: string): unknown;
};

type OpenSession = {
	harness: Harness;
	root: Awaited<ReturnType<Harness["root"]>>;
};

type WatchHandle = {
	stop(ctx?: typeof context): Promise<unknown> | void;
};

type ConversationIdParam = Parameters<Harness["conversation"]>[0];

type WatchViewLike = {
	entries?: readonly TimelineEntryLike[];
	docs?: Record<string, unknown>;
};

function toConversationId(raw: string | number): ConversationIdParam {
	return (typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw) as ConversationIdParam;
}

const execFileAsync = promisify(execFile);

/** Readable, unique branch name for a session, e.g. "ade/fix-login-redirect-1a2b3c4d". */
export function sessionBranchName(title: string, id: string): string {
	const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
	return `ade/${slug ? `${slug}-` : ""}${id.replace(/-/g, "").slice(0, 8)}`;
}

export async function detectGitHubRemoteFromCheckout(repoPath: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
			cwd: repoPath,
			timeout: 5000,
			encoding: "utf8",
		});
		const remote = stdout.trim();
		const m = /(?:github\.com[:/])([a-z0-9-]+)\/([a-z0-9_.-]+?)(?:\.git)?$/i.exec(remote);
		return m ? `${m[1]}/${m[2]}` : null;
	} catch {
		return null;
	}
}

function plainText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: string; text: string } => Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"))
		.map((part) => part.text)
		.join("");
}

export class LocalAgentHost {
	#db: DatabaseSync;
	#sessions = new Map<string, OpenSession>();
	#watches = new Map<string, WatchHandle>();
	#active = new Map<string, Promise<unknown>>();
	#modelConfigFactory?: (environment: NodeJS.ProcessEnv, provider?: string) => ModelConfigResult | Promise<ModelConfigResult>;
	#runtimeModels?: ReturnType<typeof createRuntimeModels>;
	#environment: NodeJS.ProcessEnv;
	#stateDirectory: string;
	#closing = false;
	#recovering = new Set<string>();
	#provisioning = new Map<string, Promise<void>>();
	#githubIssueFetcher: typeof fetch;
	#credentialChangeBusy = false;
	#credentialRevision = 0;
	#worktreeManager?: WorktreeManager;

	readonly events: RuntimeEventBus;
	readonly approvals: ApprovalManager;
	readonly processes: ProcessManager;
	readonly artifacts: ArtifactManager;
	readonly browser: BrowserManager;
	readonly mcp: McpManager;
	readonly factory: CaptainCore;
	readonly factoryRunner: LocalFactoryRunner;
	#captainHost: ReturnType<typeof createNodeSqliteCaptainHost>;

	constructor({ stateDirectory, environment = process.env, modelConfigFactory, githubIssueFetcher = fetch, worktreeManager }: {
		stateDirectory: string;
		environment?: NodeJS.ProcessEnv;
		modelConfigFactory?: (environment: NodeJS.ProcessEnv, provider?: string) => ModelConfigResult | Promise<ModelConfigResult>;
		githubIssueFetcher?: typeof fetch;
		worktreeManager?: WorktreeManager;
	}) {
		if (!stateDirectory) throw new Error("A state directory is required");
		this.#stateDirectory = stateDirectory;
		this.#githubIssueFetcher = githubIssueFetcher;
		this.#environment = environment;
		this.#modelConfigFactory = modelConfigFactory;
		this.#worktreeManager = worktreeManager;
		this.#runtimeModels = modelConfigFactory ? undefined : createRuntimeModels(environment, stateDirectory);
		mkdirSync(stateDirectory, { recursive: true });
		this.#db = new DatabaseSync(join(stateDirectory, "ade-host.sqlite"));
		this.events = new RuntimeEventBus();
		this.approvals = new ApprovalManager(this.#db, this.events);
		this.processes = new ProcessManager(this.events);
		this.artifacts = new ArtifactManager(this.#db, this.events);
		this.browser = new BrowserManager(stateDirectory, this.events);
		this.mcp = new McpManager(this.#db, this.events);
		this.#captainHost = createNodeSqliteCaptainHost({
			db: this.#db,
			region: "local",
			onEvent: (event) => this.events.emit("factory.event", event, event.runId),
		});
		this.factory = new CaptainCore({ host: this.#captainHost });
		this.factoryRunner = new LocalFactoryRunner({
			captain: this.factory,
			stateDirectory,
			stageExecutor: createPiFactoryStageExecutor({
				stateDirectory,
				resolveModelConfig: (provider) => this.#modelConfig(provider),
				processes: this.processes,
				browser: this.browser,
				artifacts: this.artifacts,
				approvals: this.approvals,
			}),
		});
		void this.factoryRunner.hydrateFromStorage();
		this.#db.exec(`
			PRAGMA journal_mode=WAL;
			CREATE TABLE IF NOT EXISTS turns (
				id TEXT PRIMARY KEY,
				mode TEXT NOT NULL CHECK(mode IN ('coding','personal')),
				content TEXT NOT NULL,
				provider TEXT,
				model TEXT NOT NULL,
				reasoning TEXT NOT NULL,
				status TEXT NOT NULL CHECK(status IN ('pending','completed','failed','blocked')),
				answer TEXT,
				error TEXT,
				createdAt INTEGER NOT NULL,
				updatedAt INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS coding_tasks (
				id TEXT PRIMARY KEY, title TEXT NOT NULL, repository TEXT NOT NULL,
				kind TEXT NOT NULL, base TEXT NOT NULL, branch TEXT, workspace TEXT,
				status TEXT NOT NULL, message TEXT, createdAt INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS projects (
				id TEXT PRIMARY KEY, name TEXT NOT NULL, githubUrl TEXT,
				repository TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS github_connection (
				id INTEGER PRIMARY KEY CHECK(id=1), login TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS github_connection_preferences (
				id INTEGER PRIMARY KEY CHECK(id=1), auto_connect INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS chat_threads (
				id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('coding','personal')),
				title TEXT NOT NULL, manuallyNamed INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS provider_preferences (
				id TEXT PRIMARY KEY,
				enabled INTEGER NOT NULL
			);
		`);
		if (!this.#db.prepare("PRAGMA table_info(turns)").all().some(column => column.name === "provider")) {
			this.#db.exec("ALTER TABLE turns ADD COLUMN provider TEXT");
		}
		if (!this.#db.prepare("PRAGMA table_info(turns)").all().some(column => column.name === "taskId")) {
			this.#db.exec("ALTER TABLE turns ADD COLUMN taskId TEXT");
		}
		if (!this.#db.prepare("PRAGMA table_info(turns)").all().some(column => column.name === "chatId")) {
			this.#db.exec("ALTER TABLE turns ADD COLUMN chatId TEXT");
		}
		const taskColumns = this.#db.prepare("PRAGMA table_info(coding_tasks)").all();
		if (!taskColumns.some(column => column.name === "workspaceDev")) {
			this.#db.exec("ALTER TABLE coding_tasks ADD COLUMN workspaceDev TEXT; ALTER TABLE coding_tasks ADD COLUMN workspaceIno TEXT");
		}
		if (!taskColumns.some(column => column.name === "initialTurnId")) {
			this.#db.exec("ALTER TABLE coding_tasks ADD COLUMN initialTurnId TEXT");
		}
		if (!taskColumns.some(column => column.name === "projectId")) {
			this.#db.exec("ALTER TABLE coding_tasks ADD COLUMN projectId TEXT REFERENCES projects(id)");
		}
		if (!taskColumns.some(column => column.name === "initialTitle")) {
			this.#db.exec("ALTER TABLE coding_tasks ADD COLUMN initialTitle TEXT");
		}
		for (const [name, type] of [["issueUrl", "TEXT"], ["issueRepository", "TEXT"], ["issueNumber", "INTEGER"], ["issueTitle", "TEXT"], ["issueState", "TEXT"]]) {
			if (!this.#db.prepare("PRAGMA table_info(coding_tasks)").all().some(column => column.name === name)) {
				this.#db.exec(`ALTER TABLE coding_tasks ADD COLUMN ${name} ${type}`);
			}
		}
		for (const table of ["projects", "coding_tasks", "chat_threads"]) {
			if (!this.#db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === "archivedAt")) {
				this.#db.exec(`ALTER TABLE ${table} ADD COLUMN archivedAt INTEGER`);
			}
		}
		if (!this.#db.prepare("PRAGMA table_info(coding_tasks)").all().some(column => column.name === "worktreeRemoved")) {
			this.#db.exec("ALTER TABLE coding_tasks ADD COLUMN worktreeRemoved INTEGER NOT NULL DEFAULT 0");
		}
		const projectColumns = this.#db.prepare("PRAGMA table_info(projects)").all();
		for (const [name, ddl] of [
			["blueprintId", "TEXT DEFAULT 'automated-factory'"],
			["modelProfile", "TEXT DEFAULT 'balanced'"],
			["euOnlyMode", "INTEGER DEFAULT 0"],
			["cloudActFree", "INTEGER DEFAULT 0"],
			["stageOverridesJson", "TEXT"],
		]) {
			if (!projectColumns.some(column => column.name === name)) {
				this.#db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${ddl}`);
			}
		}
	}

	#get<T>(sql: string, ...args: SQLInputValue[]): T | undefined {
		return this.#db.prepare(sql).get(...args) as T | undefined;
	}

	#all<T>(sql: string, ...args: SQLInputValue[]): T[] {
		return this.#db.prepare(sql).all(...args) as unknown as T[];
	}

	#serializeProject(row: ProjectRow | undefined) {
		if (!row) return null;
		let stageOverrides: Record<string, { provider: string; model: string }> | undefined;
		if (typeof row.stageOverridesJson === "string" && row.stageOverridesJson.trim()) {
			try {
				stageOverrides = JSON.parse(row.stageOverridesJson) as Record<string, { provider: string; model: string }>;
			} catch (error) {
				logger.warn("Malformed stageOverridesJson on project row", { error, context: { projectId: row.id } });
			}
		}
		return {
			id: row.id,
			name: row.name,
			githubUrl: row.githubUrl ?? null,
			repository: row.repository ?? null,
			blueprintId: row.blueprintId || "automated-factory",
			modelProfile: row.modelProfile || "balanced",
			euOnlyMode: Boolean(row.euOnlyMode),
			cloudActFree: Boolean(row.cloudActFree),
			...(stageOverrides ? { stageOverrides } : {}),
			archivedAt: row.archivedAt ?? null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	projects() {
		return this.#all<ProjectRow>("SELECT * FROM projects ORDER BY createdAt,id")
			.map(row => this.#serializeProject(row))
			.filter((project): project is NonNullable<typeof project> => project !== null);
	}

	githubConnection(): { login: string | null } {
		const connection = this.#db.prepare("SELECT login FROM github_connection WHERE id=1").get() as { login: string } | undefined;
		return { login: connection?.login ?? null };
	}

	githubAutoConnectEnabled() {
		const row = this.#db.prepare("SELECT auto_connect FROM github_connection_preferences WHERE id=1").get() as { auto_connect: number } | undefined;
		return row?.auto_connect !== 0;
	}

	connectGitHub(login: unknown) {
		if (typeof login !== "string" || !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(login)) {
			throw badGateway("GitHub CLI did not return a valid account.");
		}
		const previous = this.githubConnection().login;
		if (previous && previous.toLowerCase() !== login.toLowerCase()) {
			throw conflict("The GitHub CLI account changed. Disconnect it in Settings before connecting another account.");
		}
		this.#db.prepare("INSERT INTO github_connection (id,login) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login").run(login);
		this.#db.prepare("INSERT INTO github_connection_preferences (id,auto_connect) VALUES (1,1) ON CONFLICT(id) DO UPDATE SET auto_connect=1").run();
		return this.githubConnection();
	}

	disconnectGitHub() {
		this.#db.prepare("DELETE FROM github_connection WHERE id=1").run();
		this.#db.prepare("INSERT INTO github_connection_preferences (id,auto_connect) VALUES (1,0) ON CONFLICT(id) DO UPDATE SET auto_connect=0").run();
		return this.githubConnection();
	}

	async lookupGitHubIssue(projectId: unknown, url: unknown) {
		const project = typeof projectId === "string"
			? (this.#db.prepare("SELECT * FROM projects WHERE id=?").get(projectId) as ProjectRow | undefined)
			: undefined;
		return lookupGitHubIssue({ project, url, fetcher: this.#githubIssueFetcher });
	}

	renameCodingTask(id: string, title: unknown) {
		if (typeof title !== "string" || !title.trim() || title.length > 200) {
			throw badRequest("Provide a session name of up to 200 characters.");
		}
		const result = this.#db.prepare("UPDATE coding_tasks SET initialTitle=COALESCE(initialTitle,title),title=? WHERE id=?").run(title.trim(), id);
		if (!result.changes) throw notFound("Session not found.");
		return this.sessions().find(item => item.id === id);
	}

	createChatThread(input: { id?: unknown; mode?: unknown } | null | undefined) {
		if (typeof input?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) ||
			typeof input.mode !== "string" || !Object.hasOwn(modes, input.mode)) {
			throw badRequest("Provide a valid chat ID and mode.");
		}
		const existing = this.#db.prepare("SELECT * FROM chat_threads WHERE id=?").get(input.id) as ChatThreadRow | undefined;
		if (existing) {
			if (existing.mode !== input.mode) throw conflict("This chat ID already belongs to a different conversation.");
			return this.sessions().find(item => item.id === input.id);
		}
		this.#db.prepare("INSERT INTO chat_threads (id,mode,title,createdAt) VALUES (?,?,?,?)")
			.run(input.id, input.mode, "New chat", Date.now());
		return this.sessions().find(item => item.id === input.id);
	}

	renameChatThread(id: string, title: unknown) {
		if (typeof title !== "string" || !title.trim() || title.length > 200) {
			throw badRequest("Provide a chat name of up to 200 characters.");
		}
		const result = this.#db.prepare("UPDATE chat_threads SET title=?,manuallyNamed=1 WHERE id=?").run(title.trim(), id);
		if (!result.changes) throw notFound("Chat not found.");
		return this.sessions().find(item => item.id === id);
	}

	deleteChatThread(id: string) {
		this.#db.prepare("DELETE FROM turns WHERE chatId=?").run(id);
		const result = this.#db.prepare("DELETE FROM chat_threads WHERE id=?").run(id);
		if (!result.changes) throw notFound("Chat not found.");
		return { deleted: true, id };
	}

	deleteCodingTask(id: string) {
		this.#db.prepare("DELETE FROM turns WHERE taskId=?").run(id);
		const result = this.#db.prepare("DELETE FROM coding_tasks WHERE id=?").run(id);
		if (!result.changes) throw notFound("Session not found.");
		return { deleted: true, id };
	}

	/**
	 * Archive or restore a coding session or chat thread. Archiving stops a running turn; the caller closes
	 * terminals and (optionally) removes the worktree. The branch and conversation are always kept.
	 */
	async setSessionArchived(id: string, archived: boolean): Promise<{ id: string; archivedAt: number | null; workspace: string | null; repository: string | null; kind: string | null }> {
		if (Object.hasOwn(modes, id)) throw badRequest("Built-in chats cannot be archived.");
		const task = this.#get<CodingTaskRow>("SELECT * FROM coding_tasks WHERE id=?", id);
		const chat = task ? null : this.#get<ChatThreadRow>("SELECT * FROM chat_threads WHERE id=?", id);
		if (!task && !chat) throw notFound("Session not found.");
		if (archived && (this.#active.has(id) || this.#recovering.has(id))) await this.abortSession(id).catch(() => ({ ok: false }));
		const archivedAt = archived ? Date.now() : null;
		this.#db.prepare(`UPDATE ${task ? "coding_tasks" : "chat_threads"} SET archivedAt=? WHERE id=?`).run(archivedAt, id);
		this.events.emit("sessions.changed", { id, archivedAt });
		return { id, archivedAt, workspace: task?.workspace ?? null, repository: task?.repository ?? null, kind: task?.kind ?? null };
	}

	/** Mark a session's worktree as removed after the caller deleted it from disk. */
	markWorktreeRemoved(id: string) {
		this.#db.prepare("UPDATE coding_tasks SET worktreeRemoved=1 WHERE id=?").run(id);
	}

	/** Details needed to recreate a removed worktree, or null when the session's worktree is still present. */
	removedWorktree(id: string): { path: string; repository: string; branch: string } | null {
		const task = this.#get<Pick<CodingTaskRow, "workspace" | "repository" | "branch" | "worktreeRemoved" | "kind">>(
			"SELECT workspace, repository, branch, worktreeRemoved, kind FROM coding_tasks WHERE id=?",
			id,
		);
		if (!task?.worktreeRemoved || task.kind !== "worktree" || !task.workspace || !task.branch) return null;
		return { path: task.workspace, repository: task.repository, branch: task.branch };
	}

	/** Record that a removed worktree was recreated on disk, refreshing its identity checks. */
	markWorktreeRestored(id: string) {
		const task = this.#get<Pick<CodingTaskRow, "workspace">>("SELECT workspace FROM coding_tasks WHERE id=?", id);
		if (!task?.workspace) throw notFound("Session workspace not found.");
		const info = statSync(task.workspace, { bigint: true });
		this.#db.prepare("UPDATE coding_tasks SET worktreeRemoved=0, workspaceDev=?, workspaceIno=? WHERE id=?").run(String(info.dev), String(info.ino), id);
	}

	/** Archive or restore a project. Archiving a project also archives its sessions; restoring leaves them archived. */
	async setProjectArchived(id: string, archived: boolean) {
		const project = this.#get<ProjectRow>("SELECT * FROM projects WHERE id=?", id);
		if (!project) throw notFound("Project not found.");
		const sessions = [];
		if (archived) {
			const tasks = this.#all<{ id: string }>("SELECT id FROM coding_tasks WHERE projectId=? AND archivedAt IS NULL", id);
			for (const task of tasks) sessions.push(await this.setSessionArchived(task.id, true));
		}
		this.#db.prepare("UPDATE projects SET archivedAt=? WHERE id=?").run(archived ? Date.now() : null, id);
		return { project: this.#serializeProject(this.#get<ProjectRow>("SELECT * FROM projects WHERE id=?", id)), sessions };
	}

	forkSession(sourceId: string) {
		const newId = randomUUID();
		const now = Date.now();
		const chat = this.#get<ChatThreadRow>("SELECT * FROM chat_threads WHERE id=?", sourceId);
		if (chat) {
			const forkTitle = `${chat.title} (fork)`.slice(0, 200);
			this.#db.prepare("INSERT INTO chat_threads (id,mode,title,manuallyNamed,createdAt) VALUES (?,?,?,?,?)")
				.run(newId, chat.mode, forkTitle, 1, now);
			const rows = this.#all<TurnRow>("SELECT * FROM turns WHERE chatId=? ORDER BY createdAt ASC", sourceId);
			const insertTurn = this.#db.prepare(
				"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,chatId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			);
			for (const row of rows) {
				insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, newId);
			}
			return this.sessions().find(item => item.id === newId);
		}
		const task = this.#get<CodingTaskRow>("SELECT * FROM coding_tasks WHERE id=?", sourceId);
		if (task) {
			const forkTitle = `${task.title} (fork)`.slice(0, 200);
			this.#db.prepare(
				"INSERT INTO coding_tasks (id,title,repository,kind,base,branch,workspace,status,message,createdAt,projectId,initialTitle) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			).run(newId, forkTitle, task.repository, task.kind, task.base, task.branch, task.workspace, task.status, task.message, now, task.projectId ?? null, forkTitle);
			const rows = this.#all<TurnRow>("SELECT * FROM turns WHERE taskId=? ORDER BY createdAt ASC", sourceId);
			const insertTurn = this.#db.prepare(
				"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,taskId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			);
			for (const row of rows) {
				insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, newId);
			}
			return this.sessions().find(item => item.id === newId);
		}
		if (sourceId === "coding" || sourceId === "personal") {
			const forkTitle = sourceId === "coding" ? "Coding lead (fork)" : "Personal agent (fork)";
			this.#db.prepare("INSERT INTO chat_threads (id,mode,title,manuallyNamed,createdAt) VALUES (?,?,?,?,?)")
				.run(newId, sourceId, forkTitle, 1, now);
			const rows = this.#all<TurnRow>("SELECT * FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL ORDER BY createdAt ASC", sourceId);
			const insertTurn = this.#db.prepare(
				"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,chatId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			);
			for (const row of rows) {
				insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, newId);
			}
			return this.sessions().find(item => item.id === newId);
		}
		throw notFound("Session not found.");
	}

	moveSession(sourceId: string, opts: { mode?: "coding" | "personal"; projectId?: string | null }) {
		const task = this.#get<CodingTaskRow>("SELECT * FROM coding_tasks WHERE id=?", sourceId);
		if (task) {
			if (opts.projectId !== undefined) {
				const targetProjectId = opts.projectId ? String(opts.projectId) : null;
				if (targetProjectId) {
					const proj = this.#get<Pick<ProjectRow, "id" | "repository">>("SELECT id, repository FROM projects WHERE id=?", targetProjectId);
					if (!proj) throw notFound("Target project not found.");
					this.#db.prepare("UPDATE coding_tasks SET projectId=?, repository=CASE WHEN repository='' THEN ? ELSE repository END WHERE id=?")
						.run(targetProjectId, proj.repository ?? "", sourceId);
				} else {
					this.#db.prepare("UPDATE coding_tasks SET projectId=NULL WHERE id=?").run(sourceId);
				}
			}
			return this.sessions().find(item => item.id === sourceId);
		}
		const chat = this.#get<ChatThreadRow>("SELECT * FROM chat_threads WHERE id=?", sourceId);
		if (chat) {
			if (opts.projectId) {
				const proj = this.#get<Pick<ProjectRow, "id" | "repository">>("SELECT id, repository FROM projects WHERE id=?", opts.projectId);
				if (!proj) throw notFound("Target project not found.");
				this.#db.prepare(
					"INSERT INTO coding_tasks (id,title,repository,kind,base,branch,workspace,status,message,createdAt,projectId,initialTitle) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
				).run(chat.id, chat.title, proj.repository ?? "", proj.repository ? "existing" : "none", "main", null, proj.repository ?? null, "ready", null, chat.createdAt, proj.id, chat.title);
				this.#db.prepare("UPDATE turns SET taskId=?, chatId=NULL, mode='coding' WHERE chatId=?").run(chat.id, chat.id);
				this.#db.prepare("DELETE FROM chat_threads WHERE id=?").run(chat.id);
				return this.sessions().find(item => item.id === chat.id);
			}
			if (opts.mode === "coding" || opts.mode === "personal") {
				this.#db.prepare("UPDATE chat_threads SET mode=? WHERE id=?").run(opts.mode, sourceId);
				this.#db.prepare("UPDATE turns SET mode=? WHERE chatId=?").run(opts.mode, sourceId);
			}
			return this.sessions().find(item => item.id === sourceId);
		}
		throw notFound("Session not found.");
	}

	async saveProject(input: Record<string, unknown> | null | undefined, id?: string) {
		const projectId = id ?? input?.id;
		if (typeof projectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId) ||
			typeof input?.name !== "string" || !input.name.trim() || input.name.length > 100 ||
			(input.githubUrl != null && typeof input.githubUrl !== "string") ||
			(input.repository != null && typeof input.repository !== "string")) {
			throw badRequest("Provide a project ID, name and optional repository links.");
		}
		let githubUrl: string | null = null;
		if (typeof input.githubUrl === "string" && input.githubUrl.trim()) {
			const match = /^(?:https:\/\/github\.com\/)?([a-z0-9-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(input.githubUrl.trim());
			if (!match || [".", ".."].includes(match[2])) {
				throw badRequest("Use a GitHub repository URL or owner/repository, without credentials or query parameters.");
			}
			githubUrl = `https://github.com/${match[1]}/${match[2]}`;
		}
		const repository = typeof input.repository === "string" && input.repository.trim() ? await resolveCheckout(input.repository.trim()) : null;
		// Auto-detect GitHub origin when a local repo is set and no GitHub URL was entered
		if (!githubUrl && repository && input.githubUrl === undefined) {
			const detected = await detectGitHubRemoteFromCheckout(repository);
			if (detected) githubUrl = `https://github.com/${detected}`;
		}
		const name = input.name.trim();
		const blueprintId = typeof input.blueprintId === "string" && input.blueprintId.trim() ? input.blueprintId.trim() : undefined;
		const modelProfile = typeof input.modelProfile === "string" && input.modelProfile.trim() ? input.modelProfile.trim() : undefined;
		const euOnlyMode = typeof input.euOnlyMode === "boolean" ? (input.euOnlyMode ? 1 : 0) : undefined;
		const cloudActFree = typeof input.cloudActFree === "boolean" ? (input.cloudActFree ? 1 : 0) : undefined;
		const stageOverridesJson =
			input.stageOverrides !== undefined
				? (input.stageOverrides && Object.keys(input.stageOverrides).length ? JSON.stringify(input.stageOverrides) : null)
				: undefined;

		const existing = this.#db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
		if (id) {
			if (!existing) throw notFound("Project not found.");
			this.#db.prepare(
				`UPDATE projects SET
					name=?, githubUrl=?, repository=?,
					blueprintId=COALESCE(?, blueprintId),
					modelProfile=COALESCE(?, modelProfile),
					euOnlyMode=COALESCE(?, euOnlyMode),
					cloudActFree=COALESCE(?, cloudActFree),
					stageOverridesJson=CASE WHEN ? THEN ? ELSE stageOverridesJson END,
					updatedAt=?
				WHERE id=?`,
			).run(
				name,
				githubUrl,
				repository,
				blueprintId ?? null,
				modelProfile ?? null,
				euOnlyMode ?? null,
				cloudActFree ?? null,
				stageOverridesJson !== undefined ? 1 : 0,
				stageOverridesJson ?? null,
				Date.now(),
				id,
			);
		} else if (existing) {
			if (existing.name !== name || existing.githubUrl !== githubUrl || existing.repository !== repository) {
				throw conflict("This project ID already belongs to different inputs.");
			}
		} else {
			const now = Date.now();
			this.#db.prepare(
				"INSERT INTO projects (id, name, githubUrl, repository, createdAt, updatedAt, blueprintId, modelProfile, euOnlyMode, cloudActFree, stageOverridesJson) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
			).run(
				projectId,
				name,
				githubUrl,
				repository,
				now,
				now,
				blueprintId ?? "automated-factory",
				modelProfile ?? "balanced",
				euOnlyMode ?? 0,
				cloudActFree ?? 0,
				stageOverridesJson ?? null,
			);
		}
		return this.#serializeProject(this.#get<ProjectRow>("SELECT * FROM projects WHERE id=?", projectId));
	}

	deleteProject(id: string) {
		const existing = this.#db.prepare("SELECT * FROM projects WHERE id=?").get(id);
		if (!existing) throw notFound("Project not found.");
		this.#db.prepare("UPDATE coding_tasks SET projectId=NULL WHERE projectId=?").run(id);
		this.#db.prepare("DELETE FROM projects WHERE id=?").run(id);
		return { deleted: true, id };
	}

	setWorktreeManager(manager: WorktreeManager): void {
		this.#worktreeManager = manager;
	}

	getWorkspacePath(sessionId: string): string | null {
		const task = this.#get<Pick<CodingTaskRow, "workspace" | "status" | "kind" | "worktreeRemoved">>(
			"SELECT workspace, status, kind, worktreeRemoved FROM coding_tasks WHERE id=?",
			sessionId,
		);
		if (!task || task.kind === "none" || task.status !== "ready" || !task.workspace || task.worktreeRemoved) return null;
		return task.workspace;
	}

	/** The commit a session's branch started from (recorded at creation), or null for checkout/none sessions. */
	getWorkspaceBase(sessionId: string): string | null {
		const task = this.#get<Pick<CodingTaskRow, "base" | "kind">>("SELECT base, kind FROM coding_tasks WHERE id=?", sessionId);
		return task?.kind === "worktree" && task.base && task.base !== "HEAD" ? task.base : null;
	}

	#sessionDbPath(sessionId: string): string | null {
		if (Object.hasOwn(modes, sessionId)) return join(this.#stateDirectory, `${sessionId}.sqlite`);
		if (this.#db.prepare("SELECT 1 FROM coding_tasks WHERE id=?").get(sessionId)) {
			return join(this.#stateDirectory, `coding-task-${sessionId}.sqlite`);
		}
		if (this.#db.prepare("SELECT 1 FROM chat_threads WHERE id=?").get(sessionId)) {
			return join(this.#stateDirectory, `chat-thread-${sessionId}.sqlite`);
		}
		return null;
	}

	async #watchConversation(sessionId: string, harness: Harness, conversationId: string | number, isSubagent: boolean): Promise<void> {
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
				this.events.emit("timeline.update", { ...snapshot, isSubagent }, sessionId);
				if (isSubagent) {
					this.events.emit("subagents.update", { sessionId, subagentId: convKey, busy: snapshot.busy }, sessionId);
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
			this.events.emit("sessions.changed", { sessionId, watchError: error instanceof Error ? error.message : String(error) }, sessionId);
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
		if (!trimmed || trimmed.length > 8000) {
			throw badRequest("Enter a message between 1 and 8000 characters.");
		}
		const open = this.#sessions.get(sessionId);
		if (!open) throw conflict("Session is not currently active.");
		const whenBusy = mode === "steer" ? "steer" : "followUp";
		await open.root.submit({ type: "input", content: trimmed, whenBusy }, context);
		this.events.emit("sessions.changed", { sessionId }, sessionId);
		return { ok: true, mode };
	}

	async abortSession(sessionId: string): Promise<{ ok: boolean }> {
		const open = this.#sessions.get(sessionId);
		if (!open) return { ok: true };
		await open.root.abort(context);
		this.events.emit("sessions.changed", { sessionId }, sessionId);
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
		await this.#watchConversation(sessionId, open.harness, convId, true);
		const whenBusy = mode === "steer" ? "steer" : "followUp";
		await conv.submit({ type: "input", content: trimmed, whenBusy }, context);
		this.events.emit("subagents.update", { sessionId, subagentId: String(convId) }, sessionId);
		return { ok: true };
	}

	async stopSubagent(sessionId: string, subagentId: string): Promise<{ ok: boolean }> {
		const open = this.#sessions.get(sessionId);
		if (!open) return { ok: true };
		const convId = toConversationId(subagentId);
		const conv = await open.harness.conversation(convId, context);
		if (!conv) throw notFound("Subagent not found.");
		await conv.abort(context);
		this.events.emit("subagents.update", { sessionId, subagentId: String(convId) }, sessionId);
		return { ok: true };
	}

	async featureAgents(taskId: string) {
		const task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(taskId) as CodingTaskRow | undefined;
		if (!task) throw notFound("Feature not found.");
		const path = join(this.#stateDirectory, `coding-task-${taskId}.sqlite`);
		let harness = this.#sessions.get(taskId)?.harness;
		if (!harness && !existsSync(path)) {
			if (this.#db.prepare("SELECT 1 FROM turns WHERE taskId=? LIMIT 1").get(taskId)) {
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
					const metadata = transcript.entries.find(entry => entry.kind === "ade.assignment")?.data as {
						name?: string;
						role?: string;
						mode?: string;
						background?: boolean;
						workspacePath?: string | null;
						branch?: string | null;
						createdAt?: number;
						task?: string;
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
		if (!this.#db.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) {
			throw notFound("Project not found.");
		}
		const sessions = this.#db.prepare("SELECT id,title FROM coding_tasks WHERE projectId=? ORDER BY createdAt DESC").all(projectId) as { id: string; title: string }[];
		const agents = [];
		const errors = [];
		for (const session of sessions) {
			try {
				for (const agent of await this.featureAgents(session.id)) {
					agents.push({ ...agent, sessionId: session.id, sessionName: session.title });
				}
			} catch (error) {
				errors.push({ sessionId: session.id, sessionName: session.title, message: this.safeErrorMessage(error) });
			}
		}
		return { agents, errors, observedAt: Date.now() };
	}
	async #modelConfig(provider?: string): Promise<ModelConfigResult> {
		if (this.#runtimeModels) return this.#runtimeModels.config(provider);
		if (this.#modelConfigFactory) return await this.#modelConfigFactory(this.#environment, provider);
		throw new Error("Model configuration is unavailable.");
	}

	/**
	 * Providers the Pi Durable harness can run. Installed CLI agents (claude, codex, …) are reported by
	 * providerTools() for information only; they are not selectable until a CLI harness exists.
	 */
	async modelCatalog() {
		const runtimeProviders = this.#runtimeModels?.providers ?? [];
		const results = [];
		for (const p of runtimeProviders) {
			let config: Pick<ModelConfigResult, "configured" | "availableModels" | "defaultModel" | "setupMessage">;
			try {
				config = await this.#modelConfig(p.id);
			} catch (error) {
				config = { configured: false, availableModels: [], defaultModel: "", setupMessage: this.safeErrorMessage(error) };
			}
			results.push({
				id: p.id,
				name: p.name,
				kind: "api",
				configured: Boolean(config.configured),
				enabled: true,
				defaultModel: config.defaultModel ?? "",
				setupMessage: config.setupMessage ?? "",
				models: config.configured ? config.availableModels ?? [] : [],
			});
		}
		if (!results.length) {
			const single = await this.#modelConfig(undefined);
			results.push({
				id: single.provider,
				name: single.provider,
				kind: "api",
				configured: single.configured,
				enabled: true,
				defaultModel: single.defaultModel,
				setupMessage: single.setupMessage ?? "",
				models: single.availableModels ?? [],
			});
		}
		const defaultProvider = await this.#runtimeModels?.defaultProvider?.();
		return { providers: results, defaultProvider: defaultProvider ?? results[0]?.id };
	}

	async health(provider?: string) {
		const config = await this.#modelConfig(provider);
		return {
			online: true,
			harness: "Pi Durable",
			provider: config.provider,
			configured: config.configured,
			defaultModel: config.defaultModel,
			models: config.availableModels,
			message: config.setupMessage,
			providers: this.#runtimeModels?.providers ?? [{ id: config.provider, name: config.provider }],
			copilotSignedIn: config.signedIn ?? false,
			copilotSignIn: config.provider === copilotId ? this.#runtimeModels?.signIn.status() : undefined,
		};
	}

	async copilotAuth(action: unknown) {
		const signIn = this.#runtimeModels?.signIn;
		if (!signIn) throw notFound("Copilot sign-in is unavailable.");
		if (action === "start") return signIn.start();
		if (action === "cancel") return signIn.cancel();
		if (action === "sign-out") {
			if (this.#active.size) throw conflict("Wait for active turns to finish before signing out.");
			return signIn.signOut();
		}
		throw badRequest("Unknown Copilot sign-in action.");
	}

	safeErrorMessage(error: unknown) {
		return this.#runtimeModels?.safeErrorMessage(error) ?? safeErrorMessage(error, this.#environment);
	}

	async modelCredentials(input: { action?: unknown; provider?: unknown; key?: unknown; url?: unknown; model?: unknown } | null | undefined) {
		if (!this.#runtimeModels) throw notFound("Model credentials are unavailable.");
		if (input?.action === "status") return { credentials: await this.#runtimeModels.credentialStatus(), compatible: this.#runtimeModels.compatibleStatus() };
		if (input?.action === "configure-compatible") {
			if (this.#active.size || this.#recovering.size) throw conflict("Wait for active work to finish before changing providers.");
			return { credentials: await this.#runtimeModels.credentialStatus(), compatible: this.#runtimeModels.configureCompatible({ url: input.url, model: input.model }) };
		}
		if (this.#credentialChangeBusy || this.#active.size || this.#recovering.size || this.#provisioning.size) {
			throw conflict("Wait for active work to finish before changing model credentials.");
		}
		this.#credentialChangeBusy = true;
		this.#credentialRevision++;
		try {
			return { credentials: await this.#runtimeModels.changeCredential(input?.action, input?.provider, input?.key) };
		} finally {
			this.#credentialChangeBusy = false;
		}
	}

	async providerTools(input: { action?: unknown; id?: unknown; enabled?: unknown } | null | undefined) {
		if (input?.action === "set") {
			if (typeof input.id !== "string" || typeof input.enabled !== "boolean") {
				throw badRequest("Provide a provider id and enabled state.");
			}
			this.#db.prepare("INSERT INTO provider_preferences(id,enabled) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled")
				.run(input.id, input.enabled ? 1 : 0);
		}
		const scanned = await scanProviderTools();
		const prefRows = this.#db.prepare("SELECT id,enabled FROM provider_preferences").all() as { id: string; enabled: number }[];
		const preferences = new Map(prefRows.map(item => [item.id, Boolean(item.enabled)]));
		type ProviderToolEntry = {
			id: string;
			name: string;
			command: string | null;
			kind: string;
			install: string | null;
			installed: boolean;
			available: boolean;
			modelCount: number | null;
			models?: readonly { readonly id: string; readonly name: string }[];
		};
		const providers: ProviderToolEntry[] = scanned.map(item => ({
			...item,
			command: item.command,
			install: item.install,
		}));

		if (this.#runtimeModels) {
			const apiNames: Record<string, string> = {
				openai: "OpenAI",
				anthropic: "Anthropic",
				compatible: "OpenAI-compatible",
				radius: "Pi",
				"github-copilot": "GitHub Copilot",
			};
			for (const id of ["openai", "anthropic", "compatible", "radius", copilotId]) {
				try {
					const config = await this.#runtimeModels.config(id);
					providers.push({
						id,
						name: apiNames[id] ?? id,
						command: null,
						kind: "api",
						install: null,
						installed: config.configured,
						available: config.configured,
						modelCount: config.availableModels?.length ?? null,
					});
				} catch {
					providers.push({
						id,
						name: apiNames[id] ?? id,
						command: null,
						kind: "api",
						install: null,
						installed: false,
						available: false,
						modelCount: null,
					});
				}
			}
		}

		return {
			providers: providers.map(provider => ({
				...provider,
				enabled: preferences.has(provider.id) ? Boolean(preferences.get(provider.id)) : provider.available,
			})),
		};
	}

	sessions() {
		const tasks = this.#db.prepare("SELECT * FROM coding_tasks ORDER BY createdAt DESC").all() as CodingTaskRow[];
		const chats = this.#db.prepare("SELECT * FROM chat_threads ORDER BY createdAt DESC").all() as ChatThreadRow[];
		type SessionDef = { id: string; mode: SessionMode; label: string; task: CodingTaskRow | null; chat: ChatThreadRow | null };
		const definitions: SessionDef[] = [
			...(Object.entries(modes) as [SessionMode, (typeof modes)[SessionMode]][]).map(([mode, definition]) => ({ id: mode, mode, label: definition.label, task: null, chat: null })),
			...chats.map(chat => ({ id: chat.id, mode: chat.mode, label: chat.title, task: null, chat })),
			...tasks.map(task => ({ id: task.id, mode: "coding" as const, label: task.title, task, chat: null })),
		];
		return definitions.map(({ id, mode, label, task, chat }) => {
			const turns = (chat
				? this.#db.prepare("SELECT * FROM turns WHERE chatId=? ORDER BY createdAt, id").all(id)
				: task
					? this.#db.prepare("SELECT * FROM turns WHERE taskId=? ORDER BY createdAt, id").all(id)
					: this.#db.prepare("SELECT * FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL ORDER BY createdAt, id").all(mode)) as TurnRow[];
			const messages = turns.flatMap((turn) => {
				const result = [{
					id: `${turn.id}:user`,
					role: "user",
					content: turn.content,
					status: turn.status,
					createdAt: turn.createdAt,
				}];
				if (turn.answer) result.push({
					id: `${turn.id}:assistant`,
					role: "assistant",
					content: turn.answer,
					status: turn.status,
					createdAt: turn.updatedAt,
				});
				if (turn.error) result.push({
					id: `${turn.id}:error`,
					role: "error",
					content: turn.error,
					status: turn.status,
					createdAt: turn.updatedAt,
				});
				return result;
			});
			const busy = this.#active.has(id) || this.#recovering.has(id) ||
				turns.some((turn) => turn.status === "pending");
			return {
				id,
				mode,
				label,
				...(chat ? { chatThread: true } : {}),
				...(task ? { projectId: task.projectId } : {}),
				status: busy ? "working" : "idle",
				archivedAt: (task ?? chat)?.archivedAt ?? null,
				...(task ? { workspace: { kind: task.kind, path: task.worktreeRemoved ? null : task.workspace, repository: task.repository, branch: task.branch, status: task.worktreeRemoved ? "archived" : task.status, message: task.message, removed: Boolean(task.worktreeRemoved) } } : {}),
				...(task?.issueUrl ? { githubIssue: { url: task.issueUrl, repository: task.issueRepository, number: task.issueNumber, title: task.issueTitle, state: task.issueState } } : {}),
				messages,
			};
		});
	}

	async createCodingTask(input: {
		id?: unknown;
		kind?: unknown;
		repository?: unknown;
		title?: unknown;
		projectId?: unknown;
		githubIssue?: unknown;
		initialMessage?: {
			id?: unknown;
			content?: unknown;
			provider?: unknown;
			model?: unknown;
			reasoning?: unknown;
		};
	} | null | undefined, manager: WorktreeManager) {
		const credentialRevision = this.#credentialRevision;
		if (typeof input?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) ||
			typeof input.kind !== "string" || !["none", "checkout", "worktree"].includes(input.kind) || typeof input.repository !== "string" ||
			typeof input.title !== "string" || !input.title.trim() || input.title.length > 200) {
			throw badRequest("Provide a task ID, title, repository and workspace choice.");
		}
		if (input.projectId != null && (typeof input.projectId !== "string" || !this.#db.prepare("SELECT 1 FROM projects WHERE id=?").get(input.projectId))) {
			throw badRequest("Choose an existing project for this feature.");
		}
		const project = typeof input.projectId === "string"
			? (this.#db.prepare("SELECT * FROM projects WHERE id=?").get(input.projectId) as ProjectRow | undefined) ?? null
			: null;
		const githubIssue = validateLinkedIssue(input.githubIssue, project);
		if (input.kind === "none" && input.repository.trim()) {
			throw badRequest("A workspace-free feature cannot have a checkout path.");
		}
		type ValidatedInitialMessage = { id: string; content: string; provider: string; model: string; reasoning: string };
		let initial: ValidatedInitialMessage | undefined;
		let config: ModelConfigResult | undefined;
		if (input.initialMessage !== undefined) {
			const message = input.initialMessage;
			if (typeof message?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.id) ||
				typeof message.content !== "string" || !message.content.trim() || message.content.length > 8000 ||
				typeof message.provider !== "string" || !message.provider || typeof message.model !== "string" || !message.model ||
				typeof message.reasoning !== "string" || !["none", "off", "low", "medium", "high", "xhigh", "max"].includes(message.reasoning)) {
				throw badRequest("Provide a valid initial message, provider, model and reasoning level.");
			}
			initial = { id: message.id, content: message.content.trim(), provider: message.provider, model: message.model, reasoning: message.reasoning };
		}
		if (this.#closing) throw serviceUnavailable("ADE is shutting down");
		const repository = input.kind === "none" ? "" : await resolveCheckout(input.repository);
		const normalizedInput = {
			id: input.id,
			kind: input.kind,
			title: input.title,
			projectId: typeof input.projectId === "string" ? input.projectId : null,
			githubIssue,
		};
		let task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(input.id) as CodingTaskRow | undefined;
		if (task) this.#verifyTaskInputs(task, normalizedInput, repository, initial);
		if (!task) {
			const branch = input.kind === "worktree" ? sessionBranchName(input.title, input.id) : null;
			const base = input.kind === "worktree" ? await resolveBaseCommit(repository, "HEAD") : "HEAD";
			if (initial) {
				config = await this.#modelConfig(initial.provider);
				if (!config.configured) throw serviceUnavailable(config.setupMessage || "The selected model provider is not configured");
				if (config.provider !== initial.provider || !config.resolveModel(initial.model)) {
					throw badRequest("The selected model is not available from this provider.");
				}
			}
			task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(input.id) as CodingTaskRow | undefined;
			if (task) this.#verifyTaskInputs(task, normalizedInput, repository, initial);
			if (!task) {
				if (this.#closing) throw serviceUnavailable("ADE is shutting down");
				if (initial && (this.#credentialChangeBusy || credentialRevision !== this.#credentialRevision)) {
					throw conflict("Model credentials changed. Retry the message.");
				}
				const now = Date.now();
				this.#db.exec("BEGIN IMMEDIATE");
				try {
					if (initial && this.#db.prepare("SELECT 1 FROM turns WHERE id=?").get(initial.id)) {
						throw conflict("This initial message ID already belongs to another turn.");
					}
					this.#db.prepare("INSERT INTO coding_tasks (id,title,repository,kind,base,branch,status,createdAt,initialTurnId,projectId,initialTitle,issueUrl,issueRepository,issueNumber,issueTitle,issueState) VALUES (?,?,?,?,?,?,'provisioning',?,?,?,?,?,?,?,?,?)")
						.run(input.id, input.title.trim(), repository, input.kind, base, branch, now, initial?.id ?? null, normalizedInput.projectId, input.title.trim(),
							githubIssue?.url ?? null, githubIssue?.repository ?? null, githubIssue?.number ?? null, githubIssue?.title ?? null, githubIssue?.state ?? null);
					if (initial) this.#db.prepare("INSERT INTO turns (id,mode,content,provider,model,reasoning,status,createdAt,updatedAt,taskId) VALUES (?,'coding',?,?,?,?,'pending',?,?,?)")
						.run(initial.id, initial.content, initial.provider, initial.model, initial.reasoning, now, now, input.id);
					this.#db.exec("COMMIT");
				} catch (error) {
					this.#db.exec("ROLLBACK");
					throw error;
				}
				task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(input.id) as CodingTaskRow | undefined;
			}
		}
		if (task?.status === "provisioning") await this.#ensureProvisioned(task, manager);
		task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(input.id) as CodingTaskRow | undefined;
		if (!task) throw notFound("Session not found.");
		const pendingStatus = initial
			? (this.#db.prepare("SELECT status FROM turns WHERE id=?").get(initial.id) as { status: string } | undefined)?.status
			: undefined;
		if (initial && pendingStatus === "pending") {
			if (task.status !== "ready") {
				this.#finishTurn(initial.id, "blocked", null, `Workspace needs attention; the saved message was not submitted. ${task.message ?? ""}`);
			} else if (!this.#recovering.has(task.id)) {
				this.#recovering.add(task.id);
				try {
					const savedTurn = this.#db.prepare("SELECT * FROM turns WHERE id=?").get(initial.id) as TurnRow | undefined;
					if (savedTurn) await this.#resumeSavedTurn(savedTurn, config);
				} finally {
					this.#recovering.delete(task.id);
				}
			}
		}
		return this.sessions().find(item => item.id === input.id);
	}

	#verifyTaskInputs(
		task: CodingTaskRow,
		input: { kind: string; title: string; projectId: string | null; githubIssue: ReturnType<typeof validateLinkedIssue> },
		repository: string,
		initial: { id: string; content: string; provider: string; model: string; reasoning: string } | undefined,
	) {
		const issue = input.githubIssue;
		if (task.repository !== repository || task.kind !== input.kind || (task.initialTitle ?? task.title) !== input.title.trim() ||
			task.initialTurnId !== (initial?.id ?? null) || task.projectId !== (input.projectId ?? null) ||
			task.issueUrl !== (issue?.url ?? null) || task.issueRepository !== (issue?.repository ?? null) || task.issueNumber !== (issue?.number ?? null) ||
			task.issueTitle !== (issue?.title ?? null) || task.issueState !== (issue?.state ?? null)) {
			throw conflict("This task ID already belongs to different inputs.");
		}
		if (initial) {
			const turn = this.#db.prepare("SELECT * FROM turns WHERE id=?").get(initial.id) as TurnRow | undefined;
			if (!turn || turn.taskId !== task.id || turn.content !== initial.content || turn.provider !== initial.provider ||
				turn.model !== initial.model || turn.reasoning !== initial.reasoning) {
				throw conflict("This task ID already belongs to a different initial message.");
			}
		}
	}

	async #ensureProvisioned(task: CodingTaskRow, manager: WorktreeManager) {
		if (!this.#provisioning.has(task.id)) {
			const work = this.#provisionTask(task, manager).finally(() => this.#provisioning.delete(task.id));
			this.#provisioning.set(task.id, work);
		}
		await this.#provisioning.get(task.id);
	}

	async #provisionTask(task: CodingTaskRow, manager: WorktreeManager) {
		try {
			if (task.kind === "none") {
				this.#db.prepare("UPDATE coding_tasks SET status='ready' WHERE id=?").run(task.id);
				return;
			}
			let path = task.repository;
			let note: string | null = null;
			if (task.kind === "worktree") {
				const operation = await manager.create({ id: task.id, repository: task.repository, branch: task.branch, base: task.base });
				if (operation.status !== "completed") throw new Error(operation.message);
				path = operation.target;
				note = operation.message;
			}
			await resolveCheckout(path);
			const info = statSync(path, { bigint: true });
			this.#db.prepare("UPDATE coding_tasks SET status='ready', workspace=?, message=?, workspaceDev=?, workspaceIno=? WHERE id=?")
				.run(path, note, String(info.dev), String(info.ino), task.id);
		} catch (error) {
			this.#db.prepare("UPDATE coding_tasks SET status='attention', message=? WHERE id=?").run(this.safeErrorMessage(error), task.id);
		}
	}

	async #verifyTaskWorkspace(task: CodingTaskRow) {
		if (task.kind === "none") return;
		if (!task.workspace) throw conflict("Task workspace is missing.");
		try {
			const info = statSync(task.workspace, { bigint: true });
			if (String(info.dev) !== task.workspaceDev || String(info.ino) !== task.workspaceIno) {
				throw new Error("The task workspace has changed or been replaced.");
			}
			await resolveCheckout(task.workspace);
		} catch (error) {
			throw conflict(`Task workspace unavailable: ${this.safeErrorMessage(error)}. It will not be retargeted automatically.`);
		}
	}

	async #existingTurn(
		mode: SessionMode,
		taskId: string | null,
		chatId: string | null,
		input: { id?: string; content: string; provider?: string; model?: string; reasoning?: string },
		key: string,
	) {
		if (!input.id) return undefined;
		const existing = this.#db.prepare("SELECT * FROM turns WHERE id=?").get(input.id) as TurnRow | undefined;
		if (!existing) return undefined;
		if (existing.mode !== mode || existing.taskId !== taskId || existing.chatId !== chatId || existing.content !== input.content.trim() ||
			(input.provider && existing.provider !== input.provider) || (input.model && existing.model !== input.model) ||
			(input.reasoning && existing.reasoning !== input.reasoning)) {
			throw conflict("This message ID was already used with different inputs.");
		}
		if (this.#active.has(key)) await this.#active.get(key);
		return this.sessions().find(item => item.id === key);
	}

	async send(
		mode: string,
		input: { id?: unknown; content?: unknown; provider?: unknown; model?: unknown; reasoning?: unknown; async?: unknown } | null | undefined,
		taskId: string | null = null,
		chatId: string | null = null,
	) {
		const credentialRevision = this.#credentialRevision;
		if (!Object.hasOwn(modes, mode)) throw notFound("Unknown conversation");
		const sessionMode = mode as SessionMode;
		const task = taskId ? (this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(taskId) as CodingTaskRow | undefined) ?? null : null;
		if (taskId && (sessionMode !== "coding" || !task || task.status !== "ready")) throw conflict("This coding task has no ready workspace.");
		if (task?.archivedAt) throw conflict("This session is archived. Restore it to continue.");
		if (task?.worktreeRemoved) throw conflict("This session's worktree was removed when it was archived.");
		const chat = chatId ? (this.#db.prepare("SELECT * FROM chat_threads WHERE id=?").get(chatId) as ChatThreadRow | undefined) ?? null : null;
		if (chatId && (!chat || chat.mode !== sessionMode || taskId)) throw notFound("This chat thread is unavailable.");
		const key = chatId ?? taskId ?? sessionMode;
		if (this.#closing) throw serviceUnavailable("ADE is shutting down");
		if (typeof input?.content !== "string" || !input.content.trim() || input.content.length > 8000) {
			throw badRequest("Enter a message between 1 and 8000 characters");
		}
		if (input.id !== undefined) {
			if (typeof input.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) {
				throw badRequest("Invalid message ID.");
			}
		}
		const normalizedSend = {
			id: typeof input.id === "string" ? input.id : undefined,
			content: input.content,
			provider: typeof input.provider === "string" ? input.provider : undefined,
			model: typeof input.model === "string" ? input.model : undefined,
			reasoning: typeof input.reasoning === "string" ? input.reasoning : undefined,
			async: Boolean(input.async),
		};
		const existing = await this.#existingTurn(sessionMode, taskId, chatId, normalizedSend, key);
		if (existing) return existing;
		if (task) await this.#verifyTaskWorkspace(task);
		const config = await this.#modelConfig(normalizedSend.provider);
		const admitted = await this.#existingTurn(sessionMode, taskId, chatId, normalizedSend, key);
		if (admitted) return admitted;
		if (this.#closing) throw serviceUnavailable("ADE is shutting down");
		if (this.#credentialChangeBusy || credentialRevision !== this.#credentialRevision) {
			throw conflict("Model credentials changed. Retry the message.");
		}
		if (this.#active.has(key) || this.#recovering.has(key) ||
			(chatId ? this.#db.prepare("SELECT 1 FROM turns WHERE chatId=? AND status='pending' LIMIT 1").get(chatId)
				: taskId ? this.#db.prepare("SELECT 1 FROM turns WHERE taskId=? AND status='pending' LIMIT 1").get(taskId)
				: this.#db.prepare("SELECT 1 FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL AND status='pending' LIMIT 1").get(sessionMode))) {
			const alreadyAdmitted = await this.#existingTurn(sessionMode, taskId, chatId, normalizedSend, key);
			if (alreadyAdmitted) return alreadyAdmitted;
			throw conflict("This conversation has a turn in progress or awaiting recovery");
		}
		if (task) {
			const otherTasks = this.#db.prepare("SELECT id FROM coding_tasks WHERE id<>? AND workspaceDev=? AND workspaceIno=?").all(taskId, task.workspaceDev, task.workspaceIno) as { id: string }[];
			if (otherTasks.some(other => this.#active.has(other.id) || this.#recovering.has(other.id) ||
				this.#db.prepare("SELECT 1 FROM turns WHERE taskId=? AND status='pending'").get(other.id))) {
				throw conflict("Another task is already working in this checkout. Use a separate worktree for concurrent work.");
			}
		}
		if (!config.configured) throw serviceUnavailable(config.setupMessage || "The selected model provider is not configured");
		const modelId = normalizedSend.model || config.defaultModel;
		if (!modelId || !config.resolveModel(modelId)) {
			throw badRequest(`Model "${modelId || "(none)"}" is not available from ${config.provider}`);
		}
		const reasoning = normalizedSend.reasoning ?? "medium";
		if (!["none", "off", "low", "medium", "high", "xhigh", "max"].includes(reasoning)) {
			throw badRequest("Reasoning must be none, off, low, medium, high, xhigh, or max");
		}
		const now = Date.now();
		const turn = { id: normalizedSend.id ?? randomUUID(), mode: sessionMode, taskId, chatId, content: normalizedSend.content.trim(), provider: config.provider, model: modelId, reasoning };
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			if (chat) {
				const firstTurn = !this.#db.prepare("SELECT 1 FROM turns WHERE chatId=? LIMIT 1").get(chatId);
				if (firstTurn && !chat.manuallyNamed) {
					const title = turn.content.replace(/\s+/g, " ").trim().slice(0, 80);
					this.#db.prepare("UPDATE chat_threads SET title=? WHERE id=? AND manuallyNamed=0").run(title, chatId);
				}
			}
			this.#db.prepare("INSERT INTO turns (id,mode,content,provider,model,reasoning,status,createdAt,updatedAt,taskId,chatId) VALUES (?,?,?,?,?,?,'pending',?,?,?,?)")
				.run(turn.id, sessionMode, turn.content, turn.provider, modelId, reasoning, now, now, taskId, chatId);
			this.#db.exec("COMMIT");
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
		const operation = this.#executeTurn(turn, config);
		if (normalizedSend.async) {
			operation.catch((error) => {
				logger.error("Async turn execution failed", { error, sessionId: key });
			});
			return this.sessions().find(item => item.id === key);
		}
		return operation;
	}

	async #openSession(mode: SessionMode, config: ModelConfigResult, modelId: string, reasoning: string, taskId: string | null, chatId: string | null): Promise<OpenSession> {
		const key = chatId ?? taskId ?? mode;
		const task = taskId ? (this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(taskId) as CodingTaskRow | undefined) ?? null : null;
		if (taskId) {
			if (!task || task.status !== "ready") throw new Error("The task workspace is unavailable.");
			await this.#verifyTaskWorkspace(task);
		}
		const skillsCatalog = discoverSkillsAndRules(task?.workspace ?? null);
		const skillsPrompt = buildSkillsAndRulesPrompt(skillsCatalog);
		const baseInstructions = task
			? `You are ADE's coding lead inside an Agentic Development Environment. ${task.workspace ? "You have full workspace tools (list_files, read, write, edit, grep_search, find_files) and shell command tools (run_command, manage_process) in the bound workspace." : "This session has no bound local workspace: do not claim local file access."} You can spawn 1 or more parallel subagents using spawn_subagent (readonly, workspace, or isolated worktree mode; foreground or background) and coordinate with message_subagent, wait_subagent, list_subagents, and stop_subagent. You also have built-in browser tools (browser_navigate, browser_snapshot, browser_click, browser_type, browser_scroll, browser_screenshot, browser_eval, browser_open_external), structured artifact tools (write_artifact, update_tasks), and skills (read_skill). Keep responses concise and well-structured.`
			: modes[mode].instructions;
		const instructions = skillsPrompt ? `${baseInstructions}\n\n${skillsPrompt}` : baseInstructions;
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
		const registry = createRegistry();
		const identity = task?.workspace && task.workspaceDev && task.workspaceIno ? { dev: task.workspaceDev, ino: task.workspaceIno } : null;
		const workspaceExt = task?.workspace && identity ? createWorkspaceTools(task.workspace, identity) : null;
		const searchExt = task?.workspace && identity ? createSearchTools(task.workspace, identity) : null;
		const shellExt = task?.workspace && identity ? createShellTools({ sessionId: key, workspace: task.workspace, identity, processes: this.processes }) : null;
		if (workspaceExt) registry.install(workspaceExt);
		if (searchExt) registry.install(searchExt);
		if (shellExt) registry.install(shellExt);
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
				processes: this.processes,
				events: this.events,
				onSubagentCreated: (convId) => {
					const current = this.#sessions.get(key);
					if (current) void this.#watchConversation(key, current.harness, convId, true);
				},
			}));
		}
		if (task || mode === "coding") {
			registry.install(createBrowserTools(this.browser));
		}
		registry.install(this.artifacts.createExtension(key));
		registry.install(createSkillsExtension(task?.workspace ?? null));
		const mcpExt = this.mcp.createExtension();
		if (mcpExt) registry.install(mcpExt);

		let harnessRef: Harness | null = null;
		registry.install(this.approvals.createExtension(key, () => harnessRef));

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
			await this.#watchConversation(key, harness, ROOT_CONVERSATION_ID, false);
			return session;
		} catch (error) {
			await harness.close(context);
			throw error;
		}
	}

	async #executeTurn(
		turn: { id: string; mode: SessionMode; taskId: string | null; chatId: string | null; content: string; provider: string | null; model: string; reasoning: string },
		config: ModelConfigResult,
		recovery = false,
	) {
		const key = turn.chatId ?? turn.taskId ?? turn.mode;
		if (this.#active.has(key)) throw conflict("This conversation is already processing a turn");
		const operation = (async () => {
			this.events.emit("sessions.changed", { sessionId: key, status: "working" }, key);
			try {
				const session = await this.#openSession(turn.mode, config, turn.model, turn.reasoning, turn.taskId, turn.chatId);
				const submission = await session.root.submit({
					type: "input",
					content: turn.content,
					requestId: `ade:${turn.id}`,
					whenBusy: "reject",
				}, context);
				const settled = await submission.wait(context);
				if (settled.status !== "done" || settled.type !== "input") {
					const detail = settled.status === "unanswered" && settled.detail && config.provider !== copilotId
						? ` (${this.safeErrorMessage(JSON.stringify(settled.detail))})` : "";
					const error = settled.status === "unanswered"
						? `Turn ended without an answer: ${settled.reason}${detail}${config.provider === copilotId && settled.reason === "model_error" ? ". Check your Copilot access or reconnect in Settings." : ""}`
						: `Turn ended with status "${settled.status}"`;
					this.#finishTurn(turn.id, "failed", null, error);
					throw badGateway(error);
				}
				const transcript = await session.root.context(context);
				const assistantMessage = [...transcript.messages].reverse().find((message) => message.role === "assistant");
				const answer = plainText(assistantMessage?.content);
				if (!answer.trim()) throw new Error("The model completed without a text response");
				this.#finishTurn(turn.id, "completed", answer, null);
				return this.sessions().find((item) => item.id === key);
			} catch (error) {
				const current = this.#db.prepare("SELECT status FROM turns WHERE id=?").get(turn.id) as { status: string } | undefined;
				const safeMessage = config.provider === copilotId && current?.status === "pending"
					? "The Copilot turn could not be confirmed." : this.safeErrorMessage(error);
				if (current?.status === "pending") {
					const detail = recovery
						? `Turn recovery could not be confirmed: ${safeMessage}`
						: `Turn outcome is uncertain; restart ADE to reconnect safely: ${safeMessage}`;
					this.#finishTurn(turn.id, recovery ? "blocked" : "pending", null, detail);
				}
				const message = recovery
					? `Saved turn ${turn.id} could not be reconnected`
					: safeMessage;
				const statusCode = (error as { statusCode?: number })?.statusCode ?? 502;
				throw httpError(statusCode, message);
			} finally {
				this.#active.delete(key);
				this.events.emit("sessions.changed", { sessionId: key, status: "idle" }, key);
			}
		})();
		this.#active.set(key, operation);
		return operation;
	}

	#finishTurn(id: string, status: TurnRow["status"], answer: string | null, error: string | null) {
		this.#db.prepare("UPDATE turns SET status=?,answer=?,error=?,updatedAt=? WHERE id=?")
			.run(status, answer, error, Date.now(), id);
	}

	async #resumeSavedTurn(row: TurnRow, providedConfig: ModelConfigResult | undefined) {
		const key = row.chatId ?? row.taskId ?? row.mode;
		try {
			if (this.#active.has(key)) {
				await this.#active.get(key);
				return;
			}
			if (row.taskId) {
				const task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(row.taskId) as CodingTaskRow | undefined;
				if (!task || task.status !== "ready") {
					this.#finishTurn(row.id, "blocked", null, `Workspace needs attention; the saved message was not submitted. ${task?.message ?? ""}`);
					return;
				}
				await this.#verifyTaskWorkspace(task);
				const others = this.#db.prepare("SELECT id FROM coding_tasks WHERE id<>? AND workspaceDev=? AND workspaceIno=?").all(task.id, task.workspaceDev, task.workspaceIno) as { id: string }[];
				const earlier = this.#db.prepare("SELECT 1 FROM turns WHERE taskId=? AND status='pending' AND (createdAt<? OR (createdAt=? AND id<?)) LIMIT 1");
				if (others.some(other => this.#active.has(other.id) || earlier.get(other.id, row.createdAt, row.createdAt, row.id))) {
					this.#finishTurn(row.id, "blocked", null, "Another task is working in this checkout; the saved message was not submitted. Use a separate worktree for concurrent work.");
					return;
				}
			}
			const config = providedConfig ?? await this.#modelConfig(row.provider ?? undefined);
			if (!config.configured) {
				this.#finishTurn(row.id, "pending", null, `Reconnect ${config.provider}, then restart ADE to recover this turn. ${config.setupMessage}`);
				return;
			}
			if (!config.resolveModel(row.model)) {
				this.#finishTurn(row.id, "blocked", null, `Saved model "${row.model}" is not available from ${config.provider}.`);
				return;
			}
			await this.#executeTurn(row, config, true);
		} catch (error) {
			const rowStatus = (this.#db.prepare("SELECT status FROM turns WHERE id=?").get(row.id) as { status: string } | undefined)?.status;
			if (rowStatus === "pending") {
				this.#finishTurn(row.id, "blocked", null, `Could not recover the saved turn: ${this.safeErrorMessage(error)}`);
			}
		}
	}

	async recover(manager?: WorktreeManager) {
		if (manager) {
			const provisioningTasks = this.#db.prepare("SELECT * FROM coding_tasks WHERE status='provisioning'").all() as CodingTaskRow[];
			for (const task of provisioningTasks) {
				await this.#ensureProvisioned(task, manager);
			}
		}
		const pending = this.#db.prepare("SELECT * FROM turns WHERE status='pending' ORDER BY createdAt, id").all() as TurnRow[];
		for (const row of pending) {
			const key = row.chatId ?? row.taskId ?? row.mode;
			if (this.#recovering.has(key)) continue;
			this.#recovering.add(key);
			try {
				await this.#resumeSavedTurn(row, undefined);
			} finally {
				this.#recovering.delete(key);
			}
		}
	}

	async close() {
		this.#closing = true;
		await this.#runtimeModels?.signIn.cancel();
		await Promise.allSettled(this.#active.values());
		for (const watch of this.#watches.values()) {
			try {
				await watch.stop();
			} catch (error) {
				logger.debug("Failed to stop conversation watch during host close", { error });
			}
		}
		this.#watches.clear();
		this.processes.close();
		this.browser.close();
		this.mcp.close();
		await this.factoryRunner.close();
		this.#captainHost.close();
		this.events.close();
		await Promise.all([...this.#sessions.values()].map(({ harness }) => harness.close(context)));
		this.#sessions.clear();
		this.#db.close();
	}
}
