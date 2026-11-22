import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { badRequest, conflict, notFound } from "../http-error.ts";
import { dbAll, dbGet } from "./schema.ts";
import type { ProjectStore } from "./project-store.ts";
import type { TaskStore } from "./task-store.ts";
import type { TurnStore } from "./turn-store.ts";
import { MODES, type ChatThreadRow } from "./types.ts";

export class ChatThreadStore {
	#db: DatabaseSync;
	#projects: ProjectStore;
	#tasks: TaskStore;
	#turns: TurnStore;

	constructor(opts: { db: DatabaseSync; projects: ProjectStore; tasks: TaskStore; turns: TurnStore }) {
		this.#db = opts.db;
		this.#projects = opts.projects;
		this.#tasks = opts.tasks;
		this.#turns = opts.turns;
	}

	list(): ChatThreadRow[] {
		return dbAll<ChatThreadRow>(this.#db, "SELECT * FROM chat_threads ORDER BY createdAt DESC");
	}

	get(id: string): ChatThreadRow | undefined {
		return dbGet<ChatThreadRow>(this.#db, "SELECT * FROM chat_threads WHERE id=?", id);
	}

	exists(id: string): boolean {
		return Boolean(this.#db.prepare("SELECT 1 FROM chat_threads WHERE id=?").get(id));
	}

	create(input: { id?: unknown; mode?: unknown } | null | undefined): string {
		if (typeof input?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) ||
			typeof input.mode !== "string" || !Object.hasOwn(MODES, input.mode)) {
			throw badRequest("Provide a valid chat ID and mode.");
		}
		const existing = this.get(input.id);
		if (existing) {
			if (existing.mode !== input.mode) throw conflict("This chat ID already belongs to a different conversation.");
			return input.id;
		}
		this.#db.prepare("INSERT INTO chat_threads (id,mode,title,createdAt) VALUES (?,?,?,?)")
			.run(input.id, input.mode, "New chat", Date.now());
		return input.id;
	}

	rename(id: string, title: unknown): void {
		if (typeof title !== "string" || !title.trim() || title.length > 200) {
			throw badRequest("Provide a chat name of up to 200 characters.");
		}
		const result = this.#db.prepare("UPDATE chat_threads SET title=?,manuallyNamed=1 WHERE id=?").run(title.trim(), id);
		if (!result.changes) throw notFound("Chat not found.");
	}

	delete(id: string): { deleted: true; id: string } {
		this.#turns.deleteForChat(id);
		const result = this.#db.prepare("DELETE FROM chat_threads WHERE id=?").run(id);
		if (!result.changes) throw notFound("Chat not found.");
		return { deleted: true, id };
	}

	setArchivedAt(id: string, archivedAt: number | null): void {
		this.#db.prepare("UPDATE chat_threads SET archivedAt=? WHERE id=?").run(archivedAt, id);
	}

	autoNameIfUnset(chatId: string, title: string): void {
		this.#db.prepare("UPDATE chat_threads SET title=? WHERE id=? AND manuallyNamed=0").run(title, chatId);
	}

	forkSession(sourceId: string): string {
		const newId = randomUUID();
		const now = Date.now();
		const chat = this.get(sourceId);
		if (chat) {
			const forkTitle = `${chat.title} (fork)`.slice(0, 200);
			this.#db.prepare("INSERT INTO chat_threads (id,mode,title,manuallyNamed,createdAt) VALUES (?,?,?,?,?)")
				.run(newId, chat.mode, forkTitle, 1, now);
			this.#turns.copyTurnsForChat(sourceId, newId);
			return newId;
		}
		const task = this.#tasks.get(sourceId);
		if (task) {
			const forkTitle = `${task.title} (fork)`.slice(0, 200);
			this.#db.prepare(
				"INSERT INTO coding_tasks (id,title,repository,kind,base,branch,workspace,status,message,createdAt,projectId,initialTitle) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			).run(newId, forkTitle, task.repository, task.kind, task.base, task.branch, task.workspace, task.status, task.message, now, task.projectId ?? null, forkTitle);
			this.#turns.copyTurnsForTask(sourceId, newId);
			return newId;
		}
		if (sourceId === "coding" || sourceId === "personal") {
			const forkTitle = sourceId === "coding" ? "Coding lead (fork)" : "Personal agent (fork)";
			this.#db.prepare("INSERT INTO chat_threads (id,mode,title,manuallyNamed,createdAt) VALUES (?,?,?,?,?)")
				.run(newId, sourceId, forkTitle, 1, now);
			this.#turns.copyTurnsForRootMode(sourceId, newId);
			return newId;
		}
		throw notFound("Session not found.");
	}

	moveSession(sourceId: string, opts: { mode?: "coding" | "personal"; projectId?: string | null }): string {
		const task = this.#tasks.get(sourceId);
		if (task) {
			if (opts.projectId !== undefined) {
				const targetProjectId = opts.projectId ? String(opts.projectId) : null;
				if (targetProjectId) {
					const proj = this.#projects.get(targetProjectId);
					if (!proj) throw notFound("Target project not found.");
					this.#db.prepare("UPDATE coding_tasks SET projectId=?, repository=CASE WHEN repository='' THEN ? ELSE repository END WHERE id=?")
						.run(targetProjectId, proj.repository ?? "", sourceId);
				} else {
					this.#db.prepare("UPDATE coding_tasks SET projectId=NULL WHERE id=?").run(sourceId);
				}
			}
			return sourceId;
		}
		const chat = this.get(sourceId);
		if (chat) {
			if (opts.projectId) {
				const proj = this.#projects.get(opts.projectId);
				if (!proj) throw notFound("Target project not found.");
				this.#db.prepare(
					"INSERT INTO coding_tasks (id,title,repository,kind,base,branch,workspace,status,message,createdAt,projectId,initialTitle) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
				).run(chat.id, chat.title, proj.repository ?? "", proj.repository ? "existing" : "none", "main", null, proj.repository ?? null, "ready", null, chat.createdAt, proj.id, chat.title);
				this.#db.prepare("UPDATE turns SET taskId=?, chatId=NULL, mode='coding' WHERE chatId=?").run(chat.id, chat.id);
				this.#db.prepare("DELETE FROM chat_threads WHERE id=?").run(chat.id);
				return chat.id;
			}
			if (opts.mode === "coding" || opts.mode === "personal") {
				this.#db.prepare("UPDATE chat_threads SET mode=? WHERE id=?").run(opts.mode, sourceId);
				this.#db.prepare("UPDATE turns SET mode=? WHERE chatId=?").run(opts.mode, sourceId);
			}
			return sourceId;
		}
		throw notFound("Session not found.");
	}
}
