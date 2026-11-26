import { z } from "zod";
import { SubagentHarnessSchema } from "./mcp-targets.ts";
import { TERMINAL_HARNESS_IDS } from "./sessions.ts";

// --- Stages & Blueprints ---

export const StageDecisionRequestSchema = z.object({
	decision: z.enum(["approve", "request_changes"], {
		message: "Approve, or request changes.",
	}),
	feedback: z.string().nullable().optional(),
});

export const SessionBlueprintSwitchRequestSchema = z.object({
	blueprintId: z.string().nullable().optional(),
});

// --- Team Board ---

export const TeamPlanDecisionRequestSchema = z.object({
	decision: z.enum(["approve", "return"], {
		message: "Approve, or return the plan.",
	}),
	note: z.string().nullable().optional(),
});

export const TeamPostCreateRequestSchema = z.object({
	text: z.string({ message: "Write something to post." }),
	to: z.array(z.string()).default([]),
	re: z.number().finite().nullable().optional(),
});

export const TeamSettingsRequestSchema = z.object({
	requirePlans: z.boolean({ message: "Say whether plans need approval." }),
});

// --- Integrations ---

export const SlackEventsSchema = z.object({
	finished: z.boolean().optional(),
	needsApproval: z.boolean().optional(),
	failed: z.boolean().optional(),
	automations: z.boolean().optional(),
});

export const SlackIntegrationRequestSchema = z.object({
	webhook: z.string().optional(),
	events: SlackEventsSchema.optional(),
});

export const LinearIntegrationRequestSchema = z.object({
	apiKey: z.string().min(10, "Paste a Linear personal API key.").max(200),
});

export const BoatIntegrationRequestSchema = z.object({
	apiKey: z.string().min(1, "Paste a Boat.dev API key.").max(250),
});

// --- Automations ---

export const AutomationTriggerSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("schedule"),
		every: z.enum(["hourly", "daily", "weekdays", "weekly"]),
		at: z.string().regex(/^\d{1,2}:\d{2}$/, "Enter a time like 09:00."),
		day: z.number().int().min(0).max(6).optional(),
	}),
	z.object({
		type: z.literal("issue-label"),
		label: z
			.string()
			.transform((v) => v.trim())
			.refine((v) => v.length > 0 && v.length <= 50, {
				message: "Enter the issue label that starts the automation.",
			}),
	}),
]);

export const AutomationCreateRequestSchema = z.object({
	name: z
		.string()
		.transform((v) => v.trim())
		.refine((v) => v.length > 0 && v.length <= 80, { message: "Give the automation a name." }),
	prompt: z
		.string()
		.transform((v) => v.trim())
		.refine((v) => v.length > 0 && v.length <= 6000, {
			message: "Describe what the agent should do (up to 6000 characters).",
		}),
	agent: SubagentHarnessSchema.optional(),
	trigger: AutomationTriggerSchema,
	enabled: z.boolean().default(true),
});

export const AutomationUpdateRequestSchema = z.object({
	name: z.string().max(80).optional(),
	prompt: z.string().max(6000).optional(),
	agent: SubagentHarnessSchema.optional(),
	trigger: AutomationTriggerSchema.optional(),
	enabled: z.boolean().optional(),
});

// --- Checkpoints & Engine ---

export const CheckpointCreateRequestSchema = z.object({
	label: z.string().optional(),
});

export const SessionEngineIdSchema = z.enum(["pi", ...TERMINAL_HARNESS_IDS]);
export type SessionEngineId = z.infer<typeof SessionEngineIdSchema>;

export const SessionEngineRequestSchema = z.object({
	engine: SessionEngineIdSchema,
	interactionMode: z.enum(["chat", "terminal"]).optional(),
});

// --- Mobile Pairing ---

export const MobileAddressModeSchema = z.enum(["lan", "tailscale", "tunnel", "custom"]);

export const MobilePortSchema = z.number().int().min(1).max(65535);

export const MobileEnableRequestSchema = z.object({
	enabled: z.boolean().optional(),
	port: MobilePortSchema.optional(),
	mode: MobileAddressModeSchema.optional(),
	customUrl: z.string().optional(),
});

export const MobilePairRequestSchema = z.object({
	mode: MobileAddressModeSchema.optional(),
	customUrl: z.string().optional(),
});

export const MobileTunnelRequestSchema = z.object({
	action: z.enum(["start", "stop"]).default("start"),
});

export const MobileDeviceRenameRequestSchema = z.object({
	name: z
		.string()
		.transform((v) => v.trim())
		.refine((v) => v.length > 0 && v.length <= 60, {
			message: "Device name must be 1 to 60 characters.",
		}),
});

export type StageDecisionRequest = z.infer<typeof StageDecisionRequestSchema>;
export type SessionBlueprintSwitchRequest = z.infer<typeof SessionBlueprintSwitchRequestSchema>;
export type TeamPlanDecisionRequest = z.infer<typeof TeamPlanDecisionRequestSchema>;
export type TeamPostCreateRequest = z.infer<typeof TeamPostCreateRequestSchema>;
export type TeamSettingsRequest = z.infer<typeof TeamSettingsRequestSchema>;
export type SlackIntegrationRequest = z.infer<typeof SlackIntegrationRequestSchema>;
export type LinearIntegrationRequest = z.infer<typeof LinearIntegrationRequestSchema>;
export type BoatIntegrationRequest = z.infer<typeof BoatIntegrationRequestSchema>;
export type AutomationTriggerDto = z.infer<typeof AutomationTriggerSchema>;
export type AutomationCreateRequest = z.infer<typeof AutomationCreateRequestSchema>;
export type AutomationUpdateRequest = z.infer<typeof AutomationUpdateRequestSchema>;
export type CheckpointCreateRequest = z.infer<typeof CheckpointCreateRequestSchema>;
export type SessionEngineRequest = z.infer<typeof SessionEngineRequestSchema>;
export type MobileAddressModeDto = z.infer<typeof MobileAddressModeSchema>;
export type MobileEnableRequest = z.infer<typeof MobileEnableRequestSchema>;
export type MobilePairRequest = z.infer<typeof MobilePairRequestSchema>;
export type MobileTunnelRequest = z.infer<typeof MobileTunnelRequestSchema>;
export type MobileDeviceRenameRequest = z.infer<typeof MobileDeviceRenameRequestSchema>;
