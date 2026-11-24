import type { ServerResponse } from "node:http";
import { logger } from "./log.ts";

export type RuntimeEventType =
	| "connected"
	| "sessions.changed"
	| "timeline.update"
	| "subagents.update"
	| "stages.update"
	| "team.update"
	| "approval.requested"
	| "approval.resolved"
	| "processes.update"
	| "artifacts.update"
	| "tasks.update"
	| "browser.update"
	| "browser.frame"
	| "diff.update"
	| "mcp.update"
	| "factory.event";

export type RuntimeEvent = {
	type: RuntimeEventType;
	sessionId?: string;
	payload: unknown;
	timestamp: number;
};

type Client = {
	response: ServerResponse;
	sessionId: string | null;
	heartbeat: ReturnType<typeof setInterval>;
};

export class RuntimeEventBus {
	#clients = new Set<Client>();
	#listeners = new Set<(event: RuntimeEvent) => void>();

	subscribe(listener: (event: RuntimeEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	emit(type: RuntimeEventType, payload: unknown, sessionId?: string): void {
		const event: RuntimeEvent = {
			type,
			...(sessionId ? { sessionId } : {}),
			payload,
			timestamp: Date.now(),
		};
		for (const listener of this.#listeners) {
			try {
				listener(event);
			} catch (error) {
				// Isolate listener failures so one subscriber cannot break broadcast to others.
				logger.warn("RuntimeEventBus listener threw", { error, sessionId, context: { eventType: type } });
			}
		}
		if (!this.#clients.size) return;
		const serialized = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
		for (const client of this.#clients) {
			if (client.sessionId && sessionId && client.sessionId !== sessionId) continue;
			try {
				client.response.write(serialized);
			} catch {
				this.#removeClient(client);
			}
		}
	}

	attachSse(response: ServerResponse, sessionId: string | null = null): void {
		response.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-content-type-options": "nosniff",
		});
		response.write(`event: connected\ndata: ${JSON.stringify({ type: "connected", payload: { ok: true }, timestamp: Date.now() })}\n\n`);
		const heartbeat = setInterval(() => {
			try {
				response.write(": ping\n\n");
			} catch {
				this.#removeClient(client);
			}
		}, 20_000);
		heartbeat.unref?.();
		const client: Client = { response, sessionId, heartbeat };
		this.#clients.add(client);
		response.once("close", () => this.#removeClient(client));
		response.once("error", () => this.#removeClient(client));
	}

	#removeClient(client: Client): void {
		if (!this.#clients.delete(client)) return;
		clearInterval(client.heartbeat);
		try {
			if (!client.response.writableEnded) client.response.end();
		} catch (error) {
			logger.debug("SSE client response close failed", { error, sessionId: client.sessionId ?? undefined });
		}
	}

	close(): void {
		for (const client of [...this.#clients]) {
			this.#removeClient(client);
		}
		this.#listeners.clear();
	}
}
