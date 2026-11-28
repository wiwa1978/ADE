import { z } from "zod";

export const PluginCategorySchema = z.enum([
	"observability",
	"collaboration",
	"workflows",
	"cloud-vms",
	"skills-mcp",
	"security",
	"integrations",
	"terminal",
	"mobile",
]);

export const PluginKindSchema = z.enum(["core", "community"]);

export const PluginSkillContributionSchema = z.object({
	name: z.string().min(1).max(80),
	description: z.string().max(300),
	source: z.string().min(1).max(500),
});

export const PluginMcpContributionSchema = z.object({
	id: z.string().min(1).max(64),
	name: z.string().min(1).max(80),
	command: z.string().max(300).optional(),
	args: z.array(z.string().max(200)).max(32).optional(),
	url: z.string().max(500).optional(),
});

export const PluginRecipeContributionSchema = z.object({
	id: z.string().min(1).max(64),
	name: z.string().min(1).max(80),
	description: z.string().max(300),
	prompt: z.string().min(1).max(4000),
	blueprintId: z.string().max(64).optional(),
});

export const PluginSettingFieldSchema = z.object({
	key: z.string().min(1).max(64),
	label: z.string().min(1).max(80),
	description: z.string().max(300).optional(),
	kind: z.enum(["select", "text", "secret", "boolean"]),
	options: z.array(z.object({ value: z.string().max(120), label: z.string().max(120) })).max(64).optional(),
	defaultValue: z.union([z.string(), z.boolean()]).optional(),
	placeholder: z.string().max(120).optional(),
});

export const PluginTerminalProfileSchema = z.object({
	id: z.string().min(1).max(64),
	name: z.string().min(1).max(80),
	description: z.string().max(300).optional(),
	shell: z.string().min(1).max(64),
	args: z.array(z.string().max(64)).max(16).default([]),
	env: z.record(z.string(), z.string().max(300)).optional(),
	detectPath: z.string().max(200).optional(),
	detectCommand: z.string().max(64).optional(),
	installHint: z.string().max(500).optional(),
	settingsFields: z.array(PluginSettingFieldSchema).max(16).optional(),
});

export const PluginNotificationChannelSchema = z.object({
	id: z.string().min(1).max(64),
	name: z.string().min(1).max(80),
	description: z.string().max(300).optional(),
	settingsFields: z.array(PluginSettingFieldSchema).max(16).optional(),
});

export const PluginGuardrailSchema = z.object({
	id: z.string().min(1).max(64),
	name: z.string().min(1).max(80),
	description: z.string().max(300).optional(),
	settingsFields: z.array(PluginSettingFieldSchema).max(16).optional(),
});

export const PluginCapabilitiesSchema = z.object({
	uiModules: z.array(z.string().min(1).max(64)).max(16).optional(),
	skills: z.array(PluginSkillContributionSchema).max(32).optional(),
	mcpServers: z.array(PluginMcpContributionSchema).max(16).optional(),
	recipes: z.array(PluginRecipeContributionSchema).max(32).optional(),
	cloudProviders: z.array(z.string().min(1).max(64)).max(16).optional(),
	terminalProfiles: z.array(PluginTerminalProfileSchema).max(8).optional(),
	notificationChannels: z.array(PluginNotificationChannelSchema).max(8).optional(),
	guardrails: z.array(PluginGuardrailSchema).max(8).optional(),
});

export const AdePluginManifestSchema = z.object({
	id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/, "Plugin ID must be 2-64 lowercase alphanumeric characters, dots, dashes, or underscores."),
	name: z.string().min(1).max(80),
	version: z.string().min(1).max(32),
	description: z.string().min(1).max(400),
	author: z.string().min(1).max(80),
	homepage: z.string().url().optional(),
	repository: z.string().url().optional(),
	license: z.string().max(40).optional(),
	kind: PluginKindSchema.default("community"),
	category: PluginCategorySchema,
	tags: z.array(z.string().min(1).max(32)).max(12).default([]),
	defaultEnabled: z.boolean().default(true),
	capabilities: PluginCapabilitiesSchema.default({}),
});

export const AdeMarketplaceIndexSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/),
	name: z.string().min(1).max(80),
	description: z.string().max(300).default(""),
	homepage: z.string().url().optional(),
	plugins: z.array(AdePluginManifestSchema).max(200),
});

export const PluginToggleRequestSchema = z.object({
	enabled: z.boolean(),
});

export const PluginInstallRequestSchema = z.object({
	pluginId: z.string().min(2).max(64),
	sourceId: z.string().min(1).max(64).optional(),
});

export const MarketplaceSourceAddRequestSchema = z.object({
	name: z.string().min(1).max(80).optional(),
	url: z.string().min(3).max(500),
});

export const PluginSettingsUpdateRequestSchema = z.object({
	values: z.record(z.string(), z.union([z.string().max(300), z.boolean()])),
});

export type PluginCategory = z.infer<typeof PluginCategorySchema>;
export type PluginKind = z.infer<typeof PluginKindSchema>;
export type PluginSettingField = z.infer<typeof PluginSettingFieldSchema>;
export type PluginTerminalProfile = z.infer<typeof PluginTerminalProfileSchema>;
export type PluginCapabilities = z.infer<typeof PluginCapabilitiesSchema>;
export type AdePluginManifest = z.infer<typeof AdePluginManifestSchema>;
export type AdeMarketplaceIndex = z.infer<typeof AdeMarketplaceIndexSchema>;
