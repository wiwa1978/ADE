// AgentTasks (.tasks/) v2 format support: repo-committed, git-versioned task trees with
// fixed 6-state lifecycle, start/finish gates, subtree cascades, session claims, and state.md resume points.
// Zero external dependencies; works 100% locally inside any Git repository.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { badRequest, conflict, notFound } from "./http-error.ts";

export const AGENT_TASKS_DIR = ".tasks";
export const AGENT_TASK_STATUSES = ["BACKLOG", "TODO", "IN_PROGRESS", "PAUSED", "DONE", "CANCELLED"] as const;
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];
export const AGENT_TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type AgentTaskPriority = (typeof AGENT_TASK_PRIORITIES)[number];

const TERMINAL_STATUSES = new Set<AgentTaskStatus>(["DONE", "CANCELLED"]);

/** Normative transition table for the fixed 6-state lifecycle. */
const ALLOWED_TRANSITIONS: Record<AgentTaskStatus, readonly AgentTaskStatus[]> = {
	BACKLOG: ["TODO", "CANCELLED"],
	TODO: ["IN_PROGRESS", "BACKLOG", "CANCELLED"],
	IN_PROGRESS: ["PAUSED", "DONE", "TODO", "CANCELLED"],
	PAUSED: ["IN_PROGRESS", "TODO", "BACKLOG", "CANCELLED"],
	DONE: ["TODO", "IN_PROGRESS"],
	CANCELLED: ["BACKLOG", "TODO"],
};

export type AgentTaskFrontmatter = {
	title: string;
	status: AgentTaskStatus;
	priority: AgentTaskPriority;
	depends_on: string[];
	finishes_after: string[];
	assignee: string | null;
	claimed_by: string | null;
	claimed_session: string | null;
	claimed_at: string | null;
	updated_at: string | null;
	extra: Record<string, string | string[]>;
};

export type AgentTaskSummary = {
	/** Relative path under `.tasks/` using POSIX slashes, e.g. `auth/oauth-flow`. */
	path: string;
	parentPath: string | null;
	depth: number;
	title: string;
	status: AgentTaskStatus;
	priority: AgentTaskPriority;
	dependsOn: string[];
	finishesAfter: string[];
	assignee: string | null;
	claimedBy: string | null;
	claimedSession: string | null;
	claimedAt: string | null;
	updatedAt: string | null;
	/** True when `status` is TODO/PAUSED and all `depends_on` tasks are DONE. */
	ready: boolean;
	/** Prerequisite paths that are not DONE yet. */
	blockedBy: string[];
	/** Descendant paths that are not DONE or CANCELLED. */
	openChildren: string[];
	/** True when all descendants are terminal and all `finishes_after` tasks are DONE. */
	canFinish: boolean;
	hasState: boolean;
	hasDesign: boolean;
	hasLog: boolean;
	statePreview: string;
	bodyPreview: string;
};

export type AgentTaskDetail = AgentTaskSummary & {
	body: string;
	state: string;
	design: string;
	log: string;
};

export type AgentTasksOverview = {
	exists: boolean;
	rootPath: string;
	tasks: AgentTaskSummary[];
	counts: Record<AgentTaskStatus, number>;
};

export function isAgentTaskStatus(value: string): value is AgentTaskStatus {
	return (AGENT_TASK_STATUSES as readonly string[]).includes(value);
}

