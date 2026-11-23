// Routes for the agent workflow features: Inbox (R4), project setup/run scripts (R1),
// workspace checkpoints (R2), and choosing Claude Code or Codex for a session (R3).
import { badRequest, conflict, notFound } from "../http-error.ts";
import type { ScriptKind } from "../project-scripts.ts";
import type { Router } from "../router.ts";
import type { RouteDeps } from "./context.ts";
import { readInstructions, searchWorkspaceFiles, writeInstructions } from "../agent-context.ts";

export function registerAgentWorkflowRoutes(
	router: Router,
	{ host, inbox, scripts, scriptRunner, checkpoints, engines, viewSessions, usage, secrets, automations, automationRunner, integrations, executionTargets }: RouteDeps,
): void {
	// --- Usage: tokens and cost per session, project and day ---
	router.get("/api/usage", (ctx) => {
		ctx.json(200, usage.report());
	});

	// --- Inbox ---
	router.get("/api/inbox", async (ctx) => {
		ctx.json(200, { entries: await inbox.entries() });
	});

	router.post("/api/sessions/:id/seen", async (ctx) => {
		await ctx.readBody();
		inbox.markSeen(ctx.params.id);
		ctx.json(200, { ok: true });
	}, { originError: "Use ADE to update sessions." });

	// --- Project scripts ---
	const projectFor = (projectId: string) => {
		const project = host.projects().find(item => item?.id === projectId);
		if (!project) throw notFound("Project not found.");
		return project;
	};
	const scriptsResponse = (projectId: string, repository: string | null) => ({
		saved: scripts.saved(projectId),
		repository: scripts.fromRepository(repository),
		effective: scripts.effective(projectId, repository),
	});

	router.get("/api/projects/:id/scripts", (ctx) => {
		const project = projectFor(ctx.params.id);
		ctx.json(200, scriptsResponse(project.id, project.repository));
	});

	router.put("/api/projects/:id/scripts", async (ctx) => {
		const project = projectFor(ctx.params.id);
		scripts.save(project.id, await ctx.readBody());
		ctx.json(200, scriptsResponse(project.id, project.repository));
	}, { originError: "Use ADE to change project scripts." });

	// --- Where sessions run: this computer or a Docker container ---
	router.get("/api/docker", async (ctx) => {
		ctx.json(200, await executionTargets.dockerAvailable());
	});

	// Which run targets this computer offers, and whether each is set up.
	router.get("/api/run-targets", async (ctx) => {
		const docker = await executionTargets.dockerAvailable();
		ctx.json(200, { available: executionTargets.available(), docker, boat: { configured: integrations.status().boat.configured } });
	});

	router.get("/api/projects/:id/run-on", (ctx) => {
		ctx.json(200, executionTargets.projectDefault(projectFor(ctx.params.id).id));
	});

	router.put("/api/projects/:id/run-on", async (ctx) => {
		const project = projectFor(ctx.params.id);
		ctx.json(200, executionTargets.setProjectDefault(project.id, await ctx.readBody()));
	}, { originError: "Use ADE to change where sessions run." });

	router.get("/api/sessions/:id/run-on", async (ctx) => {
		ctx.json(200, await executionTargets.status(ctx.params.id));
	});

	router.put("/api/sessions/:id/run-on", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		const body = await ctx.readBody();
		if (viewSessions().find(item => item.id === ctx.params.id)?.status === "working") throw conflict("Wait for the agent to finish before changing where the session runs.");
		scriptRunner.stopAll(ctx.params.id);
		const session = host.sessions().find(item => item.id === ctx.params.id);
		// Settings not given (SSH host, image, …) come from the session, or the project the first time.
		const base = executionTargets.session(ctx.params.id).updatedAt ? {} : executionTargets.projectDefault(session?.projectId);
		ctx.json(200, executionTargets.setTarget(ctx.params.id, { ...base, ...body }, { workspace, repository: session?.workspace?.repository ?? null }));
	}, { originError: "Use ADE to change where sessions run." });

	router.post("/api/sessions/:id/run-on/restart", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		await ctx.readBody();
		const repository = host.sessions().find(item => item.id === ctx.params.id)?.workspace?.repository ?? null;
		ctx.json(200, await executionTargets.ensure(ctx.params.id, { workspace, repository }));
	}, { originError: "Use ADE to change where sessions run." });

	// --- Integrations: Slack notifications and Linear issues ---
	router.get("/api/integrations", (ctx) => {
		ctx.json(200, integrations.status());
	});
	router.put("/api/integrations/slack", async (ctx) => {
		const body = await ctx.readBody();
		ctx.json(200, integrations.setSlack(body.webhook, body.events as Record<string, boolean> | undefined));
	}, { originError: "Use ADE to change integrations." });
	router.delete("/api/integrations/slack", (ctx) => {
		ctx.json(200, integrations.removeSlack());
	}, { originError: "Use ADE to change integrations." });
	router.post("/api/integrations/slack/test", async (ctx) => {
		await ctx.readBody();
		const sent = await integrations.notify("👋 ADE is connected. You'll get messages here when agents finish or need you.");
		if (!sent) throw badRequest("Add a Slack webhook first.");
		ctx.json(200, { sent: true });
	}, { originError: "Use ADE to test integrations." });
	router.put("/api/integrations/linear", async (ctx) => {
		const body = await ctx.readBody();
		ctx.json(200, await integrations.setLinear(body.apiKey));
	}, { originError: "Use ADE to change integrations." });
	router.delete("/api/integrations/linear", (ctx) => {
		ctx.json(200, integrations.removeLinear());
	}, { originError: "Use ADE to change integrations." });
	router.put("/api/integrations/boat", async (ctx) => {
		const body = await ctx.readBody();
		ctx.json(200, await integrations.setBoat(body.apiKey));
	}, { originError: "Use ADE to change integrations." });
	router.delete("/api/integrations/boat", (ctx) => {
		ctx.json(200, integrations.removeBoat());
	}, { originError: "Use ADE to change integrations." });
	router.get("/api/integrations/linear/issues", async (ctx) => {
		ctx.json(200, { issues: await integrations.linearIssues(ctx.url.searchParams.get("q") ?? "") });
	});

	// --- Automations: scheduled and issue-triggered background agents ---
	router.get("/api/projects/:id/automations", (ctx) => {
		ctx.json(200, { automations: automations.forProject(projectFor(ctx.params.id).id) });
	});

	router.post("/api/projects/:id/automations", async (ctx) => {
		const project = projectFor(ctx.params.id);
		const body = await ctx.readBody();
		const trigger = body.trigger as { type?: unknown; label?: unknown } | undefined;
		// Issues that already have the label are skipped, so creating an automation doesn't start a burst of runs.
		const seen = trigger?.type === "issue-label" && typeof trigger.label === "string" ? await automationRunner.currentIssues(project.id, trigger.label.trim()) : [];
		automations.create(project.id, body, seen);
		ctx.json(200, { automations: automations.forProject(project.id) });
	}, { originError: "Use ADE to change automations." });

	router.put("/api/automations/:id", async (ctx) => {
		const item = automations.update(ctx.params.id, await ctx.readBody());
		ctx.json(200, { automations: automations.forProject(item.projectId) });
	}, { originError: "Use ADE to change automations." });

	router.delete("/api/automations/:id", (ctx) => {
		const { projectId } = automations.get(ctx.params.id);
		automations.remove(ctx.params.id);
		ctx.json(200, { automations: automations.forProject(projectId) });
	}, { originError: "Use ADE to change automations." });

	router.post("/api/automations/:id/run", async (ctx) => {
		await ctx.readBody();
		const item = automations.get(ctx.params.id);
		const sessionId = await automationRunner.run(item, "Run now");
		ctx.json(200, { sessionId, automations: automations.forProject(item.projectId) });
	}, { originError: "Use ADE to run automations." });

	// --- Secrets per project (names only; values never come back) ---
	router.get("/api/projects/:id/secrets", (ctx) => {
		ctx.json(200, { secrets: secrets.list(projectFor(ctx.params.id).id) });
	});

	router.put("/api/projects/:id/secrets", async (ctx) => {
		const project = projectFor(ctx.params.id);
		const body = await ctx.readBody(64_000);
		ctx.json(200, { secrets: secrets.set(project.id, body.name, body.value) });
	}, { originError: "Use ADE to change project secrets.", maxBody: 64_000 });

	router.delete("/api/projects/:id/secrets/:name", (ctx) => {
		ctx.json(200, { secrets: secrets.remove(projectFor(ctx.params.id).id, ctx.params.name) });
	}, { originError: "Use ADE to change project secrets." });

	// --- Agent context: @-mention file search and instruction files ---
	router.get("/api/sessions/:id/files/search", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		ctx.json(200, { files: await searchWorkspaceFiles(workspace, (ctx.url.searchParams.get("q") ?? "").slice(0, 200)) });
	});

	router.get("/api/projects/:id/instructions", (ctx) => {
		const project = projectFor(ctx.params.id);
		if (!project.repository) throw badRequest("This project has no local checkout.");
		ctx.json(200, { files: readInstructions(project.repository) });
	});

	router.put("/api/projects/:id/instructions", async (ctx) => {
		const project = projectFor(ctx.params.id);
		if (!project.repository) throw badRequest("This project has no local checkout.");
		const body = await ctx.readBody(400_000);
		ctx.json(200, { files: writeInstructions(project.repository, body.name, body.content) });
	}, { originError: "Use ADE to edit agent instructions.", maxBody: 400_000 });

	const sessionProject = (sessionId: string) => {
		const session = host.sessions().find(item => item.id === sessionId);
		return session?.projectId ? host.projects().find(project => project?.id === session.projectId) ?? null : null;
	};

	router.get("/api/sessions/:id/scripts", (ctx) => {
		const project = sessionProject(ctx.params.id);
		ctx.json(200, {
			configured: project ? scripts.effective(project.id, project.repository) : null,
			setup: scriptRunner.state(ctx.params.id, "setup"),
			run: scriptRunner.state(ctx.params.id, "run"),
			check: scriptRunner.state(ctx.params.id, "check"),
		});
	});

	router.post("/api/sessions/:id/scripts/:kind(setup|run|check)/:action(start|stop)", async (ctx) => {
		await ctx.readBody();
		const kind = ctx.params.kind as ScriptKind;
		if (ctx.params.action === "stop") {
			ctx.json(200, scriptRunner.stop(ctx.params.id, kind));
			return;
		}
		const workspace = ctx.requireWorkspace(ctx.params.id);
		const project = sessionProject(ctx.params.id);
		const effective = project ? scripts.effective(project.id, project.repository) : null;
		ctx.json(200, await scriptRunner.start(ctx.params.id, kind, effective?.[kind] ?? "", workspace, project?.repository ? { ADE_PROJECT_ROOT: project.repository } : {}));
	}, { originError: "Use ADE to run project scripts." });

	// --- Checkpoints ---
	router.get("/api/sessions/:id/checkpoints", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		ctx.json(200, { checkpoints: await checkpoints.withChanges(ctx.params.id, workspace) });
	});

	router.post("/api/sessions/:id/checkpoints", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		const input = await ctx.readBody();
		const label = typeof input.label === "string" && input.label.trim() ? input.label : "Saved by you";
		const created = await checkpoints.create(ctx.params.id, workspace, label);
		ctx.json(200, { checkpoint: created, unchanged: !created });
	}, { originError: "Use ADE to change checkpoints." });

	router.post("/api/sessions/:id/checkpoints/:checkpoint/restore", async (ctx) => {
		await ctx.readBody();
		const workspace = ctx.requireWorkspace(ctx.params.id);
		if (viewSessions().find(item => item.id === ctx.params.id)?.status === "working") {
			throw conflict("Stop the agent before rewinding its workspace.");
		}
		inbox.invalidate(ctx.params.id);
		ctx.json(200, await checkpoints.restore(ctx.params.id, workspace, ctx.params.checkpoint));
	}, { originError: "Use ADE to change checkpoints." });

	// --- Engines ---
	router.get("/api/engines", (ctx) => {
		ctx.json(200, { engines: engines.available() });
	});

	router.post("/api/sessions/:id/engine", async (ctx) => {
		const input = await ctx.readBody();
		if (!host.getWorkspacePath(ctx.params.id)) {
			throw conflict("Claude Code and Codex need a session with a workspace (its own branch or the project folder).");
		}
		if (typeof input.engine !== "string") throw badRequest("Choose an agent.");
		ctx.json(200, { engine: engines.setEngine(ctx.params.id, input.engine)?.engine ?? "pi" });
	}, { originError: "Use ADE to choose the agent." });
}
