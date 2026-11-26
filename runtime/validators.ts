import { z } from "zod";
import {
	ApprovalPolicyRequestSchema,
	ApprovalResolveRequestSchema,
	ApprovalRuleCreateRequestSchema,
	ArchiveProjectRequestSchema,
	ArchiveSessionRequestSchema,
	ArtifactReviewRequestSchema,
	AutomationCreateRequestSchema,
	AutomationUpdateRequestSchema,
	BoatIntegrationRequestSchema,
	BrowserInputRequestSchema,
	BrowserUrlRequestSchema,
	BrowserViewportRequestSchema,
	ChatThreadCreateRequestSchema,
	CheckpointCreateRequestSchema,
	CodingTaskCreateRequestSchema,
	CopilotAuthRequestSchema,
	EnvironmentActivateRequestSchema,
	EnvironmentAddRequestSchema,
	FactoryApproveRequestSchema,
	FactoryRunCreateRequestSchema,
	FactorySteerRequestSchema,
	FactoryTakeoverRequestSchema,
	GitHubIssueLookupRequestSchema,
	GitHubRepoCreateRequestSchema,
	GitHubRepoSearchRequestSchema,
	LimitsRequestSchema,
	LinearIntegrationRequestSchema,
	McpSaveRequestSchema,
	MobileDeviceRenameRequestSchema,
	MobileEnableRequestSchema,
	MobilePairRequestSchema,
	MobileTunnelRequestSchema,
	ModelCredentialsRequestSchema,
	OpenInRequestSchema,
	ProcessInputRequestSchema,
	ProjectCloneRequestSchema,
	ProjectDetectGitRequestSchema,
	ProjectInitLocalRequestSchema,
	ProjectInstructionsWriteRequestSchema,
	ProjectSaveRequestSchema,
	ProjectScriptsRequestSchema,
	ProjectSecretSetRequestSchema,
	ProviderToolsRequestSchema,
	RenameTitleRequestSchema,
	SendMessageRequestSchema,
	SessionBlueprintSwitchRequestSchema,
	SessionCompactRequestSchema,
	SessionEngineRequestSchema,
	SessionMoveRequestSchema,
	SessionPrCreateRequestSchema,
	SessionPrMergeRequestSchema,
	SessionSteerRequestSchema,
	SlackIntegrationRequestSchema,
	StageDecisionRequestSchema,
	SubagentMessageRequestSchema,
	SubagentPolicyRequestSchema,
	TargetSettingsRequestSchema,
	TeamPlanDecisionRequestSchema,
	TeamPostCreateRequestSchema,
	TeamSettingsRequestSchema,
	TerminalCreateRequestSchema,
	TerminalInputRequestSchema,
	TerminalResizeRequestSchema,
	WorkspaceFileWriteRequestSchema,
	WorkspaceGitCommitRequestSchema,
	WorkspaceGitDiscardRequestSchema,
	WorkspaceGitPathsRequestSchema,
	WorktreeCreateRequestSchema,
	WorktreeInspectRequestSchema,
	type ApprovalPolicy,
	type BrowserInputRequest,
} from "@ade/protocol";
import type { McpServerConfig } from "./mcp.ts";
import { badRequest } from "./http-error.ts";

function badInput(message: string): Error {
	return badRequest(message);
}

function formatZodError(error: z.ZodError): string {
	const first = error.issues[0];
	if (!first) return "Invalid request body.";
	const path = first.path.length ? first.path.join(".") : "";
	if (!path || first.message.includes(`"${path}"`)) return first.message;
	return `Field "${path}": ${first.message}`;
}

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
	const result = schema.safeParse(input);
	if (!result.success) {
		throw badInput(formatZodError(result.error));
	}
	return result.data;
}

// --- Environment & Terminal Validators ---

export function validateEnvironmentAdd(body: Record<string, unknown>) {
	return parseWithSchema(EnvironmentAddRequestSchema, body);
}

export function validateEnvironmentActivate(body: Record<string, unknown>): { id: string } {
	return parseWithSchema(EnvironmentActivateRequestSchema, body);
}

