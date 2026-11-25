import { z } from "zod";
import { PendingApprovalSchema } from "./approvals.ts";
import { CaptainEventSchema } from "./factory.ts";
import {
	SessionArtifactSchema,
	SessionBlueprintSummarySchema,
	SessionTaskItemSchema,
} from "./sessions.ts";
import { ManagedProcessSummarySchema } from "./workspace.ts";

export const RuntimeEventTypeSchema = z.enum([
	"connected",
	"sessions.changed",
	"timeline.update",
	"subagents.update",
	"stages.update",
	"team.update",
	"approval.requested",
	"approval.resolved",
	"processes.update",
	"artifacts.update",
	"tasks.update",
	"browser.update",
	"browser.frame",
	"diff.update",
	"mcp.update",
	"factory.event",
]);

export type RuntimeEventType = z.infer<typeof RuntimeEventTypeSchema>;

export const RuntimeEventPayloadSchemas = {
	connected: z.object({ ok: z.boolean() }),
	"sessions.changed": z.record(z.string(), z.unknown()),
	"timeline.update": z.record(z.string(), z.unknown()),
	"subagents.update": z
		.object({
			sessionId: z.string(),
			subagentId: z.string(),
			busy: z.boolean().optional(),
			queued: z.number().optional(),
			usageWait: z.unknown().optional(),
		})
		.passthrough(),
	"stages.update": z.object({
		sessionId: z.string(),
		summary: SessionBlueprintSummarySchema.nullable(),
	}),
	"team.update": z.object({
		sessionId: z.string(),
		events: z.number(),
		tasks: z.number(),
	}),
	"approval.requested": PendingApprovalSchema,
	"approval.resolved": PendingApprovalSchema.extend({
		allow: z.boolean(),
		reason: z.string().optional(),
	}),
	"processes.update": z.union([
		z.object({ processes: z.array(ManagedProcessSummarySchema) }),
		z.object({
			sessionId: z.string(),
			scripts: z.object({
				setup: z.string(),
				run: z.string(),
				check: z.string(),
			}),
		}),
	]),
	"artifacts.update": z.object({
		sessionId: z.string(),
		artifacts: z.array(SessionArtifactSchema),
		activeArtifactId: z.string().optional(),
	}),
	"tasks.update": z.object({
		sessionId: z.string(),
		tasks: z.array(SessionTaskItemSchema),
	}),
	"browser.update": z.record(z.string(), z.unknown()),
	"browser.frame": z.object({
		frame: z.string(),
		metadata: z.unknown().optional(),
	}),
	"diff.update": z.record(z.string(), z.unknown()),
	"mcp.update": z.object({
		servers: z.array(z.record(z.string(), z.unknown())),
	}),
	"factory.event": CaptainEventSchema,
} as const;

export type RuntimeEventMap = {
	[K in RuntimeEventType]: z.infer<(typeof RuntimeEventPayloadSchemas)[K]>;
};

const eventBase = {
	sessionId: z.string().optional(),
	timestamp: z.number(),
};

export const RuntimeEventSchema = z.discriminatedUnion("type", [
	z.object({ ...eventBase, type: z.literal("connected"), payload: RuntimeEventPayloadSchemas.connected }),
	z.object({ ...eventBase, type: z.literal("sessions.changed"), payload: RuntimeEventPayloadSchemas["sessions.changed"] }),
	z.object({ ...eventBase, type: z.literal("timeline.update"), payload: RuntimeEventPayloadSchemas["timeline.update"] }),
	z.object({ ...eventBase, type: z.literal("subagents.update"), payload: RuntimeEventPayloadSchemas["subagents.update"] }),
	z.object({ ...eventBase, type: z.literal("stages.update"), payload: RuntimeEventPayloadSchemas["stages.update"] }),
	z.object({ ...eventBase, type: z.literal("team.update"), payload: RuntimeEventPayloadSchemas["team.update"] }),
	z.object({ ...eventBase, type: z.literal("approval.requested"), payload: RuntimeEventPayloadSchemas["approval.requested"] }),
	z.object({ ...eventBase, type: z.literal("approval.resolved"), payload: RuntimeEventPayloadSchemas["approval.resolved"] }),
	z.object({ ...eventBase, type: z.literal("processes.update"), payload: RuntimeEventPayloadSchemas["processes.update"] }),
	z.object({ ...eventBase, type: z.literal("artifacts.update"), payload: RuntimeEventPayloadSchemas["artifacts.update"] }),
	z.object({ ...eventBase, type: z.literal("tasks.update"), payload: RuntimeEventPayloadSchemas["tasks.update"] }),
	z.object({ ...eventBase, type: z.literal("browser.update"), payload: RuntimeEventPayloadSchemas["browser.update"] }),
	z.object({ ...eventBase, type: z.literal("browser.frame"), payload: RuntimeEventPayloadSchemas["browser.frame"] }),
	z.object({ ...eventBase, type: z.literal("diff.update"), payload: RuntimeEventPayloadSchemas["diff.update"] }),
	z.object({ ...eventBase, type: z.literal("mcp.update"), payload: RuntimeEventPayloadSchemas["mcp.update"] }),
	z.object({ ...eventBase, type: z.literal("factory.event"), payload: RuntimeEventPayloadSchemas["factory.event"] }),
]);

export type TypedRuntimeEvent<K extends RuntimeEventType = RuntimeEventType> = {
	[P in K]: {
		type: P;
		sessionId?: string;
		payload: RuntimeEventMap[P];
		timestamp: number;
	};
}[K];
