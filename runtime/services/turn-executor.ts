import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { copilotId } from "../copilot-auth.ts";
import type { ChatThreadStore } from "../db/chat-thread-store.ts";
import type { TaskStore } from "../db/task-store.ts";
import type { TurnStore } from "../db/turn-store.ts";
import { MODES, plainText, type ModelConfigResult, type SessionMode, type TurnRow } from "../db/types.ts";
import type { RuntimeEventBus } from "../events.ts";
import { badGateway, badRequest, conflict, httpError, notFound, serviceUnavailable } from "../http-error.ts";
import { logger } from "../log.ts";
import type { WorktreeManager } from "../worktrees.ts";
import type { ModelConfigService } from "./model-config-service.ts";
import type { SessionManager } from "./session-manager.ts";

export class TurnExecutor {
	#db: DatabaseSync;
	#events: RuntimeEventBus;
	#tasks: TaskStore;
	#chats: ChatThreadStore;
	#turns: TurnStore;
	#models: ModelConfigService;
	#sessions: SessionManager;
	#listSessions: () => ReturnType<TurnStore["listSessions"]>;
	#active = new Map<string, Promise<unknown>>();
	#recovering = new Set<string>();
	#closing = false;

	constructor(opts: {
		db: DatabaseSync;
		events: RuntimeEventBus;
		tasks: TaskStore;
		chats: ChatThreadStore;
		turns: TurnStore;
		models: ModelConfigService;
		sessions: SessionManager;
		listSessions: () => ReturnType<TurnStore["listSessions"]>;
	}) {
		this.#db = opts.db;
		this.#events = opts.events;
		this.#tasks = opts.tasks;
		this.#chats = opts.chats;
		this.#turns = opts.turns;
		this.#models = opts.models;
		this.#sessions = opts.sessions;
		this.#listSessions = opts.listSessions;
	}

	isClosing(): boolean {
		return this.#closing;
	}

	beginClosing(): void {
		this.#closing = true;
	}

	hasActive(): boolean {
		return this.#active.size > 0;
	}

	hasRecovering(): boolean {
		return this.#recovering.size > 0;
	}

	isActiveOrRecovering(id: string): boolean {
		return this.#active.has(id) || this.#recovering.has(id);
	}