export function validateTerminalCreate(body: Record<string, unknown>) {
	const parsed = parseWithSchema(TerminalCreateRequestSchema, body);
	return {
		// The UI sends the folder as `cwd`; `workspace` is accepted too.
		cwd: parsed.cwd ?? parsed.workspace,
		cols: parsed.cols,
		rows: parsed.rows,
		harness: parsed.harness,
		sessionId: parsed.sessionId,
		initialPrompt: parsed.initialPrompt,
	};
}

export function validateTerminalInput(body: Record<string, unknown>): { data: string } {
	return parseWithSchema(TerminalInputRequestSchema, body);
}

export function validateTerminalResize(body: Record<string, unknown>) {
	return parseWithSchema(TerminalResizeRequestSchema, body);
}

export function validateOpenIn(body: Record<string, unknown>): {
	app: "cursor" | "vscode" | "windsurf" | "finder";
	path: string | undefined;
} {
	const parsed = parseWithSchema(OpenInRequestSchema, body);
	return { app: parsed.app, path: parsed.path };
}

// --- Project & GitHub Validators ---

export function validateProjectSave(body: Record<string, unknown>) {
	return parseWithSchema(ProjectSaveRequestSchema, body);
}

export function validateProjectClone(body: Record<string, unknown>) {
	return parseWithSchema(ProjectCloneRequestSchema, body);
}

export function validateProjectInitLocal(body: Record<string, unknown>) {
	return parseWithSchema(ProjectInitLocalRequestSchema, body);
}

export function validateProjectDetectGit(body: Record<string, unknown>) {
	return parseWithSchema(ProjectDetectGitRequestSchema, body);
}

export function validateArchiveProject(body: Record<string, unknown>) {
	return parseWithSchema(ArchiveProjectRequestSchema, body);
}

export function validateGitHubRepoCreate(body: Record<string, unknown>) {
	return parseWithSchema(GitHubRepoCreateRequestSchema, body);
}

export function validateGitHubRepoSearch(body: Record<string, unknown>) {
	return parseWithSchema(GitHubRepoSearchRequestSchema, body);
}

export function validateGitHubIssueLookup(body: Record<string, unknown>) {
	return parseWithSchema(GitHubIssueLookupRequestSchema, body);
}

// --- Factory Validators ---

export function validateFactoryRunCreate(body: Record<string, unknown>) {
	return parseWithSchema(FactoryRunCreateRequestSchema, body);
}

export function validateFactoryAction(
	action: string,
	body: Record<string, unknown>,
): {
	note?: string;
	decision?: "approve" | "request_changes" | "cancel";
	cardId?: string;
	enable?: boolean;
} {
	if (action === "steer") {
		return parseWithSchema(FactorySteerRequestSchema, body);
	}
	if (action === "approve") {
		return parseWithSchema(FactoryApproveRequestSchema, body);
	}
	if (action === "takeover") {
		return parseWithSchema(FactoryTakeoverRequestSchema, body);
	}
	return {};
}

// --- Session & Coding Task Validators ---

export function validateArchiveSession(body: Record<string, unknown>) {
	return parseWithSchema(ArchiveSessionRequestSchema, body);
}

export function validateSessionPrCreate(body: Record<string, unknown>) {
	return parseWithSchema(SessionPrCreateRequestSchema, body);
}

export function validateSessionPrMerge(body: Record<string, unknown>) {
	return parseWithSchema(SessionPrMergeRequestSchema, body);
}

export function validateChatThreadCreate(body: Record<string, unknown>) {
	return parseWithSchema(ChatThreadCreateRequestSchema, body);
}

export function validateRenameTitle(body: Record<string, unknown>): { title: string } {
	return parseWithSchema(RenameTitleRequestSchema, body);
}

export function validateSessionMove(body: Record<string, unknown>) {
	return parseWithSchema(SessionMoveRequestSchema, body);
}

export function validateSendMessage(body: Record<string, unknown>) {
	return parseWithSchema(SendMessageRequestSchema, body);
}

