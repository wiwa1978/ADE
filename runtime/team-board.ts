// How a session's agents work together: a shared task board (owners, dependencies, atomic takes),
// plan approval per task, a team board of posts with read tracking, and file claims. Every change
// is logged as a flow event (who wrote into which part, what each part handed to whom), which is
// what the Team view draws. The model follows Ensemble for Orca's team mode (MIT,
// github.com/DueGin/orca-ensemble).
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { badRequest, conflict, notFound } from "./http-error.ts";
import type { RuntimeEventBus } from "./events.ts";

export const DEFAULT_TASK_LEASE_MS = 5 * 60_000;
export const MIN_TASK_LEASE_MS = 5_000;
export const MAX_TASK_LEASE_MS = 60 * 60_000;
export const DEFAULT_CHANNEL = "general";

export function projectBoardId(projectId: string): string {
	return `project:${projectId}`;
}

export function normalizeChannel(channel?: string | null): string {
	const cleaned = String(channel ?? "")
		.trim()
		.toLowerCase()
		.replace(/^#+/, "")
		.replace(/[^a-z0-9/_-]+/g, "-")
		.replace(/^[-/]+|[-/]+$/g, "")
		.slice(0, 48);
	return cleaned || DEFAULT_CHANNEL;
}

function clampLeaseMs(leaseMs?: number): number {
	if (typeof leaseMs !== "number" || !Number.isFinite(leaseMs)) return DEFAULT_TASK_LEASE_MS;
	return Math.max(MIN_TASK_LEASE_MS, Math.min(MAX_TASK_LEASE_MS, Math.floor(leaseMs)));
}

/** "lead" (the main agent), "user", or a subagent's conversation id. */
export type Party = string;

export type TaskStatus = "todo" | "in_progress" | "done" | "dropped";
export type ThreadStatus = "open" | "moving" | "waiting" | "done" | "blocked";
export type SwarmGoal = {
	title: string;
	summary: string;
	updatedAt: number;
};
export type TeamThread = {
	id: string;
	title: string;
	summary: string;
	status: ThreadStatus;
	focus: string;
	updatedAt: number;
};
export type AgentFocus = {
	text: string;
	at: number;
};
export type TeamTask = {
	id: string;
	title: string;
	detail: string;
	owner: Party | null;
	createdBy: Party;
	status: TaskStatus;
	dependsOn: string[];
	threadId?: string | null;
	plan: { text: string; status: "waiting" | "approved" | "returned"; note: string; at: number } | null;
	/** Sent back by a reviewer or the lead: what to fix. */
	returnedNote: string;
	result: string;
	/** When `now >= leaseExpiresAt`, the claim returns to `todo`. */
	leaseExpiresAt?: number | null;
	/** Issued on claim. A late or mismatched write fails with `claim_lost`. */
	claimToken?: string | null;
	updatedAt: number;
	history: Array<{ at: number; by: Party; action: string; note?: string }>;
};

export type PostKind = "question" | "finding" | "answer" | "update";
export type TeamPost = { seq: number; at: number; author: Party; to: string[]; kind: PostKind; text: string; re: number | null; channel?: string };

export type TaskClaimReceipt = {
	taskId: string;
	owner: Party;
	claimToken: string;
	leaseExpiresAt: number;
	message: string;
};

export type BoardWaitResult = { matched: boolean; posts: TeamPost[]; lastSeq: number };
export type FileClaim = { agent: Party; path: string; at: number };

export type TeamPart = "tasks" | "plans" | "board" | "claims";
export type TeamEvent = { seq: number; at: number; part: TeamPart; action: string; direction: "in" | "out"; from: Party; to: Party[]; subject: string; text: string; count: number };

export type TeamState = {
	version: 1;
	title: string;
	goal: SwarmGoal | null;
	threads: TeamThread[];
	focus: Record<Party, AgentFocus>;
	tasks: TeamTask[];
	posts: TeamPost[];
	claims: FileClaim[];
	events: TeamEvent[];
	/** The last post each party has read. */
	readSeq: Record<Party, number>;
	/** Members show a plan and wait for approval before they work on a task. */
	requirePlans: boolean;
	nextTask: number;
	nextThread: number;
	nextSeq: number;
};

const MAX_EVENTS = 400;
/** A runaway agent can't grow a session's board without limit (the file is rewritten on every change). */
const MAX_TASKS = 500;
const MAX_THREADS = 50;
const MAX_POSTS = 1000;
const POST_KINDS: readonly PostKind[] = ["question", "finding", "answer", "update"];
const FOLD_MS = 90_000;
const empty = (): TeamState => ({ version: 1, title: "", goal: null, threads: [], focus: {}, tasks: [], posts: [], claims: [], events: [], readSeq: {}, requirePlans: false, nextTask: 1, nextThread: 1, nextSeq: 1 });
const clip = (text: string, max = 160) => {
	const value = text.replace(/\s+/g, " ").trim();
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const normalizePath = (path: string) => path.trim().replace(/^\.\//, "").replace(/\/+$/, "") || ".";
/** A claim on a folder covers what's inside it. */
const covers = (claimed: string, path: string) => claimed === "." || claimed === path || path.startsWith(`${claimed}/`) || claimed.startsWith(`${path}/`);

export class TeamBoard {
	#dir: string;
	#events?: RuntimeEventBus;
	#now: () => number;
	#cache = new Map<string, TeamState>();
	#waiters = new Map<string, Set<() => void>>();

	constructor(stateDirectory: string, events?: RuntimeEventBus, now: () => number = Date.now) {
		this.#dir = join(stateDirectory, "teams");
		this.#events = events;
		this.#now = now;
	}

	#file(sessionId: string) {
		if (!/^(?:project:)?[\w-]{1,80}$/.test(sessionId)) throw badRequest("Invalid board or session id.");
		return join(this.#dir, `${sessionId.replace(/:/g, "__")}.json`);
	}

	/** Return expired in-progress claims to todo, releasing stale file claims and syncing threads. */
	#reap(state: TeamState): string[] {
		const now = this.#now();
		const lost: string[] = [];
		const formerOwners = new Set<Party>();
		for (const task of state.tasks) {
			if (task.status !== "in_progress") continue;
			if (typeof task.leaseExpiresAt !== "number" || task.leaseExpiresAt > now) continue;
			const prevOwner = task.owner;
			task.status = "todo";
			task.owner = null;
			task.claimToken = null;
			task.leaseExpiresAt = null;
			task.updatedAt = now;
			task.history.push({ at: now, by: "board", action: "lease_expired" });
			this.#syncThreadFromTasks(state, task.threadId);
			this.#log(state, { part: "tasks", action: "lease_expired", direction: "out", from: "tasks", to: prevOwner ? [prevOwner] : [], subject: task.id, text: `${task.id} lease expired — returned to todo` });
			if (prevOwner) formerOwners.add(prevOwner);
			lost.push(task.id);
		}
		for (const owner of formerOwners) {
			if (state.tasks.some(other => other.owner === owner && other.status === "in_progress")) continue;
			const released = state.claims.filter(claim => claim.agent === owner);
			if (!released.length) continue;
			state.claims = state.claims.filter(claim => claim.agent !== owner);
			this.#log(state, { part: "claims", action: "release", direction: "in", from: owner, to: [], subject: released.map(claim => claim.path).join(", "), text: `released ${released.length} ${released.length === 1 ? "path" : "paths"} (lease expired)` });
		}
		return lost;
	}

	state(sessionId: string): TeamState {
		const cached = this.#cache.get(sessionId);
		if (cached) {
			if (this.#reap(cached).length) this.#save(sessionId, cached);
			return cached;
		}
		let state = empty();
		const file = this.#file(sessionId);
		try {
			if (existsSync(file)) state = { ...empty(), ...(JSON.parse(readFileSync(file, "utf8")) as Partial<TeamState>) };
		} catch {
			state = empty();
		}
		this.#cache.set(sessionId, state);
		if (this.#reap(state).length) this.#save(sessionId, state);
		return state;
	}

	#save(sessionId: string, state: TeamState) {
		mkdirSync(this.#dir, { recursive: true });
		const file = this.#file(sessionId);
		writeFileSync(`${file}.tmp`, JSON.stringify(state));
		renameSync(`${file}.tmp`, file);
		this.#cache.set(sessionId, state);
		if (!sessionId.startsWith("project:")) this.#events?.emit("team.update", { sessionId, events: state.events.length, tasks: state.tasks.length }, sessionId);
		for (const wake of this.#waiters.get(sessionId) ?? []) wake();
	}

	#log(state: TeamState, event: Omit<TeamEvent, "seq" | "at" | "count">) {
		const now = this.#now();
		// Repeated reads by the same party fold into one event.
		if (event.action === "read") {
			const last = [...state.events].reverse().find(entry => entry.action === "read" && entry.to.join() === event.to.join());
			if (last && now - last.at < FOLD_MS && state.events.indexOf(last) >= state.events.length - 6) {
				last.at = now;
				last.count += 1;
				last.subject = event.subject;
				return;
			}
		}
		state.events.push({ ...event, seq: state.nextSeq++, at: now, count: 1 });
		if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
	}

	#task(state: TeamState, id: string) {
		const task = state.tasks.find(entry => entry.id.toLowerCase() === String(id).trim().toLowerCase());
		if (!task) throw notFound(`There is no task ${id}. Tasks: ${state.tasks.map(entry => entry.id).join(", ") || "none yet"}.`);
		return task;
	}

	#ready(state: TeamState, task: TeamTask) {
		return task.dependsOn.every(dep => state.tasks.find(entry => entry.id === dep)?.status === "done");
	}

	#change<T>(sessionId: string, change: (state: TeamState) => T): T {
		const state = structuredClone(this.state(sessionId));
		const result = change(state);
		this.#save(sessionId, state);
		return result;
	}

	#thread(state: TeamState, id: string) {
		const thread = state.threads.find(entry => entry.id.toLowerCase() === String(id).trim().toLowerCase());
		if (!thread) throw notFound(`There is no thread ${id}. Threads: ${state.threads.map(entry => entry.id).join(", ") || "none yet"}.`);
		return thread;
	}

	#syncThreadFromTasks(state: TeamState, threadId: string | null | undefined) {
		if (!threadId) return;
		const thread = state.threads.find(entry => entry.id === threadId);
		if (!thread) return;
		const related = state.tasks.filter(task => task.threadId === threadId && task.status !== "dropped");
		if (!related.length) return;
		const now = this.#now();
		if (related.every(task => task.status === "done")) {
			thread.status = "done";
			thread.updatedAt = now;
		} else if (related.some(task => task.status === "in_progress")) {
			thread.status = "moving";
			thread.updatedAt = now;
		} else if (thread.status === "done") {
			thread.status = "open";
			thread.updatedAt = now;
		}
	}

	setRequirePlans(sessionId: string, on: boolean) {
		this.#change(sessionId, state => { state.requirePlans = on; return ""; });
	}

	setSwarmOverview(sessionId: string, by: Party, input: { title?: string; goalTitle?: string; goalSummary?: string }) {
		return this.#change(sessionId, state => {
			const now = this.#now();
			if (typeof input.title === "string") state.title = clip(input.title, 160);
			const nextTitle = typeof input.goalTitle === "string" ? clip(input.goalTitle, 200) : state.goal?.title ?? "";
			const nextSummary = typeof input.goalSummary === "string" ? clip(input.goalSummary, 400) : state.goal?.summary ?? "";
			if (nextTitle || nextSummary) {
				state.goal = { title: nextTitle || state.title || "Swarm Goal", summary: nextSummary, updatedAt: now };
			}
			const label = state.goal?.title || state.title || "Swarm overview";
			this.#log(state, { part: "board", action: "overview", direction: "in", from: by, to: ["all"], subject: "goal", text: `goal: ${clip(label, 140)}` });
			return `Swarm overview updated: ${label}.`;
		});
	}

	upsertThread(sessionId: string, by: Party, input: { id?: string; title?: string; summary?: string; status?: ThreadStatus; focus?: string }) {
		return this.#change(sessionId, state => {
			const now = this.#now();
			const rawId = input.id?.trim();
			const existing = rawId ? state.threads.find(entry => entry.id.toLowerCase() === rawId.toLowerCase()) : undefined;
			const validStatus = (value?: string): ThreadStatus | undefined =>
				value === "open" || value === "moving" || value === "waiting" || value === "done" || value === "blocked" ? value : undefined;
			if (existing) {
				if (typeof input.title === "string" && input.title.trim()) existing.title = clip(input.title, 160);
				if (typeof input.summary === "string") existing.summary = clip(input.summary, 320);
				const status = validStatus(input.status);
				if (status) existing.status = status;
				if (typeof input.focus === "string") existing.focus = clip(input.focus, 160);
				existing.updatedAt = now;
				return existing.id;
			}
			const title = clip(input.title ?? "", 160);
			if (!title) throw badRequest("A thread needs a title.");
			if (state.threads.length >= MAX_THREADS) throw conflict(`There are already ${MAX_THREADS} threads. Reuse one, or mark finished ones done.`);
			// A chosen id must not collide with one already taken (including the TH1, TH2… ids made later).
			let id = rawId && /^[\w-]{1,40}$/.test(rawId) ? rawId : "";
			while (!id || state.threads.some(entry => entry.id.toLowerCase() === id.toLowerCase())) id = `TH${state.nextThread++}`;
			state.threads.push({
				id,
				title,
				summary: clip(input.summary ?? "", 320),
				status: validStatus(input.status) ?? "open",
				focus: clip(input.focus ?? "", 160),
				updatedAt: now,
			});
			this.#log(state, { part: "board", action: "thread", direction: "in", from: by, to: ["all"], subject: id, text: `thread ${id}: ${title}` });
			return id;
		});
	}

	setFocus(sessionId: string, agent: Party, text: string) {
		const focus = clip(text ?? "", 160);
		if (!focus) throw badRequest("Describe what you are focusing on.");
		return this.#change(sessionId, state => {
			const now = this.#now();
			state.focus[agent] = { text: focus, at: now };
			for (const task of state.tasks) {
				if (task.owner === agent && task.status === "in_progress" && task.threadId) {
					const thread = state.threads.find(entry => entry.id === task.threadId);
					if (thread) {
						thread.focus = focus;
						if (thread.status === "open" || thread.status === "waiting") thread.status = "moving";
						thread.updatedAt = now;
					}
				}
			}
			return `Focus set: ${focus}`;
		});
	}

	describeOverview(sessionId: string) {
		const state = this.state(sessionId);
		const lines: string[] = [];
		if (state.title) lines.push(`Title: ${state.title}`);
		if (state.goal) lines.push(`Goal: ${state.goal.title}${state.goal.summary ? ` — ${state.goal.summary}` : ""}`);
		if (state.threads.length) {
			lines.push("Threads:");
			for (const thread of state.threads) {
				const tasks = state.tasks.filter(task => task.threadId === thread.id && task.status !== "dropped");
				const done = tasks.filter(task => task.status === "done").length;
				lines.push(`- ${thread.id} [${thread.status}] ${thread.title} (${done}/${tasks.length})${thread.focus ? ` · Now: ${thread.focus}` : ""}`);
			}
		}
		return lines.length ? lines.join("\n") : "No swarm goal or threads set yet.";
	}

	addTask(sessionId: string, by: Party, input: { title: string; detail?: string; owner?: Party | null; dependsOn?: string[]; threadId?: string | null }) {
		const title = clip(input.title ?? "", 200);
		if (!title) throw badRequest("A task needs a title.");
		return this.#change(sessionId, state => {
			if (state.tasks.length >= MAX_TASKS) throw conflict(`The task board is full (${MAX_TASKS} tasks). Finish or drop some first.`);
			const dependsOn = (input.dependsOn ?? []).map(dep => this.#task(state, dep).id);
			const threadId = input.threadId?.trim() ? this.#thread(state, input.threadId).id : null;
			const id = `T${state.nextTask++}`;
			const now = this.#now();
			state.tasks.push({ id, title, detail: (input.detail ?? "").slice(0, 4000), owner: input.owner ?? null, createdBy: by, status: "todo", dependsOn, threadId, plan: null, returnedNote: "", result: "", updatedAt: now, history: [{ at: now, by, action: "added" }] });
			this.#log(state, { part: "tasks", action: "add", direction: "in", from: by, to: [], subject: id, text: `${id} ${title}${dependsOn.length ? ` (waits for ${dependsOn.join(", ")})` : ""}` });
			if (input.owner) this.#log(state, { part: "tasks", action: "assign", direction: "out", from: "tasks", to: [input.owner], subject: id, text: `${id} assigned` });
			return id;
		});
	}

	/** Take a task to work on: only one agent gets it, and only once what it waits for is done. */
	/** Take a task. The message is what agents see; the claim token is on the task. */
	takeTask(sessionId: string, agent: Party, id: string, leaseMs?: number): string {
		return this.claimTask(sessionId, agent, id, leaseMs).message;
	}

	claimTask(sessionId: string, agent: Party, id: string, leaseMs?: number): TaskClaimReceipt {
		return this.#change(sessionId, state => {
			this.#reap(state);
			const task = this.#task(state, id);
			if (task.status === "in_progress" && task.owner === agent && task.claimToken && typeof task.leaseExpiresAt === "number") {
				return { taskId: task.id, owner: agent, claimToken: task.claimToken, leaseExpiresAt: task.leaseExpiresAt, message: `${task.id} is already yours.` };
			}
			if (task.status !== "todo") throw conflict(`${task.id} is ${task.status.replace("_", " ")}${task.owner ? ` (${task.owner === agent ? "yours" : "someone else's"})` : ""}.`);
			if (task.owner && task.owner !== agent) throw conflict(`${task.id} is assigned to someone else.`);
			if (!this.#ready(state, task)) throw conflict(`${task.id} waits for ${task.dependsOn.filter(dep => state.tasks.find(entry => entry.id === dep)?.status !== "done").join(", ")}.`);
			const now = this.#now();
			task.owner = agent;
			task.status = "in_progress";
			task.claimToken = randomUUID();
			task.leaseExpiresAt = now + clampLeaseMs(leaseMs);
			task.updatedAt = now;
			task.history.push({ at: now, by: agent, action: "took" });
			this.#syncThreadFromTasks(state, task.threadId);
			this.#log(state, { part: "tasks", action: "claim", direction: "in", from: agent, to: [], subject: task.id, text: `took ${task.id}: ${task.title}` });
			const message = state.requirePlans ? `You have ${task.id}. Submit your plan with team_plan before you change anything; the lead approves it.` : `You have ${task.id}.`;
			return { taskId: task.id, owner: agent, claimToken: task.claimToken, leaseExpiresAt: task.leaseExpiresAt, message };
		}) as TaskClaimReceipt;
	}

	renewTask(sessionId: string, agent: Party, id: string, claimToken?: string | null, leaseMs?: number): TaskClaimReceipt {
		return this.#change(sessionId, state => {
			const lost = this.#reap(state);
			const task = this.#task(state, id);
			if (lost.includes(task.id) || task.status !== "in_progress" || task.owner !== agent || (claimToken && claimToken !== task.claimToken)) {
				throw conflict("claim_lost");
			}
			const now = this.#now();
			task.claimToken = task.claimToken || randomUUID();
			task.leaseExpiresAt = now + clampLeaseMs(leaseMs);
			task.updatedAt = now;
			this.#log(state, { part: "tasks", action: "renew", direction: "in", from: agent, to: [], subject: task.id, text: `renewed lease on ${task.id}` });
			return { taskId: task.id, owner: agent, claimToken: task.claimToken, leaseExpiresAt: task.leaseExpiresAt, message: `Renewed ${task.id}.` };
		}) as TaskClaimReceipt;
	}

	finishTask(sessionId: string, agent: Party, id: string, result: string, claimToken?: string | null) {
		return this.#change(sessionId, state => {
			const lost = this.#reap(state);
			const task = this.#task(state, id);
			if (lost.includes(task.id) || (claimToken && claimToken !== task.claimToken)) throw conflict("claim_lost");
			if (task.owner !== agent && agent !== "lead") throw conflict(`${task.id} isn't yours.`);
			if (state.requirePlans && task.plan?.status !== "approved" && agent !== "lead") throw conflict(`${task.id}'s plan isn't approved yet.`);
			task.status = "done";
			task.result = clip(result ?? "", 2000);
			task.returnedNote = "";
			task.claimToken = null;
			task.leaseExpiresAt = null;
			task.updatedAt = this.#now();
			task.history.push({ at: task.updatedAt, by: agent, action: "done", note: task.result });
			this.#syncThreadFromTasks(state, task.threadId);
			this.#log(state, { part: "tasks", action: "done", direction: "in", from: agent, to: [], subject: task.id, text: `${task.id} done${task.result ? `: ${clip(task.result, 120)}` : ""}` });
			// Its file claims are released; tasks waiting for it may start.
			const released = state.claims.filter(claim => claim.agent === agent);
			if (released.length && !state.tasks.some(other => other !== task && other.owner === agent && other.status === "in_progress")) {
				state.claims = state.claims.filter(claim => claim.agent !== agent);
				this.#log(state, { part: "claims", action: "release", direction: "in", from: agent, to: [], subject: released.map(claim => claim.path).join(", "), text: `released ${released.length} ${released.length === 1 ? "path" : "paths"}` });
			}
			const unlocked = state.tasks.filter(other => other.status === "todo" && other.dependsOn.includes(task.id) && this.#ready(state, other));
			for (const other of unlocked) this.#log(state, { part: "tasks", action: "ready", direction: "out", from: "tasks", to: other.owner ? [other.owner] : [], subject: other.id, text: `${other.id} can start` });
			return unlocked.length ? `Done. ${unlocked.map(other => other.id).join(", ")} can start now.` : "Done.";
		});
	}

	/** The lead (or you) sends a done task back, or drops or reopens one. */
	reviewTask(sessionId: string, by: Party, id: string, action: "send_back" | "drop" | "reopen", note: string) {
		return this.#change(sessionId, state => {
			const task = this.#task(state, id);
			const now = this.#now();
			if (action === "send_back") {
				if (task.status !== "done") throw conflict(`${task.id} isn't done.`);
				task.status = "in_progress";
				task.claimToken = randomUUID();
				task.leaseExpiresAt = now + DEFAULT_TASK_LEASE_MS;
				task.returnedNote = clip(note, 1000);
				this.#log(state, { part: "tasks", action: "return", direction: "out", from: "tasks", to: task.owner ? [task.owner] : [], subject: task.id, text: `${task.id} sent back${note ? `: ${clip(note, 120)}` : ""}` });
			} else if (action === "drop") {
				task.status = "dropped";
				task.claimToken = null;
				task.leaseExpiresAt = null;
				this.#log(state, { part: "tasks", action: "drop", direction: "in", from: by, to: [], subject: task.id, text: `dropped ${task.id}${note ? `: ${clip(note, 100)}` : ""}` });
			} else {
				task.status = "todo";
				task.owner = null;
				task.claimToken = null;
				task.leaseExpiresAt = null;
				this.#log(state, { part: "tasks", action: "reopen", direction: "in", from: by, to: [], subject: task.id, text: `reopened ${task.id}` });
			}
			task.updatedAt = now;
			task.history.push({ at: now, by, action, note });
			this.#syncThreadFromTasks(state, task.threadId);
			return `${task.id} is ${task.status.replace("_", " ")}.`;
		});
	}

	submitPlan(sessionId: string, agent: Party, id: string, text: string) {
		const plan = (text ?? "").trim();
		if (!plan) throw badRequest("Describe the plan.");
		return this.#change(sessionId, state => {
			const lost = this.#reap(state);
			const task = this.#task(state, id);
			if (lost.includes(task.id)) throw conflict("claim_lost");
			if (task.owner !== agent) throw conflict(`${task.id} isn't yours; take it first.`);
			task.plan = { text: plan.slice(0, 4000), status: "waiting", note: "", at: this.#now() };
			task.history.push({ at: task.plan.at, by: agent, action: "plan" });
			this.#log(state, { part: "plans", action: "submit", direction: "in", from: agent, to: [], subject: task.id, text: `plan for ${task.id}: ${clip(plan, 140)}` });
			this.#log(state, { part: "plans", action: "notify", direction: "out", from: "plans", to: ["lead"], subject: task.id, text: `plan for ${task.id} waits for approval` });
			return `Plan for ${task.id} submitted. Wait for the decision (team_read shows it) before changing files.`;
		});
	}

	decidePlan(sessionId: string, by: Party, id: string, decision: "approve" | "return", note: string) {
		return this.#change(sessionId, state => {
			const task = this.#task(state, id);
			if (!task.plan || task.plan.status !== "waiting") throw conflict(`${task.id} has no plan waiting.`);
			task.plan.status = decision === "approve" ? "approved" : "returned";
			task.plan.note = clip(note ?? "", 1000);
			task.history.push({ at: this.#now(), by, action: decision === "approve" ? "plan approved" : "plan returned", note });
			this.#log(state, { part: "plans", action: decision, direction: "in", from: by, to: [], subject: task.id, text: `${decision === "approve" ? "approved" : "returned"} the plan of ${task.id}${note ? `: ${clip(note, 110)}` : ""}` });
			if (task.owner) this.#log(state, { part: "plans", action: "verdict", direction: "out", from: "plans", to: [task.owner], subject: task.id, text: `verdict on ${task.id}` });
			return `Plan of ${task.id} ${decision === "approve" ? "approved" : "returned"}.`;
		});
	}

	post(sessionId: string, author: Party, input: { text: string; to?: string[]; kind?: PostKind; re?: number | null; channel?: string | null }) {
		const text = (input.text ?? "").trim();
		if (!text) throw badRequest("Write something to post.");
		const channel = normalizeChannel(input.channel);
		return this.#change(sessionId, state => {
			const seq = (state.posts.at(-1)?.seq ?? 0) + 1;
			const to = input.to?.length ? input.to.slice(0, 20).map(party => String(party).slice(0, 80)) : ["all"];
			const kind = input.kind && POST_KINDS.includes(input.kind) ? input.kind : "update";
			state.posts.push({ seq, at: this.#now(), author, to, kind, text: text.slice(0, 4000), re: input.re ?? null, channel });
			if (state.posts.length > MAX_POSTS) state.posts.splice(0, state.posts.length - MAX_POSTS);
			// Your own post counts as read, but only when nothing before it is still unread.
			if ((state.readSeq[author] ?? 0) >= seq - 1) state.readSeq[author] = seq;
			this.#log(state, { part: "board", action: "post", direction: "in", from: author, to, subject: `#${seq}`, text: `${kind}: ${clip(text, 140)}` });
			return `Posted #${seq}.`;
		});
	}

	/** What's new for this party: posts addressed to it (or to all), and decisions on its plans and tasks. */
	read(sessionId: string, agent: Party, names: (party: Party) => string = party => party, channel?: string | null) {
		const state = this.state(sessionId);
		const since = state.readSeq[agent] ?? 0;
		const only = channel ? normalizeChannel(channel) : null;
		const posts = state.posts.filter(post => post.seq > since && post.author !== agent && (post.to.includes("all") || post.to.includes(agent) || post.to.includes(names(agent))) && (!only || (post.channel ?? DEFAULT_CHANNEL) === only));
		const mine = state.tasks.filter(task => task.owner === agent);
		const lines: string[] = [];
		for (const post of posts) lines.push(`#${post.seq} ${names(post.author)} (${post.kind}${post.re ? `, re #${post.re}` : ""}): ${post.text}`);
		for (const task of mine) {
			if (task.plan?.status === "approved" && task.status === "in_progress") lines.push(`Your plan for ${task.id} is approved${task.plan.note ? `: ${task.plan.note}` : ""}. Go ahead.`);
			if (task.plan?.status === "returned") lines.push(`Your plan for ${task.id} was returned: ${task.plan.note || "rework it"}. Submit a new plan.`);
			if (task.returnedNote && task.status === "in_progress") lines.push(`${task.id} was sent back: ${task.returnedNote}`);
		}
		const last = state.posts.at(-1)?.seq ?? 0;
		if (posts.length) {
			this.#change(sessionId, next => {
				next.readSeq[agent] = last;
				this.#log(next, { part: "board", action: "read", direction: "out", from: "board", to: [agent], subject: posts.length > 1 ? `#${posts[0].seq}–#${posts.at(-1)!.seq}` : `#${posts[0].seq}`, text: `${names(agent)} read ${posts.length} ${posts.length === 1 ? "post" : "posts"}` });
				return "";
			});
		}
		return lines.length ? lines.join("\n") : "Nothing new on the team board.";
	}

	/** Claim files before editing them; paths another agent holds are refused. */
	claim(sessionId: string, agent: Party, paths: string[], names: (party: Party) => string = party => party) {
		const wanted = [...new Set(paths.map(normalizePath))].slice(0, 50);
		if (!wanted.length) throw badRequest("Name the files or folders to claim.");
		return this.#change(sessionId, state => {
			const granted: string[] = [];
			const refused: string[] = [];
			for (const path of wanted) {
				const holder = state.claims.find(claim => claim.agent !== agent && covers(claim.path, path));
				if (holder) {
					refused.push(`${path} (held by ${names(holder.agent)})`);
					this.#log(state, { part: "claims", action: "conflict", direction: "out", from: "claims", to: [agent], subject: path, text: `${names(agent)} was refused ${path}, held by ${names(holder.agent)}` });
					continue;
				}
				if (!state.claims.some(claim => claim.agent === agent && claim.path === path)) state.claims.push({ agent, path, at: this.#now() });
				granted.push(path);
			}
			if (granted.length) this.#log(state, { part: "claims", action: "claim", direction: "in", from: agent, to: [], subject: granted.join(", "), text: `claimed ${granted.join(", ")}` });
			return [granted.length ? `Claimed: ${granted.join(", ")}.` : "", refused.length ? `Refused: ${refused.join("; ")}. Coordinate on the team board, or work on something else.` : ""].filter(Boolean).join(" ");
		});
	}

	release(sessionId: string, agent: Party, paths: string[] | null) {
		return this.#change(sessionId, state => {
			const mine = state.claims.filter(claim => claim.agent === agent && (!paths || paths.map(normalizePath).includes(claim.path)));
			if (!mine.length) return "You hold no such claims.";
			state.claims = state.claims.filter(claim => !mine.includes(claim));
			this.#log(state, { part: "claims", action: "release", direction: "in", from: agent, to: [], subject: mine.map(claim => claim.path).join(", "), text: `released ${mine.map(claim => claim.path).join(", ")}` });
			return `Released ${mine.length} ${mine.length === 1 ? "path" : "paths"}.`;
		});
	}

	posts(sessionId: string, channel?: string | null): TeamPost[] {
		const only = channel ? normalizeChannel(channel) : null;
		return this.state(sessionId).posts.filter(post => !only || (post.channel ?? DEFAULT_CHANNEL) === only);
	}

	/** Wait until a post arrives after `afterSeq` on this board (and channel, when set). */
	waitFor(sessionId: string, options: { afterSeq?: number; channel?: string | null; timeoutMs?: number } = {}): Promise<BoardWaitResult> {
		const afterSeq = options.afterSeq ?? 0;
		const channel = options.channel ? normalizeChannel(options.channel) : null;
		const timeoutMs = Math.max(0, Math.min(options.timeoutMs ?? 30_000, 120_000));
		const snapshot = (): BoardWaitResult => {
			const posts = this.posts(sessionId, channel).filter(post => post.seq > afterSeq);
			const lastSeq = this.state(sessionId).posts.at(-1)?.seq ?? 0;
			return { matched: posts.length > 0, posts, lastSeq };
		};
		const ready = snapshot();
		if (ready.matched || timeoutMs === 0) return Promise.resolve(ready);
		return new Promise(resolve => {
			const waiters = this.#waiters.get(sessionId) ?? new Set();
			this.#waiters.set(sessionId, waiters);
			let timer: ReturnType<typeof setTimeout>;
			const finish = () => {
				clearTimeout(timer);
				waiters.delete(wake);
				if (waiters.size === 0) this.#waiters.delete(sessionId);
				resolve(snapshot());
			};
			const wake = () => { if (snapshot().matched) finish(); };
			waiters.add(wake);
			timer = setTimeout(finish, timeoutMs);
			timer.unref?.();
		});
	}

	/** Who holds a path, if someone other than `agent` does (for refusing edits). */
	holderOf(sessionId: string, agent: Party, path: string) {
		return this.state(sessionId).claims.find(claim => claim.agent !== agent && covers(claim.path, normalizePath(path)))?.agent ?? null;
	}

	/** The task board as text, for agents. */
	describe(sessionId: string, names: (party: Party) => string = party => party) {
		const state = this.state(sessionId);
		if (!state.tasks.length) return "The task board is empty.";
		return state.tasks.map(task => {
			const waits = task.status === "todo" && !this.#ready(state, task) ? ` · waits for ${task.dependsOn.join(", ")}` : "";
			const plan = task.plan ? ` · plan ${task.plan.status}` : "";
			return `${task.id} [${task.status.replace("_", " ")}] ${task.title}${task.owner ? ` · ${names(task.owner)}` : " · unassigned"}${waits}${plan}`;
		}).join("\n");
	}
}

/** Told to agents that have the team tools. */
export const TEAM_INSTRUCTIONS = "This session has a shared team & swarm board. Use team_overview to set the swarm title, goal, and workstream threads; team_tasks to see, add (optionally linked to a threadId) and take tasks (one agent per task; a task can wait for others) and to mark them done; team_focus to publish your short live status line; team_post to ask, report findings or answer on the team board, and team_read to see what's new for you (posts, plan decisions, tasks sent back); team_claim before editing files, so two agents never edit the same file. When plans are required, submit yours with team_plan and wait for approval before changing files.";
