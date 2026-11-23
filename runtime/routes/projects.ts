import { detectGitHubRemoteFromCheckout } from "../host.ts";
import { notFound } from "../http-error.ts";
import { cloneProjectRepository, initLocalFolderProject } from "../project-onboarding.ts";
import type { Router } from "../router.ts";
import {
	validateArchiveProject,
	validateProjectClone,
	validateProjectDetectGit,
	validateProjectInitLocal,
	validateProjectSave,
} from "../validators.ts";
import { resolveCheckout } from "../worktrees.ts";
import type { ArchivedWorkspaceCleanup, RouteDeps } from "./context.ts";
import { createStartFrom } from "../start-from.ts";

const startFrom = createStartFrom();

export function registerProjectRoutes(router: Router, { host, githubRepositories, sessionGit, cleanUpArchivedWorkspace }: RouteDeps): void {
	router.get("/api/projects", (ctx) => {
		ctx.json(200, { projects: host.projects() });
	});

	router.post(
		"/api/projects",
		async (ctx) => {
			ctx.json(200, { project: await host.saveProject(validateProjectSave(await ctx.readBody())) });
		},
		{ originError: "Use ADE to manage projects." },
	);

	router.post(
		"/api/projects/clone",
		async (ctx) => {
			const input = validateProjectClone(await ctx.readBody());
			ctx.json(200, await cloneProjectRepository(input));
		},
		{ originError: "Use ADE to clone a repository." },
	);

	router.post(
		"/api/projects/init-local",
		async (ctx) => {
			const input = validateProjectInitLocal(await ctx.readBody());
			ctx.json(200, await initLocalFolderProject(input));
		},
		{ originError: "Use ADE to initialize a local project." },
	);

	router.post(
		"/api/projects/detect-git",
		async (ctx) => {
			const input = validateProjectDetectGit(await ctx.readBody());
			const resolved = await resolveCheckout(input.path);
			const githubRepo = await detectGitHubRemoteFromCheckout(resolved);
			ctx.json(200, { repository: resolved, githubRepo });
		},
		{ originError: "Use ADE to detect Git metadata." },
	);

	router.get("/api/projects/:id/issues", async (ctx) => {
		const project = host.projects().find((p) => p.id === ctx.params.id);
		if (!project) throw notFound("Project not found.");
		if (!project.githubUrl) {
			ctx.json(200, { issues: [], unlinked: true });
			return;
		}
		const slug = project.githubUrl.replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "");
		const stateParam = ctx.url.searchParams.get("state");
		const state = stateParam === "closed" || stateParam === "all" ? stateParam : "open";
		ctx.json(200, await githubRepositories.listIssues({ repository: slug, state }));
	});

	router.get("/api/projects/:id/pulls", async (ctx) => {
		const project = host.projects().find((p) => p.id === ctx.params.id);
		if (!project) throw notFound("Project not found.");
		if (!project.githubUrl) {
			ctx.json(200, { pullRequests: [], unlinked: true });
			return;
		}
		const slug = project.githubUrl.replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "").replace(/\.git$/, "");
		const stateParam = ctx.url.searchParams.get("state");
		const state = stateParam === "closed" || stateParam === "merged" || stateParam === "all" ? stateParam : "open";
		ctx.json(200, { pullRequests: await sessionGit.listPullRequests(project.repository || process.cwd(), slug, state) });
	});

	// Branches a new session can start from (local and origin, newest first).
	router.get("/api/projects/:id/branches", async (ctx) => {
		const project = host.projects().find((p) => p.id === ctx.params.id);
		if (!project) throw notFound("Project not found.");
		if (!project.repository) {
			ctx.json(200, { branches: [] });
			return;
		}
		ctx.json(200, { branches: await startFrom.listBranches(project.repository) });
	});

	router.get("/api/projects/:id([0-9a-f-]+)/agents", async (ctx) => {
		ctx.json(200, await host.projectAgents(ctx.params.id));
	});

	router.post(
		"/api/projects/:id([0-9a-f-]{36})/archive",
		async (ctx) => {
			const input = validateArchiveProject(await ctx.readBody());
			const result = await host.setProjectArchived(ctx.params.id, input.archived);
			const cleanups: ArchivedWorkspaceCleanup[] = [];
			for (const session of result.sessions) {
				cleanups.push(await cleanUpArchivedWorkspace(session, input.removeWorktrees));
			}
			ctx.json(200, {
				project: result.project,
				sessions: result.sessions.map((session, index) => ({ ...session, ...cleanups[index] })),
			});
		},
		{ originError: "Use ADE to archive projects." },
	);

	router.patch(
		"/api/projects/:id([0-9a-f-]+)",
		async (ctx) => {
			ctx.json(200, { project: await host.saveProject(validateProjectSave(await ctx.readBody()), ctx.params.id) });
		},
		{ originError: "Use ADE to manage projects." },
	);

	router.delete(
		"/api/projects/:id([0-9a-f-]{36})",
		(ctx) => {
			ctx.json(200, host.deleteProject(ctx.params.id));
		},
		{ originError: "Use ADE to delete a project." },
	);
}
