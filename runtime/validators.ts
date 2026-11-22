import type { ApprovalPolicy } from "./approvals.ts";
import type { McpServerConfig } from "./mcp.ts";
import type { ModelProfileId, ModelRef } from "../packages/protocol/index.ts";

function badInput(message: string): Error {
	return Object.assign(new Error(message), { statusCode: 400 });
}

export function requireString(
	body: Record<string, unknown>,
	field: string,
	opts: { nonEmpty?: boolean; maxLength?: number; message?: string } = {},
): string {
	const value = body[field];
	if (typeof value !== "string") {
		throw badInput(opts.message ?? `Field "${field}" must be a string.`);
	}
	if (opts.nonEmpty && !value.trim()) {
		throw badInput(opts.message ?? `Field "${field}" must be a non-empty string.`);
	}
	if (opts.maxLength !== undefined && value.length > opts.maxLength) {
		throw badInput(opts.message ?? `Field "${field}" exceeds maximum length of ${opts.maxLength}.`);
	}
	return value;
}

export function optionalString(
	body: Record<string, unknown>,
	field: string,
	opts: { maxLength?: number; message?: string } = {},
): string | undefined {
	const value = body[field];
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		throw badInput(opts.message ?? `Field "${field}" must be a string.`);
	}
	if (opts.maxLength !== undefined && value.length > opts.maxLength) {
		throw badInput(opts.message ?? `Field "${field}" exceeds maximum length of ${opts.maxLength}.`);
	}
	return value;
}

export function optionalNullableString(body: Record<string, unknown>, field: string): string | null | undefined {
	const value = body[field];
	if (value === undefined || value === null) return value;
	if (typeof value !== "string") {
		throw badInput(`Field "${field}" must be a string or null.`);
	}
	return value;
}

export function requireBoolean(body: Record<string, unknown>, field: string): boolean {
	const value = body[field];
	if (typeof value !== "boolean") {
		throw badInput(`Field "${field}" must be a boolean.`);
	}
	return value;
}

export function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
	const value = body[field];
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") {
		throw badInput(`Field "${field}" must be a boolean.`);
	}
	return value;
}

export function requireNumber(body: Record<string, unknown>, field: string): number {
	const value = body[field];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw badInput(`Field "${field}" must be a finite number.`);
	}
	return value;
}

export function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
	const value = body[field];
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw badInput(`Field "${field}" must be a finite number.`);
	}
	return value;
}

export function optionalStringArray(body: Record<string, unknown>, field: string): string[] | undefined {
	const value = body[field];
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
		throw badInput(`Field "${field}" must be an array of strings.`);
	}
	return value;
}

export function optionalStringRecord(body: Record<string, unknown>, field: string): Record<string, string> | undefined {
	const value = body[field];
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw badInput(`Field "${field}" must be an object mapping strings to strings.`);
	}
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (typeof v !== "string") {
			throw badInput(`Field "${field}.${k}" must be a string.`);
		}
		out[k] = v;
	}
	return out;
}

export function requireEnum<const T extends readonly string[]>(
	body: Record<string, unknown>,
	field: string,
	allowed: T,
	message?: string,
): T[number] {
	const value = body[field];
	if (typeof value !== "string" || !allowed.includes(value)) {
		throw badInput(message ?? `Field "${field}" must be one of: ${allowed.join(", ")}.`);
	}
	return value as T[number];
}

export function optionalEnum<const T extends readonly string[]>(
	body: Record<string, unknown>,
	field: string,
	allowed: T,
	message?: string,
): T[number] | undefined {
	const value = body[field];
	if (value === undefined) return undefined;
	return requireEnum(body, field, allowed, message);
}

// --- Route Validators ---

export function validateEnvironmentAdd(body: Record<string, unknown>) {
	return {
		...body,
		name: optionalString(body, "name"),
		host: optionalString(body, "host"),
		user: optionalString(body, "user"),
		port: optionalNumber(body, "port"),
		remotePort: optionalNumber(body, "remotePort"),
	};
}

export function validateEnvironmentActivate(body: Record<string, unknown>): { id: string } {
	return { id: requireString(body, "id", { nonEmpty: true }) };
}

export function validateTerminalCreate(body: Record<string, unknown>) {
	return {
		workspace: optionalString(body, "workspace"),
		cols: optionalNumber(body, "cols"),
		rows: optionalNumber(body, "rows"),
	};
}

