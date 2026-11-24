import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { validateLinkedIssue } from "../github-issues.ts";
import { badRequest, conflict, notFound, serviceUnavailable } from "../http-error.ts";
import { parseStartFrom, type PreparedBranch, type StartFrom } from "../start-from.ts";
import { resolveBaseCommit, resolveCheckout, type WorktreeManager } from "../worktrees.ts";
import { dbAll, dbGet, dbRun, withTransaction } from "./schema.ts";
import type { ProjectStore } from "./project-store.ts";
import { resolveSessionBlueprint } from "../session-blueprints.ts";
import type { TurnStore } from "./turn-store.ts";
import { sessionBranchName, type CodingTaskRow, type ModelConfigResult, type TurnRow } from "./types.ts";

export type CreateCodingTaskInput = {
	id?: unknown;
	kind?: unknown;
	repository?: unknown;
	title?: unknown;
	projectId?: unknown;
	githubIssue?: unknown;
	/** Start from an existing branch or pull request instead of a new branch. */
	startFrom?: unknown;
	/** Group id shared by parallel attempts at the same task. */
	attemptGroup?: unknown;
	/** Way of working: "vibe" or a blueprint id; empty = the project's default. */
	blueprintId?: unknown;
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
		return Boolean(dbGet(this.#db, "SELECT 1 FROM coding_tasks WHERE id=?", id));
	}

	hasProvisioning(): boolean {
		return this.#provisioning.size > 0;
	}

	rename(id: string, title: unknown): void {
		if (typeof title !== "string" || !title.trim() || title.length > 200) {
			throw badRequest("Provide a session name of up to 200 characters.");
		}
		const result = dbRun(this.#db, "UPDATE coding_tasks SET initialTitle=COALESCE(initialTitle,title),title=? WHERE id=?", title.trim(), id);
		if (!result.changes) throw notFound("Session not found.");
	}

	delete(id: string): { deleted: true; id: string } {
		return withTransaction(this.#db, () => {
			this.#turns.deleteForTask(id);
			const result = dbRun(this.#db, "DELETE FROM coding_tasks WHERE id=?", id);
			if (!result.changes) throw notFound("Session not found.");
			return { deleted: true, id };
		});
	}

	setArchivedAt(id: string, archivedAt: number | null): void {
		dbRun(this.#db, "UPDATE coding_tasks SET archivedAt=? WHERE id=?", archivedAt, id);
	}

	markWorktreeRemoved(id: string): void {
		dbRun(this.#db, "UPDATE coding_tasks SET worktreeRemoved=1 WHERE id=?", id);
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
		dbRun(this.#db, "UPDATE coding_tasks SET worktreeRemoved=0, workspaceDev=?, workspaceIno=? WHERE id=?", String(info.dev), String(info.ino), id);
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

	listWorkspaces(): { id: string; path: string | null; repository: string; archivedAt: number | null }[] {
		return dbAll<Pick<CodingTaskRow, "id" | "workspace" | "repository" | "archivedAt" | "worktreeRemoved">>(
			this.#db,
			"SELECT id, workspace, repository, archivedAt, worktreeRemoved FROM coding_tasks ORDER BY createdAt DESC",
		).map((row) => ({
			id: row.id,
			path: row.worktreeRemoved ? null : row.workspace,
			repository: row.repository,
			archivedAt: row.archivedAt,
		}));
	}

	/**
	 * Resolve the project ID owning a working directory (exact indexed workspace match first,
	 * then subdirectory match against task workspaces and project checkouts) without loading turns.
	 */
	findProjectForCwd(cwd: string): string | null {
		const real = (path: string) => {
			try {
				return realpathSync(path);
			} catch {
				return resolve(path);
			}
		};
		const resolved = resolve(cwd);
		const target = real(cwd);
		const exact = dbGet<{ projectId: string }>(
			this.#db,
			"SELECT projectId FROM coding_tasks WHERE (workspace=? OR workspace=?) AND projectId IS NOT NULL AND worktreeRemoved=0 ORDER BY createdAt DESC LIMIT 1",
			target,
			resolved,
		);
		if (exact?.projectId) return exact.projectId;

		const inside = (root: string | null | undefined) => {
			if (!root) return false;
			const base = real(root);
			return target === base || target.startsWith(`${base}${sep}`);
		};
		const taskRows = dbAll<{ projectId: string; workspace: string }>(
			this.#db,
			"SELECT projectId, workspace FROM coding_tasks WHERE projectId IS NOT NULL AND workspace IS NOT NULL AND worktreeRemoved=0 ORDER BY createdAt DESC",
		);
		for (const row of taskRows) {
			if (inside(row.workspace)) return row.projectId;
		}
		const projectRows = dbAll<{ id: string; repository: string }>(
			this.#db,
			"SELECT id, repository FROM projects WHERE repository IS NOT NULL ORDER BY createdAt, id",
		);
		for (const row of projectRows) {
			if (inside(row.repository)) return row.id;
		}
		return null;
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
				dbRun(this.#db, "UPDATE coding_tasks SET status='ready' WHERE id=?", task.id);
				return;
			}
			let path = task.repository;
			let note: string | null = null;
			if (task.kind === "worktree") {
				const operation = await manager.create({ id: task.id, repository: task.repository, branch: task.branch, base: task.base, existingBranch: task.existingBranch === 1 });
				if (operation.status !== "completed") throw new Error(operation.message);
				path = operation.target;
				note = operation.message;
			}
			await resolveCheckout(path);
			const info = statSync(path, { bigint: true });
			dbRun(
				this.#db,
				"UPDATE coding_tasks SET status='ready', workspace=?, message=?, workspaceDev=?, workspaceIno=? WHERE id=?",
				path,
				note,
				String(info.dev),
				String(info.ino),
				task.id,
			);
		} catch (error) {
			dbRun(this.#db, "UPDATE coding_tasks SET status='attention', message=? WHERE id=?", this.#safeErrorMessage(error), task.id);
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
			prepareBranch?: (repository: string, startFrom: StartFrom) => Promise<PreparedBranch>;
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
		const startFrom = parseStartFrom(input.startFrom);
		if (input.attemptGroup != null && (typeof input.attemptGroup !== "string" || !/^[0-9a-f-]{36}$/i.test(input.attemptGroup))) throw badRequest("Invalid attempt group.");
		const attemptGroup = typeof input.attemptGroup === "string" ? input.attemptGroup : null;
		const blueprintId = resolveSessionBlueprint(project, input.blueprintId);
		if (startFrom && input.kind !== "worktree") throw badRequest("Starting from a branch or pull request needs its own worktree.");
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
			const prepared = startFrom && deps.prepareBranch ? await deps.prepareBranch(repository, startFrom) : null;
			const branch = prepared?.branch ?? (input.kind === "worktree" ? sessionBranchName(input.title, input.id) : null);
			const base = prepared?.base ?? (input.kind === "worktree" ? await resolveBaseCommit(repository, "HEAD") : "HEAD");
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
				const trimmedTitle = normalizedInput.title.trim();
				withTransaction(this.#db, () => {
					if (initial && this.#turns.exists(initial.id)) {
						throw conflict("This initial message ID already belongs to another turn.");
					}
					dbRun(
						this.#db,
						"INSERT INTO coding_tasks (id,title,repository,kind,base,branch,status,createdAt,initialTurnId,projectId,initialTitle,issueUrl,issueRepository,issueNumber,issueTitle,issueState,existingBranch,attemptGroup,blueprintId) VALUES (?,?,?,?,?,?,'provisioning',?,?,?,?,?,?,?,?,?,?,?,?)",
						normalizedInput.id,
						trimmedTitle,
						repository,
						normalizedInput.kind,
						base,
						branch,
						now,
						initial?.id ?? null,
						normalizedInput.projectId,
						trimmedTitle,
						githubIssue?.url ?? null,
						githubIssue?.repository ?? null,
						githubIssue?.number ?? null,
						githubIssue?.title ?? null,
						githubIssue?.state ?? null,
						prepared ? 1 : 0,
						attemptGroup,
						blueprintId,
					);
					if (initial) {
						dbRun(
							this.#db,
							"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,createdAt,updatedAt,taskId) VALUES (?,'coding',?,?,?,?,'pending',?,?,?)",
							initial.id,
							initial.content,
							initial.provider,
							initial.model,
							initial.reasoning,
							now,
							now,
							normalizedInput.id,
						);
					}
				});
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
