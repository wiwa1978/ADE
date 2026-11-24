// Blueprints inside sessions. A session's way of working is Vibe (no stages) or a blueprint
// (Spec Kit, OpenSpec, …). For a blueprint, ADE keeps the session's stage progress with the
// stage engine from captain-core, tells the main agent which stage it's in, and records each stage
// when the agent calls finish_stage. Gates wait for the user's Approve / Request changes.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";
import { applyStageApproval, completeStage, createBlueprintRun, planNextStep } from "../packages/captain-core/index.ts";
import { getBlueprint, isSessionBlueprint, VIBE_BLUEPRINT_ID } from "../packages/blueprints/index.ts";
import type { BlueprintRunState, BlueprintStage, FactoryBlueprint, ModelRoutingConfig, SessionBlueprintSummary, StageStatus, StageVerdict } from "../packages/protocol/index.ts";
import { badRequest, conflict, notFound } from "./http-error.ts";
import { checksLine, failureText, type StageChecks } from "./stage-checks.ts";
import { dbGet } from "./db/schema.ts";
import type { RuntimeEventBus } from "./events.ts";

/** What's stored per session, next to the engine's own run state. */
export type SessionStageRecord = {
	run: BlueprintRunState;
	/** The agent's summary per stage (latest attempt). */
	summaries: Record<string, string>;
	/** The user's "Request changes" feedback per stage, until the stage is finished again. */
	feedback?: Record<string, string>;
	/** What ADE's own run of each stage's checks found (latest run). */
	checks?: Record<string, StageChecks>;
	/** What happened, newest last: shown in the Stages view. */
	history: Array<{ at: number; stageId: string; event: "started" | "finished" | "approved" | "changes_requested" | "looped_back" | "escalated" | "checks_passed" | "checks_failed"; note?: string }>;
};

export type StageView = {
	id: string;
	name: string;
	description: string;
	status: StageStatus;
	attempt: number;
	gate: BlueprintStage["approvalGate"];
	executor: BlueprintStage["executor"];
	goldfish: boolean;
	artifactPaths: string[];
	summary: string | null;
	verdict: StageVerdict | null;
	/** ADE's own run of the stage's checks, if it ran any. */
	checks: StageChecks | null;
	startedAt: number | null;
	endedAt: number | null;
};

export type SessionStagesView = {
	blueprintId: string;
	name: string;
	/** Null for Vibe. */
	summary: SessionBlueprintSummary | null;
	stages: StageView[];
	history: SessionStageRecord["history"];
};

type TaskRow = { id: string; projectId: string | null; blueprintId: string | null; blueprintRunJson: string | null; branch: string | null; issueNumber: number | null };

/** Sessions use their own model for every stage (per-stage models come later); the engine only needs a config. */
const MODEL_CONFIG: ModelRoutingConfig = { profile: "balanced", appDefault: { provider: "session", model: "session" }, compliance: { euOnlyMode: false } };

const TERMINAL: StageStatus[] = ["completed", "skipped"];

/** Tools that still work while the agent waits at a gate: looking around and talking to the team. */
const GATE_ALLOWED = new Set(["read", "list_files", "grep_search", "find_files", "read_skill", "finish_stage", "team_read", "team_post", "wait_subagent", "list_subagents"]);

export class SessionBlueprints {
	#db: DatabaseSync;
	#events?: RuntimeEventBus;
	#now: () => number;
	/** Sessions whose agent just stopped at a gate: until the next turn begins, it may only read and talk. */
	#gated = new Set<string>();
	/** Runs a stage's checks in the session's workspace; null when there is nothing to run them in. */
	#checker: ((sessionId: string, stage: BlueprintStage) => Promise<StageChecks | null>) | null = null;

	constructor(db: DatabaseSync, events?: RuntimeEventBus, now: () => number = Date.now) {
		this.#db = db;
		this.#events = events;
		this.#now = now;
	}

	#row(sessionId: string) {
		return dbGet<TaskRow>(this.#db, "SELECT id, projectId, blueprintId, blueprintRunJson, branch, issueNumber FROM coding_tasks WHERE id=?", sessionId);
	}