export function validateTerminalInput(body: Record<string, unknown>): { data: string } {
	return { data: requireString(body, "data") };
}

export function validateTerminalResize(body: Record<string, unknown>) {
	return {
		cols: optionalNumber(body, "cols"),
		rows: optionalNumber(body, "rows"),
	};
}

export function validateOpenIn(body: Record<string, unknown>): {
	app: "cursor" | "vscode" | "windsurf" | "finder";
	path: string | undefined;
} {
	return {
		app: requireEnum(body, "app", ["cursor", "vscode", "windsurf", "finder"] as const, "Unsupported app target."),
		path: optionalString(body, "path"),
	};
}

export function validateProjectClone(body: Record<string, unknown>) {
	return {
		url: requireString(body, "url", { nonEmpty: true }),
		destinationParent: optionalString(body, "destinationParent"),
		folderName: optionalString(body, "folderName"),
	};
}

export function validateProjectInitLocal(body: Record<string, unknown>) {
	return {
		folderPath: requireString(body, "folderPath", { nonEmpty: true, message: "Provide a folder path." }),
		initializeGit: optionalBoolean(body, "initializeGit") ?? true,
	};
}

export function validateProjectDetectGit(body: Record<string, unknown>) {
	return {
		path: requireString(body, "path", { nonEmpty: true, message: "Provide a local folder path." }).trim(),
	};
}

export function validateFactoryRunCreate(body: Record<string, unknown>) {
	let stageOverrides: Record<string, ModelRef> | undefined;
	if (body.stageOverrides !== undefined) {
		if (!body.stageOverrides || typeof body.stageOverrides !== "object" || Array.isArray(body.stageOverrides)) {
			throw badInput('Field "stageOverrides" must be an object.');
		}
		stageOverrides = body.stageOverrides as Record<string, ModelRef>;
	}
	return {
		runId: optionalString(body, "runId"),
		projectId: optionalString(body, "projectId"),
		blueprintId: optionalString(body, "blueprintId"),
		repoPath: optionalString(body, "repoPath"),
		githubRepo: optionalString(body, "githubRepo"),
		issueNumber: optionalNumber(body, "issueNumber"),
		taskPrompt: optionalString(body, "taskPrompt"),
		baseBranch: optionalString(body, "baseBranch"),
		modelProfile: optionalString(body, "modelProfile") as ModelProfileId | undefined,
		stageOverrides,
		euOnlyMode: optionalBoolean(body, "euOnlyMode"),
		cloudActFree: optionalBoolean(body, "cloudActFree"),
		disabledStageIds: optionalStringArray(body, "disabledStageIds"),
		autoStart: optionalBoolean(body, "autoStart") ?? false,
	};
}

export function validateFactoryAction(action: string, body: Record<string, unknown>) {
	if (action === "steer") {
		return { note: requireString(body, "note", { nonEmpty: true }) };
	}
	if (action === "approve") {
		return {
			decision: optionalEnum(body, "decision", ["approve", "request_changes", "cancel"] as const) ?? "approve",
			cardId: optionalString(body, "cardId"),
			note: optionalString(body, "note"),
		};
	}
	if (action === "takeover") {
		return { enable: optionalBoolean(body, "enable") ?? true };
	}
	return {};
}

export function validateArchiveSession(body: Record<string, unknown>) {
	return {
		archived: optionalBoolean(body, "archived") ?? true,
		removeWorktree: optionalBoolean(body, "removeWorktree") ?? false,
	};
}

export function validateArchiveProject(body: Record<string, unknown>) {
	return {
		archived: optionalBoolean(body, "archived") ?? true,
		removeWorktrees: optionalBoolean(body, "removeWorktrees") ?? false,
	};
}

export function validateSessionPrCreate(body: Record<string, unknown>) {
	return {
		title: optionalString(body, "title"),
		body: optionalString(body, "body"),
		draft: optionalBoolean(body, "draft"),
		base: optionalString(body, "base"),
	};
}

export function validateSessionPrMerge(body: Record<string, unknown>) {
	return {
		method: optionalString(body, "method"),
	};
}

export function validateGitHubRepoCreate(body: Record<string, unknown>) {
	return {
		name: requireString(body, "name", { nonEmpty: true }),
		description: optionalString(body, "description") ?? "",
		visibility: optionalEnum(body, "visibility", ["private", "public"] as const) ?? "private",
		addReadme: optionalBoolean(body, "addReadme") ?? true,
	};
}

