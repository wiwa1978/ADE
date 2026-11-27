import { z } from "zod";

const nonEmptyTrimmed = (field: string, message?: string) =>
	z.string().refine((v) => v.trim().length > 0, {
		message: message ?? `Field "${field}" must be a non-empty string.`,
	});

// --- MCP ---

const McpServerBaseSchema = z.object({
	id: z.string(),
	name: z.string().min(1).max(80),
	enabled: z.boolean(),
});

export const McpServerConfigSchema = z.discriminatedUnion("transport", [
	McpServerBaseSchema.extend({
		transport: z.literal("stdio"),
		command: z.string().min(1),
		args: z.array(z.string()).optional(),
		env: z.record(z.string(), z.string()).optional(),
	}),
	McpServerBaseSchema.extend({
		transport: z.literal("http"),
		url: z.string().min(1),
		headers: z.record(z.string(), z.string()).optional(),
	}),
]);

export const McpSaveRequestSchema = z.object({
	id: z.string().optional(),
	name: nonEmptyTrimmed("name").refine((v) => v.length <= 80, {
		message: 'Field "name" exceeds maximum length of 80.',
	}),
	transport: z.enum(["stdio", "http"]).default("stdio"),
	command: z.string().optional(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
	url: z.string().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	enabled: z.boolean().optional(),
});

// --- Environments ---

export const EnvironmentSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(["local", "ssh"]),
	status: z.enum(["connected", "connecting", "disconnected", "error"]),
	active: z.boolean(),
	sshHost: z.string().optional(),
	sshPort: z.number().optional(),
	remotePort: z.number().optional(),
});

export const EnvironmentDirectorySchema = z.object({
	activeId: z.string(),
	environments: z.array(EnvironmentSummarySchema),
});

export const EnvironmentAddRequestSchema = z.object({
	name: z.string().optional(),
	sshHost: z.string().optional(),
	sshPort: z.number().finite().optional(),
	remotePort: z.number().finite().optional(),
	host: z.string().optional(),
	user: z.string().optional(),
	port: z.number().finite().optional(),
});

export const EnvironmentActivateRequestSchema = z.object({
	id: nonEmptyTrimmed("id"),
});

// --- Execution Targets ---

export const RunTargetSchema = z.enum(["local", "docker", "podman", "wsl", "ssh", "boat", "cloud"]);
export const VmSizeSchema = z.enum(["small", "medium", "large"]);

export const TargetSettingsRequestSchema = z.object({
	target: RunTargetSchema.optional(),
	image: z.string().optional(),
	wslDistro: z.string().optional(),
	sshHost: z.string().optional(),
	remoteRoot: z.string().optional(),
	cloudProvider: z.string().max(64).optional(),
	vmSize: VmSizeSchema.optional(),
	idleSleepMinutes: z.number().finite().min(0).max(24 * 60).optional(),
});

// --- Subagent Policy & Limits ---

export const SubagentHarnessSchema = z.enum(["pi", "claude-code", "codex", "opencode"]);

export const SubagentPolicyRequestSchema = z.object({
	allowed: z.array(SubagentHarnessSchema).optional(),
	choice: z.enum(["agent", "pi", "claude-code", "codex", "opencode"]).optional(),
	piModel: z.string().max(120).optional(),
	claudeModel: z.string().max(120).optional(),
	codexModel: z.string().max(120).optional(),
	opencodeModel: z.string().max(120).optional(),
});

export const LimitsRequestSchema = z.object({
	taskMinutes: z.number().finite().min(0).max(7 * 24 * 60).optional(),
	taskCost: z.number().finite().min(0).max(100_000).optional(),
	dayCost: z.number().finite().min(0).max(100_000).optional(),
	maxSubagents: z.number().finite().min(0).max(64).optional(),
	fallbackProvider: z.string().max(200).optional(),
	fallbackModel: z.string().max(200).optional(),
});

export type McpServerConfigDto = z.infer<typeof McpServerConfigSchema>;
export type McpSaveRequest = z.infer<typeof McpSaveRequestSchema>;
export type EnvironmentSummary = z.infer<typeof EnvironmentSummarySchema>;
export type EnvironmentDirectory = z.infer<typeof EnvironmentDirectorySchema>;
export type EnvironmentAddRequest = z.infer<typeof EnvironmentAddRequestSchema>;
export type RunTargetDto = z.infer<typeof RunTargetSchema>;
export type TargetSettingsRequest = z.infer<typeof TargetSettingsRequestSchema>;
export type SubagentPolicyRequest = z.infer<typeof SubagentPolicyRequestSchema>;
export type LimitsRequest = z.infer<typeof LimitsRequestSchema>;
