import { z } from "zod";
import {
	ModelProfileIdSchema,
	ModelRefSchema,
	ModelRoleSchema,
	ResolvedModelSchema,
	StageOverridesSchema,
} from "./models.ts";

export const StageExecutorSchema = z.enum([
	"captain",
	"subagent",
	"parallel_subagents",
	"deterministic_hook",
]);

export const ContextIsolationSchema = z.enum(["elephant", "goldfish"]);

export const ApprovalGateModeSchema = z.enum(["never", "before", "after"]);

export const WorkerHarnessSchema = z.enum(["pi", "claude-code", "codex", "opencode"]);

export const BlueprintStageSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	executor: StageExecutorSchema,
	contextIsolation: ContextIsolationSchema,
	requiresSandbox: z.boolean(),
	useCodeMode: z.boolean(),
	allowedToolGroups: z.array(z.string()),
	personaPrompt: z.string().optional(),
	artifactPathPattern: z.string().optional(),
	approvalGate: ApprovalGateModeSchema,
	deterministicChecks: z.array(z.string()).optional(),
	defaultModelRole: ModelRoleSchema,
	modelOverride: ModelRefSchema.optional(),
	workerHarness: WorkerHarnessSchema.optional(),
	maxParallelSubagents: z.number().optional(),
	onChangesRequestedStageId: z.string().optional(),
});

export const FactoryBlueprintSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	bestFor: z.enum(["brownfield", "greenfield", "enterprise", "fast"]),
	constitutionPath: z.string().optional(),
	decisionsLogPath: z.string().optional(),
	microSkillsPath: z.string().optional(),
	stages: z.array(BlueprintStageSchema),
});

export const StageStatusSchema = z.enum([
	"pending",
	"awaiting_approval",
	"running",
	"completed",
	"changes_requested",
	"skipped",
	"failed",
]);

export const StageVerdictFindingSchema = z.object({
	severity: z.enum(["blocker", "major", "minor"]),
	file: z.string().optional(),
	line: z.number().optional(),
	message: z.string(),
});

export const StageVerdictSchema = z.object({
	outcome: z.enum(["pass", "changes_requested", "escalate_human"]),
	summary: z.string(),
	findings: z.array(StageVerdictFindingSchema).optional(),
});

export const StageRunStateSchema = z.object({
	stageId: z.string(),
	status: StageStatusSchema,
	attempt: z.number(),
	startedAt: z.number().optional(),
	endedAt: z.number().optional(),
	resolvedModel: ResolvedModelSchema.optional(),
	sandboxAttached: z.boolean(),
	artifactPaths: z.array(z.string()),
	verdict: StageVerdictSchema.optional(),
	error: z.string().optional(),
});

export const BlueprintRunStatusSchema = z.enum([
	"idle",
	"running",
	"awaiting_human",
	"completed",
	"failed",
	"cancelled",
]);

export const BlueprintRunIssueRefSchema = z.object({
	repository: z.string(),
	number: z.number(),
	title: z.string(),
	url: z.string(),
});

export const BlueprintRunStateSchema = z.object({
	runId: z.string(),
	projectId: z.string(),
	blueprintId: z.string(),
	issueRef: BlueprintRunIssueRefSchema.optional(),
	status: BlueprintRunStatusSchema,
	currentStageIndex: z.number(),
	stages: z.array(StageRunStateSchema),
	disabledStageIds: z.array(z.string()),
	maxAuditLoopbacks: z.number(),
	auditLoopbacksUsed: z.number(),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export const EscalationKindSchema = z.enum([
	"approve_stage",
	"choose_option",
	"spec_conflict",
	"loop_intervention",
	"approve_pr",
]);

export const SubagentEscalationInputSchema = z.object({
	subagentId: z.string(),
	subagentName: z.string(),
	stageId: z.string(),
	kind: z.enum(["question", "spec_conflict", "failure_loop", "completed", "failed"]),
	summary: z.string(),
	options: z.array(z.string()).optional(),
	file: z.string().optional(),
	createdAt: z.number(),
});

const EscalationCardBaseSchema = z.object({
	id: z.string(),
	runId: z.string(),
	stageId: z.string(),
	kind: EscalationKindSchema,
	title: z.string(),
	summary: z.string(),
	options: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
			recommended: z.boolean().optional(),
		}),
	),
	sourceSubagentIds: z.array(z.string()),
	createdAt: z.number(),
});

