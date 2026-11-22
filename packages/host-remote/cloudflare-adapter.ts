import type {
  CaptainEvent,
  CaptainHost,
  CaptainScheduler,
  CaptainStorage,
  CaptainTransport,
} from "../protocol/index.ts";

/**
 * Minimal Cloudflare Durable Object state interface (avoids hard compile-time
 * dependency on @cloudflare/workers-types in the local workspace).
 * Compatible with Cloudflare Workers Paid (`env.CAPTAIN.jurisdiction("eu")`)
 * as well as celld.dev.
 */
export interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(opts?: { prefix?: string }): Promise<Map<string, T>>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export interface DurableObjectSocketLike {
  send(message: string): void;
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
  getWebSockets(): DurableObjectSocketLike[];
}

/**
 * Thin ~55-line Cloudflare Durable Object / PiHarness host adapter for packages/captain-core.
 * Mounts the exact same pure Web-standard CaptainCore without duplicating any workflow logic.
 */
export function createCloudflareDoCaptainHost(params: {
  state: DurableObjectStateLike;
  region?: "eu" | "global";
}): CaptainHost {
  const { state, region = "eu" } = params;

  const storage: CaptainStorage = {
    async get<T>(key: string) {
      return state.storage.get<T>(key);
    },
    async put<T>(key: string, value: T) {
      await state.storage.put(key, value);
    },
    async delete(key: string) {
      await state.storage.delete(key);
    },
    async list<T>(prefix: string) {
      const map = await state.storage.list<T>({ prefix });
      return [...map.entries()].map(([key, value]) => ({ key, value }));
    },
  };

  const scheduler: CaptainScheduler = {
    async schedule(_id: string, delayMs: number) {
      await state.storage.setAlarm(Date.now() + Math.max(0, delayMs));
    },
    async cancel() {
      await state.storage.deleteAlarm();
    },
  };

  const transport: CaptainTransport = {
    async broadcast(event: CaptainEvent) {
      const payload = JSON.stringify(event);
      for (const ws of state.getWebSockets()) {
        try {
          ws.send(payload);
        } catch {
          // ignore closed hibernating socket
        }
      }
    },
  };

  return {
    kind: "cloudflare-do",
    region,
    storage,
    scheduler,
    transport,
  };
}
