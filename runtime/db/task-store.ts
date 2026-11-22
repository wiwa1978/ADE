import { statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { validateLinkedIssue } from "../github-issues.ts";
import { badRequest, conflict, notFound, serviceUnavailable } from "../http-error.ts";
import { resolveBaseCommit, resolveCheckout, type WorktreeManager } from "../worktrees.ts";
import { dbAll, dbGet } from "./schema.ts";
import type { ProjectStore } from "./project-store.ts";
import type { TurnStore } from "./turn-store.ts";
import { sessionBranchName, type CodingTaskRow, type ModelConfigResult, type TurnRow } from "./types.ts";

export type CreateCodingTaskInput = {
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
};

export class TaskStore {
	#db: DatabaseSync;
	#projects: ProjectStore;
	#turns: TurnStore;
	#provisioning = new Map<string, Promise<void>>();
	#safeErrorMessage: (error: unknown) => string;

	constructor(opts: {
		db: DatabaseSync;
		projects: ProjectStore;
		turns: TurnStore;
		safeErrorMessage: (error: unknown) => string;
	}) {
		this.#db = opts.db;
		this.#projects = opts.projects;
		this.#turns = opts.turns;
		this.#safeErrorMessage = opts.safeErrorMessage;
	}

	list(): CodingTaskRow[] {
		return dbAll<CodingTaskRow>(this.#db, "SELECT * FROM coding_tasks ORDER BY createdAt DESC");
	}

	listForProject(projectId: string): { id: string; title: string }[] {
		return dbAll<{ id: string; title: string }>(this.#db, "SELECT id,title FROM coding_tasks WHERE projectId=? ORDER BY createdAt DESC", projectId);
	}

	listActiveIdsForProject(projectId: string): { id: string }[] {
		return dbAll<{ id: string }>(this.#db, "SELECT id FROM coding_tasks WHERE projectId=? AND archivedAt IS NULL", projectId);
	}

	listProvisioning(): CodingTaskRow[] {
		return dbAll<CodingTaskRow>(this.#db, "SELECT * FROM coding_tasks WHERE status='provisioning'");
	}

	get(id: string): CodingTaskRow | undefined {
		return dbGet<CodingTaskRow>(this.#db, "SELECT * FROM coding_tasks WHERE id=?", id);
	}

	exists(id: string): boolean {
		return Boolean(this.#db.prepare("SELECT 1 FROM coding_tasks WHERE id=?").get(id));
	}

	hasProvisioning(): boolean {
		return this.#provisioning.size > 0;
	}

	rename(id: string, title: unknown): void {
		if (typeof title !== "string" || !title.trim() || title.length > 200) {
			throw badRequest("Provide a session name of up to 200 characters.");
		}
		const result = this.#db.prepare("UPDATE coding_tasks SET initialTitle=COALESCE(initialTitle,title),title=? WHERE id=?").run(title.trim(), id);
		if (!result.changes) throw notFound("Session not found.");
	}

	delete(id: string): { deleted: true; id: string } {
		this.#turns.deleteForTask(id);
		const result = this.#db.prepare("DELETE FROM coding_tasks WHERE id=?").run(id);
		if (!result.changes) throw notFound("Session not found.");
		return { deleted: true, id };
	}

	setArchivedAt(id: string, archivedAt: number | null): void {
		this.#db.prepare("UPDATE coding_tasks SET archivedAt=? WHERE id=?").run(archivedAt, id);
	}

	markWorktreeRemoved(id: string): void {
		this.#db.prepare("UPDATE coding_tasks SET worktreeRemoved=1 WHERE id=?").run(id);
	}

	removedWorktree(id: string): { path: string; repository: string; branch: string } | null {
		const task = dbGet<Pick<CodingTaskRow, "workspace" | "repository" | "branch" | "worktreeRemoved" | "kind">>(
			this.#db,
			"SELECT workspace, repository, branch, worktreeRemoved, kind FROM coding_tasks WHERE id=?",
			id,
		);
		if (!task?.worktreeRemoved || task.kind !== "worktree" || !task.workspace || !task.branch) return null;
		return { path: task.workspace, repository: task.repository, branch: task.branch };
	}

	markWorktreeRestored(id: string): void {
		const task = dbGet<Pick<CodingTaskRow, "workspace">>(this.#db, "SELECT workspace FROM coding_tasks WHERE id=?", id);
		if (!task?.workspace) throw notFound("Session workspace not found.");
		const info = statSync(task.workspace, { bigint: true });
		this.#db.prepare("UPDATE coding_tasks SET worktreeRemoved=0, workspaceDev=?, workspaceIno=? WHERE id=?").run(String(info.dev), String(info.ino), id);
	}

	getWorkspacePath(sessionId: string): string | null {
		const task = dbGet<Pick<CodingTaskRow, "workspace" | "status" | "kind" | "worktreeRemoved">>(
			this.#db,
			"SELECT workspace, status, kind, worktreeRemoved FROM coding_tasks WHERE id=?",
			sessionId,
		);
		if (!task || task.kind === "none" || task.status !== "ready" || !task.workspace || task.worktreeRemoved) return null;
		return task.workspace;
	}

	getWorkspaceBase(sessionId: string): string | null {
		const task = dbGet<Pick<CodingTaskRow, "base" | "kind">>(this.#db, "SELECT base, kind FROM coding_tasks WHERE id=?", sessionId);
		return task?.kind === "worktree" && task.base && task.base !== "HEAD" ? task.base : null;
	}

	findSameWorkspaceTasks(taskId: string, workspaceDev: string | null, workspaceIno: string | null): { id: string }[] {
		return dbAll<{ id: string }>(
			this.#db,
			"SELECT id FROM coding_tasks WHERE id<>? AND workspaceDev=? AND workspaceIno=?",
			taskId,
			workspaceDev,
			workspaceIno,
		);
	}

	async verifyWorkspace(task: CodingTaskRow): Promise<void> {
		if (task.kind === "none") return;
		if (!task.workspace) throw conflict("Task workspace is missing.");
		try {
			const info = statSync(task.workspace, { bigint: true });
			if (String(info.dev) !== task.workspaceDev || String(info.ino) !== task.workspaceIno) {
				throw new Error("The task workspace has changed or been replaced.");
			}
			await resolveCheckout(task.workspace);
		} catch (error) {
			throw conflict(`Task workspace unavailable: ${this.#safeErrorMessage(error)}. It will not be retargeted automatically.`);
		}
	}

	async ensureProvisioned(task: CodingTaskRow, manager: WorktreeManager): Promise<void> {
		if (!this.#provisioning.has(task.id)) {
			const work = this.#provisionTask(task, manager).finally(() => this.#provisioning.delete(task.id));
			this.#provisioning.set(task.id, work);
		}
		await this.#provisioning.get(task.id);
	}

	async #provisionTask(task: CodingTaskRow, manager: WorktreeManager): Promise<void> {
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
			this.#db.prepare("UPDATE coding_tasks SET status='attention', message=? WHERE id=?").run(this.#safeErrorMessage(error), task.id);
		}
	}

	#verifyTaskInputs(
		task: CodingTaskRow,
		input: { kind: string; title: string; projectId: string | null; githubIssue: ReturnType<typeof validateLinkedIssue> },
		repository: string,
		initial: { id: string; content: string; provider: string; model: string; reasoning: string } | undefined,
	): void {
		const issue = input.githubIssue;
		if (task.repository !== repository || task.kind !== input.kind || (task.initialTitle ?? task.title) !== input.title.trim() ||
			task.initialTurnId !== (initial?.id ?? null) || task.projectId !== (input.projectId ?? null) ||
			task.issueUrl !== (issue?.url ?? null) || task.issueRepository !== (issue?.repository ?? null) || task.issueNumber !== (issue?.number ?? null) ||
			task.issueTitle !== (issue?.title ?? null) || task.issueState !== (issue?.state ?? null)) {
			throw conflict("This task ID already belongs to different inputs.");
		}
		if (initial) {
			const turn = this.#turns.get(initial.id);
			if (!turn || turn.taskId !== task.id || turn.content !== initial.content || turn.provider !== initial.provider ||
				turn.model !== initial.model || turn.reasoning !== initial.reasoning) {
				throw conflict("This task ID already belongs to a different initial message.");
			}
		}
	}

	async create(
		input: CreateCodingTaskInput | null | undefined,
		manager: WorktreeManager,
		deps: {
			isClosing: () => boolean;
			getCredentialRevision: () => number;
			isCredentialChangeBusy: () => boolean;
			getModelConfig: (provider?: string) => Promise<ModelConfigResult>;
			resumeInitialTurn: (taskId: string, savedTurn: TurnRow, config: ModelConfigResult | undefined) => Promise<void>;
		},
	): Promise<string> {
		const credentialRevision = deps.getCredentialRevision();
		if (typeof input?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) ||
			typeof input.kind !== "string" || !["none", "checkout", "worktree"].includes(input.kind) || typeof input.repository !== "string" ||
			typeof input.title !== "string" || !input.title.trim() || input.title.length > 200) {
			throw badRequest("Provide a task ID, title, repository and workspace choice.");
		}
		if (input.projectId != null && (typeof input.projectId !== "string" || !this.#projects.exists(input.projectId))) {
			throw badRequest("Choose an existing project for this feature.");
		}
		const project = typeof input.projectId === "string" ? this.#projects.get(input.projectId) ?? null : null;
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
		if (deps.isClosing()) throw serviceUnavailable("ADE is shutting down");
		const repository = input.kind === "none" ? "" : await resolveCheckout(input.repository);
		const normalizedInput = {
			id: input.id,
			kind: input.kind,
			title: input.title,
			projectId: typeof input.projectId === "string" ? input.projectId : null,
			githubIssue,
		};
		let task = this.get(input.id);
		if (task) this.#verifyTaskInputs(task, normalizedInput, repository, initial);
		if (!task) {
			const branch = input.kind === "worktree" ? sessionBranchName(input.title, input.id) : null;
			const base = input.kind === "worktree" ? await resolveBaseCommit(repository, "HEAD") : "HEAD";
			if (initial) {
				config = await deps.getModelConfig(initial.provider);
				if (!config.configured) throw serviceUnavailable(config.setupMessage || "The selected model provider is not configured");
				if (config.provider !== initial.provider || !config.resolveModel(initial.model)) {
					throw badRequest("The selected model is not available from this provider.");
				}
			}
			task = this.get(input.id);
			if (task) this.#verifyTaskInputs(task, normalizedInput, repository, initial);
			if (!task) {
				if (deps.isClosing()) throw serviceUnavailable("ADE is shutting down");
				if (initial && (deps.isCredentialChangeBusy() || credentialRevision !== deps.getCredentialRevision())) {
					throw conflict("Model credentials changed. Retry the message.");
				}
				const now = Date.now();
				this.#db.exec("BEGIN IMMEDIATE");
				try {
					if (initial && this.#turns.exists(initial.id)) {
						throw conflict("This initial message ID already belongs to another turn.");
					}
					this.#db.prepare("INSERT INTO coding_tasks (id,title,repository,kind,base,branch,status,createdAt,initialTurnId,projectId,initialTitle,issueUrl,issueRepository,issueNumber,issueTitle,issueState) VALUES (?,?,?,?,?,?,'provisioning',?,?,?,?,?,?,?,?,?)")
						.run(input.id, input.title.trim(), repository, input.kind, base, branch, now, initial?.id ?? null, normalizedInput.projectId, input.title.trim(),
							githubIssue?.url ?? null, githubIssue?.repository ?? null, githubIssue?.number ?? null, githubIssue?.title ?? null, githubIssue?.state ?? null);
					if (initial) {
						this.#db.prepare("INSERT INTO turns (id,mode,content,provider,model,reasoning,status,createdAt,updatedAt,taskId) VALUES (?,'coding',?,?,?,?,'pending',?,?,?)")
							.run(initial.id, initial.content, initial.provider, initial.model, initial.reasoning, now, now, input.id);
					}
					this.#db.exec("COMMIT");
				} catch (error) {
					this.#db.exec("ROLLBACK");
					throw error;
				}
				task = this.get(input.id);
			}
		}
		if (task?.status === "provisioning") await this.ensureProvisioned(task, manager);
		task = this.get(input.id);
		if (!task) throw notFound("Session not found.");
		const pendingStatus = initial ? this.#turns.getStatus(initial.id) : undefined;
		if (initial && pendingStatus === "pending") {
			if (task.status !== "ready") {
				this.#turns.finishTurn(initial.id, "blocked", null, `Workspace needs attention; the saved message was not submitted. ${task.message ?? ""}`);
			} else {
				const savedTurn = this.#turns.get(initial.id);
				if (savedTurn) await deps.resumeInitialTurn(task.id, savedTurn, config);
			}
		}
		return input.id;
	}
}