export function validateGitHubRepoSearch(body: Record<string, unknown>) {
	return {
		login: optionalString(body, "login"),
		query: optionalString(body, "query"),
		page: optionalNumber(body, "page"),
	};
}

export function validateGitHubIssueLookup(body: Record<string, unknown>) {
	return {
		projectId: requireString(body, "projectId", { nonEmpty: true }),
		url: requireString(body, "url", { nonEmpty: true }),
	};
}

export function validateChatThreadCreate(body: Record<string, unknown>) {
	return {
		id: optionalString(body, "id"),
		mode: optionalString(body, "mode"),
		title: optionalString(body, "title"),
	};
}

export function validateRenameTitle(body: Record<string, unknown>): { title: string } {
	return { title: requireString(body, "title") };
}

export function validateSessionMove(body: Record<string, unknown>) {
	return {
		mode: optionalEnum(body, "mode", ["coding", "personal"] as const),
		projectId: optionalNullableString(body, "projectId"),
	};
}

export function validateSendMessage(body: Record<string, unknown>) {
	return {
		id: optionalString(body, "id"),
		content: requireString(body, "content"),
		provider: optionalString(body, "provider"),
		model: optionalString(body, "model"),
		reasoning: optionalString(body, "reasoning"),
	};
}

export function validateProjectSave(body: Record<string, unknown>) {
	if (body.stageOverrides !== undefined && body.stageOverrides !== null) {
		if (typeof body.stageOverrides !== "object" || Array.isArray(body.stageOverrides)) {
			throw badInput('Field "stageOverrides" must be an object.');
		}
	}
	return {
		id: optionalString(body, "id"),
		name: optionalString(body, "name"),
		githubUrl: optionalNullableString(body, "githubUrl"),
		repository: optionalNullableString(body, "repository"),
		blueprintId: optionalString(body, "blueprintId"),
		modelProfile: optionalString(body, "modelProfile"),
		euOnlyMode: optionalBoolean(body, "euOnlyMode"),
		cloudActFree: optionalBoolean(body, "cloudActFree"),
		stageOverrides: body.stageOverrides as Record<string, { provider: string; model: string }> | undefined,
	};
}

export function validateCodingTaskCreate(body: Record<string, unknown>) {
	if (body.initialMessage !== undefined && body.initialMessage !== null) {
		if (typeof body.initialMessage !== "object" || Array.isArray(body.initialMessage)) {
			throw badInput('Field "initialMessage" must be an object.');
		}
	}
	if (body.githubIssue !== undefined && body.githubIssue !== null) {
		if (typeof body.githubIssue !== "object" || Array.isArray(body.githubIssue)) {
			throw badInput('Field "githubIssue" must be an object.');
		}
	}
	return {
		...body,
		id: optionalString(body, "id"),
		title: optionalString(body, "title"),
		repository: optionalString(body, "repository"),
		kind: optionalString(body, "kind"),
		projectId: optionalNullableString(body, "projectId"),
	};
}

export function validateWorktreeInspect(body: Record<string, unknown>) {
	return { repository: requireString(body, "repository", { nonEmpty: true }) };
}

export function validateWorktreeCreate(body: Record<string, unknown>) {
	return {
		id: optionalString(body, "id"),
		repository: optionalString(body, "repository"),
		branch: optionalString(body, "branch"),
		base: optionalString(body, "base"),
	};
}

export function validateCopilotAuth(body: Record<string, unknown>) {
	return { action: optionalString(body, "action") };
}

export function validateModelCredentials(body: Record<string, unknown>) {
	return {
		action: optionalString(body, "action"),
		provider: optionalString(body, "provider"),
		key: optionalString(body, "key"),
		url: optionalString(body, "url"),
		model: optionalString(body, "model"),
	};
}

export function validateProviderTools(body: Record<string, unknown>) {
	return {
		action: optionalString(body, "action"),
		id: optionalString(body, "id"),
		enabled: optionalBoolean(body, "enabled"),
	};
}

export function validateSessionSteer(body: Record<string, unknown>) {
	return {
		content: requireString(body, "content", { nonEmpty: true }),
		mode: optionalEnum(body, "mode", ["steer", "follow-up"] as const) ?? "steer",
	};
}

export function validateSessionCompact(body: Record<string, unknown>) {
	return {
		instructions: optionalString(body, "instructions"),
	};
}