	async awaitActive(): Promise<void> {
		await Promise.allSettled(this.#active.values());
	}

	async #existingTurn(
		mode: SessionMode,
		taskId: string | null,
		chatId: string | null,
		input: { id?: string; content: string; provider?: string; model?: string; reasoning?: string },
		key: string,
	) {
		if (!input.id) return undefined;
		const existing = this.#turns.get(input.id);
		if (!existing) return undefined;
		if (existing.mode !== mode || existing.taskId !== taskId || existing.chatId !== chatId || existing.content !== input.content.trim() ||
			(input.provider && existing.provider !== input.provider) || (input.model && existing.model !== input.model) ||
			(input.reasoning && existing.reasoning !== input.reasoning)) {
			throw conflict("This message ID was already used with different inputs.");
		}
		if (this.#active.has(key)) await this.#active.get(key);
		return this.#listSessions().find(item => item.id === key);
	}

	async send(
		mode: string,
		input: { id?: unknown; content?: unknown; provider?: unknown; model?: unknown; reasoning?: unknown; async?: unknown } | null | undefined,
		taskId: string | null = null,
		chatId: string | null = null,
	) {
		const credentialRevision = this.#models.credentialRevision;
		if (!Object.hasOwn(MODES, mode)) throw notFound("Unknown conversation");
		const sessionMode = mode as SessionMode;
		const task = taskId ? this.#tasks.get(taskId) ?? null : null;
		if (taskId && (sessionMode !== "coding" || !task || task.status !== "ready")) throw conflict("This coding task has no ready workspace.");
		if (task?.archivedAt) throw conflict("This session is archived. Restore it to continue.");
		if (task?.worktreeRemoved) throw conflict("This session's worktree was removed when it was archived.");
		const chat = chatId ? this.#chats.get(chatId) ?? null : null;
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
		if (task) await this.#tasks.verifyWorkspace(task);
		const config = await this.#models.getConfig(normalizedSend.provider);
		const admitted = await this.#existingTurn(sessionMode, taskId, chatId, normalizedSend, key);
		if (admitted) return admitted;
		if (this.#closing) throw serviceUnavailable("ADE is shutting down");
		if (this.#models.credentialChangeBusy || credentialRevision !== this.#models.credentialRevision) {
			throw conflict("Model credentials changed. Retry the message.");
		}
		if (this.#active.has(key) || this.#recovering.has(key) || this.#turns.hasPending(sessionMode, taskId, chatId)) {
			const alreadyAdmitted = await this.#existingTurn(sessionMode, taskId, chatId, normalizedSend, key);
			if (alreadyAdmitted) return alreadyAdmitted;
			throw conflict("This conversation has a turn in progress or awaiting recovery");
		}
		if (task && taskId) {
			const otherTasks = this.#tasks.findSameWorkspaceTasks(taskId, task.workspaceDev, task.workspaceIno);
			if (otherTasks.some(other => this.#active.has(other.id) || this.#recovering.has(other.id) || this.#turns.hasPendingForTask(other.id))) {
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
			if (chat && chatId) {
				const firstTurn = !this.#turns.hasAnyForChat(chatId);
				if (firstTurn && !chat.manuallyNamed) {
					const title = turn.content.replace(/\s+/g, " ").trim().slice(0, 80);
					this.#chats.autoNameIfUnset(chatId, title);
				}
			}
			this.#turns.insertPending({ ...turn, now });
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
			return this.#listSessions().find(item => item.id === key);
		}
		return operation;
	}

	async #executeTurn(
		turn: { id: string; mode: SessionMode; taskId: string | null; chatId: string | null; content: string; provider: string | null; model: string; reasoning: string },
		config: ModelConfigResult,
		recovery = false,
	) {
		const key = turn.chatId ?? turn.taskId ?? turn.mode;
		if (this.#active.has(key)) throw conflict("This conversation is already processing a turn");
		const operation = (async () => {
			this.#events.emit("sessions.changed", { sessionId: key, status: "working" }, key);
			try {
				const session = await this.#sessions.openSession(turn.mode, config, turn.model, turn.reasoning, turn.taskId, turn.chatId);
				const submission = await session.root.submit({
					type: "input",
					content: turn.content,
					requestId: `ade:${turn.id}`,
					whenBusy: "reject",
				}, context);
				const settled = await submission.wait(context);
				if (settled.status !== "done" || settled.type !== "input") {
					const detail = settled.status === "unanswered" && settled.detail && config.provider !== copilotId
						? ` (${this.#models.safeErrorMessage(JSON.stringify(settled.detail))})` : "";
					const error = settled.status === "unanswered"
						? `Turn ended without an answer: ${settled.reason}${detail}${config.provider === copilotId && settled.reason === "model_error" ? ". Check your Copilot access or reconnect in Settings." : ""}`
						: `Turn ended with status "${settled.status}"`;
					this.#turns.finishTurn(turn.id, "failed", null, error);
					throw badGateway(error);
				}
				const transcript = await session.root.context(context);
				const assistantMessage = [...transcript.messages].reverse().find((message) => message.role === "assistant");
				const answer = plainText(assistantMessage?.content);
				if (!answer.trim()) throw new Error("The model completed without a text response");
				this.#turns.finishTurn(turn.id, "completed", answer, null);
				return this.#listSessions().find((item) => item.id === key);
			} catch (error) {
				const currentStatus = this.#turns.getStatus(turn.id);
				const safeMessage = config.provider === copilotId && currentStatus === "pending"
					? "The Copilot turn could not be confirmed." : this.#models.safeErrorMessage(error);
				if (currentStatus === "pending") {
					const detail = recovery
						? `Turn recovery could not be confirmed: ${safeMessage}`
						: `Turn outcome is uncertain; restart ADE to reconnect safely: ${safeMessage}`;
					this.#turns.finishTurn(turn.id, recovery ? "blocked" : "pending", null, detail);
				}
				const message = recovery ? `Saved turn ${turn.id} could not be reconnected` : safeMessage;
				const statusCode = (error as { statusCode?: number })?.statusCode ?? 502;
				throw httpError(statusCode, message);
			} finally {
				this.#active.delete(key);
				this.#events.emit("sessions.changed", { sessionId: key, status: "idle" }, key);
			}
		})();
		this.#active.set(key, operation);
		return operation;
	}

	async resumeInitialTurn(taskId: string, savedTurn: TurnRow, config: ModelConfigResult | undefined): Promise<void> {
		if (this.#recovering.has(taskId)) return;
		this.#recovering.add(taskId);
		try {
			await this.#resumeSavedTurn(savedTurn, config);
		} finally {
			this.#recovering.delete(taskId);
		}
	}

	async #resumeSavedTurn(row: TurnRow, providedConfig: ModelConfigResult | undefined): Promise<void> {
		const key = row.chatId ?? row.taskId ?? row.mode;
		try {
			if (this.#active.has(key)) {
				await this.#active.get(key);
				return;
			}
			if (row.taskId) {
				const task = this.#tasks.get(row.taskId);
				if (!task || task.status !== "ready") {
					this.#turns.finishTurn(row.id, "blocked", null, `Workspace needs attention; the saved message was not submitted. ${task?.message ?? ""}`);
					return;
				}
				await this.#tasks.verifyWorkspace(task);
				const others = this.#tasks.findSameWorkspaceTasks(task.id, task.workspaceDev, task.workspaceIno);
				if (others.some(other => this.#active.has(other.id) || this.#turns.hasEarlierPendingForTask(other.id, row.createdAt, row.id))) {
					this.#turns.finishTurn(row.id, "blocked", null, "Another task is working in this checkout; the saved message was not submitted. Use a separate worktree for concurrent work.");
					return;
				}
			}
			const config = providedConfig ?? await this.#models.getConfig(row.provider ?? undefined);
			if (!config.configured) {
				this.#turns.finishTurn(row.id, "pending", null, `Reconnect ${config.provider}, then restart ADE to recover this turn. ${config.setupMessage}`);
				return;
			}
			if (!config.resolveModel(row.model)) {
				this.#turns.finishTurn(row.id, "blocked", null, `Saved model "${row.model}" is not available from ${config.provider}.`);
				return;
			}
			await this.#executeTurn(row, config, true);
		} catch (error) {
			if (this.#turns.getStatus(row.id) === "pending") {
				this.#turns.finishTurn(row.id, "blocked", null, `Could not recover the saved turn: ${this.#models.safeErrorMessage(error)}`);
			}
		}
	}

	async recover(manager?: WorktreeManager): Promise<void> {
		if (manager) {
			for (const task of this.#tasks.listProvisioning()) {
				await this.#tasks.ensureProvisioned(task, manager);
			}
		}
		for (const row of this.#turns.listAllPending()) {
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
}
