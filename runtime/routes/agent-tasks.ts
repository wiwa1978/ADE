// Native `.tasks/` trees for a project's local repository.
import { existsSync } from "node:fs";
import { badRequest, notFound } from "../http-error.ts";
import {
	buildAgentTaskPrompt,
	getAgentTaskDetail,
	listAgentTasks,
	transitionAgentTask,
} from "../agent-tasks.ts";
import type { Router } from "../router.ts";
import type { RouteDeps } from "./context.ts";

function projectRepo(host: RouteDeps["host"], projectId: string): string {
	const project = host.projects().find(item => item.id === projectId);
	if (!project) throw notFound("Project not found.");
	const root = project.repository;
	if (!root || !existsSync(root)) throw badRequest("This project has no local repository.");
	return root;
}

export function registerAgentTaskRoutes(router: Router, { host }: RouteDeps): void {
	router.get("/api/projects/:id([0-9a-f-]{36})/agent-tasks", (ctx) => {
		ctx.json(200, listAgentTasks(projectRepo(host, ctx.params.id)));
	});

	router.get("/api/projects/:id([0-9a-f-]{36})/agent-tasks/detail", (ctx) => {
		const path = ctx.url.searchParams.get("path") ?? "";
		const root = projectRepo(host, ctx.params.id);
		const task = getAgentTaskDetail(root, path);
		ctx.json(200, { task, prompt: buildAgentTaskPrompt(task) });
	});

	router.post("/api/projects/:id([0-9a-f-]{36})/agent-tasks/claim", async (ctx) => {
		const body = await ctx.readBody();
		const path = String(body.path ?? "");
		const sessionId = String(body.sessionId ?? "").trim();
		if (!sessionId) throw badRequest("sessionId is required.");
		const root = projectRepo(host, ctx.params.id);
		const current = getAgentTaskDetail(root, path);
		if (current.claimedSession && current.claimedSession !== sessionId && current.status === "IN_PROGRESS" && !body.force) {
			ctx.json(200, { task: current, resumed: true, sessionId: current.claimedSession });
			return;
		}
		const result = transitionAgentTask(root, {
			path,
			status: "IN_PROGRESS",
			sessionId,
			actor: String(body.actor ?? "ade"),
			force: Boolean(body.force),
			note: "claimed by session",
		});
		ctx.json(200, { task: result.task, resumed: current.claimedSession === sessionId, sessionId });
	}, { originError: "Use ADE to claim a repo task." });
}
