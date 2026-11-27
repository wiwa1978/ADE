// ADE Observatory: Live Fleet, Stall Detection, and Stage-Aware Task Trace.
// Privacy boundary: records only tool/program metadata, stage IDs, exit codes, and timestamps —
// never prompts, message bodies, command arguments, tool outputs, or secrets.
import type { DatabaseSync } from "node:sqlite";
import { defineExtension, hook, ROOT_CONVERSATION_ID, ToolTask } from "@earendil-works/pi-durable";
import type { Conversation } from "@ade/protocol";
import type { InboxEntry, SessionState } from "./inbox.ts";
import type { SessionStagesView } from "./session-blueprints.ts";
import type { UsageReport } from "./usage.ts";
import { dbAll, dbRun } from "./db/schema.ts";
import { runHostMigrations } from "./db/migrations.ts";

export const QUIET_MS = 2 * 60_000;
export const STALLED_MS = 8 * 60_000;
export const SLOW_TOOL_MS = 5 * 60_000;
export const IDLE_FOLD_MS = 30 * 60_000;

export type ToolCategory = "read" | "edit" | "shell" | "search" | "browser" | "subagent" | "stage" | "mcp" | "other";

export type AgentHealth = "ok" | "delegating" | "quiet" | "stalled" | "slow-tool";

export type ActiveToolRun = {
	id: string;
	sessionId: string;
	conversationId: string;
	stageId: string | null;
	toolName: string;
	program: string | null;
	category: ToolCategory;
	startedAt: number;
};

export type StoredToolRun = {
	id: string;
	sessionId: string;
	conversationId: string;
	stageId: string | null;
	toolName: string;
	program: string | null;
	category: ToolCategory;
	status: "running" | "done" | "error";
	exitCode: number | null;
	startedAt: number;
	endedAt: number | null;
};

export type LaneEvent = {
	t: number;
	cat: ToolCategory;
	failed: boolean;
};

export type FailedCallSummary = {
	id: string;
	toolName: string;
	program: string | null;
	category: ToolCategory;
	exitCode: number | null;
	stageId: string | null;
	at: number;
	durationMs: number | null;
};

export type FleetSubagent = {
	id: string;
	name: string;
	role: string;
	harness: string;
	model: string | null;
	status: string;
	health: AgentHealth;
	healthSince: number | null;
	startedAt: number | null;
	endedAt: number | null;
	lastActivityAt: number | null;
	currentTool: { name: string; program: string | null; category: ToolCategory; startedAt: number; slow: boolean } | null;
	lane: LaneEvent[];
	recentFailures: FailedCallSummary[];
};

export type FleetSession = {
	sessionId: string;
	title: string;
	projectId: string | null;
	projectName: string | null;
	engine: string;
	provider: string | null;
	model: string | null;
	state: SessionState;
	needsYou: boolean;
	waitingReason: string | null;
	waitingSince: number | null;
	health: AgentHealth;
	healthSince: number | null;
	blueprint: {
		id: string;
		name: string;
		stageId: string;
		stageName: string;
		stageStatus: string;
		done: number;
		total: number;
	} | null;
	currentTool: { name: string; program: string | null; category: ToolCategory; startedAt: number; slow: boolean } | null;
	lastActivityAt: number | null;
	startedAt: number | null;
	tokens: { input: number; output: number; cost: number };
	lane: LaneEvent[];
	recentFailures: FailedCallSummary[];
	subagents: FleetSubagent[];
	foldedSubagentsCount: number;
};

export type ObservatoryLiveSnapshot = {
	at: number;
	windowMin: number;
	scope: "all" | "active" | "needs-you";
	kpis: {
		activeAgents: number;
		needsYou: number;
		oldestWaitMs: number | null;
		topNeedsYouTitle: string | null;
		topNeedsYouReason: string | null;
		toolsPerMin: number;
		toolsSparkline: number[];
		stalledCount: number;
		slowToolsCount: number;
		failedCalls: number;
		tokensToday: number;
		costToday: number;
	};
	sessions: FleetSession[];
};

export type TraceSpanKind = "tool" | "subagent" | "wait" | "model";

export type TraceSpan = {
	id: string;
	kind: TraceSpanKind;
	label: string;
	stageId: string | null;
	category?: ToolCategory;
	program?: string | null;
	model?: string | null;
	status: "running" | "done" | "error" | "waiting";
	exitCode?: number | null;
	startedAt: number;
	endedAt: number;
	durationMs: number;
	live: boolean;
	/** Folded consecutive sub-second tool calls. */
	foldedCount?: number;
};

export type TraceStageBand = {
	id: string;
	name: string;
	status: string;
	attempt: number;
	gate: string;
	goldfish: boolean;
	checksOk: boolean | null;
	reviewerModel: string | null;
	reviewerIndependent: boolean | null;
	startedAt: number | null;
	endedAt: number | null;
};

