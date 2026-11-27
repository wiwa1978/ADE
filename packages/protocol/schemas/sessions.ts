import { z } from "zod";
import { BlueprintRunStatusSchema, StageStatusSchema } from "./factory.ts";
import { GitHubIssueSchema, GitHubIssueSummarySchema } from "./projects.ts";

const nonEmptyTrimmed = (field: string, message?: string) =>
	z.string().refine((v) => v.trim().length > 0, {
		message: message ?? `Field "${field}" must be a non-empty string.`,
	});

export const SessionBlueprintSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	status: BlueprintRunStatusSchema,
	stage: z
		.object({
			id: z.string(),
			name: z.string(),
			status: StageStatusSchema,
			index: z.number(),
		})
		.optional(),
	done: z.number(),
	total: z.number(),
});

export const ConversationMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant", "error"]),
	content: z.string(),
	status: z.enum(["pending", "completed", "failed", "blocked"]),
	createdAt: z.number(),
});

export const ConversationWorkspaceSchema = z.object({
	kind: z.enum(["none", "checkout", "worktree", "existing"]),
	path: z.string().nullable(),
	repository: z.string(),
	branch: z.string().nullable(),
	status: z.enum(["provisioning", "ready", "attention", "archived"]),
	message: z.string().nullable(),
	removed: z.boolean().optional(),
});

export const SessionInteractionModeSchema = z.enum(["chat", "terminal"]);
export type SessionInteractionMode = z.infer<typeof SessionInteractionModeSchema>;

export const TERMINAL_HARNESS_IDS = [
	"claude-code",
	"codex",
	"copilot",
	"opencode",
	"pi-cli",
	"oh-my-pi",
	"gemini",
	"hermes",
	"muse-code",
	"devin",
] as const;

export const TerminalHarnessSchema = z.enum(TERMINAL_HARNESS_IDS);
export type TerminalHarness = z.infer<typeof TerminalHarnessSchema>;

export type HarnessCatalogEntry = {
	id: TerminalHarness;
	name: string;
	command: string;
	description: string;
	modes: readonly SessionInteractionMode[];
};

export const HARNESS_CATALOG: readonly HarnessCatalogEntry[] = [
	{ id: "claude-code", name: "Claude Code", command: "claude", description: "Anthropic's coding agent, using your Claude Code sign-in.", modes: ["chat", "terminal"] },
	{ id: "codex", name: "Codex", command: "codex", description: "OpenAI's coding agent, using your Codex sign-in.", modes: ["chat", "terminal"] },
	{ id: "copilot", name: "GitHub Copilot", command: "copilot", description: "GitHub Copilot CLI, using your GitHub Copilot sign-in.", modes: ["terminal"] },
	{ id: "opencode", name: "OpenCode", command: "opencode", description: "Open-source terminal coding agent with local and EU model support.", modes: ["terminal"] },
	{ id: "pi-cli", name: "Pi CLI", command: "pi", description: "Interactive Pi coding agent TUI.", modes: ["terminal"] },
	{ id: "oh-my-pi", name: "Oh My Pi", command: "omp", description: "Oh My Pi interactive coding harness.", modes: ["terminal"] },
	{ id: "gemini", name: "Gemini CLI", command: "gemini", description: "Google's Gemini interactive coding CLI.", modes: ["terminal"] },
	{ id: "hermes", name: "Hermes", command: "hermes", description: "Hermes interactive coding CLI.", modes: ["terminal"] },
	{ id: "muse-code", name: "Muse Code", command: "muse", description: "Muse Code interactive coding CLI.", modes: ["terminal"] },
	{ id: "devin", name: "Devin CLI", command: "devin", description: "Devin interactive coding CLI.", modes: ["terminal"] },
];

export function harnessEntry(id: TerminalHarness): HarnessCatalogEntry {
	return HARNESS_CATALOG.find(entry => entry.id === id) ?? HARNESS_CATALOG[0];
}

export function harnessLabel(id: TerminalHarness): string {
	return harnessEntry(id).name;
}

