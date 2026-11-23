// Limits for unattended work: how long one task may run, what it may cost, and what all agents may
// spend in a day. When a limit is hit, ADE stops the session's agent (and its subagents), records
// why, and tells you (Slack, the Inbox). Nothing is undone; you can continue the session yourself.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { badRequest, conflict } from "./http-error.ts";

/**
 * 0 means "no limit". The fallback model (provider and model id, both empty for none) is what the
 * main agent continues on when its model hits a usage limit; without one, ADE waits for the reset.
 * maxSubagents caps how many Claude Code / Codex subagents run at once on this machine (0 = by free memory).
 */
export type Limits = { taskMinutes: number; taskCost: number; dayCost: number; fallbackProvider: string; fallbackModel: string; maxSubagents: number };
export const NO_LIMITS: Limits = { taskMinutes: 0, taskCost: 0, dayCost: 0, fallbackProvider: "", fallbackModel: "", maxSubagents: 0 };

export type LimitStop = { at: number; reason: string; kind: "time" | "cost" | "day" };

type RunStart = { startedAt: number; startCost: number };

export type LimitGuardDeps = {
	/** Total cost spent by a session so far (all its conversations). */
	sessionCost: (sessionId: string) => number;
	/** Total cost spent by all agents today. */
	todayCost: () => number;
	/** Stop the session's agent and its subagents. */
	stop: (sessionId: string) => void;
	/** Tell the user (notification, events). */
	notify: (sessionId: string, stop: LimitStop) => void;
	now?: () => number;
};

function sanitize(input: unknown, base: Limits): Limits {
	const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	const text = (key: "fallbackProvider" | "fallbackModel") => {
		if (value[key] === undefined) return base[key];
		if (typeof value[key] !== "string" || value[key].length > 200 || /[\s\0]/.test(value[key])) throw badRequest("Choose a fallback model from the list.");
		return value[key];
	};
	const number = (key: "taskMinutes" | "taskCost" | "dayCost" | "maxSubagents", max: number) => {
		if (value[key] === undefined) return base[key];
		const parsed = Number(value[key]);
		if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw badRequest(`Enter a number between 0 (no limit) and ${max} for ${key === "taskMinutes" ? "minutes per task" : key === "maxSubagents" ? "subagents at once" : "the cost limit"}.`);
		if (key === "maxSubagents") return Math.round(parsed);
		return Math.round(parsed * 100) / 100;
	};
	const fallbackProvider = text("fallbackProvider");
	const fallbackModel = text("fallbackModel");
	return {
		taskMinutes: number("taskMinutes", 7 * 24 * 60), taskCost: number("taskCost", 100_000), dayCost: number("dayCost", 100_000), maxSubagents: number("maxSubagents", 64),
		// Both or neither.
		fallbackProvider: fallbackModel ? fallbackProvider : "", fallbackModel: fallbackProvider ? fallbackModel : "",
	};
}

export class LimitGuard {
	#file: string;
	#limits: Limits;
	#deps: LimitGuardDeps;
	#runs = new Map<string, RunStart>();
	#stops = new Map<string, LimitStop>();
	#timer: ReturnType<typeof setInterval> | null = null;

	constructor(stateDirectory: string, deps: LimitGuardDeps) {
		this.#file = join(stateDirectory, "limits.json");
		this.#deps = deps;
		this.#limits = NO_LIMITS;
		try {
			if (existsSync(this.#file)) this.#limits = sanitize(JSON.parse(readFileSync(this.#file, "utf8")), NO_LIMITS);
		} catch {
			this.#limits = NO_LIMITS;
		}
	}

	#now() {
		return this.#deps.now?.() ?? Date.now();
	}

	get() {
		return this.#limits;
	}

	set(input: unknown) {
		this.#limits = sanitize(input, this.#limits);
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#limits, null, 2));
		renameSync(temp, this.#file);
		return this.#limits;
	}

	/** Why the session was last stopped by a limit, if it was (cleared when it runs again). */
	stopped(sessionId: string) {
		return this.#stops.get(sessionId) ?? null;
	}

	/** Refuse to start work once the day's budget is spent. */
	assertCanStart() {
		if (this.#limits.dayCost > 0 && this.#deps.todayCost() >= this.#limits.dayCost) {
			throw conflict(`Today's limit of $${this.#limits.dayCost.toFixed(2)} for agents is reached. Raise it in Settings → Agents & permissions, or continue tomorrow.`);
		}
	}

	/** A session's agent started working. */
	started(sessionId: string) {
		this.#stops.delete(sessionId);
		this.#runs.set(sessionId, { startedAt: this.#now(), startCost: this.#deps.sessionCost(sessionId) });
	}

	/** A session's agent finished (or was stopped). */
	finished(sessionId: string) {
		this.#runs.delete(sessionId);
	}

	/** Check every running session against the limits; called on progress and every 30 seconds. */
	check(sessionId?: string) {
		const ids = sessionId ? (this.#runs.has(sessionId) ? [sessionId] : []) : [...this.#runs.keys()];
		const limits = this.#limits;
		const today = limits.dayCost > 0 ? this.#deps.todayCost() : 0;
		for (const id of ids) {
			const run = this.#runs.get(id)!;
			let stop: LimitStop | null = null;
			const minutes = (this.#now() - run.startedAt) / 60_000;
			const cost = this.#deps.sessionCost(id) - run.startCost;
			if (limits.taskMinutes > 0 && minutes >= limits.taskMinutes) stop = { at: this.#now(), kind: "time", reason: `Stopped after ${Math.round(minutes)} minutes (limit ${limits.taskMinutes}).` };
			else if (limits.taskCost > 0 && cost >= limits.taskCost) stop = { at: this.#now(), kind: "cost", reason: `Stopped at $${cost.toFixed(2)} for this task (limit $${limits.taskCost.toFixed(2)}).` };
			else if (limits.dayCost > 0 && today >= limits.dayCost) stop = { at: this.#now(), kind: "day", reason: `Stopped: today's agent spend reached $${today.toFixed(2)} (limit $${limits.dayCost.toFixed(2)}).` };
			if (!stop) continue;
			this.#runs.delete(id);
			this.#stops.set(id, stop);
			this.#deps.stop(id);
			this.#deps.notify(id, stop);
		}
	}

	start() {
		if (this.#timer) return;
		this.#timer = setInterval(() => {
			try {
				this.check();
			} catch {
				// Shutting down.
			}
		}, 30_000);
		this.#timer.unref?.();
	}

	stopTimer() {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}
}
