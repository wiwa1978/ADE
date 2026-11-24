import { z } from "zod";
import { ModelProfileIdSchema, ModelRefSchema, StageOverridesSchema } from "./models.ts";

const nonEmptyTrimmed = (field: string, message?: string) =>
	z.string().refine((v) => v.trim().length > 0, {
		message: message ?? `Field "${field}" must be a non-empty string.`,
	});

export const ProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
	githubUrl: z.string().nullable(),
	repository: z.string().nullable(),
	blueprintId: z.string().optional(),
	blueprintLocked: z.boolean().optional(),
	modelProfile: z.string().optional(),
	euOnlyMode: z.boolean().optional(),
	cloudActFree: z.boolean().optional(),
	stageOverrides: z.record(z.string(), z.object({ provider: z.string(), model: z.string() })).optional(),
	archivedAt: z.number().nullable().optional(),
	createdAt: z.number().optional(),
	updatedAt: z.number().optional(),
});

export const ProjectInputSchema = z.object({
	id: z.string(),
	name: z.string(),
	githubUrl: z.string(),
	repository: z.string(),
	blueprintId: z.string().optional(),
	blueprintLocked: z.boolean().optional(),
	modelProfile: z.string().optional(),
	euOnlyMode: z.boolean().optional(),
	cloudActFree: z.boolean().optional(),
	stageOverrides: z.record(z.string(), z.object({ provider: z.string(), model: z.string() })).optional(),
});

export const GitHubConnectionSchema = z.object({
	login: z.string().nullable(),
});

export const GitHubRepositorySchema = z.object({
	fullName: z.string(),
	private: z.boolean(),
});

export const GitHubRepositoryPageSchema = z.object({
	repositories: z.array(GitHubRepositorySchema),
	nextPage: z.number().nullable(),
});

export const GitHubIssueSchema = z.object({
	url: z.string(),
	repository: z.string(),
	number: z.number().int().positive(),
	title: z.string(),
	state: z.enum(["open", "closed"]),
	body: z.string(),
	truncated: z.boolean(),
});

export const GitHubIssueSummarySchema = GitHubIssueSchema.pick({
	url: true,
	repository: true,
	number: true,
	title: true,
	state: true,
});

// --- Request schemas ---

export const ProjectSaveRequestSchema = z.object({
	id: z.string().optional(),
	name: z.string().optional(),
	githubUrl: z.string().nullable().optional(),
	repository: z.string().nullable().optional(),
	blueprintId: z.string().optional(),
	blueprintLocked: z.boolean().optional(),
	modelProfile: ModelProfileIdSchema.optional(),
	euOnlyMode: z.boolean().optional(),
	cloudActFree: z.boolean().optional(),
	stageOverrides: StageOverridesSchema.nullable().optional(),
});

export const ArchiveProjectRequestSchema = z.object({
	archived: z.boolean().default(true),
	removeWorktrees: z.boolean().default(false),
});

export const ProjectCloneRequestSchema = z.object({
	url: nonEmptyTrimmed("url"),
	destinationParent: z.string().optional(),
	folderName: z.string().optional(),
});

export const ProjectInitLocalRequestSchema = z.object({
	folderPath: nonEmptyTrimmed("folderPath", "Provide a folder path."),
	initializeGit: z.boolean().default(true),
});

export const ProjectDetectGitRequestSchema = z.object({
	path: nonEmptyTrimmed("path", "Provide a local folder path.").transform((v) => v.trim()),
});

export const GitHubRepoCreateRequestSchema = z.object({
	name: nonEmptyTrimmed("name"),
	description: z.string().default(""),
	visibility: z.enum(["private", "public"]).default("private"),
	addReadme: z.boolean().default(true),
});

export const GitHubRepoSearchRequestSchema = z.object({
	login: z.string().optional(),
	query: z.string().optional(),
	page: z.number().finite().optional(),
});

export const GitHubIssueLookupRequestSchema = z.object({
	projectId: nonEmptyTrimmed("projectId"),
	url: nonEmptyTrimmed("url"),
});

export const ProjectScriptsRequestSchema = z.object({
	setup: z.string().max(4000).optional(),
	run: z.string().max(4000).optional(),
	copy: z.array(z.string()).max(50).optional(),
	check: z.string().max(4000).optional(),
	checkAutoFix: z.boolean().optional(),
});

export const ProjectSecretSetRequestSchema = z.object({
	name: nonEmptyTrimmed("name"),
	value: z.string().min(1).max(32_768),
});

export const InstructionFileNameSchema = z.enum(["AGENTS.md", "CLAUDE.md"]);

export const ProjectInstructionsWriteRequestSchema = z.object({
	name: InstructionFileNameSchema,
	content: z.string().max(200_000),
});

export { ModelRefSchema };

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectInput = z.infer<typeof ProjectInputSchema>;
export type GitHubConnection = z.infer<typeof GitHubConnectionSchema>;
export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>;
export type GitHubRepositoryPage = z.infer<typeof GitHubRepositoryPageSchema>;
export type GitHubIssue = z.infer<typeof GitHubIssueSchema>;
export type GitHubIssueSummary = z.infer<typeof GitHubIssueSummarySchema>;
export type ProjectSaveRequest = z.infer<typeof ProjectSaveRequestSchema>;
export type ArchiveProjectRequest = z.infer<typeof ArchiveProjectRequestSchema>;
export type ProjectCloneRequest = z.infer<typeof ProjectCloneRequestSchema>;
export type ProjectInitLocalRequest = z.infer<typeof ProjectInitLocalRequestSchema>;
export type ProjectDetectGitRequest = z.infer<typeof ProjectDetectGitRequestSchema>;
export type GitHubRepoCreateRequest = z.infer<typeof GitHubRepoCreateRequestSchema>;
export type GitHubRepoSearchRequest = z.infer<typeof GitHubRepoSearchRequestSchema>;
export type GitHubIssueLookupRequest = z.infer<typeof GitHubIssueLookupRequestSchema>;
export type ProjectScriptsRequest = z.infer<typeof ProjectScriptsRequestSchema>;
export type ProjectSecretSetRequest = z.infer<typeof ProjectSecretSetRequestSchema>;
export type ProjectInstructionsWriteRequest = z.infer<typeof ProjectInstructionsWriteRequestSchema>;