export type TraceFoldedGap = {
	startedAt: number;
	endedAt: number;
	durationMs: number;
};

export type ObservatoryTaskTrace = {
	at: number;
	sessionId: string;
	title: string;
	projectName: string | null;
	blueprintName: string | null;
	startedAt: number | null;
	endedAt: number | null;
	totalMs: number;
	breakdown: {
		toolsMs: number;
		modelMs: number;
		waitingMs: number;
		delegatingMs: number;
	};
	stages: TraceStageBand[];
	spans: TraceSpan[];
	foldedGaps: TraceFoldedGap[];
};

const ALLOWED_PROGRAMS = new Set([
	"awk", "bash", "bun", "cargo", "cat", "chmod", "cp", "curl", "cut", "deno",
	"diff", "docker", "du", "echo", "eslint", "fd", "find", "gcc", "gh", "git",
	"go", "grep", "head", "jq", "ls", "make", "mkdir", "mv", "node", "npm",
	"npx", "oxlint", "pip", "pip3", "pnpm", "psql", "pytest", "python", "python3",
	"rg", "rm", "rsync", "rustc", "sed", "sh", "sort", "sqlite3", "ssh", "tail",
	"tar", "tee", "touch", "tsc", "tsx", "uv", "vite", "vitest", "wc", "wget",
	"which", "xargs", "yarn", "zsh",
]);

const WRAPPER_SHELLS = new Set(["sh", "bash", "zsh", "env", "sudo", "timeout", "nohup", "time"]);

/**
 * Extract only the allowlisted program name from a shell command line.
 * Never returns arguments, file paths, env values, or secrets.
 */
