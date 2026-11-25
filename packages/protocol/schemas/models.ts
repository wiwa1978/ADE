import { z } from "zod";

export const DeploymentFlavorSchema = z.enum(["local", "remote"]);

export const EndpointRegionSchema = z.enum(["eu", "us", "global", "local"]);

export const CaptainRegionSchema = z.enum(["local", "eu", "global"]);

export const CaptainEndpointConfigSchema = z.object({
	flavor: DeploymentFlavorSchema,
	baseUrl: z.string(),
	wsUrl: z.string().optional(),
	authToken: z.string().optional(),
	region: CaptainRegionSchema.optional(),
});

export const ReasoningLevelSchema = z.enum(["off", "low", "medium", "high"]);

export const ModelRoleSchema = z.enum(["fast", "reasoning", "coding", "adversarial_critic"]);

export const ModelProfileIdSchema = z.enum([
	"balanced",
	"max-quality",
	"budget",
	"eu-only",
	"eu-sovereign",
	"local-ollama",
]);

export const ModelRefSchema = z.object({
	provider: z.string().min(1),
	model: z.string().min(1),
	reasoning: ReasoningLevelSchema.optional(),
	endpointRegion: EndpointRegionSchema.optional(),
});

export const StageOverridesSchema = z.record(z.string(), ModelRefSchema);

export const EuCompliancePolicySchema = z.object({
	euOnlyMode: z.boolean(),
	cloudActFree: z.boolean().optional(),
	allowLocalLoopback: z.boolean().optional(),
	extraAllowedProviders: z.array(z.string()).optional(),
});

export const ModelRoutingConfigSchema = z.object({
	profile: ModelProfileIdSchema,
	appDefault: ModelRefSchema,
	projectOverride: ModelRefSchema.partial().optional(),
	roleDefaults: z.partialRecord(ModelRoleSchema, ModelRefSchema).optional(),
	stageOverrides: StageOverridesSchema.optional(),
	runOverrides: StageOverridesSchema.optional(),
	compliance: EuCompliancePolicySchema,
});

export const ResolvedModelSchema = z.object({
	ref: ModelRefSchema,
	source: z.enum([
		"run-override",
		"stage-override",
		"role-default",
		"project-override",
		"app-default",
	]),
	euCompliant: z.boolean(),
});

export const CopilotSignInSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("idle") }),
	z.object({ status: z.literal("waiting"), code: z.string().optional(), url: z.string().optional() }),
	z.object({ status: z.literal("complete") }),
	z.object({ status: z.literal("failed"), message: z.string().optional() }),
]);

export const ModelCredentialProviderSchema = z.enum(["openai", "anthropic", "radius", "compatible"]);

export const ModelCredentialSchema = z.object({
	provider: ModelCredentialProviderSchema,
	source: z.enum(["saved", "environment", "none"]),
});

export const ModelCatalogItemSchema = z.object({
	id: z.string(),
	name: z.string(),
});

export const ProviderCatalogEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(["cli", "api"]).optional(),
	configured: z.boolean(),
	enabled: z.boolean().optional(),
	defaultModel: z.string(),
	setupMessage: z.string(),
	models: z.array(ModelCatalogItemSchema),
});

export const RuntimeHealthSchema = z.object({
	online: z.boolean(),
	harness: z.string(),
	provider: z.string(),
	configured: z.boolean(),
	defaultModel: z.string(),
	models: z.array(ModelCatalogItemSchema),
	providers: z.array(ModelCatalogItemSchema),
	copilotSignedIn: z.boolean(),
	copilotSignIn: CopilotSignInSchema.optional(),
	message: z.string(),
});

export const ProviderToolSchema = z.object({
	id: z.string(),
	name: z.string(),
	command: z.string().nullable(),
	kind: z.enum(["cli", "api"]),
	install: z.string().nullable(),
	installed: z.boolean(),
	available: z.boolean(),
	modelCount: z.number().nullable(),
	enabled: z.boolean(),
	models: z.array(ModelCatalogItemSchema).optional(),
});

// --- Request schemas ---

export const CopilotAuthRequestSchema = z.object({
	action: z.string().optional(),
});

export const ModelCredentialsRequestSchema = z.object({
	action: z.string().optional(),
	provider: z.string().optional(),
	key: z.string().optional(),
	url: z.string().optional(),
	model: z.string().optional(),
});

export const ProviderToolsRequestSchema = z.object({
	action: z.string().optional(),
	id: z.string().optional(),
	enabled: z.boolean().optional(),
});

export type DeploymentFlavor = z.infer<typeof DeploymentFlavorSchema>;
export type CaptainEndpointConfig = z.infer<typeof CaptainEndpointConfigSchema>;
export type ReasoningLevel = z.infer<typeof ReasoningLevelSchema>;
export type ModelRole = z.infer<typeof ModelRoleSchema>;
export type ModelProfileId = z.infer<typeof ModelProfileIdSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type EuCompliancePolicy = z.infer<typeof EuCompliancePolicySchema>;
export type ModelRoutingConfig = z.infer<typeof ModelRoutingConfigSchema>;
export type ResolvedModel = z.infer<typeof ResolvedModelSchema>;
export type CopilotSignInStateDto = z.infer<typeof CopilotSignInSchema>;
export type ModelCredentialProvider = z.infer<typeof ModelCredentialProviderSchema>;
export type ModelCredential = z.infer<typeof ModelCredentialSchema>;
export type ProviderCatalogEntry = z.infer<typeof ProviderCatalogEntrySchema>;
export type ProviderTool = z.infer<typeof ProviderToolSchema>;
export type CopilotAuthRequest = z.infer<typeof CopilotAuthRequestSchema>;
export type ModelCredentialsRequest = z.infer<typeof ModelCredentialsRequestSchema>;
export type ProviderToolsRequest = z.infer<typeof ProviderToolsRequestSchema>;
