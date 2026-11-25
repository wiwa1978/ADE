import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
	Conversation,
	ConversationMessage,
	ConversationWorkspace,
} from "@ade/protocol";
import { dbAll, dbGet, dbPrepare, dbRun, withTransaction } from "./schema.ts";
import { MODES, type ChatThreadRow, type CodingTaskRow, type SessionMode, type TurnRow } from "./types.ts";

type SessionDef = {
	id: string;
	mode: SessionMode;
	label: string;
	task: CodingTaskRow | null;
	chat: ChatThreadRow | null;
};

export class TurnStore {
	#db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.#db = db;
	}

	get(id: string): TurnRow | undefined {
		return dbGet<TurnRow>(this.#db, "SELECT * FROM turns WHERE id=?", id);
	}

	exists(id: string): boolean {
		return Boolean(dbGet(this.#db, "SELECT 1 FROM turns WHERE id=?", id));
	}

	getStatus(id: string): TurnRow["status"] | undefined {
		return dbGet<{ status: TurnRow["status"] }>(this.#db, "SELECT status FROM turns WHERE id=?", id)?.status;
	}

	/** The first message the person sent in a session. */
	firstForSession(sessionId: string): TurnRow | undefined {
		return dbGet<TurnRow>(this.#db, "SELECT * FROM turns WHERE taskId=? OR chatId=? ORDER BY createdAt ASC, id ASC LIMIT 1", sessionId, sessionId);
	}

	/** The latest turn that ended with an answer. */
	latestCompletedForSession(sessionId: string): TurnRow | undefined {
		return dbGet<TurnRow>(this.#db, "SELECT * FROM turns WHERE (taskId=? OR chatId=?) AND status='completed' AND answer IS NOT NULL ORDER BY createdAt DESC, id DESC LIMIT 1", sessionId, sessionId);
	}

	/** The session's latest turn (a coding task or chat thread). */
	latestForSession(sessionId: string): TurnRow | undefined {
		return dbGet<TurnRow>(this.#db, "SELECT * FROM turns WHERE taskId=? OR chatId=? ORDER BY createdAt DESC, id DESC LIMIT 1", sessionId, sessionId);
	}

	hasAnyForTask(taskId: string): boolean {
		return Boolean(dbGet(this.#db, "SELECT 1 FROM turns WHERE taskId=? LIMIT 1", taskId));
	}

	hasAnyForChat(chatId: string): boolean {
		return Boolean(dbGet(this.#db, "SELECT 1 FROM turns WHERE chatId=? LIMIT 1", chatId));
	}

	hasPending(mode: SessionMode, taskId: string | null, chatId: string | null): boolean {
		if (chatId) return Boolean(dbGet(this.#db, "SELECT 1 FROM turns WHERE chatId=? AND status='pending' LIMIT 1", chatId));
		if (taskId) return Boolean(dbGet(this.#db, "SELECT 1 FROM turns WHERE taskId=? AND status='pending' LIMIT 1", taskId));
		return Boolean(dbGet(this.#db, "SELECT 1 FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL AND status='pending' LIMIT 1", mode));
	}

	hasPendingForTask(taskId: string): boolean {
		return Boolean(dbGet(this.#db, "SELECT 1 FROM turns WHERE taskId=? AND status='pending' LIMIT 1", taskId));
	}

	hasEarlierPendingForTask(taskId: string, createdAt: number, turnId: string): boolean {
		return Boolean(
			dbGet(
				this.#db,
				"SELECT 1 FROM turns WHERE taskId=? AND status='pending' AND (createdAt<? OR (createdAt=? AND id<?)) LIMIT 1",
				taskId,
				createdAt,
				createdAt,
				turnId,
			),
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
		dbRun(
			this.#db,
			"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,createdAt,updatedAt,taskId,chatId) VALUES (?,?,?,?,?,?,'pending',?,?,?,?)",
			turn.id,
			turn.mode,
			turn.content,
			turn.provider,
			turn.model,
			turn.reasoning,
			turn.now,
			turn.now,
			turn.taskId,
			turn.chatId,
		);
	}

	finishTurn(id: string, status: TurnRow["status"], answer: string | null, error: string | null): void {
		dbRun(this.#db, "UPDATE turns SET status=?,answer=?,error=?,updatedAt=? WHERE id=?", status, answer, error, Date.now(), id);
	}

	deleteForTask(taskId: string): void {
		dbRun(this.#db, "DELETE FROM turns WHERE taskId=?", taskId);
	}

	deleteForChat(chatId: string): void {
		dbRun(this.#db, "DELETE FROM turns WHERE chatId=?", chatId);
	}

	copyTurnsForChat(sourceChatId: string, targetChatId: string): void {
		withTransaction(this.#db, () => {
			const rows = dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE chatId=? ORDER BY createdAt ASC, id ASC", sourceChatId);
			const insertTurn = dbPrepare(
				this.#db,
				"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,chatId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			);
			for (const row of rows) {
				insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, targetChatId);
			}
		});
	}

	copyTurnsForTask(sourceTaskId: string, targetTaskId: string): void {
		withTransaction(this.#db, () => {
			const rows = dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE taskId=? ORDER BY createdAt ASC, id ASC", sourceTaskId);
			const insertTurn = dbPrepare(
				this.#db,
				"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,taskId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			);
			for (const row of rows) {
				insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, targetTaskId);
			}
		});
	}

	copyTurnsForRootMode(mode: SessionMode, targetChatId: string): void {
		withTransaction(this.#db, () => {
			const rows = dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL ORDER BY createdAt ASC, id ASC", mode);
			const insertTurn = dbPrepare(
				this.#db,
				"INSERT INTO turns (id,mode,content,provider,model,reasoning,status,answer,error,createdAt,updatedAt,chatId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			);
			for (const row of rows) {
				insertTurn.run(randomUUID(), row.mode, row.content, row.provider, row.model, row.reasoning, row.status, row.answer, row.error, row.createdAt, row.updatedAt, targetChatId);
			}
		});
	}

	#buildSession({ id, mode, label, task, chat }: SessionDef, turns: TurnRow[], isActiveOrRecovering: (id: string) => boolean): Conversation {
		const messages: ConversationMessage[] = turns.flatMap((turn) => {
			const result: ConversationMessage[] = [{
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
		const workspace: ConversationWorkspace | undefined = task
			? {
				kind: task.kind as ConversationWorkspace["kind"],
				path: task.worktreeRemoved ? null : task.workspace,
				repository: task.repository,
				branch: task.branch,
				status: (task.worktreeRemoved ? "archived" : task.status) as ConversationWorkspace["status"],
				message: task.message,
				removed: Boolean(task.worktreeRemoved),
			}
			: undefined;
		let updatedAt: number | null = (task ?? chat)?.createdAt ?? null;
		if (turns.length) {
			let maxUpdated = turns[0].updatedAt;
			for (let i = 1; i < turns.length; i++) {
				if (turns[i].updatedAt > maxUpdated) maxUpdated = turns[i].updatedAt;
			}
			updatedAt = maxUpdated;
		}
		return {
			id,
			mode,
			label,
			...(chat ? { chatThread: true } : {}),
			...(task ? { projectId: task.projectId } : {}),
			...(task?.attemptGroup ? { attemptGroup: task.attemptGroup } : {}),
			status: busy ? "working" : "idle",
			archivedAt: (task ?? chat)?.archivedAt ?? null,
			createdAt: (task ?? chat)?.createdAt ?? null,
			// When the conversation last changed; used to sort sessions and the inbox.
			updatedAt,
			lastTurnStatus: turns.length ? turns[turns.length - 1].status : null,
			...(workspace ? { workspace } : {}),
			...(task?.issueUrl
				? {
					githubIssue: {
						url: task.issueUrl,
						repository: task.issueRepository ?? "",
						number: task.issueNumber ?? 0,
						title: task.issueTitle ?? "",
						state: (task.issueState === "closed" ? "closed" : "open"),
					},
				}
				: {}),
			messages,
		};
	}

	/** O(1) indexed lookup for a single session (root mode, chat thread, or coding task). */
	getSession(
		id: string,
		task: CodingTaskRow | null,
		chat: ChatThreadRow | null,
		isActiveOrRecovering: (id: string) => boolean,
	): Conversation | undefined {
		if (chat) {
			const turns = dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE chatId=? ORDER BY createdAt, id", id);
			return this.#buildSession({ id: chat.id, mode: chat.mode, label: chat.title, task: null, chat }, turns, isActiveOrRecovering);
		}
		if (task) {
			const turns = dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE taskId=? ORDER BY createdAt, id", id);
			return this.#buildSession({ id: task.id, mode: "coding", label: task.title, task, chat: null }, turns, isActiveOrRecovering);
		}
		if (Object.hasOwn(MODES, id)) {
			const mode = id as SessionMode;
			const turns = dbAll<TurnRow>(this.#db, "SELECT * FROM turns WHERE mode=? AND taskId IS NULL AND chatId IS NULL ORDER BY createdAt, id", mode);
			return this.#buildSession({ id: mode, mode, label: MODES[mode].label, task: null, chat: null }, turns, isActiveOrRecovering);
		}
		return undefined;
	}

	listSessions(tasks: CodingTaskRow[], chats: ChatThreadRow[], isActiveOrRecovering: (id: string) => boolean): Conversation[] {
		const definitions: SessionDef[] = [
			...(Object.entries(MODES) as [SessionMode, (typeof MODES)[SessionMode]][]).map(([mode, definition]) => ({ id: mode, mode, label: definition.label, task: null, chat: null })),
			...chats.map(chat => ({ id: chat.id, mode: chat.mode, label: chat.title, task: null, chat })),
			...tasks.map(task => ({ id: task.id, mode: "coding" as const, label: task.title, task, chat: null })),
		];
		const allTurns = dbAll<TurnRow>(this.#db, "SELECT * FROM turns ORDER BY createdAt, id");
		const byChat = new Map<string, TurnRow[]>();
		const byTask = new Map<string, TurnRow[]>();
		const byRoot = new Map<SessionMode, TurnRow[]>();
		for (const turn of allTurns) {
			if (turn.chatId) {
				let list = byChat.get(turn.chatId);
				if (!list) { list = []; byChat.set(turn.chatId, list); }
				list.push(turn);
			} else if (turn.taskId) {
				let list = byTask.get(turn.taskId);
				if (!list) { list = []; byTask.set(turn.taskId, list); }
				list.push(turn);
			} else {
				let list = byRoot.get(turn.mode);
				if (!list) { list = []; byRoot.set(turn.mode, list); }
				list.push(turn);
			}
		}
		return definitions.map((def): Conversation => {
			const turns = def.chat
				? (byChat.get(def.id) ?? [])
				: def.task
					? (byTask.get(def.id) ?? [])
					: (byRoot.get(def.mode) ?? []);
			return this.#buildSession(def, turns, isActiveOrRecovering);
		});
	}
}
