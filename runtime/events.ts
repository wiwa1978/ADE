import type { ServerResponse } from "node:http";
import type {
	RuntimeEventMap,
	RuntimeEventType,
	TypedRuntimeEvent,
} from "../packages/protocol/index.ts";
import { logger } from "./log.ts";

export type { RuntimeEventMap, RuntimeEventType, TypedRuntimeEvent };

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

	on<K extends RuntimeEventType>(type: K, listener: (event: TypedRuntimeEvent<K>) => void): () => void {
		const wrapped = (event: RuntimeEvent) => {
			if (event.type === type) {
				listener(event as TypedRuntimeEvent<K>);
			}
		};
		return this.subscribe(wrapped);
	}

	emit<K extends RuntimeEventType>(type: K, payload: RuntimeEventMap[K], sessionId?: string): void {
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