export const EscalationResolutionSchema = z.object({
	optionId: z.string(),
	note: z.string().optional(),
	resolvedAt: z.number(),
});

export const EscalationCardSchema = z.discriminatedUnion("status", [
	EscalationCardBaseSchema.extend({
		status: z.literal("pending"),
		resolution: z.undefined().optional(),
	}),
	EscalationCardBaseSchema.extend({
		status: z.literal("resolved"),
		resolution: EscalationResolutionSchema,
	}),
]);

export const CaptainEventTypeSchema = z.enum([
	"connected",
	"run.updated",
	"stage.started",
	"stage.completed",
	"stage.awaiting_approval",
	"sandbox.attached",
	"sandbox.detached",
	"escalation.created",
	"escalation.resolved",
	"loop.intervened",
	"pr.published",
]);

export const CaptainEventSchema = z.object({
	type: CaptainEventTypeSchema,
	runId: z.string().optional(),
	payload: z.unknown(),
	timestamp: z.number(),
});

// --- Request schemas ---

export const FactoryRunCreateRequestSchema = z.object({
	runId: z.string().optional(),
	projectId: z.string().optional(),
	blueprintId: z.string().optional(),
	repoPath: z.string().optional(),
	githubRepo: z.string().optional(),
	issueNumber: z.number().finite().optional(),
	issueTitle: z.string().optional(),
	issueBody: z.string().optional(),
	taskPrompt: z.string().optional(),
	baseBranch: z.string().optional(),
	modelProfile: ModelProfileIdSchema.optional(),
	stageOverrides: StageOverridesSchema.optional(),
	euOnlyMode: z.boolean().optional(),
	cloudActFree: z.boolean().optional(),
	disabledStageIds: z.array(z.string()).optional(),
	autoStart: z.boolean().default(false),
});

export const FactorySteerRequestSchema = z.object({
	note: z.string().refine((v) => v.trim().length > 0, { message: 'Field "note" must be a non-empty string.' }),
});

export const FactoryApproveRequestSchema = z.object({
	decision: z.enum(["approve", "request_changes", "cancel"]).default("approve"),
	cardId: z.string().optional(),
	note: z.string().optional(),
});

export const FactoryTakeoverRequestSchema = z.object({
	enable: z.boolean().default(true),
});

export type StageExecutor = z.infer<typeof StageExecutorSchema>;
export type ContextIsolation = z.infer<typeof ContextIsolationSchema>;
export type ApprovalGateMode = z.infer<typeof ApprovalGateModeSchema>;
export type BlueprintStage = z.infer<typeof BlueprintStageSchema>;
export type FactoryBlueprint = z.infer<typeof FactoryBlueprintSchema>;
export type StageStatus = z.infer<typeof StageStatusSchema>;
export type StageVerdict = z.infer<typeof StageVerdictSchema>;
export type StageRunState = z.infer<typeof StageRunStateSchema>;
export type BlueprintRunStatus = z.infer<typeof BlueprintRunStatusSchema>;
export type BlueprintRunState = z.infer<typeof BlueprintRunStateSchema>;
export type EscalationKind = z.infer<typeof EscalationKindSchema>;
export type SubagentEscalationInput = z.infer<typeof SubagentEscalationInputSchema>;
export type EscalationCard = z.infer<typeof EscalationCardSchema>;
export type CaptainEventType = z.infer<typeof CaptainEventTypeSchema>;
export type CaptainEvent = z.infer<typeof CaptainEventSchema>;
export type FactoryRunCreateRequest = z.infer<typeof FactoryRunCreateRequestSchema>;
export type FactorySteerRequest = z.infer<typeof FactorySteerRequestSchema>;
export type FactoryApproveRequest = z.infer<typeof FactoryApproveRequestSchema>;
export type FactoryTakeoverRequest = z.infer<typeof FactoryTakeoverRequestSchema>;
