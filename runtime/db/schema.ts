import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { runHostMigrations } from "./migrations.ts";

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
	db.exec("PRAGMA journal_mode=WAL;");
	runHostMigrations(db);
}
