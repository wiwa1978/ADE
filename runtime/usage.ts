// Token and cost bookkeeping across sessions. Agents report cumulative usage per conversation
// (the ADE agent per conversation and subagent, Claude Code and Codex per session); this turns
// those running totals into increments and keeps a small daily ledger per project, so spend can
// be shown per session, per project and per month — also after a session is archived or deleted.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type UsageTotals = { inputTokens: number; outputTokens: number; cost: number };

export type UsageReport = {
	month: string;
	monthTotal: UsageTotals;
	/** This month, per project id ("" = sessions without a project). */
	projects: Array<{ projectId: string; totals: UsageTotals }>;
	/** All-time per session. */
	sessions: Record<string, UsageTotals & { projectId: string; updatedAt: number }>;
	/** Last 30 days, oldest first. */
	days: Array<{ day: string; totals: UsageTotals }>;
};

type Ledger = {
	version: 1;
	/** Last cumulative value seen per `${sessionId}:${conversationId}`. */
	seen: Record<string, UsageTotals>;
	sessions: Record<string, UsageTotals & { projectId: string; updatedAt: number }>;
	/** day (YYYY-MM-DD) -> projectId -> totals */
	days: Record<string, Record<string, UsageTotals>>;
};

const empty = (): UsageTotals => ({ inputTokens: 0, outputTokens: 0, cost: 0 });
const add = (target: UsageTotals, delta: UsageTotals) => {
	target.inputTokens += delta.inputTokens;
	target.outputTokens += delta.outputTokens;
	target.cost = Math.round((target.cost + delta.cost) * 1e6) / 1e6;
};
const dayKey = (time: number) => {
	const date = new Date(time);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function toTotals(value: unknown): UsageTotals | null {
	if (!value || typeof value !== "object") return null;
	const usage = value as { inputTokens?: unknown; outputTokens?: unknown; totalCost?: unknown; cost?: unknown };
	const totals = {
		inputTokens: Number(usage.inputTokens) || 0,
		outputTokens: Number(usage.outputTokens) || 0,
		cost: Number(usage.totalCost ?? usage.cost) || 0,
	};
	return totals.inputTokens || totals.outputTokens || totals.cost ? totals : null;
}

export class UsageTracker {
	#file: string;
	#ledger: Ledger;
	#now: () => number;
	#saveTimer: ReturnType<typeof setTimeout> | null = null;
	#dirty = false;

	constructor(stateDirectory: string, now: () => number = Date.now) {
		this.#file = join(stateDirectory, "usage.json");
		this.#now = now;
		this.#ledger = this.#load();
	}

	#load(): Ledger {
		try {
			if (existsSync(this.#file)) {
				const parsed = JSON.parse(readFileSync(this.#file, "utf8")) as Ledger;
				if (parsed?.version === 1) return parsed;
			}
		} catch {
			// A damaged ledger starts over rather than blocking the runtime.
		}
		return { version: 1, seen: {}, sessions: {}, days: {} };
	}

	/**
	 * Record a conversation's cumulative usage. Only the increase since the last report counts;
	 * a smaller value means the counter restarted, so it counts in full.
	 */
	record(sessionId: string, conversationId: string, usage: unknown, projectId: string | null) {
		const current = toTotals(usage);
		if (!current) return;
		const key = `${sessionId}:${conversationId}`;
		const last = this.#ledger.seen[key] ?? empty();
		const restarted = current.inputTokens < last.inputTokens || current.outputTokens < last.outputTokens || current.cost < last.cost - 1e-9;
		const delta = restarted ? current : {
			inputTokens: current.inputTokens - last.inputTokens,
			outputTokens: current.outputTokens - last.outputTokens,
			cost: current.cost - last.cost,
		};
		this.#ledger.seen[key] = current;
		if (!delta.inputTokens && !delta.outputTokens && delta.cost < 1e-9) return;
		const now = this.#now();
		const project = projectId ?? this.#ledger.sessions[sessionId]?.projectId ?? "";
		const session = this.#ledger.sessions[sessionId] ?? { ...empty(), projectId: project, updatedAt: now };
		add(session, delta);
		session.projectId = project;
		session.updatedAt = now;
		this.#ledger.sessions[sessionId] = session;
		const day = (this.#ledger.days[dayKey(now)] ??= {});
		add((day[project] ??= empty()), delta);
		this.#scheduleSave();
	}

	/** Everything a session has cost so far. */
	sessionCost(sessionId: string) {
		return this.#ledger.sessions[sessionId]?.cost ?? 0;
	}

	/** What all agents have cost today. */
	todayCost() {
		let total = 0;
		for (const value of Object.values(this.#ledger.days[dayKey(this.#now())] ?? {})) total += value.cost;
		return total;
	}

	report(): UsageReport {
		const now = this.#now();
		const month = dayKey(now).slice(0, 7);
		const monthTotal = empty();
		const projects = new Map<string, UsageTotals>();
		for (const [day, perProject] of Object.entries(this.#ledger.days)) {
			if (!day.startsWith(month)) continue;
			for (const [projectId, totals] of Object.entries(perProject)) {
				add(monthTotal, totals);
				add(projects.get(projectId) ?? projects.set(projectId, empty()).get(projectId)!, totals);
			}
		}
		const days: UsageReport["days"] = [];
		for (let offset = 29; offset >= 0; offset--) {
			const day = dayKey(now - offset * 86_400_000);
			const totals = empty();
			for (const value of Object.values(this.#ledger.days[day] ?? {})) add(totals, value);
			days.push({ day, totals });
		}
		return {
			month,
			monthTotal,
			projects: [...projects.entries()].map(([projectId, totals]) => ({ projectId, totals })).sort((a, b) => b.totals.cost - a.totals.cost || b.totals.inputTokens - a.totals.inputTokens),
			sessions: this.#ledger.sessions,
			days,
		};
	}

	#scheduleSave() {
		this.#dirty = true;
		if (this.#saveTimer) return;
		this.#saveTimer = setTimeout(() => {
			this.#saveTimer = null;
			this.flush();
		}, 1000);
		this.#saveTimer.unref?.();
	}

	flush() {
		if (this.#saveTimer) {
			clearTimeout(this.#saveTimer);
			this.#saveTimer = null;
		}
		// Nothing new: don't create a ledger file (e.g. a runtime that never ran an agent).
		if (!this.#dirty) return;
		this.#dirty = false;
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#ledger));
		renameSync(temp, this.#file);
	}
}
