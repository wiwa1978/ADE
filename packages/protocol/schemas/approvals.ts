import { z } from "zod";

export const ApprovalPolicySchema = z.enum(["ask", "auto-safe", "auto-all"]);

export const ApprovalEffectSchema = z.enum(["allow", "deny"]);

export const PendingApprovalSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	taskId: z.string(),
	signalKey: z.string(),
	toolName: z.string(),
	summary: z.string(),
	command: z.string().optional(),
	arguments: z.record(z.string(), z.unknown()),
	suggestedPrefix: z.string().optional(),
	createdAt: z.number(),
});

export const ApprovalRuleSchema = z.object({
	id: z.string(),
	toolName: z.string(),
	prefix: z.string(),
	createdAt: z.number(),
	effect: ApprovalEffectSchema.optional(),
});

// --- Request schemas ---

export const ApprovalPolicyRequestSchema = z.object({
	policy: z.enum(["ask", "auto-safe", "auto-all"], {
		message: "Approval policy must be ask, auto-safe, or auto-all.",
	}),
	sessionId: z.string().optional(),
});

export const ApprovalResolveRequestSchema = z.object({
	allow: z.boolean(),
	alwaysAllow: z.boolean().optional(),
	prefix: z.string().optional(),
	reason: z.string().optional(),
});

export const ApprovalRuleToolNameSchema = z
	.string()
	.regex(/^(run_command|mcp_[\w.-]{1,120})$/, {
		message: 'Field "toolName" must be "run_command" or a valid MCP tool name.',
	});

export const ApprovalRuleCreateRequestSchema = z.object({
	prefix: z
		.string()
		.transform((v) => v.trim())
		.refine((v) => v.length > 0 && v.length <= 300, {
			message: "Enter a command prefix, like git push or rm -rf.",
		}),
	effect: ApprovalEffectSchema.default("allow"),
	toolName: ApprovalRuleToolNameSchema.default("run_command"),
});

export const ProcessInputRequestSchema = z.object({
	input: z.string(),
});

export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;
export type ApprovalEffect = z.infer<typeof ApprovalEffectSchema>;
export type PendingApproval = z.infer<typeof PendingApprovalSchema>;
export type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;
export type ApprovalPolicyRequest = z.infer<typeof ApprovalPolicyRequestSchema>;
export type ApprovalResolveRequest = z.infer<typeof ApprovalResolveRequestSchema>;
export type ApprovalRuleCreateRequest = z.infer<typeof ApprovalRuleCreateRequestSchema>;
export type ProcessInputRequest = z.infer<typeof ProcessInputRequestSchema>;
