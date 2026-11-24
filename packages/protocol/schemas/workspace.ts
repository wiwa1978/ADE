import { z } from "zod";

const nonEmptyTrimmed = (field: string, message?: string) =>
	z.string().refine((v) => v.trim().length > 0, {
		message: message ?? `Field "${field}" must be a non-empty string.`,
	});

export const ManagedProcessSummarySchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	command: z.string(),
	cwd: z.string(),
	background: z.boolean(),
	status: z.enum(["running", "exited", "killed"]),
	exitCode: z.number().nullable(),
	startedAt: z.number(),
	endedAt: z.number().nullable(),
	outputTail: z.string(),
});

export const WorkspaceEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
	kind: z.enum(["file", "directory"]),
	size: z.number().optional(),
});

export const GitFileChangeSchema = z.object({
	path: z.string(),
	status: z.enum(["modified", "added", "deleted", "renamed", "untracked"]),
	staged: z.boolean(),
	unstaged: z.boolean(),
	additions: z.number(),
	deletions: z.number(),
});

export const WorkspaceGitSummarySchema = z.object({
	isGitRepo: z.boolean(),
	branch: z.string().nullable(),
	ahead: z.number(),
	behind: z.number(),
	additions: z.number(),
	deletions: z.number(),
	files: z.array(GitFileChangeSchema),
});

// --- Request schemas ---

export const WorktreeInspectRequestSchema = z.object({
	repository: nonEmptyTrimmed("repository"),
});

export const WorktreeCreateRequestSchema = z.object({
	id: z.string().optional(),
	repository: z.string().optional(),
	branch: z.string().optional(),
	base: z.string().optional(),
});

export const WorkspaceFileWriteRequestSchema = z.object({
	sessionId: nonEmptyTrimmed("sessionId"),
	path: nonEmptyTrimmed("path"),
	content: z.string(),
});

export const WorkspaceGitPathsRequestSchema = z.object({
	sessionId: nonEmptyTrimmed("sessionId"),
	paths: z.array(z.string()).default([]),
});

export const WorkspaceGitDiscardRequestSchema = z.object({
	sessionId: nonEmptyTrimmed("sessionId"),
	path: nonEmptyTrimmed("path"),
});

export const WorkspaceGitCommitRequestSchema = z.object({
	sessionId: nonEmptyTrimmed("sessionId"),
	message: nonEmptyTrimmed("message"),
});

export const TerminalCreateRequestSchema = z.object({
	cwd: z.string().optional(),
	workspace: z.string().optional(),
	cols: z.number().finite().optional(),
	rows: z.number().finite().optional(),
});

export const TerminalInputRequestSchema = z.object({
	data: z.string(),
});

export const TerminalResizeRequestSchema = z.object({
	cols: z.number().finite().optional(),
	rows: z.number().finite().optional(),
});

export const OpenInRequestSchema = z.object({
	app: z.enum(["cursor", "vscode", "windsurf", "finder"], { message: "Unsupported app target." }),
	path: z.string().optional(),
});

export const BrowserUrlRequestSchema = z.object({
	url: nonEmptyTrimmed("url"),
});

export const BrowserViewportRequestSchema = z.object({
	preset: z.enum(["desktop", "tablet", "mobile"]).default("desktop"),
	width: z.number().finite().optional(),
	height: z.number().finite().optional(),
});

export const BrowserInputRequestSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("mouse"),
		type: z.enum(["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"]),
		x: z.number().finite(),
		y: z.number().finite(),
		button: z.enum(["left", "right"]).default("left"),
		clickCount: z.number().finite().optional(),
		deltaX: z.number().finite().optional(),
		deltaY: z.number().finite().optional(),
	}),
	z.object({
		kind: z.literal("text"),
		text: z.string(),
	}),
	z.object({
		kind: z.literal("key"),
		key: nonEmptyTrimmed("key"),
	}),
]);

export type ManagedProcessSummary = z.infer<typeof ManagedProcessSummarySchema>;
export type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;
export type GitFileChange = z.infer<typeof GitFileChangeSchema>;
export type WorkspaceGitSummary = z.infer<typeof WorkspaceGitSummarySchema>;
export type BrowserInputRequest = z.infer<typeof BrowserInputRequestSchema>;
