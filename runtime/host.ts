import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
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
import { ApprovalManager } from "./approvals.ts";
import { createShellTools, ProcessManager } from "./shell-tools.ts";
import { createSearchTools } from "./search-tools.ts";
import { createSubagentTools } from "./subagents.ts";
import { BrowserManager, createBrowserTools } from "./browser.ts";
import { ArtifactManager } from "./artifacts.ts";
import { buildSkillsAndRulesPrompt, createSkillsExtension, discoverSkillsAndRules } from "./skills.ts";
import { McpManager } from "./mcp.ts";
import { projectTimeline, type ConversationTimelineSnapshot } from "./timeline.ts";
import { CaptainCore } from "../packages/captain-core/index.ts";
import { createNodeSqliteCaptainHost } from "../packages/host-node/index.ts";
import { LocalFactoryRunner } from "./factory-runner.ts";
import { createPiFactoryStageExecutor } from "./factory-pi-executor.ts";

const modes = {
	coding: {
		label: "Coding lead",
		instructions: "You are ADE's coding lead. Help with software engineering requests, architecture, planning, and browser inspection. You can write artifacts (write_artifact), manage checklists (update_tasks), and use browser tools. If a question depends on local repository files not yet connected to a workspace, explain that clearly.",
	},
	personal: {
		label: "Personal agent",
		instructions: "You are ADE's personal agent. Help the user with questions, research, and planning. You can create structured artifacts (write_artifact) and checklists (update_tasks).",
	},
};

const execFileAsync = promisify(execFile);

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

function plainText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((part) => part?.type === "text").map((part) => part.text).join("");
}

export class LocalAgentHost {
	#db;
	#sessions = new Map();
	#watches = new Map<string, any>();
	#active = new Map();
	#modelConfigFactory;
	#runtimeModels;
	#environment;
	#stateDirectory;
	#closing = false;
	#recovering = new Set();
	#provisioning = new Map();
	#githubIssueFetcher;
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
		modelConfigFactory?: any;
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

