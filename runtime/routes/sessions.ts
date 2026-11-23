import { conflict, notFound } from "../http-error.ts";
import type { Router } from "../router.ts";
import {
	validateArchiveSession,
	validateArtifactReview,
	validateChatThreadCreate,
	validateCodingTaskCreate,
	validateRenameTitle,
	validateSendMessage,
	validateSessionCompact,
	validateSessionMove,
	validateSessionPrCreate,
	validateSessionPrMerge,
	validateSessionSteer,
	validateSubagentMessage,
} from "../validators.ts";
import { restoreWorktree } from "../worktrees.ts";
import type { RouteDeps } from "./context.ts";
import { redactForCwd } from "../project-secrets.ts";
import { transcriptMarkdown, type TranscriptItem } from "../../packages/protocol/transcript.ts";
import { RUN_TARGETS, type RunTarget } from "../execution-targets.ts";
import { getWorkspaceGitSummary, listWorkspaceFilesFlat } from "../workspace-files.ts";

export function registerSessionRoutes(
	router: Router,
	{ host, worktreeManager, sessionGit, cleanUpArchivedWorkspace, engines, inbox, viewSessions, prepareWorktree, sendToAgent, executionTargets, subagentKey, scheduler, usageWaiter }: RouteDeps,
): void {
	router.get("/api/sessions", (ctx) => {
		ctx.json(200, { sessions: viewSessions() });
	});

	router.post(
		"/api/sessions/:id/archive",
		async (ctx) => {
			const input = validateArchiveSession(await ctx.readBody());
			const sessionId = ctx.params.id;
			const removed = input.archived ? null : host.removedWorktree(sessionId);
			if (removed && worktreeManager?.root) {
				await restoreWorktree({ ...removed, allowedRoot: worktreeManager.root });
				host.markWorktreeRestored(sessionId);
			}
			const result = await host.setSessionArchived(sessionId, input.archived);
			const cleanup = input.archived
				? await cleanUpArchivedWorkspace(result, input.removeWorktree)
				: { terminalsClosed: 0, worktreeRemoved: false };
			ctx.json(200, { ...result, ...cleanup });
		},
		{ originError: "Use ADE to archive sessions." },
	);

	// --- Session branch, push and pull requests ---
	router.get("/api/sessions/:id/branch", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		// ?fetch=1 refreshes the base branch first so "behind main" is current.
		if (ctx.url.searchParams.get("fetch") === "1") await sessionGit.fetchBase(workspace);
		ctx.json(200, await sessionGit.status(workspace, host.getWorkspaceBase(ctx.params.id)));
	});

	router.post(
		"/api/sessions/:id/branch/update",
		async (ctx) => {
			const workspace = ctx.requireWorkspace(ctx.params.id);
			await ctx.readBody();
			if (viewSessions().find(session => session.id === ctx.params.id)?.status === "working") throw conflict("Wait for the agent to finish before updating the branch.");
			const update = await sessionGit.updateFromBase(workspace);
			inbox.invalidate(ctx.params.id);
			ctx.json(200, { ...update, status: await sessionGit.status(workspace, host.getWorkspaceBase(ctx.params.id)) });
		},
		{ originError: "Use ADE to change the branch or pull request." },
	);

	router.post(
		"/api/sessions/:id/branch/finish-update",
		async (ctx) => {
			const workspace = ctx.requireWorkspace(ctx.params.id);
			await ctx.readBody();
			await sessionGit.finishMerge(workspace);
			inbox.invalidate(ctx.params.id);
			ctx.json(200, { status: await sessionGit.status(workspace, host.getWorkspaceBase(ctx.params.id)) });
		},
		{ originError: "Use ADE to change the branch or pull request." },
	);

	router.post(
		"/api/sessions/:id/branch/abort-update",
		async (ctx) => {
			const workspace = ctx.requireWorkspace(ctx.params.id);
			await ctx.readBody();
			await sessionGit.abortMerge(workspace);
			inbox.invalidate(ctx.params.id);
			ctx.json(200, { status: await sessionGit.status(workspace, host.getWorkspaceBase(ctx.params.id)) });
		},
		{ originError: "Use ADE to change the branch or pull request." },
	);

	router.get("/api/sessions/:id/pr/feedback", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		ctx.json(200, { feedback: await sessionGit.reviewFeedback(workspace) });
	});

	router.get("/api/sessions/:id/pr/failed-runs", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		ctx.json(200, { runs: await sessionGit.failedRuns(workspace) });
	});

	router.get("/api/sessions/:id/branch-diff", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		ctx.json(200, await sessionGit.branchDiffFiles(workspace, host.getWorkspaceBase(ctx.params.id)));
	});

	router.get("/api/sessions/:id/branch-diff/file", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		ctx.json(200, { diff: await sessionGit.branchDiffFile(workspace, host.getWorkspaceBase(ctx.params.id), ctx.url.searchParams.get("path") ?? "") });
	});

	router.get("/api/sessions/:id/pr", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		ctx.json(200, { pullRequest: await sessionGit.pullRequest(workspace) });
	});

	router.post(
		"/api/sessions/:id/push",
		async (ctx) => {
			const workspace = ctx.requireWorkspace(ctx.params.id);
			await ctx.readBody();
			const base = host.getWorkspaceBase(ctx.params.id);
			ctx.json(200, { ...(await sessionGit.push(workspace)), status: await sessionGit.status(workspace, base) });
		},
		{ originError: "Use ADE to change the branch or pull request." },
	);

	router.post(
		"/api/sessions/:id/pr",
		async (ctx) => {
			const workspace = ctx.requireWorkspace(ctx.params.id);
			const input = validateSessionPrCreate(await ctx.readBody());
			ctx.json(200, { pullRequest: await sessionGit.createPullRequest(workspace, input) });
		},
		{ originError: "Use ADE to change the branch or pull request." },
	);

	router.post(
		"/api/sessions/:id/pr/ready",
		async (ctx) => {
			const workspace = ctx.requireWorkspace(ctx.params.id);
			await ctx.readBody();
			ctx.json(200, { pullRequest: await sessionGit.markReady(workspace) });
		},
		{ originError: "Use ADE to change the branch or pull request." },
	);

	router.post(
		"/api/sessions/:id/pr/merge",
		async (ctx) => {
			const workspace = ctx.requireWorkspace(ctx.params.id);
			const input = validateSessionPrMerge(await ctx.readBody());
			ctx.json(200, { pullRequest: await sessionGit.merge(workspace, input.method) });
		},
		{ originError: "Use ADE to change the branch or pull request." },
	);

	// --- Chat threads & coding tasks ---
	router.post(
		"/api/chat-threads",
		async (ctx) => {
			ctx.json(200, { session: host.createChatThread(validateChatThreadCreate(await ctx.readBody())) });
		},
		{ originError: "Use ADE to create a chat." },
	);

	router.patch(
		"/api/chat-threads/:id([0-9a-f-]{36})",
		async (ctx) => {
			ctx.json(200, { session: host.renameChatThread(ctx.params.id, validateRenameTitle(await ctx.readBody()).title) });
		},
		{ originError: "Use ADE to rename a chat." },
	);

	router.delete(
		"/api/chat-threads/:id([0-9a-f-]{36})",
		(ctx) => {
			ctx.json(200, host.deleteChatThread(ctx.params.id));
		},
		{ originError: "Use ADE to delete a chat." },
	);

	router.post(
		"/api/chat-threads/:id([0-9a-f-]{36})/messages",
		async (ctx) => {
			const input = validateSendMessage(await ctx.readBody());
			const session = host.sessions().find(item => item.id === ctx.params.id);
			if (!session?.chatThread) throw notFound("Chat not found.");
			ctx.json(200, { session: await host.send(session.mode, input, null, ctx.params.id) });
		},
		{ originError: "Use ADE to send a chat message." },
	);

	router.get("/api/coding-tasks/:id([0-9a-f-]+)/agents", async (ctx) => {
		const agents = await host.featureAgents(ctx.params.id);
		// Claude Code / Codex subagents: their progress lives in the CLI run, not in Pi's transcript.
		ctx.json(200, { agents: agents.map(agent => {
			if (!agent.harness || agent.harness === "pi") return agent;
			const key = subagentKey(ctx.params.id, String(agent.id));
			const run = engines.get(key);
			if (!run) return agent;
			const snapshot = engines.snapshot(key);
			const working = engines.isWorking(key);
			const queued = scheduler.position(key);
			const usageWait = usageWaiter.waiting(key);
			return {
				...agent,
				status: working ? "running" : queued || usageWait ? "waiting" : run.lastStatus === "failed" ? "failed" : run.lastStatus === "completed" ? "completed" : "waiting",
				...(queued ? { queuePosition: queued } : {}),
				...(usageWait ? { usageWaitUntil: usageWait.until } : {}),
				model: run.engine === "claude-code" ? "Claude Code" : "Codex",
				timeline: snapshot.items,
				messages: snapshot.items.flatMap((item): Array<{ id: string; role: "user" | "assistant"; content: string }> => item.kind === "user" ? [{ id: item.id, role: "user", content: item.content }] : item.kind === "assistant" && item.text ? [{ id: item.id, role: "assistant", content: item.text }] : []),
				error: run.lastStatus === "failed" ? snapshot.items.filter(item => item.kind === "error").at(-1)?.message ?? null : null,
			};
		}) });
	});

	router.post(
		"/api/coding-tasks",
		async (ctx) => {
			const body = await ctx.readBody();
			const session = await host.createCodingTask(validateCodingTaskCreate(body), worktreeManager);
			// Run on: the request's choice, else the project's default. Set before setup starts.
			if (session?.workspace?.path && session.workspace.kind !== "none") {
				const fallback = executionTargets.projectDefault(session.projectId);
				const target = RUN_TARGETS.includes(body.runOn as RunTarget) ? body.runOn as RunTarget : fallback.target;
				if (target !== "local") executionTargets.setTarget(session.id, { ...fallback, target, ...(typeof body.dockerImage === "string" ? { image: body.dockerImage } : {}) }, { workspace: session.workspace.path, repository: session.workspace.repository });
			}
			if (session) prepareWorktree(session);
			ctx.json(200, { session });
		},
		{ originError: "Use ADE to start a coding task." },
	);

	router.patch(
		"/api/coding-tasks/:id([0-9a-f-]+)",
		async (ctx) => {
			ctx.json(200, { session: host.renameCodingTask(ctx.params.id, validateRenameTitle(await ctx.readBody()).title) });
		},
		{ originError: "Use ADE to rename a session." },
	);

	router.delete(
		"/api/coding-tasks/:id([0-9a-f-]+)",
		(ctx) => {
			ctx.json(200, host.deleteCodingTask(ctx.params.id));
		},
		{ originError: "Use ADE to delete a session." },
	);

	router.post(
		"/api/coding-tasks/:id([0-9a-f-]+)/messages",
		async (ctx) => {
			const input = validateSendMessage(await ctx.readBody());
			ctx.json(200, { session: await sendToAgent(ctx.params.id, input.content, {
				id: input.id ?? undefined, provider: input.provider ?? undefined, model: input.model ?? undefined, reasoning: input.reasoning ?? undefined,
			}) });
		},
		{ originError: "Use ADE to send a coding task message." },
	);

	// --- Session Fork, Move, Root Send & Live Controls ---
	router.post(
		"/api/sessions/:id/fork",
		async (ctx) => {
			await ctx.readBody();
			ctx.json(200, { session: host.forkSession(ctx.params.id) });
		},
		{ originError: "Use ADE to fork a chat." },
	);

	router.patch(
		"/api/sessions/:id/move",
		async (ctx) => {
			const input = validateSessionMove(await ctx.readBody());
			ctx.json(200, { session: host.moveSession(ctx.params.id, input) });
		},
		{ originError: "Use ADE to move a chat." },
	);

	router.post(
		"/api/sessions/:mode(coding|personal)/messages",
		async (ctx) => {
			const session = await host.send(ctx.params.mode, validateSendMessage(await ctx.readBody()));
			ctx.json(200, { session });
		},
		{ requireAppOrigin: false },
	);

	router.get("/api/sessions/:id/timeline", async (ctx) => {
		if (engines.get(ctx.params.id)) {
			ctx.json(200, engines.snapshot(ctx.params.id));
			return;
		}
		const conversationId = ctx.url.searchParams.get("conversationId") ?? undefined;
		ctx.json(200, await host.getTimeline(ctx.params.id, conversationId));
	});

	// Transcript export (R15): Markdown for people, JSON for tools. Project secrets are masked.
	router.get("/api/sessions/:id/transcript", async (ctx) => {
		const sessionId = ctx.params.id;
		const session = viewSessions().find(item => item.id === sessionId);
		if (!session) throw notFound("Session not found.");
		const timeline = engines.get(sessionId) ? engines.snapshot(sessionId) : await host.getTimeline(sessionId);
		const workspace = host.getWorkspacePath(sessionId);
		const project = session.projectId ? host.projects().find(item => item?.id === session.projectId)?.name ?? null : null;
		const agent = session.engine === "claude-code" ? "Claude Code" : session.engine === "codex" ? "Codex" : "ADE agent";
		const format = ctx.url.searchParams.get("format") === "json" ? "json" : "md";
		const body = redactForCwd(format === "json"
			? JSON.stringify({ session: { id: session.id, title: session.label, project, branch: session.workspace?.branch ?? null, agent }, exportedAt: new Date().toISOString(), items: timeline.items, usage: timeline.usage ?? null }, null, 2)
			: transcriptMarkdown(timeline.items as TranscriptItem[], { title: session.label, project, branch: session.workspace?.branch ?? null, agent }, { includeThinking: ctx.url.searchParams.get("thinking") === "1" }), workspace);
		// Paths inside the worktree are shown relative to it, which is shorter and doesn't reveal local folders.
		const shareable = workspace ? body.split(`${workspace}/`).join("").split(workspace).join(".") : body;
		const name = `${session.label.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "session"}.${format}`;
		ctx.response.writeHead(200, {
			"content-type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
			"content-disposition": `attachment; filename="${name}"`,
			"cache-control": "no-store",
		});
		ctx.response.end(shareable);
	});

	router.post(
		"/api/sessions/:id/steer",
		async (ctx) => {
			const input = validateSessionSteer(await ctx.readBody());
			if (engines.get(ctx.params.id)) throw conflict("This agent can't take messages while it works. Wait for it to finish, or stop it and send again.");
			ctx.json(200, await host.steerOrFollowUp(ctx.params.id, input.content, input.mode));
		},
		{ originError: "Use ADE to steer a session." },
	);

	router.post(
		"/api/sessions/:id/abort",
		async (ctx) => {
			if (engines.get(ctx.params.id)) {
				ctx.json(200, engines.abort(ctx.params.id));
				return;
			}
			ctx.json(200, await host.abortSession(ctx.params.id));
		},
		{ originError: "Use ADE to abort a session." },
	);

	router.post(
		"/api/sessions/:id/compact",
		async (ctx) => {
			const input = validateSessionCompact(await ctx.readBody());
			ctx.json(200, await host.compactSession(ctx.params.id, input.instructions));
		},
		{ originError: "Use ADE to compact a session." },
	);

	router.post(
		"/api/sessions/:id/subagents/:subagentId/message",
		async (ctx) => {
			const input = validateSubagentMessage(await ctx.readBody());
			ctx.json(200, await host.messageSubagent(ctx.params.id, ctx.params.subagentId, input.message, input.mode));
		},
		{ originError: "Use ADE to message a subagent." },
	);

	router.post(
		"/api/sessions/:id/subagents/:subagentId/stop",
		async (ctx) => {
			// Claude Code / Codex subagents are stopped by ending their CLI run.
			const key = subagentKey(ctx.params.id, ctx.params.subagentId);
			if (engines.get(key)) {
				usageWaiter.cancel(key);
				ctx.json(200, { stopped: scheduler.cancel(key) || engines.abort(key).ok });
				return;
			}
			ctx.json(200, await host.stopSubagent(ctx.params.id, ctx.params.subagentId));
		},
		{ originError: "Use ADE to stop a subagent." },
	);

	// --- Artifacts & Tasks ---
	router.get("/api/sessions/:id/artifacts", async (ctx) => {
		const sessionId = ctx.params.id;
		const artifacts = host.artifacts.listArtifacts(sessionId);
		const workspace = host.getWorkspacePath(sessionId);
		if (!workspace) {
			ctx.json(200, { artifacts, files: [] });
			return;
		}
		const [flat, git] = await Promise.all([
			Promise.resolve(listWorkspaceFilesFlat(workspace, 300)),
			getWorkspaceGitSummary(workspace).catch(() => ({ isGitRepo: false, branch: null, ahead: 0, behind: 0, additions: 0, deletions: 0, files: [] })),
		]);
		const gitMap = new Map(git.files.map((f) => [f.path, f.status]));
		const files = flat
			.map((f) => ({ ...f, gitStatus: gitMap.get(f.path) ?? null }))
			.sort((a, b) => {
				const aChanged = a.gitStatus ? 1 : 0;
				const bChanged = b.gitStatus ? 1 : 0;
				if (aChanged !== bChanged) return bChanged - aChanged;
				return b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path);
			});
		ctx.json(200, { artifacts, files });
	});

	router.post(
		"/api/artifacts/:id/review",
		async (ctx) => {
			const input = validateArtifactReview(await ctx.readBody());
			ctx.json(200, { artifact: host.artifacts.reviewArtifact(ctx.params.id, input.decision, input.feedback) });
		},
		{ originError: "Use ADE to review artifacts." },
	);

	router.get("/api/sessions/:id/tasks", (ctx) => {
		ctx.json(200, { tasks: host.artifacts.getTasks(ctx.params.id) });
	});
}
