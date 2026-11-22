import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { dbAll, dbGet } from "./schema.ts";
import { MODES, type ChatThreadRow, type CodingTaskRow, type SessionMode, type TurnRow } from "./types.ts";

export class TurnStore {
	#db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.#db = db;
	}

	get(id: string): TurnRow | undefined {
		return dbGet<TurnRow>(this.#db, "SELECT * FROM turns WHERE id=?", id);
	}

	exists(id: string): boolean {
		return Boolean(this.#db.prepare("SELECT 1 FROM turns WHERE id=?").get(id));
	}

	getStatus(id: string): TurnRow["status"] | undefined {
		return dbGet<{ status: TurnRow["status"] }>(this.#db, "SELECT status FROM turns WHERE id=?", id)?.status;
	}

	hasAnyForTask(taskId: string): boolean {
		return Boolean(this.#db.prepare("SELECT 1 FROM turns WHERE taskId=? LIMIT 1").get(taskId));
	}

	hasAnyForChat(chatId: string): boolean {
		return Boolean(this.#db.prepare("SELECT 1 FROM turns WHERE chatId=? LIMIT 1").get(chatId));
	}

	hasPending(mode: SessionMode, taskId: string | null, chatId: string | null): boolean {
		if (chatId) return Boolean(this.#db.prepare("SELECT 1 FROM turns WHERE chatId=? AND status='pending' LIMIT 1").get(chatId));
		if (taskId) return Boolean(this.#db.prepare("SELECT 1 FROM turns WHERE taskId=? AND status='pending' LIMIT 1").get(taskId));
		return Boolean(this.#db.prepare("SELECT 1 FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL AND status='pending' LIMIT 1").get(mode));
	}

	hasPendingForTask(taskId: string): boolean {
		return Boolean(this.#db.prepare("SELECT 1 FROM turns WHERE taskId=? AND status='pending'").get(taskId));
	}

	hasEarlierPendingForTask(taskId: string, createdAt: number, turnId: string): boolean {
		return Boolean(
			this.#db
				.prepare("SELECT 1 FROM turns WHERE taskId=? AND status='pending' AND (createdAt<? OR (createdAt=? AND id<?)) LIMIT 1")
				.get(taskId, createdAt, createdAt, turnId),
		);
	}

	listAllPending(): TurnRow[] {
		return dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE status='pending' ORDER BY createdAt, id");
	}

	insertPending(turn: {
		id: string;
		mode: SessionMode;
		content: string;
		provider: string | null;
		model: string;
		reasoning: string;
		now: number;
		taskId: string | null;
		chatId: string | null;
	}): void {
		this.#db
			.prepare("INSERT INTO turns (id,mode,content,provider,model,reasoning,status,createdAt,updatedAt,taskId,chatId) VALUES (?,?,?,?,?,?,'pending',?,?,?,?)")
			.run(turn.id, turn.mode, turn.content, turn.provider, turn.model, turn.reasoning, turn.now, turn.now, turn.taskId, turn.chatId);
	}

	finishTurn(id: string, status: TurnRow["status"], answer: string | null, error: string | null): void {
		this.#db.prepare("UPDATE turns SET status=?,answer=?,error=?,updatedAt=? WHERE id=?").run(status, answer, error, Date.now(), id);
	}

	deleteForTask(taskId: string): void {
		this.#db.prepare("DELETE FROM turns WHERE taskId=?").run(taskId);
	}

	deleteForChat(chatId: string): void {
		this.#db.prepare("DELETE FROM turns WHERE chatId=?").run(chatId);
	}

	copyTurnsForChat(sourceChatId: string, targetChatId: string): void {
		const rows = dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE chatId=? ORDER BY createdAt ASC", sourceChatId);
		const insertTurn = this.#db.prepare(
			"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,chatId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
		);
		for (const row of rows) {
			insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, targetChatId);
		}
	}

	copyTurnsForTask(sourceTaskId: string, targetTaskId: string): void {
		const rows = dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE taskId=? ORDER BY createdAt ASC", sourceTaskId);
		const insertTurn = this.#db.prepare(
			"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,taskId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
		);
		for (const row of rows) {
			insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, targetTaskId);
		}
	}

	copyTurnsForRootMode(mode: SessionMode, targetChatId: string): void {
		const rows = dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL ORDER BY createdAt ASC", mode);
		const insertTurn = this.#db.prepare(
			"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,chatId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
		);
		for (const row of rows) {
			insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, targetChatId);
		}
	}

	listSessions(tasks: CodingTaskRow[], chats: ChatThreadRow[], isActiveOrRecovering: (id: string) => boolean) {
		type SessionDef = { id: string; mode: SessionMode; label: string; task: CodingTaskRow | null; chat: ChatThreadRow | null };
		const definitions: SessionDef[] = [
			...(Object.entries(MODES) as [SessionMode, (typeof MODES)[SessionMode]][]).map(([mode, definition]) => ({ id: mode, mode, label: definition.label, task: null, chat: null })),
			...chats.map(chat => ({ id: chat.id, mode: chat.mode, label: chat.title, task: null, chat })),
			...tasks.map(task => ({ id: task.id, mode: "coding" as const, label: task.title, task, chat: null })),
		];
		return definitions.map(({ id, mode, label, task, chat }) => {
			const turns = chat
				? dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE chatId=? ORDER BY createdAt, id", id)
				: task
					? dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE taskId=? ORDER BY createdAt, id", id)
					: dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL ORDER BY createdAt, id", mode);
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
			const busy = isActiveOrRecovering(id) || turns.some((turn) => turn.status === "pending");
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
}
