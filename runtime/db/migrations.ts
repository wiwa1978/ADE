import type { DatabaseSync } from "node:sqlite";

export type SchemaMigration = {
	version: number;
	name: string;
	up: (db: DatabaseSync) => void;
};

function ensureColumn(db: DatabaseSync, table: string, name: string, ddl: string): void {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
	if (!cols.some((col) => col.name === name)) {
		db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
	}
}

/**
 * Ordered, immutable schema migrations for `ade-host.sqlite`.
 * Each migration runs at most once inside an atomic SQLite transaction and
 * advances `PRAGMA user_version` + `schema_migrations`.
 */
export const HOST_MIGRATIONS: readonly SchemaMigration[] = [
	{
		version: 1,
		name: "baseline_host_schema",
		up(db) {
			db.exec(`
				CREATE TABLE IF NOT EXISTS schema_migrations (
					version INTEGER PRIMARY KEY,
					name TEXT NOT NULL,
					appliedAt INTEGER NOT NULL
				);

				CREATE TABLE IF NOT EXISTS turns (
					id TEXT PRIMARY KEY,
					mode TEXT NOT NULL CHECK(mode IN ('coding','personal')),
					content TEXT NOT NULL,
					provider TEXT,
					model TEXT NOT NULL,
					reasoning TEXT NOT NULL,
					status TEXT NOT NULL CHECK(status IN ('pending','completed','failed','blocked')),
					answer TEXT,
					error TEXT,
					createdAt INTEGER NOT NULL,
					updatedAt INTEGER NOT NULL,
					taskId TEXT,
					chatId TEXT
				);

				CREATE TABLE IF NOT EXISTS coding_tasks (
					id TEXT PRIMARY KEY,
					title TEXT NOT NULL,
					repository TEXT NOT NULL,
					kind TEXT NOT NULL,
					base TEXT NOT NULL,
					branch TEXT,
					workspace TEXT,
					status TEXT NOT NULL,
					message TEXT,
					createdAt INTEGER NOT NULL,
					workspaceDev TEXT,
					workspaceIno TEXT,
					initialTurnId TEXT,
					projectId TEXT REFERENCES projects(id),
					initialTitle TEXT,
					issueUrl TEXT,
					issueRepository TEXT,
					issueNumber INTEGER,
					issueTitle TEXT,
					issueState TEXT,
					archivedAt INTEGER,
					worktreeRemoved INTEGER NOT NULL DEFAULT 0
				);

				CREATE TABLE IF NOT EXISTS projects (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					githubUrl TEXT,
					repository TEXT,
					createdAt INTEGER NOT NULL,
					updatedAt INTEGER NOT NULL,
					archivedAt INTEGER,
					blueprintId TEXT DEFAULT 'automated-factory',
					modelProfile TEXT DEFAULT 'balanced',
					euOnlyMode INTEGER DEFAULT 0,
					cloudActFree INTEGER DEFAULT 0,
					stageOverridesJson TEXT
				);

				CREATE TABLE IF NOT EXISTS github_connection (
					id INTEGER PRIMARY KEY CHECK(id=1),
					login TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS github_connection_preferences (
					id INTEGER PRIMARY KEY CHECK(id=1),
					auto_connect INTEGER NOT NULL
				);

				CREATE TABLE IF NOT EXISTS chat_threads (
					id TEXT PRIMARY KEY,
					mode TEXT NOT NULL CHECK(mode IN ('coding','personal')),
					title TEXT NOT NULL,
					manuallyNamed INTEGER NOT NULL DEFAULT 0,
					createdAt INTEGER NOT NULL,
					archivedAt INTEGER
				);

				CREATE TABLE IF NOT EXISTS provider_preferences (
					id TEXT PRIMARY KEY,
					enabled INTEGER NOT NULL
				);

				CREATE TABLE IF NOT EXISTS approval_rules (
					id TEXT PRIMARY KEY,
					toolName TEXT NOT NULL,
					prefix TEXT NOT NULL,
					createdAt INTEGER NOT NULL,
					UNIQUE(toolName, prefix)
				);

				CREATE TABLE IF NOT EXISTS approval_settings (
					id INTEGER PRIMARY KEY CHECK(id=1),
					policy TEXT NOT NULL
				);

				CREATE TABLE IF NOT EXISTS session_artifacts (
					id TEXT PRIMARY KEY,
					sessionId TEXT NOT NULL,
					title TEXT NOT NULL,
					kind TEXT NOT NULL,
					content TEXT NOT NULL,
					status TEXT NOT NULL,
					feedback TEXT,
					createdAt INTEGER NOT NULL,
					updatedAt INTEGER NOT NULL
				);

				CREATE TABLE IF NOT EXISTS session_tasks (
					sessionId TEXT PRIMARY KEY,
					itemsJson TEXT NOT NULL,
					updatedAt INTEGER NOT NULL
				);

				CREATE TABLE IF NOT EXISTS mcp_servers (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL,
					transport TEXT NOT NULL,
					configJson TEXT NOT NULL,
					enabled INTEGER NOT NULL DEFAULT 1,
					createdAt INTEGER NOT NULL
				);

				CREATE TABLE IF NOT EXISTS captain_kv (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL,
					updated_at INTEGER NOT NULL
				);
			`);

			// Upgrade pre-migration databases that were created before later columns existed.
			ensureColumn(db, "turns", "provider", "TEXT");
			ensureColumn(db, "turns", "taskId", "TEXT");
			ensureColumn(db, "turns", "chatId", "TEXT");

			ensureColumn(db, "coding_tasks", "workspaceDev", "TEXT");
			ensureColumn(db, "coding_tasks", "workspaceIno", "TEXT");
			ensureColumn(db, "coding_tasks", "initialTurnId", "TEXT");
			ensureColumn(db, "coding_tasks", "projectId", "TEXT REFERENCES projects(id)");
			ensureColumn(db, "coding_tasks", "initialTitle", "TEXT");
			ensureColumn(db, "coding_tasks", "issueUrl", "TEXT");
			ensureColumn(db, "coding_tasks", "issueRepository", "TEXT");
			ensureColumn(db, "coding_tasks", "issueNumber", "INTEGER");
			ensureColumn(db, "coding_tasks", "issueTitle", "TEXT");
			ensureColumn(db, "coding_tasks", "issueState", "TEXT");
			ensureColumn(db, "coding_tasks", "archivedAt", "INTEGER");
			ensureColumn(db, "coding_tasks", "worktreeRemoved", "INTEGER NOT NULL DEFAULT 0");

			ensureColumn(db, "projects", "archivedAt", "INTEGER");
			ensureColumn(db, "projects", "blueprintId", "TEXT DEFAULT 'automated-factory'");
			ensureColumn(db, "projects", "modelProfile", "TEXT DEFAULT 'balanced'");
			ensureColumn(db, "projects", "euOnlyMode", "INTEGER DEFAULT 0");
			ensureColumn(db, "projects", "cloudActFree", "INTEGER DEFAULT 0");
			ensureColumn(db, "projects", "stageOverridesJson", "TEXT");

			ensureColumn(db, "chat_threads", "archivedAt", "INTEGER");
		},
	},
	{
		version: 2,
		name: "coding_tasks_existing_branch",
		up(db) {
			// Sessions started from an existing branch or pull request check that branch out instead of creating one.
			ensureColumn(db, "coding_tasks", "existingBranch", "INTEGER NOT NULL DEFAULT 0");
		},
	},
	{
		version: 3,
		name: "approval_rules_effect",
		up(db) {
			// Rules can now block commands outright ("deny"), not only skip the approval prompt ("allow").
			ensureColumn(db, "approval_rules", "effect", "TEXT NOT NULL DEFAULT 'allow'");
		},
	},
	{
		version: 4,
		name: "coding_tasks_attempt_group",
		up(db) {
			// Best of N: sessions started together on the same task share a group to compare them.
			ensureColumn(db, "coding_tasks", "attemptGroup", "TEXT");
		},
	},
];

