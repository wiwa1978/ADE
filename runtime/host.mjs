import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createRuntimeModels, safeErrorMessage } from "./models.mjs";
import { copilotId } from "./copilot-auth.mjs";
import { createWorkspaceTools } from "./coding-tools.mjs";
import { resolveBaseCommit, resolveCheckout } from "./worktrees.mjs";
import { createModels } from "@earendil-works/pi-ai/models";
import { createDelegationTools } from "./delegation.mjs";
import { lookupGitHubIssue, validateLinkedIssue } from "./github-issues.mjs";

const modes = {
	coding: {
		label: "Coding lead",
		instructions: "You are ADE's coding lead. Help with software engineering requests. No workspace tools are enabled yet: do not claim to inspect files, edit code, run commands, or access GitHub. Explain when an answer depends on a repository that is not connected.",
	},
	personal: {
		label: "Personal agent",
		instructions: "You are ADE's personal agent. Help the user with questions and planning. No external tools or account integrations are enabled; do not claim to access or change external services.",
	},
};

function plainText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((part) => part?.type === "text").map((part) => part.text).join("");
}

export class LocalAgentHost {
	#db;
	#sessions = new Map();
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

	constructor({ stateDirectory, environment = process.env, modelConfigFactory, githubIssueFetcher = fetch }) {
		if (!stateDirectory) throw new Error("A state directory is required");
		this.#stateDirectory = stateDirectory;
		this.#githubIssueFetcher = githubIssueFetcher;
		this.#environment = environment;
		this.#modelConfigFactory = modelConfigFactory;
		this.#runtimeModels = modelConfigFactory ? undefined : createRuntimeModels(environment, stateDirectory);
		mkdirSync(stateDirectory, { recursive: true });
		this.#db = new DatabaseSync(join(stateDirectory, "ade-host.sqlite"));
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
	}

	projects() {
		return this.#db.prepare("SELECT * FROM projects ORDER BY createdAt,id").all();
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
		const name = input.name.trim();
		const existing = this.#db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
		if (id) {
			if (!existing) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
			this.#db.prepare("UPDATE projects SET name=?,githubUrl=?,repository=?,updatedAt=? WHERE id=?").run(name, githubUrl, repository, Date.now(), id);
		} else if (existing) {
			if (existing.name !== name || existing.githubUrl !== githubUrl || existing.repository !== repository) {
				throw Object.assign(new Error("This project ID already belongs to different inputs."), { statusCode: 409 });
			}
		} else {
			const now = Date.now();
			this.#db.prepare("INSERT INTO projects VALUES (?,?,?,?,?,?)").run(projectId, name, githubUrl, repository, now, now);
		}
		return this.#db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
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
					if (!record.owner) continue;
					const conversation = await harness.conversation(record.id, context);
					const transcript = await conversation.context(context);
					const metadata = transcript.entries.find(entry => entry.kind === "ade.assignment")?.data;
					const latest = await harness.commit(tx => tx.submissionByRequest(record.id, `ade-delegate:${record.owner.taskId}`), context);
					const tasks = live.tasks.filter(item => item.record.conversationId === record.id);
					const pending = live.submissions.some(item => item.conversationId === record.id);
					const status = ownReader && (tasks.length || pending) ? "unknown"
						: tasks.some(item => item.state.kind === "blocked") ? "blocked"
						: tasks.some(item => item.state.kind === "running") ? "running"
							: tasks.length || pending ? "waiting" : latest?.status === "unanswered" ? "failed"
								: latest?.status === "done" ? "completed" : "unknown";
					const agent = await conversation.agent(context);
					agents.push({
						id: record.id, parentId: record.owner.conversationId, assignmentId: record.owner.taskId,
						name: metadata?.name ?? "Subagent", assignment: metadata?.task ?? "",
						status, model: agent.model?.modelId ?? null, reasoning: agent.thinkingLevel,
						error: latest?.status === "unanswered" ? latest.reason : null,
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
				!["none", "low", "medium", "high"].includes(message.reasoning)) {
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
		if (!["none", "low", "medium", "high"].includes(reasoning)) {
			throw Object.assign(new Error("Reasoning must be none, low, medium, or high"), { statusCode: 400 });
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
		return this.#executeTurn(turn, config);
	}

	async #openSession(mode, config, modelId, reasoning, taskId, chatId) {
		const key = chatId ?? taskId ?? mode;
		const task = taskId ? this.#db.prepare("SELECT * FROM coding_tasks WHERE id=?").get(taskId) : null;
		if (taskId) {
			if (!task || task.status !== "ready") throw new Error("The task workspace is unavailable.");
			await this.#verifyTaskWorkspace(task);
		}
		const instructions = task
			? `You are ADE's feature lead. ${task.workspace ? "Use the available file tools in the bound feature workspace. The workspace is not an OS security sandbox." : "This feature has no workspace: do not claim file access."} You may delegate bounded independent analysis with the delegate tool; subagents are read-only and use this feature's workspace, model and reasoning. Do not delegate trivial work. Do not claim to run commands, access GitHub, or use tools you do not have.`
			: modes[mode].instructions;
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
		if (task) {
			const workspace = task.workspace ? createWorkspaceTools(task.workspace, { dev: task.workspaceDev, ino: task.workspaceIno }) : null;
			if (workspace) registry.install(workspace);
			registry.install(createDelegationTools(workspace?.tools.filter(tool => ["read", "list_files"].includes(tool.name)) ?? []));
		}
		const harness = await Harness.open(
			await openNodeSqliteStorage(join(this.#stateDirectory, chatId ? `chat-thread-${chatId}.sqlite` : task ? `coding-task-${taskId}.sqlite` : `${mode}.sqlite`)),
			{ models: config.models, registry, ...(task?.workspace ? { env: () => new NodeExecutionEnv({ cwd: task.workspace }) } : {}) },
			context,
		);
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
				await this.#resumeSavedTurn(row);
			} finally {
				this.#recovering.delete(key);
			}
		}
	}

	async close() {
		this.#closing = true;
		await this.#runtimeModels?.signIn.cancel();
		await Promise.allSettled(this.#active.values());
		await Promise.all([...this.#sessions.values()].map(({ harness }) => harness.close(context)));
		this.#sessions.clear();
		this.#db.close();
	}
}
