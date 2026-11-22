import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export function dbGet<T>(db: DatabaseSync, sql: string, ...args: SQLInputValue[]): T | undefined {
	return db.prepare(sql).get(...args) as T | undefined;
}

export function dbAll<T>(db: DatabaseSync, sql: string, ...args: SQLInputValue[]): T[] {
	return db.prepare(sql).all(...args) as unknown as T[];
}

export function openHostDatabase(stateDirectory: string): DatabaseSync {
	mkdirSync(stateDirectory, { recursive: true });
	const db = new DatabaseSync(join(stateDirectory, "ade-host.sqlite"));
	initializeHostSchema(db);
	return db;
}

export function initializeHostSchema(db: DatabaseSync): void {
	db.exec(`
		PRAGMA journal_mode=WAL;
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
			updatedAt INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS coding_tasks (
			id TEXT PRIMARY KEY, title TEXT NOT NULL, repository TEXT NOT NULL,
			kind TEXT NOT NULL, base TEXT NOT NULL, branch TEXT, workspace TEXT,
			status TEXT NOT NULL, message TEXT, createdAt INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY, name TEXT NOT NULL, githubUrl TEXT,
			repository TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS github_connection (
			id INTEGER PRIMARY KEY CHECK(id=1), login TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS github_connection_preferences (
			id INTEGER PRIMARY KEY CHECK(id=1), auto_connect INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS chat_threads (
			id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('coding','personal')),
			title TEXT NOT NULL, manuallyNamed INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS provider_preferences (
			id TEXT PRIMARY KEY,
			enabled INTEGER NOT NULL
		);
	`);

	const ensureColumn = (table: string, name: string, ddl: string) => {
		const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
		if (!cols.some(col => col.name === name)) {
			db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
		}
	};

	ensureColumn("turns", "provider", "TEXT");
	ensureColumn("turns", "taskId", "TEXT");
	ensureColumn("turns", "chatId", "TEXT");

	ensureColumn("coding_tasks", "workspaceDev", "TEXT");
	ensureColumn("coding_tasks", "workspaceIno", "TEXT");
	ensureColumn("coding_tasks", "initialTurnId", "TEXT");
	ensureColumn("coding_tasks", "projectId", "TEXT REFERENCES projects(id)");
	ensureColumn("coding_tasks", "initialTitle", "TEXT");
	ensureColumn("coding_tasks", "issueUrl", "TEXT");
	ensureColumn("coding_tasks", "issueRepository", "TEXT");
	ensureColumn("coding_tasks", "issueNumber", "INTEGER");
	ensureColumn("coding_tasks", "issueTitle", "TEXT");
	ensureColumn("coding_tasks", "issueState", "TEXT");
	ensureColumn("coding_tasks", "archivedAt", "INTEGER");
	ensureColumn("coding_tasks", "worktreeRemoved", "INTEGER NOT NULL DEFAULT 0");

	ensureColumn("projects", "archivedAt", "INTEGER");
	ensureColumn("projects", "blueprintId", "TEXT DEFAULT 'automated-factory'");
	ensureColumn("projects", "modelProfile", "TEXT DEFAULT 'balanced'");
	ensureColumn("projects", "euOnlyMode", "INTEGER DEFAULT 0");
	ensureColumn("projects", "cloudActFree", "INTEGER DEFAULT 0");
	ensureColumn("projects", "stageOverridesJson", "TEXT");

	ensureColumn("chat_threads", "archivedAt", "INTEGER");
}