export function extractCommandProgram(command: string | null | undefined): string | null {
	if (!command || typeof command !== "string") return null;
	let line = command.trim();
	if (!line) return null;
	// Unwrap leading `bash -lc "..."` or `sh -c '...'`
	const shellWrap = line.match(/^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh\s+-[a-z]*c\s+(['"])([\s\S]+)\1$/);
	if (shellWrap) line = shellWrap[2].trim();
	// Split on command chain separators and prefer the first non-cd/non-export segment.
	const segments = line.split(/\s*(?:&&|\|\||;|\n)\s*/).map(s => s.trim()).filter(Boolean);
	for (const seg of segments) {
		const pipeHead = seg.split(/\s*\|\s*/)[0]?.trim() ?? "";
		const tokens = pipeHead.split(/\s+/).filter(Boolean);
		let idx = 0;
		// Skip leading VAR=val assignments
		while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) idx++;
		if (idx >= tokens.length) continue;
		const base = tokens[idx].split("/").pop()?.toLowerCase() ?? "";
		if (base === "cd" || base === "export" || base === "unset" || base === "set" || base === "true") continue;
		if (WRAPPER_SHELLS.has(base)) {
			// Look ahead for the actual command after flags
			let next = idx + 1;
			while (next < tokens.length && tokens[next].startsWith("-")) next++;
			const inner = tokens[next]?.split("/").pop()?.toLowerCase() ?? "";
			if (inner && ALLOWED_PROGRAMS.has(inner)) return inner;
		}
		if (ALLOWED_PROGRAMS.has(base)) return base;
		return null;
	}
	return null;
}

export function categorizeTool(toolName: string): ToolCategory {
	const name = toolName.toLowerCase();
	if (name.startsWith("mcp_")) return "mcp";
	if (name.startsWith("browser_")) return "browser";
	if (name === "run_command" || name === "manage_process") return "shell";
	if (name === "read" || name === "list_files" || name === "read_skill") return "read";
	if (name === "write" || name === "edit" || name === "write_artifact") return "edit";
	if (name === "grep_search" || name === "find_files") return "search";
	if (name.includes("subagent") || name.startsWith("team_")) return "subagent";
	if (name === "finish_stage" || name === "update_tasks") return "stage";
	return "other";
}

/** `rg` and `grep` return exit code 1 when no matches are found — not a broken command. */
export function isBenignExit(program: string | null | undefined, exitCode: number | null | undefined): boolean {
	if (exitCode !== 1) return false;
	return program === "rg" || program === "grep" || program === "diff";
}

export function extractExitCode(details: unknown, output?: unknown): number | null {
	if (details && typeof details === "object") {
		const rec = details as Record<string, unknown>;
		for (const key of ["exitCode", "code", "status"]) {
			if (typeof rec[key] === "number" && Number.isInteger(rec[key])) return rec[key];
		}
	}
	if (typeof output === "string") {
		const match = output.match(/exit(?:ed with)? code[:\s]+(-?\d+)/i);
		if (match) return Number(match[1]);
	}
	return null;
}

export function evaluateAgentHealth(input: {
	working: boolean;
	delegating: boolean;
	lastActivityAt: number | null;
	runningTool: { name: string; program: string | null; category: ToolCategory; startedAt: number } | null;
	now: number;
}): {
	health: AgentHealth;
	healthSince: number | null;
	slowTool: boolean;
} {
	if (!input.working) {
		return { health: "ok", healthSince: null, slowTool: false };
	}
	if (input.runningTool) {
		const elapsed = input.now - input.runningTool.startedAt;
		if (elapsed >= SLOW_TOOL_MS) {
			return { health: "slow-tool", healthSince: input.runningTool.startedAt, slowTool: true };
		}
		return { health: "ok", healthSince: null, slowTool: false };
	}
	if (input.delegating) {
		return { health: "delegating", healthSince: input.lastActivityAt, slowTool: false };
	}
	if (input.lastActivityAt !== null) {
		const silentMs = input.now - input.lastActivityAt;
		if (silentMs >= STALLED_MS) {
			return { health: "stalled", healthSince: input.lastActivityAt, slowTool: false };
		}
		if (silentMs >= QUIET_MS) {
			return { health: "quiet", healthSince: input.lastActivityAt, slowTool: false };
		}
	}
	return { health: "ok", healthSince: null, slowTool: false };
}

export type SubagentSummaryInput = {
	id: string;
	name: string;
	role: string;
	harness: string;
	model: string | null;
	status: string;
	createdAt: number | null;
	updatedAt: number | null;
};

export class Observatory {
	#db: DatabaseSync;
	#inFlight = new Map<string, ActiveToolRun>();
	#stageResolver: ((sessionId: string) => string | null) | null = null;

	constructor(db: DatabaseSync) {
		this.#db = db;
		runHostMigrations(this.#db);
	}

	setStageResolver(resolver: (sessionId: string) => string | null): void {
		this.#stageResolver = resolver;
	}

	recordToolStart(input: {
		id: string;
		sessionId: string;
		conversationId: string;
		stageId?: string | null;
		toolName: string;
		command?: string | null;
		startedAt?: number;
	}): ActiveToolRun {
		const startedAt = input.startedAt ?? Date.now();
		const program = input.toolName === "run_command" ? extractCommandProgram(input.command) : null;
		const category = categorizeTool(input.toolName);
		const stageId = input.stageId !== undefined ? input.stageId : (this.#stageResolver?.(input.sessionId) ?? null);
		const run: ActiveToolRun = {
			id: input.id,
			sessionId: input.sessionId,
			conversationId: input.conversationId,
			stageId,
			toolName: input.toolName,
			program,
			category,
			startedAt,
		};
		this.#inFlight.set(input.id, run);
		dbRun(
			this.#db,
			`INSERT OR REPLACE INTO observatory_tool_runs
			 (id, sessionId, conversationId, stageId, toolName, program, category, status, exitCode, startedAt, endedAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'running', NULL, ?, NULL)`,
			run.id,
			run.sessionId,
			run.conversationId,
			run.stageId,
			run.toolName,
			run.program,
			run.category,
			run.startedAt,
		);
		return run;
	}

	recordToolEnd(input: {
		id: string;
		isError: boolean;
		exitCode?: number | null;
		endedAt?: number;
	}): void {
		const endedAt = input.endedAt ?? Date.now();
		const active = this.#inFlight.get(input.id);
		this.#inFlight.delete(input.id);
		const benign = input.isError && active ? isBenignExit(active.program, input.exitCode) : false;
		const status = input.isError && !benign ? "error" : "done";
		dbRun(
			this.#db,
			`UPDATE observatory_tool_runs SET status = ?, exitCode = ?, endedAt = ? WHERE id = ?`,
			status,
			input.exitCode ?? null,
			endedAt,
			input.id,
		);
	}

	/** Pi Durable extension installed on every session to record tool telemetry automatically. */
	createExtension(sessionId: string) {
		return defineExtension({
			name: "ade-observatory",
			hooks: [
				hook(ToolTask, {
					beforeTool: async (call, api) => {
						const args = (call.arguments && typeof call.arguments === "object" ? call.arguments : {}) as Record<string, unknown>;
						const id = `${sessionId}:${String(api.taskId)}`;
						const convId = api.conversationId === ROOT_CONVERSATION_ID ? "root" : String(api.conversationId);
						try {
							this.recordToolStart({
								id,
								sessionId,
								conversationId: convId,
								toolName: call.name,
								command: typeof args.command === "string" ? args.command : null,
							});
						} catch {
							// Telemetry must never break tool execution.
						}
						return undefined;
					},
					afterTool: async (_call, result, api) => {
						const id = `${sessionId}:${String(api.taskId)}`;
						try {
							const res = result as { isError?: boolean; details?: unknown; content?: unknown } | undefined;
							const exitCode = extractExitCode(res?.details, typeof res?.content === "string" ? res.content : undefined);
							this.recordToolEnd({
								id,
								isError: Boolean(res?.isError),
								exitCode,
							});
						} catch {
							// Telemetry must never break tool execution.
						}
						return undefined;
					},
				}),
			],
		});
	}

	listToolRunsSince(sinceMs: number): StoredToolRun[] {
		return dbAll<StoredToolRun>(
			this.#db,
			`SELECT id, sessionId, conversationId, stageId, toolName, program, category, status, exitCode, startedAt, endedAt
			 FROM observatory_tool_runs
			 WHERE startedAt >= ? OR (status = 'running' AND endedAt IS NULL)
			 ORDER BY startedAt ASC`,
			sinceMs,
		);
	}

	listSessionToolRuns(sessionId: string): StoredToolRun[] {
		return dbAll<StoredToolRun>(
			this.#db,
			`SELECT id, sessionId, conversationId, stageId, toolName, program, category, status, exitCode, startedAt, endedAt
			 FROM observatory_tool_runs
			 WHERE sessionId = ?
			 ORDER BY startedAt ASC`,
			sessionId,
		);
	}

	listSessionTurns(sessionId: string): Array<{ id: string; status: string; createdAt: number; updatedAt: number; model: string }> {
		if (sessionId === "coding" || sessionId === "personal") {
			return dbAll<{ id: string; status: string; createdAt: number; updatedAt: number; model: string }>(
				this.#db,
				`SELECT id, status, createdAt, updatedAt, model
				 FROM turns
				 WHERE mode = ? AND taskId IS NULL AND chatId IS NULL
				 ORDER BY createdAt ASC`,
				sessionId,
			);
		}
		return dbAll<{ id: string; status: string; createdAt: number; updatedAt: number; model: string }>(
			this.#db,
			`SELECT id, status, createdAt, updatedAt, model
			 FROM turns
			 WHERE taskId = ? OR chatId = ?
			 ORDER BY createdAt ASC`,
			sessionId,
			sessionId,
		);
	}

	liveSnapshot(input: {
		sessions: Conversation[];
		projects: Array<{ id: string; name: string }>;
		inboxEntries: InboxEntry[];
		pendingApprovals: Array<{ sessionId: string; summary: string; createdAt: number }>;
		usageReport: UsageReport;
		subagentsBySession: Record<string, SubagentSummaryInput[]>;
		windowMin?: number;
		scope?: "all" | "active" | "needs-you";
		now?: number;
	}): ObservatoryLiveSnapshot {
		const now = input.now ?? Date.now();
		const windowMin = [15, 30, 60, 180].includes(input.windowMin ?? 30) ? (input.windowMin ?? 30) : 30;
		const scope = input.scope ?? "all";
		const windowStart = now - windowMin * 60_000;
		const projectNames = new Map(input.projects.map(p => [p.id, p.name]));
		const inboxBySession = new Map(input.inboxEntries.map(e => [e.sessionId, e]));
		const approvalsBySession = new Map<string, Array<{ summary: string; createdAt: number }>>();
		for (const approval of input.pendingApprovals) {
			const list = approvalsBySession.get(approval.sessionId) ?? [];
			list.push({ summary: approval.summary, createdAt: approval.createdAt });
			approvalsBySession.set(approval.sessionId, list);
		}

		const runs = this.listToolRunsSince(windowStart);
		const runsBySession = new Map<string, StoredToolRun[]>();
		for (const run of runs) {
			const list = runsBySession.get(run.sessionId) ?? [];
			list.push(run);
			runsBySession.set(run.sessionId, list);
		}
		const latestModelBySession = this.#latestTurnModels();

		// Rolling 15-bucket sparkline over the last 15 minutes (1 bucket/min) and 5-minute tools/min average.
		const sparkBuckets = new Array<number>(15).fill(0);
		let toolsLast5m = 0;
		for (const run of runs) {
			const ageMs = now - run.startedAt;
			if (ageMs >= 0 && ageMs < 15 * 60_000) {
				const idx = 14 - Math.floor(ageMs / 60_000);
				if (idx >= 0 && idx < 15) sparkBuckets[idx]++;
			}
			if (ageMs >= 0 && ageMs < 5 * 60_000) toolsLast5m++;
		}

		let activeAgents = 0;
		let needsYouCount = 0;
		let oldestWaitMs: number | null = null;
		let topNeedsYouTitle: string | null = null;
		let topNeedsYouReason: string | null = null;
		let stalledCount = 0;
		let slowToolsCount = 0;
		let totalFailedCalls = 0;

		const fleetSessions: FleetSession[] = [];
		const visibleSessions = input.sessions.filter(s => !s.archivedAt);

		for (const session of visibleSessions) {
			const inbox = inboxBySession.get(session.id);
			const state: SessionState = inbox?.state ?? (session.status === "working" ? "working" : "idle");
			const needsYou = Boolean(inbox?.needsYou);
			const sessionRuns = runsBySession.get(session.id) ?? [];
			const rootRuns = sessionRuns.filter(r => r.conversationId === "root");
			const sessionApprovals = approvalsBySession.get(session.id) ?? [];

			const rawSubs = input.subagentsBySession[session.id] ?? [];
			const mappedSubs: FleetSubagent[] = rawSubs.map(sub => {
				const subRuns = sessionRuns.filter(r => r.conversationId === sub.id);
				const subRunningTool = this.#runningToolFor(session.id, sub.id, subRuns);
				const subLastRun = subRuns[subRuns.length - 1];
				const subLastAt = Math.max(sub.updatedAt ?? 0, subLastRun?.endedAt ?? subLastRun?.startedAt ?? 0) || sub.createdAt;
				const subWorking = sub.status === "running";
				const subHealth = evaluateAgentHealth({
					working: subWorking,
					delegating: false,
					lastActivityAt: subLastAt,
					runningTool: subRunningTool,
					now,
				});
				if (subWorking) activeAgents++;
				if (subHealth.health === "stalled") stalledCount++;
				if (subHealth.slowTool) slowToolsCount++;
				const subFailures = this.#failuresFrom(subRuns);
				totalFailedCalls += subFailures.length;
				return {
					id: sub.id,
					name: sub.name,
					role: sub.role,
					harness: sub.harness,
					model: sub.model,
					status: sub.status,
					health: subHealth.health,
					healthSince: subHealth.healthSince,
					startedAt: sub.createdAt,
					endedAt: subWorking ? null : sub.updatedAt,
					lastActivityAt: subLastAt,
					currentTool: subRunningTool ? { ...subRunningTool, slow: subHealth.slowTool } : null,
					lane: subRuns.map(r => ({ t: r.startedAt, cat: r.category, failed: r.status === "error" })),
					recentFailures: subFailures.slice(-5),
				};
			});

			// Fold older finished subagents (keep running, waiting, and latest 3 finished within 3h).
			const RECENT_SUB_MS = 3 * 3_600_000;
			const keptSubs: FleetSubagent[] = [];
			let finishedKept = 0;
			let foldedSubagentsCount = 0;
			const sortedSubs = [...mappedSubs].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
			for (const sub of sortedSubs) {
				const activeOrWaiting = sub.status === "running" || sub.status === "waiting";
				const isRecent = sub.lastActivityAt !== null && now - sub.lastActivityAt <= RECENT_SUB_MS;
				if (activeOrWaiting || (isRecent && finishedKept < 3)) {
					keptSubs.push(sub);
					if (!activeOrWaiting) finishedKept++;
				} else {
					foldedSubagentsCount++;
				}
			}

			const working = session.status === "working";
			if (working) activeAgents++;
			const delegating = working && mappedSubs.some(s => s.status === "running");
			const runningTool = this.#runningToolFor(session.id, "root", rootRuns);
			const lastRootRun = rootRuns[rootRuns.length - 1];
			const lastActivityAt = Math.max(session.updatedAt ?? 0, lastRootRun?.endedAt ?? lastRootRun?.startedAt ?? 0) || null;
			const healthEval = evaluateAgentHealth({
				working,
				delegating,
				lastActivityAt,
				runningTool,
				now,
			});
			if (healthEval.health === "stalled") stalledCount++;
			if (healthEval.slowTool) slowToolsCount++;

			const rootFailures = this.#failuresFrom(rootRuns);
			totalFailedCalls += rootFailures.length;

			let waitingReason: string | null = null;
			let waitingSince: number | null = null;
			if (sessionApprovals.length > 0) {
				const earliest = sessionApprovals.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
				waitingReason = earliest.summary;
				waitingSince = earliest.createdAt;
			} else if (state === "stage-approval") {
				waitingReason = inbox?.stage ? `Approve stage “${inbox.stage}”` : "Stage awaiting approval";
				waitingSince = session.updatedAt ?? null;
			} else if (state === "failed") {
				waitingReason = "Last turn failed";
				waitingSince = session.updatedAt ?? null;
			} else if (state === "checks-failing") {
				waitingReason = "Pull request checks failing";
				waitingSince = session.updatedAt ?? null;
			}

			if (needsYou) {
				needsYouCount++;
				const waitMs = waitingSince ? Math.max(0, now - waitingSince) : 0;
				if (oldestWaitMs === null || waitMs > oldestWaitMs) {
					oldestWaitMs = waitMs;
					topNeedsYouTitle = session.label;
					topNeedsYouReason = waitingReason;
				}
			}

			const sessionUsage = input.usageReport.sessions[session.id];
			const bp = session.blueprint;
			const latestModel = latestModelBySession.get(session.id);
			const entry: FleetSession = {
				sessionId: session.id,
				title: session.label,
				projectId: session.projectId ?? null,
				projectName: session.projectId ? (projectNames.get(session.projectId) ?? null) : null,
				engine: session.engine ?? "pi",
				provider: latestModel?.provider ?? null,
				model: latestModel?.model ?? null,
				state,
				needsYou,
				waitingReason,
				waitingSince,
				health: healthEval.health,
				healthSince: healthEval.healthSince,
				blueprint: bp && bp.stage ? {
					id: bp.id,
					name: bp.name,
					stageId: bp.stage.id,
					stageName: bp.stage.name,
					stageStatus: bp.stage.status,
					done: bp.done,
					total: bp.total,
				} : null,
				currentTool: runningTool ? { ...runningTool, slow: healthEval.slowTool } : null,
				lastActivityAt,
				startedAt: session.createdAt ?? null,
				tokens: {
					input: sessionUsage?.inputTokens ?? 0,
					output: sessionUsage?.outputTokens ?? 0,
					cost: sessionUsage?.cost ?? 0,
				},
				lane: rootRuns.map(r => ({ t: r.startedAt, cat: r.category, failed: r.status === "error" })),
				recentFailures: rootFailures.slice(-5),
				subagents: keptSubs,
				foldedSubagentsCount,
			};

			const include =
				scope === "all" ||
				(scope === "needs-you" && needsYou) ||
				(scope === "active" && (working || needsYou || mappedSubs.some(s => s.status === "running")));
			if (include) fleetSessions.push(entry);
		}

		// Sort: needs-you first → stalled/slow-tool → working → most recently active.
		const rank = (s: FleetSession) => {
			if (s.needsYou) return 0;
			if (s.health === "stalled" || s.health === "slow-tool") return 1;
			if (s.state === "working" || s.subagents.some(sub => sub.status === "running")) return 2;
			if (s.state === "failed" || s.state === "checks-failing") return 3;
			return 4;
		};
		fleetSessions.sort((a, b) => rank(a) - rank(b) || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));

		const today = input.usageReport.days[input.usageReport.days.length - 1]?.totals;
		return {
			at: now,
			windowMin,
			scope,
			kpis: {
				activeAgents,
				needsYou: needsYouCount,
				oldestWaitMs,
				topNeedsYouTitle,
				topNeedsYouReason,
				toolsPerMin: Math.round((toolsLast5m / 5) * 10) / 10,
				toolsSparkline: sparkBuckets,
				stalledCount,
				slowToolsCount,
				failedCalls: totalFailedCalls,
				tokensToday: (today?.inputTokens ?? 0) + (today?.outputTokens ?? 0),
				costToday: today?.cost ?? 0,
			},
			sessions: fleetSessions,
		};
	}

	sessionTrace(input: {
		session: Conversation;
		projectName: string | null;
		stagesView: SessionStagesView | null;
		turns: Array<{ id: string; status: string; createdAt: number; updatedAt: number; model?: string }>;
		subagents: SubagentSummaryInput[];
		pendingApprovals: Array<{ id: string; summary: string; createdAt: number }>;
		now?: number;
	}): ObservatoryTaskTrace {
		const now = input.now ?? Date.now();
		const toolRuns = this.listSessionToolRuns(input.session.id);

		const stages: TraceStageBand[] = (input.stagesView?.stages ?? []).map(s => ({
			id: s.id,
			name: s.name,
			status: s.status,
			attempt: s.attempt,
			gate: s.gate,
			goldfish: s.goldfish,
			checksOk: s.checks ? s.checks.ok : null,
			reviewerModel: s.review?.model ?? null,
			reviewerIndependent: s.review ? s.review.independent : null,
			startedAt: s.startedAt,
			endedAt: s.endedAt,
		}));

		const spans: TraceSpan[] = [];

		// 1. Tool call spans (fold consecutive sub-second completed calls in the same stage).
		let quickBuffer: StoredToolRun[] = [];
		const flushQuick = () => {
			if (quickBuffer.length === 0) return;
			if (quickBuffer.length === 1) {
				const r = quickBuffer[0];
				const end = r.endedAt ?? now;
				spans.push({
					id: r.id,
					kind: "tool",
					label: r.program ? `${r.program}` : r.toolName,
					stageId: r.stageId,
					category: r.category,
					program: r.program,
					status: r.status,
					exitCode: r.exitCode,
					startedAt: r.startedAt,
					endedAt: end,
					durationMs: Math.max(0, end - r.startedAt),
					live: r.status === "running",
				});
			} else {
				const first = quickBuffer[0];
				const last = quickBuffer[quickBuffer.length - 1];
				const end = last.endedAt ?? last.startedAt;
				const anyErr = quickBuffer.some(r => r.status === "error");
				spans.push({
					id: `folded:${first.id}`,
					kind: "tool",
					label: `${quickBuffer.length} quick tool calls`,
					stageId: first.stageId,
					category: first.category,
					status: anyErr ? "error" : "done",
					startedAt: first.startedAt,
					endedAt: end,
					durationMs: Math.max(0, end - first.startedAt),
					live: false,
					foldedCount: quickBuffer.length,
				});
			}
			quickBuffer = [];
		};

		for (const run of toolRuns) {
			const end = run.endedAt ?? now;
			const dur = Math.max(0, end - run.startedAt);
			const isQuick = run.status === "done" && dur < 1000;
			if (isQuick && (quickBuffer.length === 0 || (quickBuffer[0].stageId === run.stageId && run.startedAt - (quickBuffer[quickBuffer.length - 1].endedAt ?? run.startedAt) < 5_000))) {
				quickBuffer.push(run);
			} else {
				flushQuick();
				if (isQuick) {
					quickBuffer.push(run);
				} else {
					spans.push({
						id: run.id,
						kind: "tool",
						label: run.program ? `${run.program}` : run.toolName,
						stageId: run.stageId,
						category: run.category,
						program: run.program,
						status: run.status,
						exitCode: run.exitCode,
						startedAt: run.startedAt,
						endedAt: end,
						durationMs: dur,
						live: run.status === "running",
					});
				}
			}
		}
		flushQuick();

		// 2. Subagent delegate spans.
		for (const sub of input.subagents) {
			if (!sub.createdAt) continue;
			const live = sub.status === "running";
			const endedAt = live ? now : Math.max(sub.createdAt, sub.updatedAt ?? sub.createdAt);
			const stageMatch = stages.find(s => s.startedAt && sub.createdAt! >= s.startedAt && (!s.endedAt || sub.createdAt! <= s.endedAt));
			spans.push({
				id: `sub:${sub.id}`,
				kind: "subagent",
				label: `${sub.name} (${sub.role})`,
				stageId: stageMatch?.id ?? null,
				model: sub.model,
				status: live ? "running" : sub.status === "failed" || sub.status === "blocked" ? "error" : "done",
				startedAt: sub.createdAt,
				endedAt,
				durationMs: Math.max(0, endedAt - sub.createdAt),
				live,
			});
		}

		// 3. Human wait spans: blueprint stage gates from history + active pending approvals.
		const history = input.stagesView?.history ?? [];
		const waitStartByStage = new Map<string, number>();
		for (const ev of history) {
			if (ev.event === "finished") {
				waitStartByStage.set(ev.stageId, ev.at);
			} else if (ev.event === "approved" || ev.event === "changes_requested") {
				const start = waitStartByStage.get(ev.stageId);
				if (start !== undefined && ev.at > start) {
					spans.push({
						id: `gate:${ev.stageId}:${start}`,
						kind: "wait",
						label: `Gate approval (${ev.stageId})`,
						stageId: ev.stageId,
						status: "done",
						startedAt: start,
						endedAt: ev.at,
						durationMs: ev.at - start,
						live: false,
					});
				}
				waitStartByStage.delete(ev.stageId);
			}
		}
		// Currently waiting stage gate.
		for (const stage of stages) {
			if (stage.status === "awaiting_approval") {
				const start = waitStartByStage.get(stage.id) ?? stage.startedAt ?? input.session.updatedAt ?? now;
				spans.push({
					id: `gate-live:${stage.id}`,
					kind: "wait",
					label: `Waiting for approval (${stage.name})`,
					stageId: stage.id,
					status: "waiting",
					startedAt: start,
					endedAt: now,
					durationMs: Math.max(0, now - start),
					live: true,
				});
			}
		}
		// Currently pending command approvals.
		for (const approval of input.pendingApprovals) {
			spans.push({
				id: `approval:${approval.id}`,
				kind: "wait",
				label: approval.summary,
				stageId: input.stagesView?.summary?.stage?.id ?? null,
				status: "waiting",
				startedAt: approval.createdAt,
				endedAt: now,
				durationMs: Math.max(0, now - approval.createdAt),
				live: true,
			});
		}

		// 4. Turn / model spans (when turns exist, derive model thinking/writing time cleanly).
		let totalTurnMs = 0;
		for (const turn of input.turns) {
			const live = turn.status === "pending";
			const endedAt = live ? now : Math.max(turn.createdAt, turn.updatedAt);
			const dur = Math.max(0, endedAt - turn.createdAt);
			totalTurnMs += dur;
			if (dur > 0) {
				const stageMatch = stages.find(s => s.startedAt && turn.createdAt >= s.startedAt && (!s.endedAt || turn.createdAt <= s.endedAt));
				spans.push({
					id: `turn:${turn.id}`,
					kind: "model",
					label: turn.model ? `Model (${turn.model})` : "Model turn",
					stageId: stageMatch?.id ?? null,
					model: turn.model ?? null,
					status: live ? "running" : turn.status === "failed" || turn.status === "blocked" ? "error" : "done",
					startedAt: turn.createdAt,
					endedAt,
					durationMs: dur,
					live,
				});
			}
		}

		spans.sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt);

		const toolsMs = unionDurationMs(spans.filter(s => s.kind === "tool"));
		const waitingMs = unionDurationMs(spans.filter(s => s.kind === "wait"));
		const delegatingMs = unionDurationMs(spans.filter(s => s.kind === "subagent"));
		const modelMs = Math.max(0, totalTurnMs - toolsMs - waitingMs);

		const startedAt = spans.length ? spans[0].startedAt : (input.session.createdAt ?? null);
		const endedAt = spans.length ? Math.max(...spans.map(s => s.endedAt)) : (input.session.updatedAt ?? null);
		const totalMs = startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : 0;

		// Detect quiet/overnight gaps > 30 minutes where nothing was running.
		const foldedGaps: TraceFoldedGap[] = [];
		let watermark = spans[0]?.endedAt ?? 0;
		for (let i = 1; i < spans.length; i++) {
			const span = spans[i];
			if (span.startedAt - watermark >= IDLE_FOLD_MS) {
				foldedGaps.push({
					startedAt: watermark,
					endedAt: span.startedAt,
					durationMs: span.startedAt - watermark,
				});
			}
			if (span.endedAt > watermark) watermark = span.endedAt;
		}

		return {
			at: now,
			sessionId: input.session.id,
			title: input.session.label,
			projectName: input.projectName,
			blueprintName: input.stagesView?.name ?? null,
			startedAt,
			endedAt,
			totalMs,
			breakdown: { toolsMs, modelMs, waitingMs, delegatingMs },
			stages,
			spans,
			foldedGaps,
		};
	}

	#latestTurnModels(): Map<string, { provider: string | null; model: string }> {
		const map = new Map<string, { provider: string | null; model: string }>();
		const rows = dbAll<{ sessionKey: string; provider: string | null; model: string }>(
			this.#db,
			`SELECT COALESCE(taskId, chatId, mode) AS sessionKey, provider, model
			 FROM turns
			 ORDER BY createdAt ASC`,
		);
		for (const row of rows) {
			if (row.sessionKey) map.set(row.sessionKey, { provider: row.provider, model: row.model });
		}
		return map;
	}

	#runningToolFor(
		sessionId: string,
		conversationId: string,
		runs: StoredToolRun[],
	): { name: string; program: string | null; category: ToolCategory; startedAt: number } | null {
		for (const active of this.#inFlight.values()) {
			if (active.sessionId === sessionId && active.conversationId === conversationId) {
				return { name: active.toolName, program: active.program, category: active.category, startedAt: active.startedAt };
			}
		}
		for (let i = runs.length - 1; i >= 0; i--) {
			const r = runs[i];
			if (r.status === "running" && r.endedAt === null) {
				return { name: r.toolName, program: r.program, category: r.category, startedAt: r.startedAt };
			}
		}
		return null;
	}

	#failuresFrom(runs: StoredToolRun[]): FailedCallSummary[] {
		const out: FailedCallSummary[] = [];
		for (const r of runs) {
			if (r.status !== "error") continue;
			if (isBenignExit(r.program, r.exitCode)) continue;
			out.push({
				id: r.id,
				toolName: r.toolName,
				program: r.program,
				category: r.category,
				exitCode: r.exitCode,
				stageId: r.stageId,
				at: r.endedAt ?? r.startedAt,
				durationMs: r.endedAt !== null ? Math.max(0, r.endedAt - r.startedAt) : null,
			});
		}
		return out;
	}
}

function unionDurationMs(spans: Array<{ startedAt: number; endedAt: number }>): number {
	if (!spans.length) return 0;
	const sorted = [...spans].sort((a, b) => a.startedAt - b.startedAt);
	let total = 0;
	let curStart = sorted[0].startedAt;
	let curEnd = sorted[0].endedAt;
	for (let i = 1; i < sorted.length; i++) {
		const s = sorted[i];
		if (s.startedAt <= curEnd) {
			if (s.endedAt > curEnd) curEnd = s.endedAt;
		} else {
			total += Math.max(0, curEnd - curStart);
			curStart = s.startedAt;
			curEnd = s.endedAt;
		}
	}
	total += Math.max(0, curEnd - curStart);
	return total;
}