export function validateCodingTaskCreate(body: Record<string, unknown>) {
	const parsed = parseWithSchema(CodingTaskCreateRequestSchema, body);
	return {
		...parsed,
		initialMessage: parsed.initialMessage ?? undefined,
	};
}

export function validateSessionSteer(body: Record<string, unknown>) {
	return parseWithSchema(SessionSteerRequestSchema, body);
}

export function validateSessionCompact(body: Record<string, unknown>) {
	return parseWithSchema(SessionCompactRequestSchema, body);
}

export function validateSubagentMessage(body: Record<string, unknown>) {
	return parseWithSchema(SubagentMessageRequestSchema, body);
}

export function validateArtifactReview(body: Record<string, unknown>) {
	return parseWithSchema(ArtifactReviewRequestSchema, body);
}

// --- Worktree, Workspace, Browser & System Validators ---

export function validateWorktreeInspect(body: Record<string, unknown>) {
	return parseWithSchema(WorktreeInspectRequestSchema, body);
}

export function validateWorktreeCreate(body: Record<string, unknown>) {
	return parseWithSchema(WorktreeCreateRequestSchema, body);
}

export function validateWorkspaceFileWrite(body: Record<string, unknown>) {
	return parseWithSchema(WorkspaceFileWriteRequestSchema, body);
}

export function validateWorkspaceGitPaths(body: Record<string, unknown>) {
	return parseWithSchema(WorkspaceGitPathsRequestSchema, body);
}

export function validateWorkspaceGitDiscard(body: Record<string, unknown>) {
	return parseWithSchema(WorkspaceGitDiscardRequestSchema, body);
}

export function validateWorkspaceGitCommit(body: Record<string, unknown>) {
	return parseWithSchema(WorkspaceGitCommitRequestSchema, body);
}

export function validateCopilotAuth(body: Record<string, unknown>) {
	return parseWithSchema(CopilotAuthRequestSchema, body);
}

export function validateModelCredentials(body: Record<string, unknown>) {
	return parseWithSchema(ModelCredentialsRequestSchema, body);
}

export function validateProviderTools(body: Record<string, unknown>) {
	return parseWithSchema(ProviderToolsRequestSchema, body);
}

export function validateBrowserUrl(body: Record<string, unknown>) {
	return parseWithSchema(BrowserUrlRequestSchema, body);
}

export function validateBrowserViewport(body: Record<string, unknown>) {
	return parseWithSchema(BrowserViewportRequestSchema, body);
}

export function validateBrowserInput(body: Record<string, unknown>): BrowserInputRequest {
	return parseWithSchema(BrowserInputRequestSchema, body);
}

// --- Approval, Process & MCP Validators ---

export function validateApprovalPolicy(body: Record<string, unknown>): {
	policy: ApprovalPolicy;
	sessionId: string | undefined;
} {
	const parsed = parseWithSchema(ApprovalPolicyRequestSchema, body);
	return { policy: parsed.policy, sessionId: parsed.sessionId };
}

export function validateApprovalResolve(body: Record<string, unknown>) {
	return parseWithSchema(ApprovalResolveRequestSchema, body);
}

export function validateApprovalRuleCreate(body: Record<string, unknown>) {
	return parseWithSchema(ApprovalRuleCreateRequestSchema, body);
}

export function validateProcessInput(body: Record<string, unknown>) {
	return parseWithSchema(ProcessInputRequestSchema, body);
}

export function validateMcpSave(body: Record<string, unknown>): Partial<McpServerConfig> {
	return parseWithSchema(McpSaveRequestSchema, body);
}

// --- Agent Workflow, Targets, Integrations & Automations Validators ---

export function validateStageDecision(body: Record<string, unknown>) {
	return parseWithSchema(StageDecisionRequestSchema, body);
}

export function validateSessionBlueprintSwitch(body: Record<string, unknown>) {
	return parseWithSchema(SessionBlueprintSwitchRequestSchema, body);
}