export function normalizeTaskPath(input: string): string {
	const cleaned = String(input ?? "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "")
		.replace(/^\.tasks\//, "");
	if (!cleaned) throw badRequest("Task path is required (for example: auth/login-flow).");
	const segments = cleaned.split("/").filter(Boolean);
	if (!segments.length || segments.length > 8) throw badRequest("Task path must have 1 to 8 segments.");
	for (const segment of segments) {
		if (segment === "." || segment === ".." || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(segment)) {
			throw badRequest(`Invalid task path segment "${segment}". Use letters, numbers, dots, underscores, or hyphens.`);
		}
	}
	return segments.join("/");
}

function tasksRoot(repoPath: string): string {
	return resolve(repoPath, AGENT_TASKS_DIR);
}

function resolveTaskDir(repoPath: string, taskPath: string): { root: string; dir: string; normalized: string } {
	const normalized = normalizeTaskPath(taskPath);
	const root = tasksRoot(repoPath);
	const dir = resolve(root, normalized);
	if (dir !== root && !dir.startsWith(`${root}${sep}`)) {
		throw badRequest("Task path escapes .tasks directory.");
	}
	return { root, dir, normalized };
}

function unquoteYaml(raw: string): string {
	const trimmed = raw.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	return trimmed;
}

function quoteYaml(value: string): string {
	if (/^[a-zA-Z0-9._/@:-]+$/.test(value) && !["true", "false", "null", "yes", "no"].includes(value.toLowerCase())) {
		return value;
	}
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function normalizeStatus(raw: string | undefined): AgentTaskStatus {
	const upper = String(raw ?? "TODO").trim().toUpperCase().replace(/[\s-]+/g, "_");
	return isAgentTaskStatus(upper) ? upper : "TODO";
}

function normalizePriority(raw: string | undefined): AgentTaskPriority {
	const lower = String(raw ?? "normal").trim().toLowerCase();
	if ((AGENT_TASK_PRIORITIES as readonly string[]).includes(lower)) return lower as AgentTaskPriority;
	return "normal";
}

function parseInlineArray(raw: string): string[] {
	const inner = raw.slice(1, -1).trim();
	if (!inner) return [];
	return inner
		.split(",")
		.map(item => unquoteYaml(item))
		.map(item => item.trim())
		.filter(Boolean);
}

export function parseTaskMarkdown(content: string, fallbackTitle: string): { frontmatter: AgentTaskFrontmatter; body: string } {
	const normalized = content.replace(/\r\n/g, "\n");
	let rawFm = "";
	let body = normalized;
	if (normalized.startsWith("---\n")) {
		const endIdx = normalized.indexOf("\n---", 4);
		if (endIdx !== -1) {
			rawFm = normalized.slice(4, endIdx);
			const afterEnd = normalized.slice(endIdx + 4);
			body = afterEnd.startsWith("\n") ? afterEnd.slice(1) : afterEnd;
		}
	}

	const fields = new Map<string, string | string[]>();
	let currentListKey: string | null = null;
	for (const line of rawFm.split("\n")) {
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const listMatch = /^\s*-\s+(.*)$/.exec(line);
		if (listMatch && currentListKey) {
			const val = unquoteYaml(listMatch[1] ?? "");
			if (val) {
				const existing = fields.get(currentListKey);
				if (Array.isArray(existing)) existing.push(val);
				else fields.set(currentListKey, [val]);
			}
			continue;
		}
		currentListKey = null;
		const kvMatch = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line);
		if (!kvMatch) continue;
		const key = kvMatch[1].trim().toLowerCase();
		const rest = (kvMatch[2] ?? "").trim();
		if (!rest) {
			fields.set(key, []);
			currentListKey = key;
		} else if (rest.startsWith("[") && rest.endsWith("]")) {
			fields.set(key, parseInlineArray(rest));
		} else {
			const unquoted = unquoteYaml(rest);
			fields.set(key, unquoted === "null" || unquoted === "~" ? "" : unquoted);
		}
	}

	const asString = (key: string): string | null => {
		const val = fields.get(key);
		if (typeof val === "string" && val.trim()) return val.trim();
		return null;
	};
	const asList = (key: string): string[] => {
		const val = fields.get(key);
		if (Array.isArray(val)) return val.map(item => item.trim()).filter(Boolean);
		if (typeof val === "string" && val.trim()) return [val.trim()];
		return [];
	};

	const knownKeys = new Set([
		"title",
		"status",
		"priority",
		"depends_on",
		"finishes_after",
		"assignee",
		"claimed_by",
		"claimed_session",
		"claimed_at",
		"updated_at",
	]);
	const extra: Record<string, string | string[]> = {};
	for (const [k, v] of fields.entries()) {
		if (!knownKeys.has(k)) extra[k] = v;
	}

	// Derive title from first markdown heading if not in frontmatter.
	const headingMatch = /^#\s+(.+)$/m.exec(body);
	const title = asString("title") ?? headingMatch?.[1]?.trim() ?? fallbackTitle;

	return {
		frontmatter: {
			title,
			status: normalizeStatus(asString("status") ?? undefined),
			priority: normalizePriority(asString("priority") ?? undefined),
			depends_on: asList("depends_on"),
			finishes_after: asList("finishes_after"),
			assignee: asString("assignee"),
			claimed_by: asString("claimed_by"),
			claimed_session: asString("claimed_session"),
			claimed_at: asString("claimed_at"),
			updated_at: asString("updated_at"),
			extra,
		},
		body: body.trimStart(),
	};
}

export function serializeTaskMarkdown(frontmatter: AgentTaskFrontmatter, body: string): string {
	const lines: string[] = ["---"];
	lines.push(`title: ${quoteYaml(frontmatter.title)}`);
	lines.push(`status: ${frontmatter.status}`);
	lines.push(`priority: ${frontmatter.priority}`);
	if (frontmatter.depends_on.length) {
		lines.push("depends_on:");
		for (const dep of frontmatter.depends_on) lines.push(`  - ${quoteYaml(dep)}`);
	} else {
		lines.push("depends_on: []");
	}
	if (frontmatter.finishes_after.length) {
		lines.push("finishes_after:");
		for (const dep of frontmatter.finishes_after) lines.push(`  - ${quoteYaml(dep)}`);
	}
	if (frontmatter.assignee) lines.push(`assignee: ${quoteYaml(frontmatter.assignee)}`);
	if (frontmatter.claimed_by) lines.push(`claimed_by: ${quoteYaml(frontmatter.claimed_by)}`);
	if (frontmatter.claimed_session) lines.push(`claimed_session: ${quoteYaml(frontmatter.claimed_session)}`);
	if (frontmatter.claimed_at) lines.push(`claimed_at: ${quoteYaml(frontmatter.claimed_at)}`);
	if (frontmatter.updated_at) lines.push(`updated_at: ${quoteYaml(frontmatter.updated_at)}`);
	for (const [k, v] of Object.entries(frontmatter.extra)) {
		if (Array.isArray(v)) {
			if (!v.length) lines.push(`${k}: []`);
			else {
				lines.push(`${k}:`);
				for (const item of v) lines.push(`  - ${quoteYaml(item)}`);
			}
		} else if (v) {
			lines.push(`${k}: ${quoteYaml(v)}`);
		}
	}
	lines.push("---", "");
	const trimmedBody = body.trim();
	return trimmedBody ? `${lines.join("\n")}${trimmedBody}\n` : `${lines.join("\n")}# ${frontmatter.title}\n`;
}

function previewText(raw: string, max = 180): string {
	const cleaned = raw
		.replace(/^#+\s*/gm, "")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

type RawTaskEntry = {
	path: string;
	dir: string;
	frontmatter: AgentTaskFrontmatter;
	body: string;
	state: string;
	design: string;
	log: string;
	hasState: boolean;
	hasDesign: boolean;
	hasLog: boolean;
};

function scanRawTasks(repoPath: string): { exists: boolean; root: string; entries: RawTaskEntry[] } {
	const root = tasksRoot(repoPath);
	if (!existsSync(root)) return { exists: false, root, entries: [] };
	let stat;
	try {
		stat = statSync(root);
	} catch {
		return { exists: false, root, entries: [] };
	}
	if (!stat.isDirectory()) return { exists: false, root, entries: [] };

	const entries: RawTaskEntry[] = [];
	const walk = (dir: string, depth: number) => {
		if (depth > 8) return;
		let children;
		try {
			children = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		const taskFile = join(dir, "task.md");
		if (dir !== root && existsSync(taskFile)) {
			const rel = relative(root, dir).split(sep).join("/");
			const fallbackTitle = rel.split("/").at(-1) ?? rel;
			const rawTask = readFileSync(taskFile, "utf8");
			const { frontmatter, body } = parseTaskMarkdown(rawTask, fallbackTitle);
			const statePath = join(dir, "state.md");
			const designPath = join(dir, "design.md");
			const logPath = join(dir, "log.md");
			const hasState = existsSync(statePath);
			const hasDesign = existsSync(designPath);
			const hasLog = existsSync(logPath);
			entries.push({
				path: rel,
				dir,
				frontmatter,
				body,
				state: hasState ? readFileSync(statePath, "utf8") : "",
				design: hasDesign ? readFileSync(designPath, "utf8") : "",
				log: hasLog ? readFileSync(logPath, "utf8") : "",
				hasState,
				hasDesign,
				hasLog,
			});
		}
		for (const child of children) {
			if (!child.isDirectory()) continue;
			if (child.name.startsWith(".") || child.name === "node_modules") continue;
			walk(join(dir, child.name), depth + 1);
		}
	};

	walk(root, 0);
	entries.sort((a, b) => a.path.localeCompare(b.path));
	return { exists: true, root, entries };
}

function parentOf(taskPath: string): string | null {
	const idx = taskPath.lastIndexOf("/");
	return idx === -1 ? null : taskPath.slice(0, idx);
}

function isDescendant(candidate: string, ancestor: string): boolean {
	return candidate.startsWith(`${ancestor}/`);
}

function buildSummaries(entries: RawTaskEntry[]): AgentTaskSummary[] {
	const byPath = new Map(entries.map(entry => [entry.path, entry]));
	return entries.map(entry => {
		const blockedBy = entry.frontmatter.depends_on.filter(dep => byPath.get(dep)?.frontmatter.status !== "DONE");
		const openChildren = entries
			.filter(other => isDescendant(other.path, entry.path) && !TERMINAL_STATUSES.has(other.frontmatter.status))
			.map(other => other.path);
		const unfinishedAfter = entry.frontmatter.finishes_after.filter(dep => byPath.get(dep)?.frontmatter.status !== "DONE");
		const ready = (entry.frontmatter.status === "TODO" || entry.frontmatter.status === "PAUSED") && blockedBy.length === 0;
		const canFinish = openChildren.length === 0 && unfinishedAfter.length === 0;
		return {
			path: entry.path,
			parentPath: parentOf(entry.path),
			depth: entry.path.split("/").length - 1,
			title: entry.frontmatter.title,
			status: entry.frontmatter.status,
			priority: entry.frontmatter.priority,
			dependsOn: entry.frontmatter.depends_on,
			finishesAfter: entry.frontmatter.finishes_after,
			assignee: entry.frontmatter.assignee,
			claimedBy: entry.frontmatter.claimed_by,
			claimedSession: entry.frontmatter.claimed_session,
			claimedAt: entry.frontmatter.claimed_at,
			updatedAt: entry.frontmatter.updated_at,
			ready,
			blockedBy,
			openChildren,
			canFinish,
			hasState: entry.hasState,
			hasDesign: entry.hasDesign,
			hasLog: entry.hasLog,
			statePreview: previewText(entry.state),
			bodyPreview: previewText(entry.body),
		};
	});
}

function appendLog(dir: string, actor: string, action: string, note?: string): void {
	const logPath = join(dir, "log.md");
	const timestamp = new Date().toISOString();
	const line = `- \`${timestamp}\` **${actor}** — ${action}${note?.trim() ? `: ${note.trim().replace(/\s+/g, " ")}` : ""}\n`;
	if (!existsSync(logPath)) {
		writeFileSync(logPath, `# Task Log\n\n${line}`, "utf8");
	} else {
		appendFileSync(logPath, line, "utf8");
	}
}

export function listAgentTasks(repoPath: string): AgentTasksOverview {
	const { exists, root, entries } = scanRawTasks(repoPath);
	const tasks = buildSummaries(entries);
	const counts: Record<AgentTaskStatus, number> = {
		BACKLOG: 0,
		TODO: 0,
		IN_PROGRESS: 0,
		PAUSED: 0,
		DONE: 0,
		CANCELLED: 0,
	};
	for (const task of tasks) counts[task.status] += 1;
	return { exists, rootPath: root, tasks, counts };
}

export function getAgentTaskDetail(repoPath: string, taskPath: string): AgentTaskDetail {
	const { normalized } = resolveTaskDir(repoPath, taskPath);
	const { entries } = scanRawTasks(repoPath);
	const raw = entries.find(entry => entry.path === normalized);
	if (!raw) throw notFound(`Task "${normalized}" was not found under .tasks/.`);
	const summary = buildSummaries(entries).find(item => item.path === normalized)!;
	return {
		...summary,
		body: raw.body,
		state: raw.state,
		design: raw.design,
		log: raw.log,
	};
}

export type CreateAgentTaskInput = {
	path: string;
	title: string;
	body?: string;
	status?: AgentTaskStatus;
	priority?: AgentTaskPriority;
	dependsOn?: string[];
	finishesAfter?: string[];
	assignee?: string | null;
	design?: string;
	state?: string;
	actor?: string;
};

export function createAgentTask(repoPath: string, input: CreateAgentTaskInput): AgentTaskDetail {
	const { dir, normalized } = resolveTaskDir(repoPath, input.path);
	const taskFile = join(dir, "task.md");
	if (existsSync(taskFile)) throw conflict(`Task "${normalized}" already exists.`);
	const title = String(input.title ?? "").trim();
	if (!title) throw badRequest("Task title is required.");
	const status: AgentTaskStatus = input.status && isAgentTaskStatus(input.status) ? input.status : "TODO";
	const priority = normalizePriority(input.priority);
	const dependsOn = (input.dependsOn ?? []).map(dep => normalizeTaskPath(dep));
	const finishesAfter = (input.finishesAfter ?? []).map(dep => normalizeTaskPath(dep));
	const now = new Date().toISOString();

	mkdirSync(dir, { recursive: true });
	const frontmatter: AgentTaskFrontmatter = {
		title,
		status,
		priority,
		depends_on: dependsOn,
		finishes_after: finishesAfter,
		assignee: input.assignee?.trim() || null,
		claimed_by: null,
		claimed_session: null,
		claimed_at: null,
		updated_at: now,
		extra: {},
	};
	const body = input.body?.trim() ? input.body.trim() : `# ${title}\n`;
	writeFileSync(taskFile, serializeTaskMarkdown(frontmatter, body), "utf8");
	if (input.state?.trim()) writeFileSync(join(dir, "state.md"), `${input.state.trim()}\n`, "utf8");
	if (input.design?.trim()) writeFileSync(join(dir, "design.md"), `${input.design.trim()}\n`, "utf8");
	appendLog(dir, input.actor ?? "user", `created (${status})`, title);
	return getAgentTaskDetail(repoPath, normalized);
}

export type TransitionAgentTaskInput = {
	path: string;
	status: AgentTaskStatus;
	actor?: string;
	sessionId?: string | null;
	note?: string;
	/** Required when moving to PAUSED (unless state.md already exists). */
	state?: string;
	/** Allow taking over an active session claim. */
	force?: boolean;
};

export function transitionAgentTask(repoPath: string, input: TransitionAgentTaskInput): { task: AgentTaskDetail; cascaded: string[] } {
	const { dir, normalized } = resolveTaskDir(repoPath, input.path);
	const { entries } = scanRawTasks(repoPath);
	const raw = entries.find(entry => entry.path === normalized);
	if (!raw) throw notFound(`Task "${normalized}" was not found under .tasks/.`);

	const nextStatus = input.status;
	if (!isAgentTaskStatus(nextStatus)) throw badRequest(`Unsupported task status "${String(nextStatus)}".`);
	const currentStatus = raw.frontmatter.status;
	const actor = input.actor?.trim() || "user";
	const now = new Date().toISOString();

	if (currentStatus !== nextStatus) {
		const allowed = ALLOWED_TRANSITIONS[currentStatus];
		if (!allowed.includes(nextStatus)) {
			throw conflict(`Illegal transition for "${normalized}": ${currentStatus} → ${nextStatus}. Allowed: ${allowed.join(", ")}.`);
		}
	}

	const byPath = new Map(entries.map(entry => [entry.path, entry]));

	// Start gate: depends_on must all be DONE before moving to IN_PROGRESS.
	if (nextStatus === "IN_PROGRESS") {
		const unmet = raw.frontmatter.depends_on.filter(dep => byPath.get(dep)?.frontmatter.status !== "DONE");
		if (unmet.length) {
			throw conflict(`Start gate blocked for "${normalized}": waiting on ${unmet.join(", ")} to reach DONE.`);
		}
		if (
			raw.frontmatter.claimed_session
			&& input.sessionId
			&& raw.frontmatter.claimed_session !== input.sessionId
			&& currentStatus === "IN_PROGRESS"
			&& !input.force
		) {
			throw conflict(`Task "${normalized}" is already claimed by session "${raw.frontmatter.claimed_session}". Pass force: true to take over.`);
		}
	}

	// Resume state contract: pausing requires saving state.md so the next session knows where to resume.
	if (nextStatus === "PAUSED") {
		const hasIncomingState = Boolean(input.state?.trim());
		if (!hasIncomingState && !raw.state.trim()) {
			throw conflict(`Pause contract for "${normalized}": provide a resume state (state.md) before pausing.`);
		}
	}

	// Finish gates: all descendants must be terminal (DONE or CANCELLED) and finishes_after must be DONE.
	if (nextStatus === "DONE") {
		const openChildren = entries
			.filter(other => isDescendant(other.path, normalized) && !TERMINAL_STATUSES.has(other.frontmatter.status))
			.map(other => `${other.path} (${other.frontmatter.status})`);
		if (openChildren.length) {
			throw conflict(`Finish gate blocked for "${normalized}": child tasks still open (${openChildren.join(", ")}).`);
		}
		const unmetAfter = raw.frontmatter.finishes_after.filter(dep => byPath.get(dep)?.frontmatter.status !== "DONE");
		if (unmetAfter.length) {
			throw conflict(`Finish gate blocked for "${normalized}": finishes_after prerequisites not DONE (${unmetAfter.join(", ")}).`);
		}
	}

	// Apply changes to target task.
	raw.frontmatter.status = nextStatus;
	raw.frontmatter.updated_at = now;
	if (nextStatus === "IN_PROGRESS") {
		raw.frontmatter.claimed_by = actor;
		raw.frontmatter.claimed_session = input.sessionId ?? raw.frontmatter.claimed_session;
		raw.frontmatter.claimed_at = now;
	} else if (nextStatus === "DONE" || nextStatus === "CANCELLED" || nextStatus === "BACKLOG" || nextStatus === "TODO") {
		raw.frontmatter.claimed_by = null;
		raw.frontmatter.claimed_session = null;
		raw.frontmatter.claimed_at = null;
	}

	writeFileSync(join(dir, "task.md"), serializeTaskMarkdown(raw.frontmatter, raw.body), "utf8");
	if (input.state?.trim()) {
		writeFileSync(join(dir, "state.md"), `${input.state.trim()}\n`, "utf8");
	}
	appendLog(dir, actor, `${currentStatus} → ${nextStatus}`, input.note);

	// Subtree cascades for CANCELLED and BACKLOG.
	const cascaded: string[] = [];
	if (nextStatus === "CANCELLED" || nextStatus === "BACKLOG") {
		for (const child of entries) {
			if (!isDescendant(child.path, normalized)) continue;
			if (TERMINAL_STATUSES.has(child.frontmatter.status)) continue;
			if (child.frontmatter.status === nextStatus) continue;
			const prev = child.frontmatter.status;
			child.frontmatter.status = nextStatus;
			child.frontmatter.claimed_by = null;
			child.frontmatter.claimed_session = null;
			child.frontmatter.claimed_at = null;
			child.frontmatter.updated_at = now;
			writeFileSync(join(child.dir, "task.md"), serializeTaskMarkdown(child.frontmatter, child.body), "utf8");
			appendLog(child.dir, actor, `${prev} → ${nextStatus} (cascaded from ${normalized})`, input.note);
			cascaded.push(child.path);
		}
	}

	return { task: getAgentTaskDetail(repoPath, normalized), cascaded };
}

/** Write state.md and bump task.md `updated_at` without changing status. */
export function noteAgentTaskProgress(repoPath: string, taskPath: string, content: string, actor = "ade", action = "updated state.md"): AgentTaskDetail {
	const { dir, normalized } = resolveTaskDir(repoPath, taskPath);
	const { entries } = scanRawTasks(repoPath);
	const raw = entries.find(entry => entry.path === normalized);
	if (!raw) throw notFound(`Task "${normalized}" was not found under .tasks/.`);
	const trimmed = String(content ?? "").trim();
	if (!trimmed) throw badRequest("Resume state content cannot be empty.");
	raw.frontmatter.updated_at = new Date().toISOString();
	writeFileSync(join(dir, "task.md"), serializeTaskMarkdown(raw.frontmatter, raw.body), "utf8");
	writeFileSync(join(dir, "state.md"), `${trimmed}\n`, "utf8");
	appendLog(dir, actor, action);
	return getAgentTaskDetail(repoPath, normalized);
}

/** Pause or record stage progress for the task whose claimed_session is this session. */
export function syncClaimedAgentTask(repoPath: string, sessionId: string, event: "pause" | "archive" | "stage", note: string): AgentTaskDetail | null {
	const task = listAgentTasks(repoPath).tasks.find(item => item.claimedSession === sessionId);
	if (!task) return null;
	if (event === "stage") return noteAgentTaskProgress(repoPath, task.path, note, "ade", "stage finished");
	if (task.status !== "IN_PROGRESS" && task.status !== "PAUSED") return null;
	return transitionAgentTask(repoPath, {
		path: task.path,
		status: "PAUSED",
		sessionId,
		state: note,
		actor: "ade",
		note: event,
	}).task;
}

export function updateAgentTaskState(repoPath: string, taskPath: string, content: string, actor = "agent"): AgentTaskDetail {
	const { dir, normalized } = resolveTaskDir(repoPath, taskPath);
	const taskFile = join(dir, "task.md");
	if (!existsSync(taskFile)) throw notFound(`Task "${normalized}" was not found under .tasks/.`);
	const trimmed = String(content ?? "").trim();
	if (!trimmed) throw badRequest("Resume state content cannot be empty.");
	writeFileSync(join(dir, "state.md"), `${trimmed}\n`, "utf8");
	appendLog(dir, actor, "updated state.md");
	return getAgentTaskDetail(repoPath, normalized);
}

/** Build a ready-to-send prompt for launching or resuming an ADE session on a `.tasks/` item. */
export function buildAgentTaskPrompt(detail: AgentTaskDetail): string {
	const lines: string[] = [
		`Work on repo task \`.tasks/${detail.path}\`: **${detail.title}** (${detail.status}, priority: ${detail.priority}).`,
	];
	if (detail.dependsOn.length) lines.push(`Dependencies (all DONE): ${detail.dependsOn.join(", ")}`);
	if (detail.state.trim()) {
		lines.push("", "## Resume state (`state.md`)", detail.state.trim());
	}
	if (detail.body.trim()) {
		lines.push("", "## Task specification (`task.md`)", detail.body.trim());
	}
	if (detail.design.trim()) {
		lines.push("", "## Design notes (`design.md`)", detail.design.trim());
	}
	lines.push(
		"",
		"Keep `.tasks/" + detail.path + "/state.md` updated with your exact resume point before pausing or finishing, and use the `agent_tasks` tool to update task status.",
	);
	return lines.join("\n");
}
