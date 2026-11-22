import type { DatabaseSync } from "node:sqlite";
import { lookupGitHubIssue } from "../github-issues.ts";
import { badGateway, badRequest, conflict, notFound } from "../http-error.ts";
import { logger } from "../log.ts";
import { resolveCheckout } from "../worktrees.ts";
import { dbAll, dbGet } from "./schema.ts";
import { detectGitHubRemoteFromCheckout, type ProjectRow, type SerializedProject } from "./types.ts";

export class ProjectStore {
	#db: DatabaseSync;
	#githubIssueFetcher: typeof fetch;

	constructor(db: DatabaseSync, githubIssueFetcher: typeof fetch = fetch) {
		this.#db = db;
		this.#githubIssueFetcher = githubIssueFetcher;
	}

	serialize(row: ProjectRow | undefined): SerializedProject | null {
		if (!row) return null;
		let stageOverrides: Record<string, { provider: string; model: string }> | undefined;
		if (typeof row.stageOverridesJson === "string" && row.stageOverridesJson.trim()) {
			try {
				stageOverrides = JSON.parse(row.stageOverridesJson) as Record<string, { provider: string; model: string }>;
			} catch (error) {
				logger.warn("Malformed stageOverridesJson on project row", { error, context: { projectId: row.id } });
			}
		}
		return {
			id: row.id,
			name: row.name,
			githubUrl: row.githubUrl ?? null,
			repository: row.repository ?? null,
			blueprintId: row.blueprintId || "automated-factory",
			modelProfile: row.modelProfile || "balanced",
			euOnlyMode: Boolean(row.euOnlyMode),
			cloudActFree: Boolean(row.cloudActFree),
			...(stageOverrides ? { stageOverrides } : {}),
			archivedAt: row.archivedAt ?? null,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	list(): SerializedProject[] {
		return dbAll<ProjectRow>(this.#db, "SELECT * FROM projects ORDER BY createdAt,id")
			.map(row => this.serialize(row))
			.filter((project): project is SerializedProject => project !== null);
	}

	get(id: string): ProjectRow | undefined {
		return dbGet<ProjectRow>(this.#db, "SELECT * FROM projects WHERE id=?", id);
	}

	exists(id: string): boolean {
		return Boolean(this.#db.prepare("SELECT 1 FROM projects WHERE id=?").get(id));
	}

	async save(input: Record<string, unknown> | null | undefined, id?: string): Promise<SerializedProject | null> {
		const projectId = id ?? input?.id;
		if (typeof projectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId) ||
			typeof input?.name !== "string" || !input.name.trim() || input.name.length > 100 ||
			(input.githubUrl != null && typeof input.githubUrl !== "string") ||
			(input.repository != null && typeof input.repository !== "string")) {
			throw badRequest("Provide a project ID, name and optional repository links.");
		}
		let githubUrl: string | null = null;
		if (typeof input.githubUrl === "string" && input.githubUrl.trim()) {
			const match = /^(?:https:\/\/github\.com\/)?([a-z0-9-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(input.githubUrl.trim());
			if (!match || [".", ".."].includes(match[2])) {
				throw badRequest("Use a GitHub repository URL or owner/repository, without credentials or query parameters.");
			}
			githubUrl = `https://github.com/${match[1]}/${match[2]}`;
		}
		const repository = typeof input.repository === "string" && input.repository.trim() ? await resolveCheckout(input.repository.trim()) : null;
		if (!githubUrl && repository && input.githubUrl === undefined) {
			const detected = await detectGitHubRemoteFromCheckout(repository);
			if (detected) githubUrl = `https://github.com/${detected}`;
		}
		const name = input.name.trim();
		const blueprintId = typeof input.blueprintId === "string" && input.blueprintId.trim() ? input.blueprintId.trim() : undefined;
		const modelProfile = typeof input.modelProfile === "string" && input.modelProfile.trim() ? input.modelProfile.trim() : undefined;
		const euOnlyMode = typeof input.euOnlyMode === "boolean" ? (input.euOnlyMode ? 1 : 0) : undefined;
		const cloudActFree = typeof input.cloudActFree === "boolean" ? (input.cloudActFree ? 1 : 0) : undefined;
		const stageOverridesJson =
			input.stageOverrides !== undefined
				? (input.stageOverrides && Object.keys(input.stageOverrides).length ? JSON.stringify(input.stageOverrides) : null)
				: undefined;

		const existing = this.get(projectId);
		if (id) {
			if (!existing) throw notFound("Project not found.");
			this.#db.prepare(
				`UPDATE projects SET
					name=?, githubUrl=?, repository=?,
					blueprintId=COALESCE(?, blueprintId),
					modelProfile=COALESCE(?, modelProfile),
					euOnlyMode=COALESCE(?, euOnlyMode),
					cloudActFree=COALESCE(?, cloudActFree),
					stageOverridesJson=CASE WHEN ? THEN ? ELSE stageOverridesJson END,
					updatedAt=?
				WHERE id=?`,
			).run(
				name,
				githubUrl,
				repository,
				blueprintId ?? null,
				modelProfile ?? null,
				euOnlyMode ?? null,
				cloudActFree ?? null,
				stageOverridesJson !== undefined ? 1 : 0,
				stageOverridesJson ?? null,
				Date.now(),
				id,
			);
		} else if (existing) {
			if (existing.name !== name || existing.githubUrl !== githubUrl || existing.repository !== repository) {
				throw conflict("This project ID already belongs to different inputs.");
			}
		} else {
			const now = Date.now();
			this.#db.prepare(
				"INSERT INTO projects (id, name, githubUrl, repository, createdAt, updatedAt, blueprintId, modelProfile, euOnlyMode, cloudActFree, stageOverridesJson) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
			).run(
				projectId,
				name,
				githubUrl,
				repository,
				now,
				now,
				blueprintId ?? "automated-factory",
				modelProfile ?? "balanced",
				euOnlyMode ?? 0,
				cloudActFree ?? 0,
				stageOverridesJson ?? null,
			);
		}
		return this.serialize(this.get(projectId));
	}

	delete(id: string): { deleted: true; id: string } {
		const existing = this.get(id);
		if (!existing) throw notFound("Project not found.");
		this.#db.prepare("UPDATE coding_tasks SET projectId=NULL WHERE projectId=?").run(id);
		this.#db.prepare("DELETE FROM projects WHERE id=?").run(id);
		return { deleted: true, id };
	}

	setArchivedTimestamp(id: string, archivedAt: number | null): SerializedProject | null {
		this.#db.prepare("UPDATE projects SET archivedAt=? WHERE id=?").run(archivedAt, id);
		return this.serialize(this.get(id));
	}

	githubConnection(): { login: string | null } {
		const connection = dbGet<{ login: string }>(this.#db, "SELECT login FROM github_connection WHERE id=1");
		return { login: connection?.login ?? null };
	}

	githubAutoConnectEnabled(): boolean {
		const row = dbGet<{ auto_connect: number }>(this.#db, "SELECT auto_connect FROM github_connection_preferences WHERE id=1");
		return row?.auto_connect !== 0;
	}

	connectGitHub(login: unknown): { login: string | null } {
		if (typeof login !== "string" || !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(login)) {
			throw badGateway("GitHub CLI did not return a valid account.");
		}
		const previous = this.githubConnection().login;
		if (previous && previous.toLowerCase() !== login.toLowerCase()) {
			throw conflict("The GitHub CLI account changed. Disconnect it in Settings before connecting another account.");
		}
		this.#db.prepare("INSERT INTO github_connection (id,login) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login").run(login);
		this.#db.prepare("INSERT INTO github_connection_preferences (id,auto_connect) VALUES (1,1) ON CONFLICT(id) DO UPDATE SET auto_connect=1").run();
		return this.githubConnection();
	}

	disconnectGitHub(): { login: string | null } {
		this.#db.prepare("DELETE FROM github_connection WHERE id=1").run();
		this.#db.prepare("INSERT INTO github_connection_preferences (id,auto_connect) VALUES (1,0) ON CONFLICT(id) DO UPDATE SET auto_connect=0").run();
		return this.githubConnection();
	}

	async lookupGitHubIssue(projectId: unknown, url: unknown) {
		const project = typeof projectId === "string" ? this.get(projectId) : undefined;
		return lookupGitHubIssue({ project, url, fetcher: this.#githubIssueFetcher });
	}
}