export const LATEST_HOST_SCHEMA_VERSION = HOST_MIGRATIONS[HOST_MIGRATIONS.length - 1].version;

export function getSchemaVersion(db: DatabaseSync): number {
	const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
	return Number(row?.user_version ?? 0);
}

/**
 * Runs all pending migrations up to `LATEST_HOST_SCHEMA_VERSION`, each inside
 * its own transaction. Safe to call repeatedly; returns immediately once current.
 */
export function runHostMigrations(
	db: DatabaseSync,
	migrations: readonly SchemaMigration[] = HOST_MIGRATIONS,
): number {
	let currentVersion = getSchemaVersion(db);
	const targetVersion = migrations.length ? migrations[migrations.length - 1].version : 0;
	if (currentVersion >= targetVersion) return currentVersion;

	for (const migration of migrations) {
		if (migration.version <= currentVersion) continue;
		db.exec("BEGIN IMMEDIATE");
		try {
			migration.up(db);
			db.prepare(
				"INSERT OR REPLACE INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)",
			).run(migration.version, migration.name, Date.now());
			db.exec(`PRAGMA user_version = ${migration.version}`);
			db.exec("COMMIT");
			currentVersion = migration.version;
		} catch (error) {
			try {
				db.exec("ROLLBACK");
			} catch {
				// SQLite may have already aborted the transaction on constraint/IO error.
			}
			throw error;
		}
	}
	return currentVersion;
}