	#record(row: TaskRow): SessionStageRecord | null {
		// A session created on a blueprint gets its stage state the first time it's needed.
		if (!row.blueprintRunJson && row.blueprintId && row.blueprintId !== VIBE_BLUEPRINT_ID && getBlueprint(row.blueprintId)) return this.begin(row.id, row.blueprintId);
		if (!row.blueprintRunJson) return null;
		try {
			return JSON.parse(row.blueprintRunJson) as SessionStageRecord;
		} catch {
			return null;
		}
	}

	#save(sessionId: string, blueprintId: string, record: SessionStageRecord | null) {
		this.#db.prepare("UPDATE coding_tasks SET blueprintId=?, blueprintRunJson=? WHERE id=?").run(blueprintId, record ? JSON.stringify(record) : null, sessionId);
		this.#events?.emit("stages.update", { sessionId, summary: record ? this.#summary(blueprintId, record) : null }, sessionId);
		this.#events?.emit("sessions.changed", { id: sessionId, reason: "stages" }, sessionId);
	}

	/** Start a session on a way of working (also used to switch: a blueprint starts again at its first stage). */
	begin(sessionId: string, blueprintId: string) {
		const row = this.#row(sessionId);
		if (!row) throw notFound("Session not found.");
		if (blueprintId === VIBE_BLUEPRINT_ID) {
			this.#save(sessionId, VIBE_BLUEPRINT_ID, null);
			return null;
		}
		const blueprint = getBlueprint(blueprintId);
		if (!blueprint) throw badRequest(`Unknown blueprint "${blueprintId}".`);
		const now = this.#now();
		const created = createBlueprintRun({ runId: randomUUID(), projectId: row.projectId ?? "", blueprint, now });
		const { run } = planNextStep(created, blueprint, MODEL_CONFIG, now);
		const record: SessionStageRecord = { run, summaries: {}, history: [] };
		const first = blueprint.stages[run.currentStageIndex];
		if (first) record.history.push({ at: now, stageId: first.id, event: "started" });
		this.#save(sessionId, blueprintId, record);
		return record;
	}

	/** The turn's answer when it ended at a gate (it has no text of its own), or null. */
	gateNote(sessionId: string): string | null {
		if (!this.#gated.has(sessionId)) return null;
		const stage = this.summary(sessionId)?.stage;
		return stage?.status === "awaiting_approval"
			? `Waiting for your approval: ${stage.name}. Approve it, or ask for changes, in the Stages tab.`
			: "Stopped: it needs your decision. See the Stages tab.";
	}

	setChecker(checker: (sessionId: string, stage: BlueprintStage) => Promise<StageChecks | null>) {
		this.#checker = checker;
	}

	/**
	 * finish(), after ADE has run the stage's checks itself: a stage with checks can't finish while one
	 * fails (the agent gets the output and fixes it); passing checks are recorded and noted in the summary.
	 * If the checks can't run at all, the stage isn't blocked.
	 */
	async finishChecked(sessionId: string, input: { stageId: string; summary: string; artifacts?: string[]; verdict?: StageVerdict }): Promise<{ reply: string; waiting: boolean }> {
		const row = this.#row(sessionId);
		const record = row ? this.#record(row) : null;
		const blueprint = row?.blueprintId ? getBlueprint(row.blueprintId) : undefined;
		const stage = blueprint?.stages[record?.run.currentStageIndex ?? -1];
		const running = record && stage && stage.id === input.stageId && (record.run.stages[record.run.currentStageIndex].status === "running");
		if (!row || !record || !stage || !running || !stage.deterministicChecks?.length || !this.#checker) return this.finish(sessionId, input);
		let checks: StageChecks | null = null;
		try {
			checks = await this.#checker(sessionId, stage);
		} catch {
			checks = null;
		}
		if (!checks) return this.finish(sessionId, input);
		// The run may have moved while the checks ran; work on the stored state.
		const fresh = this.#record(this.#row(sessionId)!)!;
		fresh.checks = { ...fresh.checks, [stage.id]: checks };
		const now = this.#now();
		if (checks.results.length) fresh.history.push({ at: now, stageId: stage.id, event: checks.ok ? "checks_passed" : "checks_failed", note: checksLine(checks).slice(0, 300) });
		this.#save(sessionId, row.blueprintId!, fresh);
		if (!checks.ok) return { reply: failureText(stage.name, checks), waiting: false };
		const line = checksLine(checks);
		return this.finish(sessionId, { ...input, summary: `${input.summary.trim()}\n\n${line}`.trim() });
	}

	/** A new turn begins (the user wrote, or decided): the gate stop is over. */
	unlock(sessionId: string) {
		this.#gated.delete(sessionId);
	}

	/**
	 * Why a tool may not run right now: the agent stopped at a gate and must wait for the user. Only
	 * reading and talking to the team pass; anything that changes things is refused for the rest of that turn.
	 */
	gateReason(sessionId: string, toolName: string): string | null {
		if (!this.#gated.has(sessionId) || GATE_ALLOWED.has(toolName)) return null;
		const stage = this.summary(sessionId)?.stage;
		return `Stopped: "${stage?.name ?? "this stage"}" is waiting for the user's approval. End your turn now (a short summary is enough); the user approves or asks for changes in ADE, and you continue after that.`;
	}

	blueprintId(sessionId: string) {
		return this.#row(sessionId)?.blueprintId || VIBE_BLUEPRINT_ID;
	}

	#summary(blueprintId: string, record: SessionStageRecord): SessionBlueprintSummary {
		const blueprint = getBlueprint(blueprintId);
		const stages = blueprint?.stages ?? [];
		const index = record.run.currentStageIndex;
		const current = stages[index];
		return {
			id: blueprintId,
			name: blueprint?.name ?? blueprintId,
			status: record.run.status,
			...(current && record.run.status !== "completed" ? { stage: { id: current.id, name: current.name, status: record.run.stages[index].status, index } } : {}),
			done: record.run.stages.filter(stage => TERMINAL.includes(stage.status)).length,
			total: stages.length,
		};
	}

	/** For the session list: null for Vibe. */
	summary(sessionId: string): SessionBlueprintSummary | null {
		const row = this.#row(sessionId);
		const record = row ? this.#record(row) : null;
		return row && record ? this.#summary(row.blueprintId ?? "", record) : null;
	}

	/** Summary from a row the caller already has (the session list reads all rows at once). */
	summaryOf(row: { id: string; blueprintId: string | null; blueprintRunJson: string | null }): SessionBlueprintSummary | null {
		if (!row.blueprintId || row.blueprintId === VIBE_BLUEPRINT_ID) return null;
		const record = this.#record(row as TaskRow);
		return record && row.blueprintId ? this.#summary(row.blueprintId, record) : null;
	}

	view(sessionId: string): SessionStagesView {
		const row = this.#row(sessionId);
		if (!row) throw notFound("Session not found.");
		const blueprintId = row.blueprintId || VIBE_BLUEPRINT_ID;
		const record = this.#record(row);
		const blueprint = getBlueprint(blueprintId);
		if (!record || !blueprint) return { blueprintId, name: blueprint?.name ?? "Vibe coding", summary: null, stages: [], history: [] };
		return {
			blueprintId,
			name: blueprint.name,
			summary: this.#summary(blueprintId, record),
			stages: blueprint.stages.map((stage, index) => {
				const state = record.run.stages[index];
				return {
					id: stage.id,
					name: stage.name,
					description: stage.description,
					status: state.status,
					attempt: state.attempt,
					gate: stage.approvalGate,
					executor: stage.executor,
					goldfish: stage.contextIsolation === "goldfish",
					artifactPaths: state.artifactPaths.length ? state.artifactPaths : stage.artifactPathPattern ? [this.#artifactPath(stage.artifactPathPattern, row)] : [],
					summary: record.summaries[stage.id] ?? null,
					verdict: state.verdict ?? null,
					checks: record.checks?.[stage.id] ?? null,
					startedAt: state.startedAt ?? null,
					endedAt: state.endedAt ?? null,
				};
			}),
			history: record.history.slice(-50),
		};
	}

	#artifactPath(pattern: string, row: TaskRow) {
		const slug = row.issueNumber ? `issue-${row.issueNumber}` : (row.branch ?? row.id.slice(0, 8)).split("/").pop()!.replace(/[^\w.-]+/g, "-");
		return pattern.replaceAll("{issue}", slug);
	}

	/** Instructions for the main agent: the blueprint, where it is, and what to do in the current stage. */
	instructions(sessionId: string): string | null {
		const row = this.#row(sessionId);
		const record = row ? this.#record(row) : null;
		const blueprint = row?.blueprintId ? getBlueprint(row.blueprintId) : undefined;
		if (!row || !record || !blueprint) return null;
		const lines = [
			`# Way of working: ${blueprint.name}`,
			`This session follows a blueprint: ${blueprint.description} Work through its stages in order and don't skip ahead. The user follows the stages in ADE and approves the gated ones.`,
			"",
			"Stages:",
			...blueprint.stages.map((stage, index) => {
				const state = record.run.stages[index];
				const mark = state.status === "completed" ? "done" : state.status === "skipped" ? "skipped" : index === record.run.currentStageIndex ? state.status === "awaiting_approval" ? "waiting for the user's approval" : "current" : "to do";
				return `${index + 1}. ${stage.name} (${stage.id}) — ${mark}${stage.approvalGate !== "never" ? `; the user approves ${stage.approvalGate === "before" ? "before it starts" : "its result"}` : ""}`;
			}),
			"",
			this.#currentStageText(blueprint, record, row),
		];
		if (blueprint.constitutionPath) lines.push("", `The repository's principles are in ${blueprint.constitutionPath} when it exists; follow them.`);
		if (blueprint.decisionsLogPath) lines.push(`Earlier decisions are logged in ${blueprint.decisionsLogPath} when it exists; read it before deciding.`);
		return lines.join("\n");
	}

	#currentStageText(blueprint: FactoryBlueprint, record: SessionStageRecord, row: TaskRow) {
		const run = record.run;
		if (run.status === "completed") return "All stages are done. Answer questions and make follow-up changes the user asks for; there is no next stage.";
		if (run.status === "cancelled") return "The user stopped the blueprint. Work freely from here.";
		const stage = blueprint.stages[run.currentStageIndex];
		const state = run.stages[run.currentStageIndex];
		if (!stage) return "";
		if (state.status === "awaiting_approval") {
			return `## Waiting for the user: ${stage.name}\n${state.attempt === 0 ? `The user approves before this stage starts.` : `The result of this stage is ready for the user's review.`} Don't start the next stage. Answer questions, and change things only when the user asks; then call finish_stage for "${stage.id}" again so they can review it.`;
		}
		const feedback = record.feedback?.[stage.id];
		return `${stageInstructions(stage, stage.artifactPathPattern ? this.#artifactPath(stage.artifactPathPattern, row) : null)}${feedback ? `\n\nThe user asked for changes to this stage's earlier result:\n${feedback}` : ""}`;
	}

	/**
	 * The agent finished a stage. Returns the reply for the agent: the next stage's instructions,
	 * or "stop and wait" at a gate. Mistakes (wrong stage) are answered, not thrown, so the agent can correct them.
	 */
	finish(sessionId: string, input: { stageId: string; summary: string; artifacts?: string[]; verdict?: StageVerdict }): { reply: string; waiting: boolean } {
		const row = this.#row(sessionId);
		const record = row ? this.#record(row) : null;
		const blueprint = row?.blueprintId ? getBlueprint(row.blueprintId) : undefined;
		if (!row || !record || !blueprint) return { reply: "This session doesn't follow a blueprint; there are no stages to finish.", waiting: false };
		const index = record.run.currentStageIndex;
		const stage = blueprint.stages[index];
		const state = record.run.stages[index];
		if (!stage || record.run.status === "completed") return { reply: "All stages are already done.", waiting: false };
		if (input.stageId !== stage.id) return { reply: `The current stage is "${stage.id}" (${stage.name}), not "${input.stageId}". Finish the current stage first.`, waiting: false };
		if (state.status !== "running" && state.status !== "awaiting_approval") return { reply: `Stage "${stage.id}" isn't running (it's ${state.status}).`, waiting: false };
		if (stage.onChangesRequestedStageId && !input.verdict) {
			return { reply: `Stage "${stage.id}" is a review: call finish_stage again with a verdict (pass, changes_requested or escalate_human) and its findings.`, waiting: false };
		}
		const now = this.#now();
		const summary = input.summary.trim().slice(0, 4000);
		record.summaries[stage.id] = summary;
		if (record.feedback) delete record.feedback[stage.id];
		const result = completeStage(record.run, blueprint, { stageId: stage.id, artifactPaths: (input.artifacts ?? []).slice(0, 20), verdict: input.verdict, now });
		record.run = result.run;
		record.history.push({ at: now, stageId: stage.id, event: "finished", note: summary.slice(0, 300) });
		if (result.loopedBackTo) {
			record.history.push({ at: now, stageId: result.loopedBackTo, event: "looped_back", note: input.verdict?.summary });
			return this.#advance(sessionId, row, blueprint, record, `The review asked for changes. Back to stage "${result.loopedBackTo}" with its findings:\n${formatFindings(input.verdict)}`);
		}
		if (result.requiresHumanEscalation) {
			record.history.push({ at: now, stageId: stage.id, event: "escalated", note: input.verdict?.summary });
			this.#save(sessionId, row.blueprintId!, record);
			this.#gated.add(sessionId);
			return { reply: `Recorded. This needs the user's decision${record.run.auditLoopbacksUsed >= record.run.maxAuditLoopbacks ? " (the review asked for changes again after the allowed number of rounds)" : ""}. Stop here: end your turn by explaining the open findings and what you recommend.`, waiting: true };
		}
		if (record.run.stages[index].status === "awaiting_approval") {
			this.#save(sessionId, row.blueprintId!, record);
			this.#gated.add(sessionId);
			return { reply: `Recorded "${stage.name}". The user reviews it before the next stage. Stop here: end your turn with a short summary of what's ready for review and where to find it. Don't start the next stage.`, waiting: true };
		}
		return this.#advance(sessionId, row, blueprint, record, `Recorded "${stage.name}".`);
	}

	/** Move to the next actionable stage, save, and say what to do. */
	#advance(sessionId: string, row: TaskRow, blueprint: FactoryBlueprint, record: SessionStageRecord, prefix: string): { reply: string; waiting: boolean } {
		const now = this.#now();
		const { run, action } = planNextStep(record.run, blueprint, MODEL_CONFIG, now);
		record.run = run;
		if (action.kind === "execute_stage") record.history.push({ at: now, stageId: action.stage.id, event: "started" });
		this.#save(sessionId, row.blueprintId!, record);
		if (action.kind === "await_approval" || action.kind === "failed") this.#gated.add(sessionId);
		if (action.kind === "completed") return { reply: `${prefix} All stages are done. End your turn with a short final summary: what was built, where the PR or branch is, and anything left for the user.`, waiting: false };
		if (action.kind === "await_approval") return { reply: `${prefix} The next stage, "${action.stage.name}", starts after the user approves it. Stop here and end your turn with a short summary.`, waiting: true };
		if (action.kind === "failed") return { reply: `${prefix} The blueprint can't continue: ${action.reason}. Explain this to the user.`, waiting: true };
		const stage = action.stage;
		return { reply: `${prefix} Continue now with the next stage.\n\n${stageInstructions(stage, stage.artifactPathPattern ? this.#artifactPath(stage.artifactPathPattern, row) : null)}`, waiting: false };
	}

	/**
	 * The user's decision at a gate. Returns the message to send the agent (null when nothing should run).
	 */
	decide(sessionId: string, decision: "approve" | "request_changes", feedback = "") {
		const row = this.#row(sessionId);
		const record = row ? this.#record(row) : null;
		const blueprint = row?.blueprintId ? getBlueprint(row.blueprintId) : undefined;
		if (!row || !record || !blueprint) throw conflict("This session doesn't follow a blueprint.");
		const index = record.run.currentStageIndex;
		const stage = blueprint.stages[index];
		if (!stage || record.run.stages[index].status !== "awaiting_approval") throw conflict("Nothing is waiting for your approval in this session.");
		const now = this.#now();
		const note = feedback.trim().slice(0, 4000);
		if (decision === "request_changes") {
			if (!note) throw badRequest("Say what should change.");
			const beforeStart = record.run.stages[index].attempt === 0 && stage.approvalGate === "before";
			record.run = applyStageApproval(record.run, blueprint, "request_changes", now);
			record.feedback = { ...record.feedback, [stage.id]: note };
			record.history.push({ at: now, stageId: stage.id, event: "changes_requested", note: note.slice(0, 300) });
			if (beforeStart) {
				// Not started yet: the stage keeps waiting for approval; nothing to redo.
				this.#save(sessionId, row.blueprintId!, record);
				return `The user doesn't want "${stage.name}" to start yet:\n${note}\n\nAddress that (answer, adjust your plan), then stop and wait: they approve again when they're satisfied. Don't start the stage.`;
			}
			const { run } = planNextStep(record.run, blueprint, MODEL_CONFIG, now);
			record.run = run;
			record.history.push({ at: now, stageId: stage.id, event: "started" });
			this.#save(sessionId, row.blueprintId!, record);
			return `Changes requested on "${stage.name}":\n${note}\n\nRedo this stage with that feedback, then call finish_stage for "${stage.id}" again.`;
		}
		const wasBefore = record.run.stages[index].attempt === 0;
		record.run = applyStageApproval(record.run, blueprint, "approve", now);
		record.history.push({ at: now, stageId: stage.id, event: "approved", note: note.slice(0, 300) || undefined });
		const { run, action } = planNextStep(record.run, blueprint, MODEL_CONFIG, now);
		record.run = run;
		if (action.kind === "execute_stage") record.history.push({ at: now, stageId: action.stage.id, event: "started" });
		this.#save(sessionId, row.blueprintId!, record);
		const extra = note ? `\nThe user added: ${note}` : "";
		if (action.kind === "completed") return `The user approved "${stage.name}". All stages are done.${extra} Give a short final summary.`;
		if (action.kind !== "execute_stage") return null;
		return `The user approved ${wasBefore ? `starting "${stage.name}"` : `"${stage.name}"`}.${extra} Continue with the stage "${action.stage.name}".\n\n${stageInstructions(action.stage, action.stage.artifactPathPattern ? this.#artifactPath(action.stage.artifactPathPattern, row) : null)}`;
	}

	/** The agent's tool for reporting a finished stage. */
	createExtension(sessionId: string, onWaiting?: (sessionId: string) => void) {
		const finishStage = defineTool({
			name: "finish_stage",
			description: "Record that the current blueprint stage is done, with a summary and the files it produced. ADE answers with the next stage's instructions, or tells you to stop when the user approves next. Review stages also need a verdict.",
			parameters: obj({
				stageId: str({ description: "The current stage's id, e.g. \"specify\"" }),
				summary: str({ description: "What the stage produced or concluded, in a few sentences" }),
				artifacts: opt(arr(str(), { description: "Files the stage wrote, relative to the workspace (spec, plan, report)" })),
				verdict: opt(obj({
					outcome: str({ description: "pass, changes_requested or escalate_human" }),
					summary: str(),
					findings: opt(arr(obj({
						severity: str({ description: "blocker, major or minor" }),
						file: opt(str()),
						message: str(),
					}))),
				})),
			}),
			replay: "safe",
			execute: async (args) => {
				const verdict = args.verdict && ["pass", "changes_requested", "escalate_human"].includes(args.verdict.outcome)
					? {
						outcome: args.verdict.outcome as StageVerdict["outcome"],
						summary: args.verdict.summary,
						findings: (args.verdict.findings ?? []).map(item => ({ severity: (["blocker", "major", "minor"].includes(item.severity) ? item.severity : "minor") as "blocker" | "major" | "minor", ...(item.file ? { file: item.file } : {}), message: item.message })),
					}
					: undefined;
				const result = await this.finishChecked(sessionId, { stageId: args.stageId, summary: args.summary, artifacts: args.artifacts, verdict });
				if (result.waiting) onWaiting?.(sessionId);
				// At a gate the turn ends here, by ADE, not by the agent's good manners.
				return { output: [{ type: "text", text: result.reply }], details: { waiting: result.waiting }, ...(result.waiting ? { control: { terminate: true } } : {}) };
			},
		});
		return defineExtension({ name: "ade-blueprint-stages", tools: [finishStage] });
	}
}

/** The way of working a new session gets: the requested one, else the project's default; the lock wins. */
export function resolveSessionBlueprint(project: { blueprintId?: string | null; blueprintLocked?: boolean | number | null } | null, requested: unknown) {
	const fallback = project?.blueprintId && isSessionBlueprint(project.blueprintId) ? project.blueprintId : VIBE_BLUEPRINT_ID;
	if (requested == null || requested === "") return fallback;
	if (typeof requested !== "string" || !isSessionBlueprint(requested)) throw badRequest("Choose a way of working from the list.");
	if (project?.blueprintLocked && requested !== fallback) throw badRequest("This project's sessions all use its blueprint. Change it in the project's settings.");
	return requested;
}

/** What the agent does in one stage. */
export function stageInstructions(stage: BlueprintStage, artifactPath: string | null) {
	const how: Record<BlueprintStage["executor"], string> = {
		captain: "Do this stage yourself.",
		subagent: `Hand this stage to one subagent (spawn_subagent${stage.workerHarness ? `, harness "${stage.workerHarness}" if it's allowed` : ""}) with a complete brief, wait for its report, and check it.`,
		parallel_subagents: `Split the work into parts that don't touch the same files and give each to its own subagent (spawn_subagent, worktree mode${stage.maxParallelSubagents ? `, at most ${stage.maxParallelSubagents} at once` : ""}). Wait for all reports, bring the work together on this branch, and check it.`,
		deterministic_hook: "Run the checks below and report whether each passed. Fix what fails before finishing, unless the failure needs the user.",
	};
	const lines = [`## Current stage: ${stage.name} (${stage.id})`, stage.description];
	if (stage.personaPrompt) lines.push(stage.personaPrompt);
	lines.push(how[stage.executor]);
	if (stage.contextIsolation === "goldfish") {
		lines.push("This is an independent review: give it to a fresh read-only subagent (spawn_subagent, readonly mode) that hasn't seen this conversation. Brief it only with where the spec or plan is and that it should review this branch's changes against them and the codebase. Don't share your reasoning. Use its findings for the verdict.");
	}
	if (stage.deterministicChecks?.length) lines.push(`Checks: ${stage.deterministicChecks.map(check => `\`${check}\``).join(", ")} (use the project's own commands when these don't exist).`);
	if (artifactPath) lines.push(`Write the stage's result to \`${artifactPath}\` and commit it on this branch.`);
	lines.push(`When the stage is done, call finish_stage with stageId "${stage.id}", a short summary${artifactPath ? " and the files you wrote" : ""}${stage.onChangesRequestedStageId ? ", and a verdict: pass, or changes_requested with the findings" : ""}.${stage.approvalGate === "after" ? " The user reviews the result before the next stage starts." : ""}`);
	return lines.join("\n");
}

function formatFindings(verdict?: StageVerdict) {
	if (!verdict) return "";
	const findings = verdict.findings?.map(item => `- [${item.severity}] ${item.file ? `${item.file}: ` : ""}${item.message}`).join("\n") ?? "";
	return `${verdict.summary}${findings ? `\n${findings}` : ""}`;
}

export { VIBE_BLUEPRINT_ID };
