import type { DatabaseSync } from "node:sqlite";

/**
 * Which skills and MCP servers are on. Everything is on unless turned off ("opt out"):
 * a project setting beats the global setting, which beats the default (on).
 *
 * Skills are keyed by name (lower-case), so a setting follows the skill wherever it lives.
 * MCP servers are keyed by their server id. Project `.mcp.json` files also need trust once
 * (itemKind "mcp-trust", key ".mcp.json"), because they come from the repository.
 */
export type CapabilityKind = "skill" | "mcp" | "mcp-trust";
export type CapabilityScope = "global" | "project";

export type CapabilityState = {
	/** What applies after inheritance. */
	active: boolean;
	/** The global setting, if any (null = default on). */
	global: boolean | null;
	/** The project setting, if any (null = inherit). */
	project: boolean | null;
};

type Row = { scopeKind: CapabilityScope; scopeId: string; itemKind: CapabilityKind; itemKey: string; enabled: number };

export function normalizeKey(kind: CapabilityKind, key: string): string {
	return kind === "skill" ? key.trim().toLowerCase() : key.trim();
}

export class CapabilitySettings {
	#db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.#db = db;
		// The table also comes from host migration v6; this keeps the class usable on its own (tests).
		this.#db.exec(`CREATE TABLE IF NOT EXISTS capability_settings (
			scopeKind TEXT NOT NULL,
			scopeId TEXT NOT NULL,
			itemKind TEXT NOT NULL,
			itemKey TEXT NOT NULL,
			enabled INTEGER NOT NULL,
			updatedAt INTEGER NOT NULL,
			PRIMARY KEY (scopeKind, scopeId, itemKind, itemKey)
		)`);
	}

	/** Set or clear (enabled = null: inherit) one setting. */
	set(scope: CapabilityScope, scopeId: string | null, kind: CapabilityKind, key: string, enabled: boolean | null): void {
		const id = scope === "global" ? "" : (scopeId ?? "");
		if (scope === "project" && !id) throw new Error("A project setting needs a project id.");
		const itemKey = normalizeKey(kind, key);
		if (!itemKey) throw new Error("Missing item key.");
		if (enabled === null) {
			this.#db.prepare("DELETE FROM capability_settings WHERE scopeKind=? AND scopeId=? AND itemKind=? AND itemKey=?").run(scope, id, kind, itemKey);
			return;
		}
		this.#db.prepare(`INSERT INTO capability_settings (scopeKind, scopeId, itemKind, itemKey, enabled, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(scopeKind, scopeId, itemKind, itemKey) DO UPDATE SET enabled=excluded.enabled, updatedAt=excluded.updatedAt`)
			.run(scope, id, kind, itemKey, enabled ? 1 : 0, Date.now());
	}

	/** All settings of one kind for the global scope and (optionally) one project. */
	#settings(kind: CapabilityKind, projectId?: string | null) {
		const rows = this.#db.prepare("SELECT * FROM capability_settings WHERE itemKind=? AND (scopeKind='global' OR (scopeKind='project' AND scopeId=?))")
			.all(kind, projectId ?? "") as unknown as Row[];
		const global = new Map<string, boolean>();
		const project = new Map<string, boolean>();
		for (const row of rows) (row.scopeKind === "global" ? global : project).set(row.itemKey, Boolean(row.enabled));
		return { global, project };
	}

	/** A resolver for many lookups at once (one query). */
	resolver(kind: CapabilityKind, projectId?: string | null, fallback = true): (key: string) => CapabilityState {
		const { global, project } = this.#settings(kind, projectId);
		return (key: string) => {
			const k = normalizeKey(kind, key);
			const g = global.has(k) ? global.get(k)! : null;
			const p = projectId && project.has(k) ? project.get(k)! : null;
			return { active: p ?? g ?? fallback, global: g, project: p };
		};
	}

	state(kind: CapabilityKind, key: string, projectId?: string | null, fallback = true): CapabilityState {
		return this.resolver(kind, projectId, fallback)(key);
	}

	isActive(kind: CapabilityKind, key: string, projectId?: string | null): boolean {
		return this.state(kind, key, projectId).active;
	}

	/** Remove every setting for a project (when it's deleted). */
	clearProject(projectId: string): void {
		this.#db.prepare("DELETE FROM capability_settings WHERE scopeKind='project' AND scopeId=?").run(projectId);
	}
}