export function validateSubagentMessage(body: Record<string, unknown>) {
	return {
		message: requireString(body, "message", { nonEmpty: true }),
		mode: optionalEnum(body, "mode", ["steer", "follow-up"] as const) ?? "follow-up",
	};
}

export function validateApprovalPolicy(body: Record<string, unknown>): {
	policy: ApprovalPolicy;
	sessionId: string | undefined;
} {
	return {
		policy: requireEnum(
			body,
			"policy",
			["ask", "auto-safe", "auto-all"] as const,
			"Approval policy must be ask, auto-safe, or auto-all.",
		),
		sessionId: optionalString(body, "sessionId"),
	};
}

export function validateApprovalResolve(body: Record<string, unknown>) {
	return {
		allow: requireBoolean(body, "allow"),
		alwaysAllow: optionalBoolean(body, "alwaysAllow"),
		prefix: optionalString(body, "prefix"),
		reason: optionalString(body, "reason"),
	};
}

export function validateProcessInput(body: Record<string, unknown>) {
	return {
		input: requireString(body, "input"),
	};
}

export function validateWorkspaceFileWrite(body: Record<string, unknown>) {
	return {
		sessionId: requireString(body, "sessionId", { nonEmpty: true }),
		path: requireString(body, "path", { nonEmpty: true }),
		content: requireString(body, "content"),
	};
}

export function validateWorkspaceGitPaths(body: Record<string, unknown>) {
	return {
		sessionId: requireString(body, "sessionId", { nonEmpty: true }),
		paths: optionalStringArray(body, "paths") ?? [],
	};
}

export function validateWorkspaceGitDiscard(body: Record<string, unknown>) {
	return {
		sessionId: requireString(body, "sessionId", { nonEmpty: true }),
		path: requireString(body, "path", { nonEmpty: true }),
	};
}

export function validateWorkspaceGitCommit(body: Record<string, unknown>) {
	return {
		sessionId: requireString(body, "sessionId", { nonEmpty: true }),
		message: requireString(body, "message", { nonEmpty: true }),
	};
}

export function validateBrowserUrl(body: Record<string, unknown>) {
	return {
		url: requireString(body, "url", { nonEmpty: true }),
	};
}

export function validateBrowserViewport(body: Record<string, unknown>) {
	return {
		preset: optionalEnum(body, "preset", ["desktop", "tablet", "mobile"] as const) ?? "desktop",
		width: optionalNumber(body, "width"),
		height: optionalNumber(body, "height"),
	};
}

export function validateBrowserInput(body: Record<string, unknown>):
	| {
		kind: "mouse";
		type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
		x: number;
		y: number;
		button: "left" | "right";
		clickCount: number | undefined;
		deltaX: number | undefined;
		deltaY: number | undefined;
	}
	| { kind: "text"; text: string }
	| { kind: "key"; key: string } {
	const kind = requireEnum(body, "kind", ["mouse", "text", "key"] as const);
	if (kind === "mouse") {
		return {
			kind: "mouse",
			type: requireEnum(body, "type", ["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"] as const),
			x: requireNumber(body, "x"),
			y: requireNumber(body, "y"),
			button: optionalEnum(body, "button", ["left", "right"] as const) ?? "left",
			clickCount: optionalNumber(body, "clickCount"),
			deltaX: optionalNumber(body, "deltaX"),
			deltaY: optionalNumber(body, "deltaY"),
		};
	}
	if (kind === "text") {
		return { kind: "text", text: requireString(body, "text") };
	}
	return { kind: "key", key: requireString(body, "key", { nonEmpty: true }) };
}

export function validateArtifactReview(body: Record<string, unknown>) {
	return {
		decision: requireEnum(body, "decision", ["approved", "changes_requested"] as const),
		feedback: optionalString(body, "feedback"),
	};
}

export function validateMcpSave(body: Record<string, unknown>): Partial<McpServerConfig> {
	return {
		id: optionalString(body, "id"),
		name: requireString(body, "name", { nonEmpty: true, maxLength: 80 }),
		transport: optionalEnum(body, "transport", ["stdio", "http"] as const) ?? "stdio",
		command: optionalString(body, "command"),
		args: optionalStringArray(body, "args"),
		env: optionalStringRecord(body, "env"),
		url: optionalString(body, "url"),
		headers: optionalStringRecord(body, "headers"),
		enabled: optionalBoolean(body, "enabled"),
	};
}