const TeamOverviewRequestSchema = z.object({
	title: z.string().optional(),
	goalTitle: z.string().optional(),
	goalSummary: z.string().optional(),
});

const TeamThreadUpsertRequestSchema = z.object({
	id: z.string().optional(),
	title: z.string().optional(),
	summary: z.string().optional(),
	status: z.enum(["open", "moving", "waiting", "done", "blocked"]).optional(),
	focus: z.string().optional(),
});

const TeamTaskCreateRequestSchema = z.object({
	title: z.string({ message: "A task needs a title." }),
	detail: z.string().optional(),
	owner: z.string().nullable().optional(),
	dependsOn: z.array(z.string()).default([]),
	threadId: z.string().nullable().optional(),
});

export function validateTeamOverview(body: Record<string, unknown>) {
	return parseWithSchema(TeamOverviewRequestSchema, body);
}

export function validateTeamThreadUpsert(body: Record<string, unknown>) {
	return parseWithSchema(TeamThreadUpsertRequestSchema, body);
}

export function validateTeamTaskCreate(body: Record<string, unknown>) {
	return parseWithSchema(TeamTaskCreateRequestSchema, body);
}

export function validateTeamPlanDecision(body: Record<string, unknown>) {
	return parseWithSchema(TeamPlanDecisionRequestSchema, body);
}

export function validateTeamPostCreate(body: Record<string, unknown>) {
	return parseWithSchema(TeamPostCreateRequestSchema, body);
}

export function validateTeamSettings(body: Record<string, unknown>) {
	return parseWithSchema(TeamSettingsRequestSchema, body);
}

export function validateProjectScripts(body: Record<string, unknown>) {
	return parseWithSchema(ProjectScriptsRequestSchema, body);
}

export function validateLimits(body: Record<string, unknown>) {
	return parseWithSchema(LimitsRequestSchema, body);
}

export function validateSubagentPolicy(body: Record<string, unknown>) {
	return parseWithSchema(SubagentPolicyRequestSchema, body);
}

export function validateTargetSettings(body: Record<string, unknown>) {
	return parseWithSchema(TargetSettingsRequestSchema, body);
}

export function validateSlackIntegration(body: Record<string, unknown>) {
	return parseWithSchema(SlackIntegrationRequestSchema, body);
}

export function validateLinearIntegration(body: Record<string, unknown>) {
	return parseWithSchema(LinearIntegrationRequestSchema, body);
}

export function validateBoatIntegration(body: Record<string, unknown>) {
	return parseWithSchema(BoatIntegrationRequestSchema, body);
}

export function validateAutomationCreate(body: Record<string, unknown>) {
	return parseWithSchema(AutomationCreateRequestSchema, body);
}

export function validateAutomationUpdate(body: Record<string, unknown>) {
	return parseWithSchema(AutomationUpdateRequestSchema, body);
}

export function validateProjectSecretSet(body: Record<string, unknown>) {
	return parseWithSchema(ProjectSecretSetRequestSchema, body);
}

export function validateProjectInstructionsWrite(body: Record<string, unknown>) {
	return parseWithSchema(ProjectInstructionsWriteRequestSchema, body);
}

export function validateCheckpointCreate(body: Record<string, unknown>) {
	return parseWithSchema(CheckpointCreateRequestSchema, body);
}

export function validateSessionEngine(body: Record<string, unknown>) {
	return parseWithSchema(SessionEngineRequestSchema, body);
}

// --- Mobile Pairing Validators ---

export function validateMobileEnable(body: Record<string, unknown>) {
	return parseWithSchema(MobileEnableRequestSchema, body);
}

export function validateMobilePair(body: Record<string, unknown>) {
	return parseWithSchema(MobilePairRequestSchema, body);
}

export function validateMobileTunnel(body: Record<string, unknown>) {
	return parseWithSchema(MobileTunnelRequestSchema, body);
}

export function validateMobileDeviceRename(body: Record<string, unknown>) {
	return parseWithSchema(MobileDeviceRenameRequestSchema, body);
}