export const ConversationSchema = z.object({
	id: z.string(),
	mode: z.enum(["coding", "personal"]),
	label: z.string(),
	environmentId: z.string().optional(),
	chatThread: z.boolean().optional(),
	projectId: z.string().nullable().optional(),
	githubIssue: GitHubIssueSummarySchema.optional(),
	status: z.enum(["working", "idle"]),
	archivedAt: z.number().nullable().optional(),
	createdAt: z.number().nullable().optional(),
	updatedAt: z.number().nullable().optional(),
	lastTurnStatus: z.enum(["pending", "completed", "failed", "blocked"]).nullable().optional(),
	engine: TerminalHarnessSchema.optional(),
	interactionMode: SessionInteractionModeSchema.optional(),
	attemptGroup: z.string().optional(),
	blueprint: SessionBlueprintSummarySchema.optional(),
	workspace: ConversationWorkspaceSchema.optional(),
	messages: z.array(ConversationMessageSchema),
});

export const ArtifactKindSchema = z.enum(["plan", "markdown", "html", "walkthrough", "diff"]);

export const ArtifactStatusSchema = z.enum(["draft", "awaiting_approval", "approved", "changes_requested"]);

export const SessionArtifactSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	title: z.string(),
	kind: ArtifactKindSchema,
	content: z.string(),
	status: ArtifactStatusSchema,
	feedback: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export const SessionTaskItemSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: z.enum(["pending", "in_progress", "done", "blocked"]),
});

// --- Request schemas ---

export const SendMessageRequestSchema = z.object({
	id: z.string().optional(),
	content: z.string(),
	provider: z.string().optional(),
	model: z.string().optional(),
	reasoning: z.string().optional(),
	async: z.boolean().optional(),
});

export const ChatThreadCreateRequestSchema = z.object({
	id: z.string().optional(),
	mode: z.string().optional(),
	title: z.string().optional(),
});

export const RenameTitleRequestSchema = z.object({
	title: z.string(),
});

export const SessionMoveRequestSchema = z.object({
	mode: z.enum(["coding", "personal"]).optional(),
	projectId: z.string().nullable().optional(),
});

export const ArchiveSessionRequestSchema = z.object({
	archived: z.boolean().default(true),
	removeWorktree: z.boolean().default(false),
});

export const StartFromRequestSchema = z.union([
	z.object({ branch: z.string(), pullRequest: z.undefined().optional() }),
	z.object({ pullRequest: z.union([z.number().finite(), z.string()]), branch: z.undefined().optional() }),
]);

export const CodingTaskInitialMessageSchema = z.object({
	id: z.string().optional(),
	content: z.string().optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
	reasoning: z.string().optional(),
});

export const CodingTaskCreateRequestSchema = z.object({
	id: z.string().optional(),
	title: z.string().optional(),
	repository: z.string().optional(),
	kind: z.string().optional(),
	projectId: z.string().nullable().optional(),
	githubIssue: GitHubIssueSchema.partial().nullable().optional(),
	startFrom: StartFromRequestSchema.nullable().optional(),
	attemptGroup: z.string().optional(),
	blueprintId: z.string().optional(),
	initialMessage: CodingTaskInitialMessageSchema.nullable().optional(),
	runOn: z.enum(["local", "docker", "wsl", "ssh", "boat", "cloud"]).optional(),
	dockerImage: z.string().optional(),
	cloudProvider: z.string().max(64).optional(),
	vmSize: z.enum(["small", "medium", "large"]).optional(),
});

export const SessionPrCreateRequestSchema = z.object({
	title: z.string().optional(),
	body: z.string().optional(),
	draft: z.boolean().optional(),
	base: z.string().optional(),
});

export const SessionPrMergeRequestSchema = z.object({
	method: z.string().optional(),
});

export const SessionSteerRequestSchema = z.object({
	content: nonEmptyTrimmed("content"),
	mode: z.enum(["steer", "follow-up"]).default("steer"),
});

export const SessionCompactRequestSchema = z.object({
	instructions: z.string().optional(),
});

export const SubagentMessageRequestSchema = z.object({
	message: nonEmptyTrimmed("message"),
	mode: z.enum(["steer", "follow-up"]).default("follow-up"),
});

export const ArtifactReviewRequestSchema = z.object({
	decision: z.enum(["approved", "changes_requested"]),
	feedback: z.string().optional(),
});

export type SessionBlueprintSummary = z.infer<typeof SessionBlueprintSummarySchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type ConversationWorkspace = z.infer<typeof ConversationWorkspaceSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;
export type SessionArtifact = z.infer<typeof SessionArtifactSchema>;
export type SessionTaskItem = z.infer<typeof SessionTaskItemSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;
export type CodingTaskCreateRequest = z.infer<typeof CodingTaskCreateRequestSchema>;
