import { logger } from "../log.ts";

export type CdpTarget = { type?: string; webSocketDebuggerUrl?: string };
export type CdpNavHistory = { currentIndex: number; entries: Array<{ id: number; url?: string; title?: string }> };
export type CdpEvalResult<T = unknown> = { result?: { value?: T; description?: string }; exceptionDetails?: { text?: string } };
export type CdpScreenshotResult = { data: string };

const DEFAULT_CDP_TIMEOUT_MS = 30_000;

type PendingCdpCall = {
	resolve: (v: unknown) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

export class CdpConnection {
	#ws: WebSocket;
	#nextId = 1;
	#pending = new Map<number, PendingCdpCall>();
	#eventListeners = new Set<(method: string, params: Record<string, unknown>) => void>();

	constructor(ws: WebSocket) {
		this.#ws = ws;
		ws.addEventListener("message", (event) => {
			try {
				const msg = JSON.parse(String(event.data)) as {
					id?: number;
					method?: string;
					params?: Record<string, unknown>;
					result?: unknown;
					error?: { message?: string };
				};
				if (msg.id !== undefined) {
					const entry = this.#pending.get(msg.id);
					if (entry) {
						this.#pending.delete(msg.id);
						clearTimeout(entry.timer);
						if (msg.error) entry.reject(new Error(msg.error.message || "CDP command failed"));
						else entry.resolve(msg.result);
						return;
					}
				}
				if (msg.method) {
					for (const listener of this.#eventListeners) {
						try {
							listener(msg.method, msg.params ?? {});
						} catch (error) {
							logger.warn("CDP event listener threw", { error, context: { method: msg.method } });
						}
					}
				}
			} catch (error) {
				logger.debug("Malformed CDP message frame ignored", { error });
			}
		});
		ws.addEventListener("close", () => {
			for (const entry of this.#pending.values()) {
				clearTimeout(entry.timer);
				entry.reject(new Error("CDP connection closed."));
			}
			this.#pending.clear();
		});
	}

	onEvent(listener: (method: string, params: Record<string, unknown>) => void): () => void {
		this.#eventListeners.add(listener);
		return () => this.#eventListeners.delete(listener);
	}

	send<T = Record<string, unknown>>(
		method: string,
		params: Record<string, unknown> = {},
		timeoutMs = DEFAULT_CDP_TIMEOUT_MS,
	): Promise<T> {
		const id = this.#nextId++;
		return new Promise<T>((resolve, reject) => {
			if (this.#ws.readyState !== WebSocket.OPEN) {
				reject(new Error("Browser CDP socket is not open."));
				return;
			}
			const timer = setTimeout(() => {
				if (this.#pending.delete(id)) {
					reject(new Error(`CDP command "${method}" timed out after ${timeoutMs}ms.`));
				}
			}, timeoutMs);
			timer.unref?.();
			this.#pending.set(id, {
				resolve: (v) => resolve(v as T),
				reject,
				timer,
			});
			try {
				this.#ws.send(JSON.stringify({ id, method, params }));
			} catch (error) {
				this.#pending.delete(id);
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	close(): void {
		for (const entry of this.#pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(new Error("CDP connection closed."));
		}
		this.#pending.clear();
		try {
			this.#ws.close();
		} catch (error) {
			logger.debug("CDP WebSocket close failed", { error });
		}
	}
}