	#serializeProject(row: any) {
		if (!row) return null;
		let stageOverrides: Record<string, { provider: string; model: string }> | undefined;
		if (typeof row.stageOverridesJson === "string" && row.stageOverridesJson.trim()) {
			try {
				stageOverrides = JSON.parse(row.stageOverridesJson);
			} catch {
				// ignore malformed json
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
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	projects() {
		return this.#db.prepare("SELECT * FROM projects ORDER BY createdAt,id").all().map(row => this.#serializeProject(row));
	}

	githubConnection() {
		const connection = this.#db.prepare("SELECT login FROM github_connection WHERE id=1").get();
		return { login: connection?.login ?? null };
	}

	githubAutoConnectEnabled() {
		return this.#db.prepare("SELECT auto_connect FROM github_connection_preferences WHERE id=1").get()?.auto_connect !== 0;
	}

	connectGitHub(login) {
		if (typeof login !== "string" || !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(login)) {
			throw Object.assign(new Error("GitHub CLI did not return a valid account."), { statusCode: 502 });
		}
		const previous = this.githubConnection().login;
		if (previous && previous.toLowerCase() !== login.toLowerCase()) {
			throw Object.assign(new Error("The GitHub CLI account changed. Disconnect it in Settings before connecting another account."), { statusCode: 409 });
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

	async lookupGitHubIssue(projectId, url) {
		const project = this.#db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
		return lookupGitHubIssue({ project, url, fetcher: this.#githubIssueFetcher });
	}

	renameCodingTask(id, title) {
		if (typeof title !== "string" || !title.trim() || title.length > 200) {
			throw Object.assign(new Error("Provide a session name of up to 200 characters."), { statusCode: 400 });
		}
		const result = this.#db.prepare("UPDATE coding_tasks SET initialTitle=COALESCE(initialTitle,title),title=? WHERE id=?").run(title.trim(), id);
		if (!result.changes) throw Object.assign(new Error("Session not found."), { statusCode: 404 });
		return this.sessions().find(item => item.id === id);
	}

	createChatThread(input) {
		if (typeof input?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) ||
			!Object.hasOwn(modes, input.mode)) {
			throw Object.assign(new Error("Provide a valid chat ID and mode."), { statusCode: 400 });
		}
		const existing = this.#db.prepare("SELECT * FROM chat_threads WHERE id=?").get(input.id);
		if (existing) {
			if (existing.mode !== input.mode) throw Object.assign(new Error("This chat ID already belongs to a different conversation."), { statusCode: 409 });
			return this.sessions().find(item => item.id === input.id);
		}
		this.#db.prepare("INSERT INTO chat_threads (id,mode,title,createdAt) VALUES (?,?,?,?)")
			.run(input.id, input.mode, "New chat", Date.now());
		return this.sessions().find(item => item.id === input.id);
	}

	renameChatThread(id, title) {
		if (typeof title !== "string" || !title.trim() || title.length > 200) {
			throw Object.assign(new Error("Provide a chat name of up to 200 characters."), { statusCode: 400 });
		}
		const result = this.#db.prepare("UPDATE chat_threads SET title=?,manuallyNamed=1 WHERE id=?").run(title.trim(), id);
		if (!result.changes) throw Object.assign(new Error("Chat not found."), { statusCode: 404 });
		return this.sessions().find(item => item.id === id);
	}

	deleteChatThread(id: string) {
		this.#db.prepare("DELETE FROM turns WHERE chatId=?").run(id);
		const result = this.#db.prepare("DELETE FROM chat_threads WHERE id=?").run(id);
		if (!result.changes) throw Object.assign(new Error("Chat not found."), { statusCode: 404 });
		return { deleted: true, id };
	}

	deleteCodingTask(id: string) {
		this.#db.prepare("DELETE FROM turns WHERE taskId=?").run(id);
		const result = this.#db.prepare("DELETE FROM coding_tasks WHERE id=?").run(id);
		if (!result.changes) throw Object.assign(new Error("Session not found."), { statusCode: 404 });
		return { deleted: true, id };
	}

	forkSession(sourceId: string) {
		const newId = randomUUID();
		const now = Date.now();
		const chat = this.#db.prepare("SELECT * FROM chat_threads WHERE id=?").get(sourceId) as any;
		if (chat) {
			const forkTitle = `${chat.title} (fork)`.slice(0, 200);
			this.#db.prepare("INSERT INTO chat_threads (id,mode,title,manuallyNamed,createdAt) VALUES (?,?,?,?,?)")
				.run(newId, chat.mode, forkTitle, 1, now);
			const rows = this.#db.prepare("SELECT * FROM turns WHERE chatId=? ORDER BY createdAt ASC").all(sourceId) as any[];
			const insertTurn = this.#db.prepare(
				"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,chatId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			);
			for (const row of rows) {
				insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, newId);
			}
			return this.sessions().find(item => item.id === newId);
		}
		const task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(sourceId) as any;
		if (task) {
			const forkTitle = `${task.title} (fork)`.slice(0, 200);
			this.#db.prepare(
				"INSERT INTO coding_tasks (id,title,repository,kind,base,branch,workspace,status,message,createdAt,projectId,initialTitle) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			).run(newId, forkTitle, task.repository, task.kind, task.base, task.branch, task.workspace, task.status, task.message, now, task.projectId ?? null, forkTitle);
			const rows = this.#db.prepare("SELECT * FROM turns WHERE taskId=? ORDER BY createdAt ASC").all(sourceId) as any[];
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
			const rows = this.#db.prepare("SELECT * FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL ORDER BY createdAt ASC").all(sourceId) as any[];
			const insertTurn = this.#db.prepare(
				"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,chatId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			);
			for (const row of rows) {
				insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, newId);
			}
			return this.sessions().find(item => item.id === newId);
		}
		throw Object.assign(new Error("Session not found."), { statusCode: 404 });
	}

	moveSession(sourceId: string, opts: { mode?: "coding" | "personal"; projectId?: string | null }) {
		const task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(sourceId) as any;
		if (task) {
			if (opts.projectId !== undefined) {
				const targetProjectId = opts.projectId ? String(opts.projectId) : null;
				if (targetProjectId) {
					const proj = this.#db.prepare("SELECT id, repository FROM projects WHERE id=?").get(targetProjectId) as any;
					if (!proj) throw Object.assign(new Error("Target project not found."), { statusCode: 404 });
					this.#db.prepare("UPDATE coding_tasks SET projectId=?, repository=CASE WHEN repository='' THEN ? ELSE repository END WHERE id=?")
						.run(targetProjectId, proj.repository ?? "", sourceId);
				} else {
					this.#db.prepare("UPDATE coding_tasks SET projectId=NULL WHERE id=?").run(sourceId);
				}
			}
			return this.sessions().find(item => item.id === sourceId);
		}
		const chat = this.#db.prepare("SELECT * FROM chat_threads WHERE id=?").get(sourceId) as any;
		if (chat) {
			if (opts.projectId) {
				const proj = this.#db.prepare("SELECT id, repository FROM projects WHERE id=?").get(opts.projectId) as any;
				if (!proj) throw Object.assign(new Error("Target project not found."), { statusCode: 404 });
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
		throw Object.assign(new Error("Session not found."), { statusCode: 404 });
	}

	async saveProject(input, id) {
		const projectId = id ?? input?.id;
		if (typeof projectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId) ||
			typeof input?.name !== "string" || !input.name.trim() || input.name.length > 100 ||
			(input.githubUrl != null && typeof input.githubUrl !== "string") ||
			(input.repository != null && typeof input.repository !== "string")) {
			throw Object.assign(new Error("Provide a project ID, name and optional repository links."), { statusCode: 400 });
		}
		let githubUrl = null;
		if (input.githubUrl?.trim()) {
			const match = /^(?:https:\/\/github\.com\/)?([a-z0-9-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(input.githubUrl.trim());
			if (!match || [".", ".."].includes(match[2])) {
				throw Object.assign(new Error("Use a GitHub repository URL or owner/repository, without credentials or query parameters."), { statusCode: 400 });
			}
			githubUrl = `https://github.com/${match[1]}/${match[2]}`;
		}
		const repository = input.repository?.trim() ? await resolveCheckout(input.repository.trim()) : null;
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
			if (!existing) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
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
				throw Object.assign(new Error("This project ID already belongs to different inputs."), { statusCode: 409 });
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
		return this.#serializeProject(this.#db.prepare("SELECT * FROM projects WHERE id=?").get(projectId));
	}

	deleteProject(id: string) {
		const existing = this.#db.prepare("SELECT * FROM projects WHERE id=?").get(id);
		if (!existing) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
		this.#db.prepare("UPDATE coding_tasks SET projectId=NULL WHERE projectId=?").run(id);
		this.#db.prepare("DELETE FROM projects WHERE id=?").run(id);
		return { deleted: true, id };
	}

	setWorktreeManager(manager: WorktreeManager): void {
		this.#worktreeManager = manager;
	}

	getWorkspacePath(sessionId: string): string | null {
		const task = this.#db.prepare("SELECT workspace, status, kind FROM coding_tasks WHERE id=?").get(sessionId) as any;
		if (!task || task.kind === "none" || task.status !== "ready" || !task.workspace) return null;
		return task.workspace;
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

	async #watchConversation(sessionId: string, harness: any, conversationId: string | number, isSubagent: boolean): Promise<void> {
		const convKey = String(conversationId);
		const watchKey = `${sessionId}:${convKey}`;
		if (this.#watches.has(watchKey)) return;
		try {
			const conv = await harness.conversation(conversationId, context);
			if (!conv) return;
			const watch = await conv.watch(context, { min: 100, max: 200 });
			this.#watches.set(watchKey, watch);
			const emitView = (view: any) => {
				const snapshot = projectTimeline({
					sessionId,
					conversationId: convKey,
					entries: view?.entries ?? [],
					live: view?.docs?.["pi.live"],
					usage: view?.docs?.["pi.usage"],
				});
				this.events.emit("timeline.update", { ...snapshot, isSubagent }, sessionId);
				if (isSubagent) {
					this.events.emit("subagents.update", { sessionId, subagentId: convKey, busy: snapshot.busy }, sessionId);
				}
			};
			emitView(watch.value);
			watch.start((call: any) => {
				if (call.kind === "value") emitView(call.value);
			});
		} catch {
			// non-fatal watch error
		}
	}

	async getTimeline(sessionId: string, conversationId?: string): Promise<ConversationTimelineSnapshot> {
		const open = this.#sessions.get(sessionId);
		const dbPath = this.#sessionDbPath(sessionId);
		const targetId: any = conversationId !== undefined ? (/^\d+$/.test(conversationId) ? Number(conversationId) : conversationId) : ROOT_CONVERSATION_ID;
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
			const live = await harness.snapshot(LiveDoc, targetId, context);
			const usage = await harness.snapshot(UsageDoc, targetId, context);
			return projectTimeline({ sessionId, conversationId: String(targetId), entries, live, usage });
		} finally {
			if (ownReader) await harness.close(context);
		}
	}

	async steerOrFollowUp(sessionId: string, content: string, mode: "steer" | "follow-up" = "steer"): Promise<{ ok: boolean; mode: string }> {
		const trimmed = typeof content === "string" ? content.trim() : "";
		if (!trimmed || trimmed.length > 8000) {
			throw Object.assign(new Error("Enter a message between 1 and 8000 characters."), { statusCode: 400 });
		}
		const open = this.#sessions.get(sessionId);
		if (!open) throw Object.assign(new Error("Session is not currently active."), { statusCode: 409 });
		await open.root.submit({ type: "input", content: trimmed, whenBusy: mode }, context);
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
		if (!open) throw Object.assign(new Error("Open or send a message in this session before compacting."), { statusCode: 409 });
		await open.root.compact(instructions, context);
		return { ok: true };
	}

	async messageSubagent(sessionId: string, subagentId: string, message: string, mode: "steer" | "follow-up" = "follow-up"): Promise<{ ok: boolean }> {
		const trimmed = typeof message === "string" ? message.trim() : "";
		if (!trimmed) throw Object.assign(new Error("Provide a message for the subagent."), { statusCode: 400 });
		const open = this.#sessions.get(sessionId);
		if (!open) throw Object.assign(new Error("Session is not currently open."), { statusCode: 409 });
		const convId: any = /^\d+$/.test(subagentId) ? Number(subagentId) : subagentId;
		const conv = await open.harness.conversation(convId, context);
		if (!conv) throw Object.assign(new Error("Subagent not found."), { statusCode: 404 });
		await this.#watchConversation(sessionId, open.harness, convId, true);
		await conv.submit({ type: "input", content: trimmed, whenBusy: mode }, context);
		this.events.emit("subagents.update", { sessionId, subagentId: String(convId) }, sessionId);
		return { ok: true };
	}

	async stopSubagent(sessionId: string, subagentId: string): Promise<{ ok: boolean }> {
		const open = this.#sessions.get(sessionId);
		if (!open) return { ok: true };
		const convId: any = /^\d+$/.test(subagentId) ? Number(subagentId) : subagentId;
		const conv = await open.harness.conversation(convId, context);
		if (!conv) throw Object.assign(new Error("Subagent not found."), { statusCode: 404 });
		await conv.abort(context);
		this.events.emit("subagents.update", { sessionId, subagentId: String(convId) }, sessionId);
		return { ok: true };
	}

	async featureAgents(taskId) {
		const task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(taskId);
		if (!task) throw Object.assign(new Error("Feature not found."), { statusCode: 404 });
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
		try {
			const live = await harness.inspect(context);
			const agents = [];
			let cursor;
			do {
				const page = await harness.commit(tx => tx.scanConversations({}, 100, cursor), context);
				for (const record of page.items) {
					if (record.id === ROOT_CONVERSATION_ID) continue;
					const conversation = await harness.conversation(record.id, context);
					if (!conversation) continue;
					const transcript = await conversation.context(context);
					const metadata = transcript.entries.find(entry => entry.kind === "ade.assignment")?.data;
					if (!record.owner && !metadata) continue;
					const latest = record.owner
						? await harness.commit(tx => tx.submissionByRequest(record.id, `ade-delegate:${record.owner.taskId}`), context)
						: null;
					const tasks = live.tasks.filter(item => item.record.conversationId === record.id);
					const pending = live.submissions.some(item => item.conversationId === record.id);
					const liveDoc = await harness.snapshot(LiveDoc, record.id, context);
					const { items: rawEntries } = await conversation.entries({ order: "ascending" }, 200, undefined, context);
					const timeline = projectTimeline({ sessionId: taskId, conversationId: record.id, entries: rawEntries, live: liveDoc });
					const hasAssistantReply = transcript.messages.some((m: any) => m.role === "assistant" && plainText(m.content).trim());
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

	async projectAgents(projectId) {
		if (!this.#db.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) {
			throw Object.assign(new Error("Project not found."), { statusCode: 404 });
		}
		const sessions = this.#db.prepare("SELECT id,title FROM coding_tasks WHERE projectId=? ORDER BY createdAt DESC").all(projectId);
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
	#modelConfig(provider) {
		return this.#runtimeModels?.config(provider) ?? this.#modelConfigFactory(this.#environment, provider);
	}

	async modelCatalog() {
		const scanned = await this.providerTools({});
		const apiConfigs = new Map<string, any>();
		const runtimeProviders = this.#runtimeModels?.providers ?? [];
		for (const p of runtimeProviders) {
			try {
				apiConfigs.set(p.id, await this.#modelConfig(p.id));
			} catch {
				// ignore unconfigured provider
			}
		}

		const results = [];
		for (const tool of scanned.providers) {
			if (!tool.enabled) continue;
			const apiCfg = apiConfigs.get(tool.id);
			const models = apiCfg?.availableModels?.length
				? apiCfg.availableModels
				: Array.isArray(tool.models) ? tool.models : [];
			const defaultModel = apiCfg?.defaultModel || models[0]?.id || "default";
			results.push({
				id: tool.id,
				name: tool.name,
				kind: tool.kind,
				configured: Boolean(apiCfg ? apiCfg.configured : tool.available),
				enabled: Boolean(tool.enabled),
				defaultModel,
				setupMessage: apiCfg?.setupMessage ?? (tool.available ? "" : tool.install ?? ""),
				models,
			});
		}

		// If nothing was enabled in preferences yet, fall back to active model config
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
		return { providers: results };
	}

	async health(provider) {
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

	async copilotAuth(action) {
		const signIn = this.#runtimeModels?.signIn;
		if (!signIn) throw Object.assign(new Error("Copilot sign-in is unavailable."), { statusCode: 404 });
		if (action === "start") return signIn.start();
		if (action === "cancel") return signIn.cancel();
		if (action === "sign-out") {
			if (this.#active.size) throw Object.assign(new Error("Wait for active turns to finish before signing out."), { statusCode: 409 });
			return signIn.signOut();
		}
		throw Object.assign(new Error("Unknown Copilot sign-in action."), { statusCode: 400 });
	}

	safeErrorMessage(error) {
		return this.#runtimeModels?.safeErrorMessage(error) ?? safeErrorMessage(error, this.#environment);
	}

	async modelCredentials(input) {
		if (!this.#runtimeModels) throw Object.assign(new Error("Model credentials are unavailable."), { statusCode: 404 });
		if (input?.action === "status") return { credentials: await this.#runtimeModels.credentialStatus() };
		if (this.#credentialChangeBusy || this.#active.size || this.#recovering.size || this.#provisioning.size) {
			throw Object.assign(new Error("Wait for active work to finish before changing model credentials."), { statusCode: 409 });
		}
		this.#credentialChangeBusy = true;
		this.#credentialRevision++;
		try {
			return { credentials: await this.#runtimeModels.changeCredential(input?.action, input?.provider, input?.key) };
		} finally {
			this.#credentialChangeBusy = false;
		}
	}

	async providerTools(input) {
		if (input?.action === "set") {
			if (typeof input.id !== "string" || typeof input.enabled !== "boolean") {
				throw Object.assign(new Error("Provide a provider id and enabled state."), { statusCode: 400 });
			}
			this.#db.prepare("INSERT INTO provider_preferences(id,enabled) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled")
				.run(input.id, input.enabled ? 1 : 0);
		}
		const scanned = await scanProviderTools();
		const preferences = new Map(this.#db.prepare("SELECT id,enabled FROM provider_preferences").all().map(item => [item.id, Boolean(item.enabled)]));
		const providers = [...scanned];

		if (this.#runtimeModels) {
			for (const id of ["openai", "anthropic", "compatible", "radius", copilotId]) {
				try {
					const config = await this.#runtimeModels.config(id);
					const names = {
						openai: "OpenAI",
						anthropic: "Anthropic",
						compatible: "OpenAI-compatible",
						radius: "Pi",
						"github-copilot": "GitHub Copilot",
					};
					providers.push({
						id,
						name: names[id],
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
						name: id === "openai" ? "OpenAI" : id === "anthropic" ? "Anthropic" : id === "compatible" ? "OpenAI-compatible" : id === "radius" ? "Pi" : "GitHub Copilot",
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
				enabled: preferences.has(provider.id) ? preferences.get(provider.id) : provider.available,
			})),
		};
	}

	sessions() {
		const tasks = this.#db.prepare("SELECT * FROM coding_tasks ORDER BY createdAt DESC").all();
		const chats = this.#db.prepare("SELECT * FROM chat_threads ORDER BY createdAt DESC").all();
		const definitions = [
			...Object.entries(modes).map(([mode, definition]) => ({ id: mode, mode, label: definition.label, task: null })),
			...chats.map(chat => ({ id: chat.id, mode: chat.mode, label: chat.title, chat })),
			...tasks.map(task => ({ id: task.id, mode: "coding", label: task.title, task })),
		];
		return definitions.map(({ id, mode, label, task, chat }) => {
			const turns = chat
				? this.#db.prepare("SELECT * FROM turns WHERE chatId=? ORDER BY createdAt, id").all(id)
				: task
					? this.#db.prepare("SELECT * FROM turns WHERE taskId=? ORDER BY createdAt, id").all(id)
					: this.#db.prepare("SELECT * FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL ORDER BY createdAt, id").all(mode);
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
				...(task ? { workspace: { kind: task.kind, path: task.workspace, repository: task.repository, branch: task.branch, status: task.status, message: task.message } } : {}),
				...(task?.issueUrl ? { githubIssue: { url: task.issueUrl, repository: task.issueRepository, number: task.issueNumber, title: task.issueTitle, state: task.issueState } } : {}),
				messages,
			};
		});
	}

	async createCodingTask(input, manager) {
		const credentialRevision = this.#credentialRevision;
		if (typeof input?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) ||
			!["none", "checkout", "worktree"].includes(input.kind) || typeof input.repository !== "string" ||
			typeof input.title !== "string" || !input.title.trim() || input.title.length > 200) {
			throw Object.assign(new Error("Provide a task ID, title, repository and workspace choice."), { statusCode: 400 });
		}
		if (input.projectId != null && (typeof input.projectId !== "string" || !this.#db.prepare("SELECT 1 FROM projects WHERE id=?").get(input.projectId))) {
			throw Object.assign(new Error("Choose an existing project for this feature."), { statusCode: 400 });
		}
		const project = input.projectId ? this.#db.prepare("SELECT * FROM projects WHERE id=?").get(input.projectId) : null;
		const githubIssue = validateLinkedIssue(input.githubIssue, project);
		if (input.kind === "none" && input.repository.trim()) {
			throw Object.assign(new Error("A workspace-free feature cannot have a checkout path."), { statusCode: 400 });
		}
		let initial;
		let config;
		if (input.initialMessage !== undefined) {
			const message = input.initialMessage;
			if (typeof message?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.id) ||
				typeof message.content !== "string" || !message.content.trim() || message.content.length > 8000 ||
				typeof message.provider !== "string" || !message.provider || typeof message.model !== "string" || !message.model ||
				!["none", "off", "low", "medium", "high", "xhigh", "max"].includes(message.reasoning)) {
				throw Object.assign(new Error("Provide a valid initial message, provider, model and reasoning level."), { statusCode: 400 });
			}
			initial = { ...message, content: message.content.trim() };
		}
		if (this.#closing) throw Object.assign(new Error("ADE is shutting down"), { statusCode: 503 });
		const repository = input.kind === "none" ? "" : await resolveCheckout(input.repository);
		let task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(input.id);
		if (task) this.#verifyTaskInputs(task, input, repository, initial);
		if (!task) {
			const branch = input.kind === "worktree" ? `ade/task-${input.id}` : null;
			const base = input.kind === "worktree" ? await resolveBaseCommit(repository, "HEAD") : "HEAD";
			if (initial) {
				config = await this.#modelConfig(initial.provider);
				if (!config.configured) throw Object.assign(new Error(config.setupMessage || "The selected model provider is not configured"), { statusCode: 503 });
				if (config.provider !== initial.provider || !config.resolveModel(initial.model)) {
					throw Object.assign(new Error("The selected model is not available from this provider."), { statusCode: 400 });
				}
			}
			task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(input.id);
			if (task) this.#verifyTaskInputs(task, input, repository, initial);
			if (!task) {
				if (this.#closing) throw Object.assign(new Error("ADE is shutting down"), { statusCode: 503 });
				if (initial && (this.#credentialChangeBusy || credentialRevision !== this.#credentialRevision)) {
					throw Object.assign(new Error("Model credentials changed. Retry the message."), { statusCode: 409 });
				}
				const now = Date.now();
				this.#db.exec("BEGIN IMMEDIATE");
				try {
					if (initial && this.#db.prepare("SELECT 1 FROM turns WHERE id=?").get(initial.id)) {
						throw Object.assign(new Error("This initial message ID already belongs to another turn."), { statusCode: 409 });
					}
					this.#db.prepare("INSERT INTO coding_tasks (id,title,repository,kind,base,branch,status,createdAt,initialTurnId,projectId,initialTitle,issueUrl,issueRepository,issueNumber,issueTitle,issueState) VALUES (?,?,?,?,?,?,'provisioning',?,?,?,?,?,?,?,?,?)")
						.run(input.id, input.title.trim(), repository, input.kind, base, branch, now, initial?.id ?? null, input.projectId ?? null, input.title.trim(),
							githubIssue?.url ?? null, githubIssue?.repository ?? null, githubIssue?.number ?? null, githubIssue?.title ?? null, githubIssue?.state ?? null);
					if (initial) this.#db.prepare("INSERT INTO turns (id,mode,content,provider,model,reasoning,status,createdAt,updatedAt,taskId) VALUES (?,'coding',?,?,?,?,'pending',?,?,?)")
						.run(initial.id, initial.content, initial.provider, initial.model, initial.reasoning, now, now, input.id);
					this.#db.exec("COMMIT");
				} catch (error) {
					this.#db.exec("ROLLBACK");
					throw error;
				}
				task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(input.id);
			}
		}
		if (task.status === "provisioning") await this.#ensureProvisioned(task, manager);
		task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(input.id);
		if (initial && this.#db.prepare("SELECT status FROM turns WHERE id=?").get(initial.id)?.status === "pending") {
			if (task.status !== "ready") {
				this.#finishTurn(initial.id, "blocked", null, `Workspace needs attention; the saved message was not submitted. ${task.message ?? ""}`);
			} else if (!this.#recovering.has(task.id)) {
				this.#recovering.add(task.id);
				try {
					await this.#resumeSavedTurn(this.#db.prepare("SELECT * FROM turns WHERE id=?").get(initial.id), config);
				} finally {
					this.#recovering.delete(task.id);
				}
			}
		}
		return this.sessions().find(item => item.id === input.id);
	}

	#verifyTaskInputs(task, input, repository, initial) {
		const issue = input.githubIssue;
		if (task.repository !== repository || task.kind !== input.kind || (task.initialTitle ?? task.title) !== input.title.trim() ||
			task.initialTurnId !== (initial?.id ?? null) || task.projectId !== (input.projectId ?? null) ||
			task.issueUrl !== (issue?.url ?? null) || task.issueRepository !== (issue?.repository ?? null) || task.issueNumber !== (issue?.number ?? null) ||
			task.issueTitle !== (issue?.title ?? null) || task.issueState !== (issue?.state ?? null)) {
			throw Object.assign(new Error("This task ID already belongs to different inputs."), { statusCode: 409 });
		}
		if (initial) {
			const turn = this.#db.prepare("SELECT * FROM turns WHERE id=?").get(initial.id);
			if (!turn || turn.taskId !== task.id || turn.content !== initial.content || turn.provider !== initial.provider ||
				turn.model !== initial.model || turn.reasoning !== initial.reasoning) {
				throw Object.assign(new Error("This task ID already belongs to a different initial message."), { statusCode: 409 });
			}
		}
	}

	async #ensureProvisioned(task, manager) {
		if (!this.#provisioning.has(task.id)) {
			const work = this.#provisionTask(task, manager).finally(() => this.#provisioning.delete(task.id));
			this.#provisioning.set(task.id, work);
		}
		await this.#provisioning.get(task.id);
	}

	async #provisionTask(task, manager) {
		try {
			if (task.kind === "none") {
				this.#db.prepare("UPDATE coding_tasks SET status='ready' WHERE id=?").run(task.id);
				return;
			}
			let path = task.repository;
			let note = null;
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

	async #verifyTaskWorkspace(task) {
		if (task.kind === "none") return;
		try {
			const info = statSync(task.workspace, { bigint: true });
			if (String(info.dev) !== task.workspaceDev || String(info.ino) !== task.workspaceIno) {
				throw new Error("The task workspace has changed or been replaced.");
			}
			await resolveCheckout(task.workspace);
		} catch (error) {
			throw Object.assign(new Error(`Task workspace unavailable: ${this.safeErrorMessage(error)}. It will not be retargeted automatically.`), { statusCode: 409 });
		}
	}

	async #existingTurn(mode, taskId, chatId, input, key) {
		if (!input.id) return undefined;
		const existing = this.#db.prepare("SELECT * FROM turns WHERE id=?").get(input.id);
		if (!existing) return undefined;
		if (existing.mode !== mode || existing.taskId !== taskId || existing.chatId !== chatId || existing.content !== input.content.trim() ||
			(input.provider && existing.provider !== input.provider) || (input.model && existing.model !== input.model) ||
			(input.reasoning && existing.reasoning !== input.reasoning)) {
			throw Object.assign(new Error("This message ID was already used with different inputs."), { statusCode: 409 });
		}
		if (this.#active.has(key)) await this.#active.get(key);
		return this.sessions().find(item => item.id === key);
	}

	async send(mode, input, taskId = null, chatId = null) {
		const credentialRevision = this.#credentialRevision;
		if (!Object.hasOwn(modes, mode)) throw Object.assign(new Error("Unknown conversation"), { statusCode: 404 });
		const task = taskId ? this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(taskId) : null;
		if (taskId && (mode !== "coding" || !task || task.status !== "ready")) throw Object.assign(new Error("This coding task has no ready workspace."), { statusCode: 409 });
		const chat = chatId ? this.#db.prepare("SELECT * FROM chat_threads WHERE id=?").get(chatId) : null;
		if (chatId && (!chat || chat.mode !== mode || taskId)) throw Object.assign(new Error("This chat thread is unavailable."), { statusCode: 404 });
		const key = chatId ?? taskId ?? mode;
		if (this.#closing) throw Object.assign(new Error("ADE is shutting down"), { statusCode: 503 });
		if (typeof input?.content !== "string" || !input.content.trim() || input.content.length > 8000) {
			throw Object.assign(new Error("Enter a message between 1 and 8000 characters"), { statusCode: 400 });
		}
		if (input.id !== undefined) {
			if (typeof input.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) {
				throw Object.assign(new Error("Invalid message ID."), { statusCode: 400 });
			}
		}
		const existing = await this.#existingTurn(mode, taskId, chatId, input, key);
		if (existing) return existing;
		if (task) await this.#verifyTaskWorkspace(task);
		const config = await this.#modelConfig(input.provider);
		const admitted = await this.#existingTurn(mode, taskId, chatId, input, key);
		if (admitted) return admitted;
		if (this.#closing) throw Object.assign(new Error("ADE is shutting down"), { statusCode: 503 });
		if (this.#credentialChangeBusy || credentialRevision !== this.#credentialRevision) {
			throw Object.assign(new Error("Model credentials changed. Retry the message."), { statusCode: 409 });
		}
		if (this.#active.has(key) || this.#recovering.has(key) ||
			(chatId ? this.#db.prepare("SELECT 1 FROM turns WHERE chatId=? AND status='pending' LIMIT 1").get(chatId)
				: taskId ? this.#db.prepare("SELECT 1 FROM turns WHERE taskId=? AND status='pending' LIMIT 1").get(taskId)
				: this.#db.prepare("SELECT 1 FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL AND status='pending' LIMIT 1").get(mode))) {
			const alreadyAdmitted = await this.#existingTurn(mode, taskId, chatId, input, key);
			if (alreadyAdmitted) return alreadyAdmitted;
			throw Object.assign(new Error("This conversation has a turn in progress or awaiting recovery"), { statusCode: 409 });
		}
		if (task) {
			const otherTasks = this.#db.prepare("SELECT id FROM coding_tasks WHERE id<>? AND workspaceDev=? AND workspaceIno=?").all(taskId, task.workspaceDev, task.workspaceIno);
			if (otherTasks.some(other => this.#active.has(other.id) || this.#recovering.has(other.id) ||
				this.#db.prepare("SELECT 1 FROM turns WHERE taskId=? AND status='pending'").get(other.id))) {
				throw Object.assign(new Error("Another task is already working in this checkout. Use a separate worktree for concurrent work."), { statusCode: 409 });
			}
		}
		if (!config.configured) throw Object.assign(new Error(config.setupMessage || "The selected model provider is not configured"), { statusCode: 503 });
		const modelId = typeof input.model === "string" && input.model ? input.model : config.defaultModel;
		if (!modelId || !config.resolveModel(modelId)) {
			throw Object.assign(new Error(`Model "${modelId || "(none)"}" is not available from ${config.provider}`), { statusCode: 400 });
		}
		const reasoning = input.reasoning ?? "medium";
		if (!["none", "off", "low", "medium", "high", "xhigh", "max"].includes(reasoning)) {
			throw Object.assign(new Error("Reasoning must be none, off, low, medium, high, xhigh, or max"), { statusCode: 400 });
		}
		const now = Date.now();
		const turn = { id: input.id ?? randomUUID(), mode, taskId, chatId, content: input.content.trim(), provider: config.provider, model: modelId, reasoning };
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
				.run(turn.id, mode, turn.content, turn.provider, modelId, reasoning, now, now, taskId, chatId);
			this.#db.exec("COMMIT");
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
		const operation = this.#executeTurn(turn, config);
		if (input.async) {
			operation.catch(() => {});
			return this.sessions().find(item => item.id === key);
		}
		return operation;
	}

	async #openSession(mode, config, modelId, reasoning, taskId, chatId) {
		const key = chatId ?? taskId ?? mode;
		const task = taskId ? this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(taskId) : null;
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
		if (openSession) {
			await openSession.root.configure({
				model: { provider: config.provider, modelId },
				thinkingLevel: reasoning,
				instructions,
			}, context);
			return openSession;
		}
		const registry = createRegistry();
		const identity = task?.workspace ? { dev: task.workspaceDev, ino: task.workspaceIno } : null;
		const workspaceExt = task?.workspace && identity ? createWorkspaceTools(task.workspace, identity) : null;
		const searchExt = task?.workspace && identity ? createSearchTools(task.workspace, identity) : null;
		const shellExt = task?.workspace && identity ? createShellTools({ sessionId: key, workspace: task.workspace, identity, processes: this.processes }) : null;
		if (workspaceExt) registry.install(workspaceExt);
		if (searchExt) registry.install(searchExt);
		if (shellExt) registry.install(shellExt);
		if (task) {
			registry.install(createSubagentTools({
				sessionId: key,
				workspace: task.workspace ?? null,
				workspaceIdentity: identity,
				repository: task.repository ?? null,
				readTools: workspaceExt?.tools.filter(tool => ["read", "list_files"].includes(tool.name)) ?? [],
				workspaceTools: workspaceExt?.tools ?? [],
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

		let harnessRef: any = null;
		registry.install(this.approvals.createExtension(key, () => harnessRef));

		const harness = await Harness.open(
			await openNodeSqliteStorage(join(this.#stateDirectory, chatId ? `chat-thread-${chatId}.sqlite` : task ? `coding-task-${taskId}.sqlite` : `${mode}.sqlite`)),
			{ models: config.models, registry, ...(task?.workspace ? { env: () => new NodeExecutionEnv({ cwd: task.workspace }) } : {}) },
			context,
		);
		harnessRef = harness;
		try {
			const root = await harness.root(context, {
				agent: {
					model: { provider: config.provider, modelId },
					thinkingLevel: reasoning,
					instructions,
				},
			});
			await root.configure({
				model: { provider: config.provider, modelId },
				thinkingLevel: reasoning,
				instructions,
			}, context);
			const session = { harness, root };
			this.#sessions.set(key, session);
			harness.resume();
			await this.#watchConversation(key, harness, ROOT_CONVERSATION_ID, false);
			return session;
		} catch (error) {
			await harness.close(context);
			throw error;
		}
	}

	async #executeTurn(turn, config, recovery = false) {
		const key = turn.chatId ?? turn.taskId ?? turn.mode;
		if (this.#active.has(key)) throw Object.assign(new Error("This conversation is already processing a turn"), { statusCode: 409 });
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
					throw Object.assign(new Error(error), { statusCode: 502 });
				}
				const transcript = await session.root.context(context);
				const assistantMessage = [...transcript.messages].reverse().find((message) => message.role === "assistant");
				const answer = plainText(assistantMessage?.content);
				if (!answer.trim()) throw new Error("The model completed without a text response");
				this.#finishTurn(turn.id, "completed", answer, null);
				return this.sessions().find((item) => item.id === key);
			} catch (error) {
				const current = this.#db.prepare("SELECT status FROM turns WHERE id=?").get(turn.id);
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
				throw Object.assign(new Error(message), { statusCode: error.statusCode ?? 502 });
			} finally {
				this.#active.delete(key);
				this.events.emit("sessions.changed", { sessionId: key, status: "idle" }, key);
			}
		})();
		this.#active.set(key, operation);
		return operation;
	}

	#finishTurn(id, status, answer, error) {
		this.#db.prepare("UPDATE turns SET status=?,answer=?,error=?,updatedAt=? WHERE id=?")
			.run(status, answer, error, Date.now(), id);
	}

	async #resumeSavedTurn(row, providedConfig) {
		const key = row.chatId ?? row.taskId ?? row.mode;
		try {
			if (this.#active.has(key)) {
				await this.#active.get(key);
				return;
			}
			if (row.taskId) {
				const task = this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(row.taskId);
				if (!task || task.status !== "ready") {
					this.#finishTurn(row.id, "blocked", null, `Workspace needs attention; the saved message was not submitted. ${task?.message ?? ""}`);
					return;
				}
				await this.#verifyTaskWorkspace(task);
				const others = this.#db.prepare("SELECT id FROM coding_tasks WHERE id<>? AND workspaceDev=? AND workspaceIno=?").all(task.id, task.workspaceDev, task.workspaceIno);
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
			if (this.#db.prepare("SELECT status FROM turns WHERE id=?").get(row.id)?.status === "pending") {
				this.#finishTurn(row.id, "blocked", null, `Could not recover the saved turn: ${this.safeErrorMessage(error)}`);
			}
		}
	}

	async recover(manager) {
		if (manager) {
			for (const task of this.#db.prepare("SELECT * FROM coding_tasks WHERE status='provisioning'").all()) {
				await this.#ensureProvisioned(task, manager);
			}
		}
		const pending = this.#db.prepare("SELECT * FROM turns WHERE status='pending' ORDER BY createdAt, id").all();
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
			try { await watch.stop(); } catch { /* ignore */ }
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
