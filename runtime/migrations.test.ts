import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
	getSchemaVersion,
	HOST_MIGRATIONS,
	LATEST_HOST_SCHEMA_VERSION,
	runHostMigrations,
	type SchemaMigration,
} from "./db/migrations.ts";
import { initializeHostSchema } from "./db/schema.ts";

type TableColumnSnapshot = {
	name: string;
	type: string;
	notnull: number;
	dflt_value: string | null;
	pk: number;
};

function snapshotSchema(db: DatabaseSync): Record<string, TableColumnSnapshot[]> {
	const tables = (
		db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all() as { name: string }[]
	).map((row) => row.name);

	const result: Record<string, TableColumnSnapshot[]> = {};
	for (const table of tables) {
		const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as TableColumnSnapshot[];
		result[table] = cols
			.map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}
	return result;
}

test("migrations upgrade a legacy pre-migration database to the exact same schema as a fresh database without losing data", () => {
	// 1. Fresh database
	const freshDb = new DatabaseSync(":memory:");
	initializeHostSchema(freshDb);

	// 2. Legacy database (snapshot of the original tables before later columns were added)
	const legacyDb = new DatabaseSync(":memory:");
	legacyDb.exec(`
		CREATE TABLE turns (
			id TEXT PRIMARY KEY,
			mode TEXT NOT NULL CHECK(mode IN ('coding','personal')),
			content TEXT NOT NULL,
			model TEXT NOT NULL,
			reasoning TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('pending','completed','failed','blocked')),
			answer TEXT,
			error TEXT,
			createdAt INTEGER NOT NULL,
			updatedAt INTEGER NOT NULL
		);
		CREATE TABLE coding_tasks (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			repository TEXT NOT NULL,
			kind TEXT NOT NULL,
			base TEXT NOT NULL,
			branch TEXT,
			workspace TEXT,
			status TEXT NOT NULL,
			message TEXT,
			createdAt INTEGER NOT NULL
		);
		CREATE TABLE projects (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			githubUrl TEXT,
			repository TEXT,
			createdAt INTEGER NOT NULL,
			updatedAt INTEGER NOT NULL
		);
		CREATE TABLE chat_threads (
			id TEXT PRIMARY KEY,
			mode TEXT NOT NULL CHECK(mode IN ('coding','personal')),
			title TEXT NOT NULL,
			manuallyNamed INTEGER NOT NULL DEFAULT 0,
			createdAt INTEGER NOT NULL
		);
	`);

	legacyDb
		.prepare("INSERT INTO projects (id, name, githubUrl, repository, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
		.run("proj-1", "Legacy Project", "https://github.com/acme/demo", "/tmp/demo", 1000, 1000);
	legacyDb
		.prepare(
			"INSERT INTO coding_tasks (id, title, repository, kind, base, branch, workspace, status, message, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run("task-1", "Fix login", "/tmp/demo", "worktree", "main", "ade/fix-login", "/tmp/wt", "ready", null, 1001);
	legacyDb
		.prepare(
			"INSERT INTO turns (id, mode, content, model, reasoning, status, answer, error, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run("turn-1", "coding", "hello", "gpt-5", "medium", "completed", "world", null, 1002, 1003);
	legacyDb
		.prepare("INSERT INTO chat_threads (id, mode, title, manuallyNamed, createdAt) VALUES (?, ?, ?, ?, ?)")
		.run("chat-1", "personal", "Notes", 1, 1004);

	assert.equal(getSchemaVersion(legacyDb), 0);

	initializeHostSchema(legacyDb);

	assert.equal(getSchemaVersion(freshDb), LATEST_HOST_SCHEMA_VERSION);
	assert.equal(getSchemaVersion(legacyDb), LATEST_HOST_SCHEMA_VERSION);

	// Exact schema parity (all tables and all column definitions)
	assert.deepEqual(snapshotSchema(legacyDb), snapshotSchema(freshDb));

	// Pre-existing legacy data is preserved and new column defaults apply
	const project = legacyDb.prepare("SELECT * FROM projects WHERE id='proj-1'").get() as Record<string, unknown>;
	assert.equal(project.name, "Legacy Project");
	// Projects that only had the old default ("automated-factory") move to Vibe: sessions ignored it before.
	assert.equal(project.blueprintId, "vibe");
	assert.equal(project.blueprintLocked, 0);
	assert.equal(project.modelProfile, "balanced");
	assert.equal(project.archivedAt, null);

	const task = legacyDb.prepare("SELECT * FROM coding_tasks WHERE id='task-1'").get() as Record<string, unknown>;
	assert.equal(task.title, "Fix login");
	assert.equal(task.worktreeRemoved, 0);
	assert.equal(task.archivedAt, null);

	const turn = legacyDb.prepare("SELECT * FROM turns WHERE id='turn-1'").get() as Record<string, unknown>;
	assert.equal(turn.answer, "world");
	assert.equal(turn.provider, null);

	const chat = legacyDb.prepare("SELECT * FROM chat_threads WHERE id='chat-1'").get() as Record<string, unknown>;
	assert.equal(chat.title, "Notes");
	assert.equal(chat.archivedAt, null);

	// Migration v7 secondary indexes exist on both fresh and migrated databases
	const expectedIndexes = [
		"idx_turns_taskId_createdAt",
		"idx_turns_chatId_createdAt",
		"idx_turns_status",
		"idx_turns_mode_root",
		"idx_coding_tasks_projectId",
		"idx_coding_tasks_workspace",
		"idx_session_artifacts_sessionId",
		"idx_approval_rules_tool_effect",
	];
	for (const conn of [freshDb, legacyDb]) {
		const indexNames = new Set(
			(
				conn
					.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
					.all() as { name: string }[]
			).map((row) => row.name),
		);
		for (const idx of expectedIndexes) {
			assert.ok(indexNames.has(idx), `Expected index ${idx} to exist`);
		}
		assert.equal((conn.prepare("PRAGMA foreign_keys").get() as { foreign_keys?: number })?.foreign_keys, 1);
		assert.equal((conn.prepare("PRAGMA busy_timeout").get() as { timeout?: number })?.timeout, 5000);
	}

	freshDb.close();
	legacyDb.close();
});

test("migrations run each version at most once and roll back atomically on failure", () => {
	const db = new DatabaseSync(":memory:");
	let runs = 0;
	const customMigrations: SchemaMigration[] = [
		...HOST_MIGRATIONS,
		{
			version: LATEST_HOST_SCHEMA_VERSION + 1,
			name: "add_test_table",
			up(conn) {
				runs++;
				conn.exec("CREATE TABLE migration_probe (id TEXT PRIMARY KEY)");
			},
		},
	];

	assert.equal(runHostMigrations(db, customMigrations), LATEST_HOST_SCHEMA_VERSION + 1);
	assert.equal(runs, 1);
	// Second invocation must be a no-op
	assert.equal(runHostMigrations(db, customMigrations), LATEST_HOST_SCHEMA_VERSION + 1);
	assert.equal(runs, 1);

	const failingMigrations: SchemaMigration[] = [
		...customMigrations,
		{
			version: LATEST_HOST_SCHEMA_VERSION + 2,
			name: "broken_migration",
			up(conn) {
				conn.exec("CREATE TABLE should_roll_back (id TEXT PRIMARY KEY)");
				throw new Error("Simulated migration failure");
			},
		},
	];

	assert.throws(() => runHostMigrations(db, failingMigrations), /Simulated migration failure/);
	assert.equal(getSchemaVersion(db), LATEST_HOST_SCHEMA_VERSION + 1);
	const rolledBackTable = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='should_roll_back'")
		.get();
	assert.equal(rolledBackTable, undefined);

	db.close();
});
