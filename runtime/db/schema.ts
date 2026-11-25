import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { runHostMigrations } from "./migrations.ts";

const statementCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
const txDepth = new WeakMap<DatabaseSync, number>();

export function dbPrepare(db: DatabaseSync, sql: string): StatementSync {
	let cache = statementCache.get(db);
	if (!cache) {
		cache = new Map<string, StatementSync>();
		statementCache.set(db, cache);
	}
	let stmt = cache.get(sql);
	if (!stmt) {
		stmt = db.prepare(sql);
		cache.set(sql, stmt);
	}
	return stmt;
}

export function dbGet<T>(db: DatabaseSync, sql: string, ...args: SQLInputValue[]): T | undefined {
	return dbPrepare(db, sql).get(...args) as T | undefined;
}

export function dbAll<T>(db: DatabaseSync, sql: string, ...args: SQLInputValue[]): T[] {
	return dbPrepare(db, sql).all(...args) as unknown as T[];
}

export function dbRun(db: DatabaseSync, sql: string, ...args: SQLInputValue[]) {
	return dbPrepare(db, sql).run(...args);
}

/**
 * Runs `fn` inside a SQLite transaction (supporting safe nesting via SAVEPOINTs).
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
	const depth = txDepth.get(db) ?? 0;
	const savepoint = `tx_${depth}`;
	if (depth === 0) {
		db.exec("BEGIN IMMEDIATE");
	} else {
		db.exec(`SAVEPOINT ${savepoint}`);
	}
	txDepth.set(db, depth + 1);
	try {
		const result = fn();
		if (depth === 0) {
			db.exec("COMMIT");
		} else {
			db.exec(`RELEASE SAVEPOINT ${savepoint}`);
		}
		return result;
	} catch (error) {
		try {
			if (depth === 0) {
				db.exec("ROLLBACK");
			} else {
				db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
				db.exec(`RELEASE SAVEPOINT ${savepoint}`);
			}
		} catch {
			// SQLite may have already rolled back on I/O or constraint error.
		}
		throw error;
	} finally {
		if (depth === 0) {
			txDepth.delete(db);
		} else {
			txDepth.set(db, depth);
		}
	}
}

export function openHostDatabase(stateDirectory: string): DatabaseSync {
	mkdirSync(stateDirectory, { recursive: true });
	const db = new DatabaseSync(join(stateDirectory, "ade-host.sqlite"));
	initializeHostSchema(db);
	return db;
}

export function initializeHostSchema(db: DatabaseSync): void {
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	db.exec("PRAGMA synchronous = NORMAL;");
	db.exec("PRAGMA foreign_keys = ON;");
	runHostMigrations(db);
}
