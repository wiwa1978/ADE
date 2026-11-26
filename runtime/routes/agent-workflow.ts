// Routes for the agent workflow features: Inbox (R4), project setup/run scripts (R1),
// workspace checkpoints (R2), and choosing Claude Code or Codex for a session (R3).
import { badRequest, conflict, notFound } from "../http-error.ts";
import type { ScriptKind } from "../project-scripts.ts";
import type { Router } from "../router.ts";
import type { RouteDeps } from "./context.ts";
import { readInstructions, searchWorkspaceFiles, writeInstructions } from "../agent-context.ts";
import { harnessGuidance } from "../subagent-policy.ts";
import { sessionBlueprintOptions, VIBE_BLUEPRINT_ID } from "@ade/blueprints";
import { resolveSessionBlueprint } from "../session-blueprints.ts";
import { buildBrief } from "../session-brief.ts";
import { getWorkspaceGitSummary } from "../workspace-files.ts";
import {
	validateAutomationCreate,
	validateAutomationUpdate,
	validateBoatIntegration,
	validateCheckpointCreate,
	validateLimits,
	validateLinearIntegration,
	validateProjectInstructionsWrite,
	validateProjectScripts,
	validateProjectSecretSet,
	validateSessionBlueprintSwitch,
	validateSessionEngine,
	validateSlackIntegration,
	validateStageDecision,
	validateSubagentPolicy,
	validateTargetSettings,
	validateTeamOverview,
	validateTeamPlanDecision,
	validateTeamPostCreate,
	validateTeamSettings,
	validateTeamTaskCreate,
	validateTeamThreadUpsert,
} from "../validators.ts";

