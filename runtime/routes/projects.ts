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
import { getWorkspaceGitSummary, listWorkspaceFilesFlat, type WorkspaceFlatFile } from "../workspace-files.ts";

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
			try {
				const resolved = await resolveCheckout(input.path);
				const githubRepo = await detectGitHubRemoteFromCheckout(resolved);
				ctx.json(200, { isGitRepo: true, repository: resolved, githubRepo });
			} catch {
				ctx.json(200, { isGitRepo: false, repository: input.path, githubRepo: null });
			}
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

	router.get("/api/projects/:id/artifacts", async (ctx) => {
		const project = host.projects().find((p) => p.id === ctx.params.id);
		if (!project) throw notFound("Project not found.");
		const projectSessions = host.sessions().filter((s) => s.projectId === project.id);
		const labelById = new Map(projectSessions.map((s) => [s.id, s.label]));
		const artifacts = host.artifacts
			.listArtifactsForSessions(projectSessions.map((s) => s.id))
			.map((art) => ({ ...art, sessionLabel: labelById.get(art.sessionId) ?? art.sessionId }));

		type ProjectArtefactFile = WorkspaceFlatFile & {
			source: "project" | "session";
			sessionId?: string;
			sessionLabel?: string;
			gitStatus?: string | null;
		};
		const files: ProjectArtefactFile[] = [];
		const seenWorkspaces = new Set<string>();

		if (project.repository) {
			seenWorkspaces.add(project.repository);
			const [flat, git] = await Promise.all([
				Promise.resolve(listWorkspaceFilesFlat(project.repository, 400)),
				getWorkspaceGitSummary(project.repository).catch(() => ({ isGitRepo: false, branch: null, ahead: 0, behind: 0, additions: 0, deletions: 0, files: [] })),
			]);
			const gitMap = new Map(git.files.map((f) => [f.path, f.status]));
			for (const f of flat) {
				files.push({ ...f, source: "project", gitStatus: gitMap.get(f.path) ?? null });
			}
		}

		for (const sess of projectSessions) {
			const ws = host.getWorkspacePath(sess.id);
			if (!ws || seenWorkspaces.has(ws)) continue;
			seenWorkspaces.add(ws);
			const git = await getWorkspaceGitSummary(ws).catch(() => ({ isGitRepo: false, branch: null, ahead: 0, behind: 0, additions: 0, deletions: 0, files: [] }));
			const changedSet = new Set(git.files.map((f) => f.path));
			const gitMap = new Map(git.files.map((f) => [f.path, f.status]));
			const flat = listWorkspaceFilesFlat(ws, 200);
			for (const f of flat) {
				if (changedSet.size > 0 && !changedSet.has(f.path)) continue;
				files.push({
					...f,
					source: "session",
					sessionId: sess.id,
					sessionLabel: sess.label,
					gitStatus: gitMap.get(f.path) ?? null,
				});
			}
		}

		files.sort((a, b) => {
			const aChanged = a.gitStatus ? 1 : 0;
			const bChanged = b.gitStatus ? 1 : 0;
			if (aChanged !== bChanged) return bChanged - aChanged;
			return b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path);
		});

		ctx.json(200, { artifacts, files: files.slice(0, 500) });
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
