// Background agents (roadmap R11): per-project automations that start a session by themselves,
// either on a schedule (hourly, daily, weekdays, weekly) or when a GitHub issue gets a label.
// Each run is an ordinary session in its own worktree, so it shows up in the Inbox for review.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { badRequest, notFound } from "./http-error.ts";

export type AutomationAgent = "pi" | "claude-code" | "codex" | "opencode";

export type AutomationTrigger =
	| { type: "schedule"; every: "hourly" | "daily" | "weekdays" | "weekly"; at: string; day?: number }
	| { type: "issue-label"; label: string };

export type AutomationRun = { at: number; sessionId: string | null; reason: string; error?: string };

export type Automation = {
	id: string;
	projectId: string;
	name: string;
	prompt: string;
	agent: AutomationAgent;
	trigger: AutomationTrigger;
	enabled: boolean;
	createdAt: number;
	lastRunAt: number | null;
	runs: AutomationRun[];
	/** Issue numbers already handled (or already labelled when the automation was created). */
	seenIssues: number[];
};


function parseTime(value: unknown) {
	const match = typeof value === "string" ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
	if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
	return { hours: Number(match[1]), minutes: Number(match[2]) };
}

export function validateAutomation(input: unknown): Pick<Automation, "name" | "prompt" | "agent" | "trigger" | "enabled"> {
	const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
	if (!name) throw badRequest("Give the automation a name.");
	const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
	if (!prompt || prompt.length > 6000) throw badRequest("Describe what the agent should do (up to 6000 characters).");
	// The main agent is always the ADE agent; older automations may still name another one.
	const agent: AutomationAgent = "pi";
	const raw = (body.trigger && typeof body.trigger === "object" ? body.trigger : {}) as Record<string, unknown>;
	let trigger: AutomationTrigger;
	if (raw.type === "issue-label") {
		const label = typeof raw.label === "string" ? raw.label.trim() : "";
		if (!label || label.length > 50) throw badRequest("Enter the issue label that starts the automation.");
		trigger = { type: "issue-label", label };
	} else {
		const every = ["hourly", "daily", "weekdays", "weekly"].includes(raw.every as string) ? raw.every as "hourly" | "daily" | "weekdays" | "weekly" : null;
		if (!every) throw badRequest("Choose how often the automation runs.");
		if (!parseTime(raw.at)) throw badRequest("Enter a time like 09:00.");
		const day = Number(raw.day);
		if (every === "weekly" && !(Number.isInteger(day) && day >= 0 && day <= 6)) throw badRequest("Choose a day of the week.");
		trigger = { type: "schedule", every, at: String(raw.at).trim(), ...(every === "weekly" ? { day } : {}) };
	}
	return { name, prompt, agent, trigger, enabled: body.enabled !== false };
}

/** The most recent moment the schedule should have fired, at or before `now` (local time). */
export function lastScheduledTime(trigger: Extract<AutomationTrigger, { type: "schedule" }>, now: number): number {
	const time = parseTime(trigger.at) ?? { hours: 9, minutes: 0 };
	const date = new Date(now);
	if (trigger.every === "hourly") {
		date.setMinutes(time.minutes, 0, 0);
		if (date.getTime() > now) date.setHours(date.getHours() - 1);
		return date.getTime();
	}
	date.setHours(time.hours, time.minutes, 0, 0);
	if (date.getTime() > now) date.setDate(date.getDate() - 1);
	const allowed = (day: number) => trigger.every === "daily" || (trigger.every === "weekdays" ? day >= 1 && day <= 5 : day === trigger.day);
	for (let guard = 0; guard < 8 && !allowed(date.getDay()); guard++) date.setDate(date.getDate() - 1);
	return date.getTime();
}

/** A schedule is due when its last slot is after both the creation time and the last run. */
export function scheduleIsDue(automation: Pick<Automation, "trigger" | "createdAt" | "lastRunAt">, now: number) {
	if (automation.trigger.type !== "schedule") return false;
	const slot = lastScheduledTime(automation.trigger, now);
	return slot > automation.createdAt && slot > (automation.lastRunAt ?? 0);
}

export class AutomationStore {
	#file: string;
	#items: Automation[];

	constructor(stateDirectory: string) {
		this.#file = join(stateDirectory, "automations.json");
		this.#items = this.#load();
	}

	#load(): Automation[] {
		try {
			if (existsSync(this.#file)) {
				const parsed = JSON.parse(readFileSync(this.#file, "utf8")) as unknown;
				if (Array.isArray(parsed)) return parsed as Automation[];
			}
		} catch {
			// Start empty if the file is damaged.
		}
		return [];
	}

	#save() {
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#items, null, 2));
		renameSync(temp, this.#file);
	}

	all() {
		return this.#items;
	}

	forProject(projectId: string) {
		return this.#items.filter(item => item.projectId === projectId);
	}

	get(id: string) {
		const item = this.#items.find(entry => entry.id === id);
		if (!item) throw notFound("Automation not found.");
		return item;
	}

	create(projectId: string, input: unknown, seenIssues: number[] = []) {
		const item: Automation = { id: randomUUID(), projectId, ...validateAutomation(input), createdAt: Date.now(), lastRunAt: null, runs: [], seenIssues };
		this.#items.push(item);
		this.#save();
		return item;
	}

	update(id: string, input: unknown) {
		const item = this.get(id);
		const next = validateAutomation({ ...item, ...(input && typeof input === "object" ? input : {}) });
		const labelChanged = item.trigger.type === "issue-label" && next.trigger.type === "issue-label" && item.trigger.label !== next.trigger.label;
		Object.assign(item, next);
		if (labelChanged) item.seenIssues = [];
		this.#save();
		return item;
	}

	remove(id: string) {
		this.get(id);
		this.#items = this.#items.filter(item => item.id !== id);
		this.#save();
	}

	recordRun(id: string, run: AutomationRun, issue?: number) {
		const item = this.get(id);
		item.lastRunAt = run.at;
		item.runs = [run, ...item.runs].slice(0, 20);
		if (issue !== undefined && !item.seenIssues.includes(issue)) item.seenIssues = [...item.seenIssues, issue].slice(-500);
		this.#save();
	}

	markSeen(id: string, issues: number[]) {
		const item = this.get(id);
		item.seenIssues = [...new Set([...item.seenIssues, ...issues])].slice(-500);
		this.#save();
	}
}