export function registerAgentWorkflowRoutes(
	router: Router,
	{ host, inbox, scripts, scriptRunner, checkpoints, engines, viewSessions, usage, secrets, automations, automationRunner, integrations, executionTargets, subagentPolicies, limitGuard, usageWaiter, subagentKey, scheduler, sendToAgent }: RouteDeps,
): void {
	/** The team board is kept per session id: only real sessions get one. */
	const requireSession = (id: string) => {
		if (!host.sessions().some(session => session.id === id)) throw notFound("Session not found.");
	};

	// --- Ways of working: Vibe or a blueprint, per project (default) and per session ---
	router.get("/api/blueprints/session-options", (ctx) => {
		ctx.json(200, { blueprints: sessionBlueprintOptions() });
	});

	router.get("/api/sessions/:id/stages", (ctx) => {
		ctx.json(200, host.blueprints.view(ctx.params.id));
	});

	// Approve a gated stage, or send it back with feedback; the agent continues by itself.
	router.post("/api/sessions/:id/stages/decision", async (ctx) => {
		const input = validateStageDecision(await ctx.readBody());
		const id = ctx.params.id;
		if (viewSessions().find(item => item.id === id)?.status === "working") throw conflict("The agent is still working. Wait until it stops, or stop it first.");
		const message = host.blueprints.decide(id, input.decision, input.feedback ?? "");
		// The decision is saved either way; the stage's instructions (and feedback) reach the agent with its next message.
		let notice: string | null = null;
		if (message) {
			try {
				await sendToAgent(id, message, { async: true });
			} catch (error) {
				notice = `Saved, but the agent couldn't start: ${error instanceof Error ? error.message : String(error)} Send it a message (for example “continue”) once that's fixed.`;
			}
		}
		ctx.json(200, { ...host.blueprints.view(id), notice });
	}, { originError: "Use ADE to approve stages." });

	// Switch the way of working. A blueprint starts at its first stage, with the work so far as context.
	router.put("/api/sessions/:id/blueprint", async (ctx) => {
		const input = validateSessionBlueprintSwitch(await ctx.readBody());
		const id = ctx.params.id;
		const session = viewSessions().find(item => item.id === id);
		if (!session?.workspace) throw notFound("Session not found.");
		if (session.status === "working") throw conflict("The agent is still working. Wait until it stops, or stop it first.");
		const project = session.projectId ? host.projects().find(item => item?.id === session.projectId) ?? null : null;
		const blueprintId = resolveSessionBlueprint(project, input.blueprintId);
		const record = host.blueprints.begin(id, blueprintId);
		const view = host.blueprints.view(id);
		if (record && session.messages.length) {
			await sendToAgent(id, `From now on this session follows ${view.name}. Start with its first stage, "${view.stages[0]?.name}", and use what was done so far as context.`, { async: true });
		}
		ctx.json(200, { ...view, switchedTo: blueprintId === VIBE_BLUEPRINT_ID ? "vibe" : blueprintId });
	}, { originError: "Use ADE to change the way of working." });

	// --- Team board: tasks, plans, posts, file claims, swarm overview and flow events (Team & Swarm views) ---
	router.get("/api/sessions/:id/team", (ctx) => {
		const state = host.team.state(ctx.params.id);
		ctx.json(200, {
			title: state.title,
			goal: state.goal,
			threads: state.threads,
			focus: state.focus,
			tasks: state.tasks,
			posts: state.posts.slice(-200),
			claims: state.claims,
			events: state.events,
			requirePlans: state.requirePlans,
		});
	});

	// You can set or refine the Swarm title and goal directly from the Swarm Overview pane.
	router.put("/api/sessions/:id/team/overview", async (ctx) => {
		requireSession(ctx.params.id);
		const input = validateTeamOverview(await ctx.readBody());
		const message = host.team.setSwarmOverview(ctx.params.id, "user", {
			title: input.title,
			goalTitle: input.goalTitle,
			goalSummary: input.goalSummary,
		});
		ctx.json(200, { message });
	}, { originError: "Use ADE to update the swarm overview." });

	// Create or update a workstream thread from the Swarm UI.
	router.post("/api/sessions/:id/team/threads", async (ctx) => {
		requireSession(ctx.params.id);
		const input = validateTeamThreadUpsert(await ctx.readBody());
		const id = host.team.upsertThread(ctx.params.id, "user", {
			id: input.id,
			title: input.title,
			summary: input.summary,
			status: input.status,
			focus: input.focus,
		});
		ctx.json(200, { id });
	}, { originError: "Use ADE to update swarm threads." });

	// Add a task on the shared swarm/team board from the UI.
	router.post("/api/sessions/:id/team/tasks", async (ctx) => {
		requireSession(ctx.params.id);
		const input = validateTeamTaskCreate(await ctx.readBody());
		const id = host.team.addTask(ctx.params.id, "user", {
			title: input.title,
			detail: input.detail ?? "",
			owner: input.owner?.trim() ? input.owner.trim() : null,
			dependsOn: input.dependsOn,
			threadId: input.threadId?.trim() ? input.threadId.trim() : null,
		});
		ctx.json(200, { id });
	}, { originError: "Use ADE to add team tasks." });

	// You decide on a plan (instead of, or before, the lead).
	router.post("/api/sessions/:id/team/plans/:taskId", async (ctx) => {
		requireSession(ctx.params.id);
		const input = validateTeamPlanDecision(await ctx.readBody());
		const message = host.team.decidePlan(ctx.params.id, "user", ctx.params.taskId, input.decision, input.note ?? "");
		ctx.json(200, { message });
	}, { originError: "Use ADE to decide on plans." });

	// You post on the team board, e.g. to answer an agent's question.
	router.post("/api/sessions/:id/team/posts", async (ctx) => {
		requireSession(ctx.params.id);
		const input = validateTeamPostCreate(await ctx.readBody());
		ctx.json(200, { message: host.team.post(ctx.params.id, "user", { text: input.text, kind: "answer", to: input.to.slice(0, 20), re: input.re ?? null }) });
	}, { originError: "Use ADE to post on the team board." });

	router.put("/api/sessions/:id/team/settings", async (ctx) => {
		requireSession(ctx.params.id);
		const input = validateTeamSettings(await ctx.readBody());
		host.team.setRequirePlans(ctx.params.id, input.requirePlans);
		ctx.json(200, { requirePlans: input.requirePlans });
	}, { originError: "Use ADE to change team settings." });

	// --- Usage: tokens and cost per session, project and day ---
	router.get("/api/usage", (ctx) => {
		ctx.json(200, usage.report());
	});

	// --- Inbox ---
	router.get("/api/inbox", async (ctx) => {
		ctx.json(200, { entries: await inbox.entries() });
	});

	// A session at a glance for the Inbox: what was asked, what's been done, what waits for the person.
	router.get("/api/sessions/:id/brief", async (ctx) => {
		const id = ctx.params.id;
		const engine = engines.get(id);
		const turns = host.turnsOverview(id);
		const entry = (await inbox.entries()).find(item => item.sessionId === id);
		const workspace = host.getWorkspacePath(id);
		const git = workspace ? await getWorkspaceGitSummary(workspace).catch(() => null) : null;
		let stage: Parameters<typeof buildBrief>[0]["stage"] = null;
		try {
			const view = host.blueprints.view(id);
			const current = view.summary?.stage;
			if (view.summary && current) {
				const detail = view.stages.find(item => item.id === current.id);
				stage = { name: current.name, done: view.summary.done, total: view.summary.total, waiting: current.status === "awaiting_approval", waitingSummary: detail?.summary ?? null, startsAfterApproval: detail?.attempt === 0 };
			}
		} catch {
			// Not a coding session: no stages.
		}
		const items = engine?.items ?? [];
		const lastAssistant = [...items].reverse().find(item => item.kind === "assistant" && item.text.trim());
		ctx.json(200, buildBrief({
			question: engine ? items.find(item => item.kind === "user")?.content : turns.first?.content,
			lastAnswer: engine ? (lastAssistant?.kind === "assistant" ? lastAssistant.text : null) : turns.lastAnswered?.answer,
			lastError: engine ? [...items].reverse().find(item => item.kind === "error")?.message : turns.latest?.error,
			lastTurnStatus: engine ? engine.lastStatus : turns.latest?.status,
			pendingApprovals: host.approvals.listPending(id).map(item => ({ id: item.id, summary: item.summary, command: item.command, toolName: item.toolName })),
			stage,
			git: git?.isGitRepo ? { files: git.files.length, additions: git.additions, deletions: git.deletions } : null,
			commitsAhead: entry?.commitsAhead ?? 0,
			subagents: (await host.featureAgents(id).catch(() => [])).length,
		}));
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
		const input = validateProjectScripts(await ctx.readBody());
		scripts.save(project.id, input);
		ctx.json(200, scriptsResponse(project.id, project.repository));
	}, { originError: "Use ADE to change project scripts." });

	// --- Limits for unattended work ---
	router.get("/api/limits", (ctx) => {
		ctx.json(200, { limits: limitGuard.get(), todayCost: usage.todayCost() });
	});

	router.put("/api/limits", async (ctx) => {
		const input = validateLimits(await ctx.readBody());
		ctx.json(200, { limits: limitGuard.set(input) });
	}, { originError: "Use ADE to change limits." });

	// Why a session isn't running by itself right now: stopped by a limit, or waiting for a usage limit to reset.
	router.get("/api/sessions/:id/hold", (ctx) => {
		const id = ctx.params.id;
		const prefix = subagentKey(id, "");
		ctx.json(200, {
			stop: limitGuard.stopped(id),
			usageWait: usageWaiter.waiting(id),
			usageWaits: usageWaiter.waitingWith(prefix).map(({ key, ...wait }) => ({ subagentId: key.slice(prefix.length), ...wait })),
			queued: scheduler.queued().filter(key => key.startsWith(prefix)).map(key => ({ subagentId: key.slice(prefix.length), position: scheduler.position(key) })),
		});
	});

	// --- Subagent harnesses (the main agent is always Pi Durable) ---
	router.get("/api/subagent-policy", (ctx) => {
		const available = engines.available().filter(engine => engine.id !== "pi").map(engine => ({ id: engine.id, name: engine.name, installed: engine.available }));
		ctx.json(200, { policy: subagentPolicies.get(), harnesses: [{ id: "pi", name: "ADE agent (Pi)", installed: true }, ...available], guidance: harnessGuidance });
	});

	router.put("/api/subagent-policy", async (ctx) => {
		const input = validateSubagentPolicy(await ctx.readBody());
		ctx.json(200, { policy: subagentPolicies.set(input) });
	}, { originError: "Use ADE to change subagent settings." });

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
		const input = validateTargetSettings(await ctx.readBody());
		ctx.json(200, executionTargets.setProjectDefault(project.id, input));
	}, { originError: "Use ADE to change where sessions run." });

	router.get("/api/sessions/:id/run-on", async (ctx) => {
		ctx.json(200, await executionTargets.status(ctx.params.id));
	});

	router.put("/api/sessions/:id/run-on", async (ctx) => {
		const workspace = ctx.requireWorkspace(ctx.params.id);
		const input = validateTargetSettings(await ctx.readBody());
		if (viewSessions().find(item => item.id === ctx.params.id)?.status === "working") throw conflict("Wait for the agent to finish before changing where the session runs.");
		scriptRunner.stopAll(ctx.params.id);
		const session = host.sessions().find(item => item.id === ctx.params.id);
		// Settings not given (SSH host, image, …) come from the session, or the project the first time.
		const base = executionTargets.session(ctx.params.id).updatedAt ? {} : executionTargets.projectDefault(session?.projectId);
		ctx.json(200, executionTargets.setTarget(ctx.params.id, { ...base, ...input }, { workspace, repository: session?.workspace?.repository ?? null }));
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
		const input = validateSlackIntegration(await ctx.readBody());
		ctx.json(200, integrations.setSlack(input.webhook, input.events));
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
		const input = validateLinearIntegration(await ctx.readBody());
		ctx.json(200, await integrations.setLinear(input.apiKey));
	}, { originError: "Use ADE to change integrations." });
	router.delete("/api/integrations/linear", (ctx) => {
		ctx.json(200, integrations.removeLinear());
	}, { originError: "Use ADE to change integrations." });
	router.put("/api/integrations/boat", async (ctx) => {
		const input = validateBoatIntegration(await ctx.readBody());
		ctx.json(200, await integrations.setBoat(input.apiKey));
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
		const input = validateAutomationCreate(await ctx.readBody());
		// Issues that already have the label are skipped, so creating an automation doesn't start a burst of runs.
		const seen = input.trigger.type === "issue-label" ? await automationRunner.currentIssues(project.id, input.trigger.label) : [];
		automations.create(project.id, input, seen);
		ctx.json(200, { automations: automations.forProject(project.id) });
	}, { originError: "Use ADE to change automations." });

	router.put("/api/automations/:id", async (ctx) => {
		const input = validateAutomationUpdate(await ctx.readBody());
		const item = automations.update(ctx.params.id, input);
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
		const input = validateProjectSecretSet(await ctx.readBody(64_000));
		ctx.json(200, { secrets: secrets.set(project.id, input.name, input.value) });
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
		const input = validateProjectInstructionsWrite(await ctx.readBody(400_000));
		ctx.json(200, { files: writeInstructions(project.repository, input.name, input.content) });
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
		const input = validateCheckpointCreate(await ctx.readBody());
		const label = input.label?.trim() ? input.label : "Saved by you";
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
		const input = validateSessionEngine(await ctx.readBody());
		if (!host.getWorkspacePath(ctx.params.id)) {
			throw conflict("External agents need a session with a workspace (its own branch or the project folder).");
		}
		const saved = engines.setEngine(ctx.params.id, input.engine, null, input.interactionMode);
		ctx.json(200, { engine: saved?.engine ?? "pi", interactionMode: saved?.interactionMode ?? "chat" });
	}, { originError: "Use ADE to choose the agent." });
}
