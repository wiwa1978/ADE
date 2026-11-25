import { basename } from "node:path";
import { notFound } from "../http-error.ts";
import type { Router } from "../router.ts";
import { discoverSkillsAndRules } from "../skills.ts";
import {
	validateWorkspaceFileWrite,
	validateWorkspaceGitCommit,
	validateWorkspaceGitDiscard,
	validateWorkspaceGitPaths,
	validateWorktreeCreate,
	validateWorktreeInspect,
} from "../validators.ts";
import {
	getWorkspaceFileDiff,
	getWorkspaceGitSummary,
	gitCommitChanges,
	gitDiscardFile,
	gitStageFiles,
	gitUnstageFiles,
	listWorkspaceDirectoryAsync,
	readWorkspaceFileAsync,
	readWorkspaceFileRawAsync,
	writeWorkspaceFileAsync,
} from "../workspace-files.ts";
import { inspectWorktrees } from "../worktrees.ts";
import type { RouteDeps } from "./context.ts";

const INLINE_SAFE_MIME_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/avif",
	"image/x-icon",
]);

function isInlineSafeMedia(mimeType: string): boolean {
	const normalized = mimeType.split(";", 1)[0].trim().toLowerCase();
	if (INLINE_SAFE_MIME_TYPES.has(normalized)) return true;
	return normalized.startsWith("audio/") || normalized.startsWith("video/");
}

function safeDownloadFilename(relPath: string): string {
	const name = basename(relPath).replace(/[\r\n"\\]/g, "_").trim();
	return name || "download";
}

export function registerWorkspaceRoutes(router: Router, { host, worktreeManager }: RouteDeps): void {
	router.get("/api/worktree-operations", (ctx) => {
		ctx.json(200, { operations: worktreeManager.list() });
	});

	router.post(
		"/api/worktrees/inspect",
		async (ctx) => {
			ctx.json(200, { worktrees: await inspectWorktrees(validateWorktreeInspect(await ctx.readBody()).repository) });
		},
		{ originError: "Use ADE to inspect a local repository." },
	);

	router.post(
		"/api/worktrees/create",
		async (ctx) => {
			ctx.json(200, { operation: await worktreeManager.create(validateWorktreeCreate(await ctx.readBody())) });
		},
		{ originError: "Use ADE to create a worktree." },
	);

	const resolveTreeRoot = (ctx: Parameters<Parameters<Router["get"]>[1]>[0]): string => {
		const projectId = ctx.url.searchParams.get("projectId") ?? "";
		if (projectId) {
			const project = host.projects().find((p) => p.id === projectId);
			if (!project) throw notFound("Project not found.");
			if (!project.repository) throw notFound("This project has no local folder configured.");
			return project.repository;
		}
		return ctx.requireWorkspace(ctx.url.searchParams.get("sessionId") ?? "");
	};

	router.get("/api/workspace/tree", async (ctx) => {
		const workspace = resolveTreeRoot(ctx);
		ctx.json(200, { entries: await listWorkspaceDirectoryAsync(workspace, ctx.url.searchParams.get("path") ?? ".") });
	});

	router.get("/api/workspace/file", async (ctx) => {
		const workspace = resolveTreeRoot(ctx);
		ctx.json(200, await readWorkspaceFileAsync(workspace, ctx.url.searchParams.get("path") ?? ""));
	});

	router.get("/api/workspace/raw", async (ctx) => {
		const workspace = resolveTreeRoot(ctx);
		const raw = await readWorkspaceFileRawAsync(workspace, ctx.url.searchParams.get("path") ?? "");
		const inlineSafe = isInlineSafeMedia(raw.mimeType);
		const headers: Record<string, string | number> = {
			"content-type": inlineSafe ? raw.mimeType : "application/octet-stream",
			"content-length": raw.buffer.length,
			"cache-control": "no-cache",
			"content-security-policy": "default-src 'none'; sandbox",
			"x-content-type-options": "nosniff",
		};
		if (!inlineSafe) {
			headers["content-disposition"] = `attachment; filename="${safeDownloadFilename(raw.path)}"`;
		}
		ctx.response.writeHead(200, headers);
		ctx.response.end(raw.buffer);
	});

	router.put(
		"/api/workspace/file",
		async (ctx) => {
			const input = validateWorkspaceFileWrite(await ctx.readBody(2_500_000));
			const workspace = ctx.requireWorkspace(input.sessionId);
			ctx.json(200, await writeWorkspaceFileAsync(workspace, input.path, input.content));
		},
		{ originError: "Use ADE to edit workspace files.", maxBody: 2_500_000 },
	);

	router.get("/api/workspace/git", async (ctx) => {
		const sessionId = ctx.url.searchParams.get("sessionId") ?? "";
		const workspace = host.getWorkspacePath(sessionId);
		if (!workspace) {
			ctx.json(200, { isGitRepo: false, branch: null, ahead: 0, behind: 0, additions: 0, deletions: 0, files: [] });
			return;
		}
		ctx.json(200, await getWorkspaceGitSummary(workspace));
	});

	router.get("/api/workspace/git/diff", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.url.searchParams.get("sessionId") ?? "");
		const diff = await getWorkspaceFileDiff(workspace, ctx.url.searchParams.get("path") ?? "", ctx.url.searchParams.get("staged") === "true");
		ctx.json(200, { diff });
	});

	router.post(
		"/api/workspace/git/stage",
		async (ctx) => {
			const input = validateWorkspaceGitPaths(await ctx.readBody());
			const workspace = ctx.requireWorkspace(input.sessionId);
			await gitStageFiles(workspace, input.paths);
			ctx.json(200, await getWorkspaceGitSummary(workspace));
		},
		{ originError: "Use ADE to stage changes." },
	);

	router.post(
		"/api/workspace/git/unstage",
		async (ctx) => {
			const input = validateWorkspaceGitPaths(await ctx.readBody());
			const workspace = ctx.requireWorkspace(input.sessionId);
			await gitUnstageFiles(workspace, input.paths);
			ctx.json(200, await getWorkspaceGitSummary(workspace));
		},
		{ originError: "Use ADE to unstage changes." },
	);

	router.post(
		"/api/workspace/git/discard",
		async (ctx) => {
			const input = validateWorkspaceGitDiscard(await ctx.readBody());
			const workspace = ctx.requireWorkspace(input.sessionId);
			await gitDiscardFile(workspace, input.path);
			ctx.json(200, await getWorkspaceGitSummary(workspace));
		},
		{ originError: "Use ADE to discard changes." },
	);

	router.post(
		"/api/workspace/git/commit",
		async (ctx) => {
			const input = validateWorkspaceGitCommit(await ctx.readBody());
			const workspace = ctx.requireWorkspace(input.sessionId);
			const commit = await gitCommitChanges(workspace, input.message);
			const summary = await getWorkspaceGitSummary(workspace);
			ctx.json(200, { commit, summary });
		},
		{ originError: "Use ADE to commit changes." },
	);

	router.get("/api/skills", (ctx) => {
		const sessionId = ctx.url.searchParams.get("sessionId") ?? "";
		const workspace = sessionId ? host.getWorkspacePath(sessionId) : null;
		// Only the skills that are on for the session's project (everything is on unless turned off).
		const state = host.capabilities.resolver("skill", sessionId ? host.sessionProjectId(sessionId) : null);
		ctx.json(200, discoverSkillsAndRules(workspace, name => state(name).active));
	});
}
