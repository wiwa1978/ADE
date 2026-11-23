import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { createModels } from "@earendil-works/pi-ai/models";
import type { Harness } from "@earendil-works/pi-durable";
import type { Project as SharedProject } from "../../packages/protocol/index.ts";
import type { TimelineEntryLike } from "../timeline.ts";

const execFileAsync = promisify(execFile);

export const MODES = {
	coding: {
		label: "Coding chat",
		instructions: "You are ADE's coding lead. Help with software engineering requests, architecture, planning, and browser inspection. You can write artifacts (write_artifact), manage checklists (update_tasks), and use browser tools. If a question depends on local repository files not yet connected to a workspace, explain that clearly.",
	},
	personal: {
		label: "Personal chat",
		instructions: "You are ADE's personal agent. Help the user with questions, research, and planning. You can create structured artifacts (write_artifact) and checklists (update_tasks).",
	},
} as const;

export type SessionMode = keyof typeof MODES;

export type ProjectRow = {
	id: string;
	name: string;
	githubUrl: string | null;
	repository: string | null;
	createdAt: number;
	updatedAt: number;
	blueprintId: string | null;
	modelProfile: string | null;
	euOnlyMode: number | null;
	cloudActFree: number | null;
	stageOverridesJson: string | null;
	archivedAt: number | null;
};

export type SerializedProject = SharedProject & {
	blueprintId: string;
	modelProfile: string;
	euOnlyMode: boolean;
	cloudActFree: boolean;
	archivedAt: number | null;
	createdAt: number;
	updatedAt: number;
};

export type CodingTaskRow = {
	id: string;
	title: string;
	repository: string;
	kind: string;
	base: string;
	branch: string | null;
	workspace: string | null;
	status: string;
	message: string | null;
	createdAt: number;
	workspaceDev: string | null;
	workspaceIno: string | null;
	initialTurnId: string | null;
	projectId: string | null;
	initialTitle: string | null;
	issueUrl: string | null;
	issueRepository: string | null;
	issueNumber: number | null;
	issueTitle: string | null;
	issueState: string | null;
	archivedAt: number | null;
	worktreeRemoved: number;
	/** 1 when the session checks out a branch that already existed (started from a branch or pull request). */
	existingBranch: number;
};

export type ChatThreadRow = {
	id: string;
	mode: SessionMode;
	title: string;
	manuallyNamed: number;
	createdAt: number;
	archivedAt: number | null;
};

export type TurnRow = {
	id: string;
	mode: SessionMode;
	content: string;
	provider: string | null;
	model: string;
	reasoning: string;
	status: "pending" | "completed" | "failed" | "blocked";
	answer: string | null;
	error: string | null;
	createdAt: number;
	updatedAt: number;
	taskId: string | null;
	chatId: string | null;
};

export type ModelConfigResult = {
	provider: string;
	defaultModel: string;
	availableModels: { id: string; name: string }[];
	configured: boolean;
	setupMessage: string;
	signedIn?: boolean;
	models: ReturnType<typeof createModels>;
	resolveModel(modelId: string): unknown;
};

export type OpenSession = {
	harness: Harness;
	root: Awaited<ReturnType<Harness["root"]>>;
};

export type WatchHandle = {
	stop(ctx?: typeof context): Promise<unknown> | void;
};

export type ConversationIdParam = Parameters<Harness["conversation"]>[0];

export type WatchViewLike = {
	entries?: readonly TimelineEntryLike[];
	docs?: Record<string, unknown>;
};

export function toConversationId(raw: string | number): ConversationIdParam {
	return (typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw) as ConversationIdParam;
}

/** Readable, unique branch name for a session, e.g. "ade/fix-login-redirect-1a2b3c4d". */
export function sessionBranchName(title: string, id: string): string {
	const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
	return `ade/${slug ? `${slug}-` : ""}${id.replace(/-/g, "").slice(0, 8)}`;
}

export async function detectGitHubRemoteFromCheckout(repoPath: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
			cwd: repoPath,
			timeout: 5000,
			encoding: "utf8",
		});
		const remote = stdout.trim();
		const m = /(?:github\.com[:/])([a-z0-9-]+)\/([a-z0-9_.-]+?)(?:\.git)?$/i.exec(remote);
		return m ? `${m[1]}/${m[2]}` : null;
	} catch {
		return null;
	}
}

export function plainText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: string; text: string } => Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"))
		.map((part) => part.text)
		.join("");
}
