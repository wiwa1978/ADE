import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { arr, bool, obj, opt, str } from "@earendil-works/pi-schema";
import type {
	ArtifactKind,
	ArtifactStatus,
	SessionArtifact,
	SessionTaskItem,
} from "../packages/protocol/index.ts";
import type { RuntimeEventBus } from "./events.ts";
import { runHostMigrations } from "./db/migrations.ts";
import { notFound } from "./http-error.ts";

export type { ArtifactKind, ArtifactStatus, SessionArtifact, SessionTaskItem };

export class ArtifactManager {
	#db: DatabaseSync;
	#events: RuntimeEventBus;

	constructor(db: DatabaseSync, events: RuntimeEventBus) {
		this.#db = db;
		this.#events = events;
		runHostMigrations(this.#db);
	}

	listArtifacts(sessionId: string): SessionArtifact[] {
		return this.#db.prepare("SELECT * FROM session_artifacts WHERE sessionId=? ORDER BY updatedAt DESC").all(sessionId) as unknown as SessionArtifact[];
	}

	listArtifactsForSessions(sessionIds: string[]): SessionArtifact[] {
		if (sessionIds.length === 0) return [];
		const placeholders = sessionIds.map(() => "?").join(", ");
		return this.#db
			.prepare(`SELECT * FROM session_artifacts WHERE sessionId IN (${placeholders}) ORDER BY updatedAt DESC`)
			.all(...sessionIds) as unknown as SessionArtifact[];
	}

	getArtifact(id: string): SessionArtifact | null {
		return (this.#db.prepare("SELECT * FROM session_artifacts WHERE id=?").get(id) as unknown as SessionArtifact | undefined) ?? null;
	}

	upsertArtifact(input: {
		id?: string;
		sessionId: string;
		title: string;
		kind?: ArtifactKind;
		content: string;
		requestApproval?: boolean;
	}): SessionArtifact {
		const now = Date.now();
		const kind: ArtifactKind = ["plan", "markdown", "html", "walkthrough", "diff"].includes(input.kind ?? "")
			? (input.kind as ArtifactKind)
			: "markdown";
		const status: ArtifactStatus = input.requestApproval ? "awaiting_approval" : "draft";
		const existing = input.id
			? this.getArtifact(input.id)
			: (this.#db.prepare("SELECT * FROM session_artifacts WHERE sessionId=? AND title=?").get(input.sessionId, input.title.trim()) as SessionArtifact | undefined) ?? null;

		if (existing) {
			this.#db.prepare("UPDATE session_artifacts SET title=?, kind=?, content=?, status=?, updatedAt=? WHERE id=?")
				.run(input.title.trim(), kind, input.content, status, now, existing.id);
			const updated = this.getArtifact(existing.id)!;
			this.#events.emit("artifacts.update", { sessionId: input.sessionId, artifacts: this.listArtifacts(input.sessionId), activeArtifactId: updated.id }, input.sessionId);
			return updated;
		}
		const id = input.id || randomUUID();
		this.#db.prepare("INSERT INTO session_artifacts (id, sessionId, title, kind, content, status, feedback, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)")
			.run(id, input.sessionId, input.title.trim(), kind, input.content, status, now, now);
		const created = this.getArtifact(id)!;
		this.#events.emit("artifacts.update", { sessionId: input.sessionId, artifacts: this.listArtifacts(input.sessionId), activeArtifactId: created.id }, input.sessionId);
		return created;
	}

	reviewArtifact(id: string, decision: "approved" | "changes_requested", feedback?: string): SessionArtifact {
		const existing = this.getArtifact(id);
		if (!existing) throw notFound("Artifact not found.");
		const now = Date.now();
		this.#db.prepare("UPDATE session_artifacts SET status=?, feedback=?, updatedAt=? WHERE id=?")
			.run(decision, feedback?.trim() || null, now, id);
		const updated = this.getArtifact(id)!;
		this.#events.emit("artifacts.update", { sessionId: updated.sessionId, artifacts: this.listArtifacts(updated.sessionId), activeArtifactId: updated.id }, updated.sessionId);
		return updated;
	}

	getTasks(sessionId: string): SessionTaskItem[] {
		const row = this.#db.prepare("SELECT itemsJson FROM session_tasks WHERE sessionId=?").get(sessionId) as { itemsJson: string } | undefined;
		if (!row) return [];
		try {
			const parsed = JSON.parse(row.itemsJson);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	setTasks(sessionId: string, items: SessionTaskItem[]): SessionTaskItem[] {
		const clean: SessionTaskItem[] = items.map((item, idx) => ({
			id: item.id || `task-${idx + 1}`,
			title: String(item.title ?? "").trim().slice(0, 240),
			status: ["pending", "in_progress", "done", "blocked"].includes(item.status) ? item.status : "pending",
		})).filter(i => i.title);
		this.#db.prepare("INSERT INTO session_tasks (sessionId, itemsJson, updatedAt) VALUES (?, ?, ?) ON CONFLICT(sessionId) DO UPDATE SET itemsJson=excluded.itemsJson, updatedAt=excluded.updatedAt")
			.run(sessionId, JSON.stringify(clean), Date.now());
		this.#events.emit("tasks.update", { sessionId, tasks: clean }, sessionId);
		return clean;
	}

	createExtension(sessionId: string) {
		const writeArtifact = defineTool({
			name: "write_artifact",
			description: "Create or update a rich session artifact (implementation plan, walkthrough, markdown report, or interactive HTML preview) shown in ADE's Artifact pane. Set requestApproval=true for plans requiring user approval.",
			parameters: obj({
				title: str({ description: "Short title, e.g. 'Implementation Plan' or 'Architecture Preview'" }),
				kind: opt(str({ description: "One of: plan, markdown, html, walkthrough, diff" })),
				content: str({ description: "Markdown or HTML content of the artifact" }),
				requestApproval: opt(bool({ description: "Prompt the user with Approve / Request Changes actions (default false)" })),
			}),
			replay: "safe",
			execute: async (args) => {
				const artifact = this.upsertArtifact({
					sessionId,
					title: args.title,
					kind: args.kind as ArtifactKind | undefined,
					content: args.content,
					requestApproval: Boolean(args.requestApproval),
				});
				return {
					output: [{ type: "text", text: `Saved artifact "${artifact.title}" (id: ${artifact.id}, kind: ${artifact.kind}, status: ${artifact.status}).` }],
					details: { artifactId: artifact.id, title: artifact.title, kind: artifact.kind, status: artifact.status },
				};
			},
		});

		const updateTasks = defineTool({
			name: "update_tasks",
			description: "Update the session's live task checklist displayed in ADE's composer track bar.",
			parameters: obj({
				items: arr(obj({
					id: opt(str()),
					title: str(),
					status: str({ description: "One of: pending, in_progress, done, blocked" }),
				})),
			}),
			replay: "safe",
			execute: async (args) => {
				const saved = this.setTasks(sessionId, args.items as SessionTaskItem[]);
				const doneCount = saved.filter(t => t.status === "done").length;
				return {
					output: [{ type: "text", text: `Updated session checklist: ${doneCount}/${saved.length} done.` }],
					details: { total: saved.length, done: doneCount },
				};
			},
		});

		return defineExtension({
			name: "ade-artifacts",
			tools: [writeArtifact, updateTasks],
		});
	}
}
