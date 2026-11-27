import { notFound } from "../http-error.ts";
import type { SubagentSummaryInput } from "../observatory.ts";
import type { Router } from "../router.ts";
import type { RouteDeps } from "./context.ts";

function parseWindowMin(raw: string | null): number {
	const value = Number(raw);
	return value === 15 || value === 30 || value === 60 || value === 180 ? value : 30;
}

function parseScope(raw: string | null): "all" | "active" | "needs-you" {
	return raw === "active" || raw === "needs-you" ? raw : "all";
}

function mapFeatureAgents(raw: unknown[]): SubagentSummaryInput[] {
	return raw.map(item => {
		const rec = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
		return {
			id: String(rec.id ?? ""),
			name: String(rec.name ?? rec.id ?? "Subagent"),
			role: String(rec.role ?? "worker"),
			harness: String(rec.harness ?? "pi"),
			model: typeof rec.model === "string" ? rec.model : null,
			status: String(rec.status ?? "idle"),
			createdAt: typeof rec.createdAt === "number" ? rec.createdAt : null,
			updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : null,
		};
	}).filter(sub => Boolean(sub.id));
}

export function registerObservatoryRoutes(router: Router, deps: RouteDeps): void {
	const { host, inbox, usage, viewSessions } = deps;

	// Cache per-session subagent lists briefly so 3s live polling stays fast even with many closed sessions.
	const subagentCache = new Map<string, { at: number; items: SubagentSummaryInput[] }>();
	const SUBAGENT_CACHE_MS = 8_000;

	async function loadSubagents(sessionId: string, active: boolean): Promise<SubagentSummaryInput[]> {
		const cached = subagentCache.get(sessionId);
		const now = Date.now();
		if (cached && now - cached.at < (active ? 2_500 : SUBAGENT_CACHE_MS)) {
			return cached.items;
		}
		try {
			const raw = await host.featureAgents(sessionId);
			const items = mapFeatureAgents(Array.isArray(raw) ? raw : []);
			subagentCache.set(sessionId, { at: now, items });
			return items;
		} catch {
			return cached?.items ?? [];
		}
	}

	const isCodingTask = (s: { id: string; chatThread?: boolean }) =>
		!s.chatThread && s.id !== "coding" && s.id !== "personal";

	router.get("/api/observatory/live", async ctx => {
		const windowMin = parseWindowMin(ctx.url.searchParams.get("windowMin"));
		const scope = parseScope(ctx.url.searchParams.get("scope"));
		const sessions = viewSessions();
		const projects = host.projects().map(p => ({ id: p.id, name: p.name }));
		const [inboxEntries, subagentPairs] = await Promise.all([
			inbox.entries(),
			Promise.all(
				sessions
					.filter(s => !s.archivedAt && isCodingTask(s))
					.map(async s => [s.id, await loadSubagents(s.id, s.status === "working")] as const),
			),
		]);
		const subagentsBySession: Record<string, SubagentSummaryInput[]> = {};
		for (const [id, subs] of subagentPairs) {
			if (subs.length > 0) subagentsBySession[id] = subs;
		}
		const pendingApprovals = host.approvals.listPending().map(item => ({
			sessionId: item.sessionId,
			summary: item.summary,
			createdAt: item.createdAt,
		}));
		const snapshot = host.observatory.liveSnapshot({
			sessions,
			projects,
			inboxEntries,
			pendingApprovals,
			usageReport: usage.report(),
			subagentsBySession,
			windowMin,
			scope,
		});
		ctx.json(200, snapshot);
	});

	router.get("/api/observatory/trace/:id", async ctx => {
		const sessionId = ctx.params.id;
		const session = viewSessions().find(s => s.id === sessionId);
		if (!session) throw notFound("Session not found.");
		const project = session.projectId ? host.projects().find(p => p.id === session.projectId) : null;
		let stagesView = null;
		try {
			stagesView = host.blueprints.view(sessionId);
		} catch {
			stagesView = null;
		}
		const subagents = isCodingTask(session) ? await loadSubagents(sessionId, true) : [];
		const turns = host.observatory.listSessionTurns(sessionId);
		const pendingApprovals = host.approvals.listPending(sessionId).map(item => ({
			id: item.id,
			summary: item.summary,
			createdAt: item.createdAt,
		}));
		const trace = host.observatory.sessionTrace({
			session,
			projectName: project?.name ?? null,
			stagesView,
			turns,
			subagents,
			pendingApprovals,
		});
		ctx.json(200, trace);
	});
}
