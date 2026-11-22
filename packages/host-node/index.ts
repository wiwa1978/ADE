import type { DatabaseSync } from "node:sqlite";
import type {
  CaptainEvent,
  CaptainHost,
  CaptainScheduler,
  CaptainStorage,
  CaptainTransport,
} from "../protocol/index.ts";

/**
 * Thin Flavor 1 (Local Node + SQLite) host wrapper (~80 lines) for packages/captain-core.
 * Mirrors the exact 3 primitives that Cloudflare Durable Objects (PiHarness) and celld.dev
 * provide in Flavor 2: Storage, Scheduler, and Transport.
 */
export function createNodeSqliteCaptainHost(params: {
  db: DatabaseSync;
  onEvent?: (event: CaptainEvent) => void;
  onScheduledAlarm?: (id: string, payload?: unknown) => void | Promise<void>;
  region?: CaptainHost["region"];
}): CaptainHost & { close(): void } {
  const { db, onEvent, onScheduledAlarm, region = "local" } = params;

  db.exec(`
    CREATE TABLE IF NOT EXISTS captain_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const stmtGet = db.prepare("SELECT value FROM captain_kv WHERE key = ?");
  const stmtPut = db.prepare(
    "INSERT INTO captain_kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  const stmtDelete = db.prepare("DELETE FROM captain_kv WHERE key = ?");
  const stmtList = db.prepare("SELECT key, value FROM captain_kv WHERE key LIKE ? ORDER BY key ASC");

  const storage: CaptainStorage = {
    async get<T>(key: string): Promise<T | undefined> {
      const row = stmtGet.get(key) as { value: string } | undefined;
      if (!row) return undefined;
      return JSON.parse(row.value) as T;
    },
    async put<T>(key: string, value: T): Promise<void> {
      stmtPut.run(key, JSON.stringify(value), Date.now());
    },
    async delete(key: string): Promise<void> {
      stmtDelete.run(key);
    },
    async list<T>(prefix: string): Promise<{ key: string; value: T }[]> {
      const escaped = prefix.replace(/[%_]/g, "\\$&");
      const rows = stmtList.all(`${escaped}%`) as { key: string; value: string }[];
      return rows
        .filter((row) => row.key.startsWith(prefix))
        .map((row) => ({ key: row.key, value: JSON.parse(row.value) as T }));
    },
  };

  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const scheduler: CaptainScheduler = {
    async schedule(id: string, delayMs: number, payload?: unknown): Promise<void> {
      const prev = timers.get(id);
      if (prev) clearTimeout(prev);
      const handle = setTimeout(() => {
        timers.delete(id);
        void onScheduledAlarm?.(id, payload);
      }, Math.max(0, delayMs));
      handle.unref?.();
      timers.set(id, handle);
    },
    async cancel(id: string): Promise<void> {
      const prev = timers.get(id);
      if (prev) {
        clearTimeout(prev);
        timers.delete(id);
      }
    },
  };

  const transport: CaptainTransport = {
    async broadcast(event: CaptainEvent): Promise<void> {
      onEvent?.(event);
    },
  };

  return {
    kind: "node-sqlite",
    region,
    storage,
    scheduler,
    transport,
    close() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
