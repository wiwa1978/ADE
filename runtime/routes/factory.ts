import { getBlueprint, listBlueprints } from "../../packages/blueprints/index.ts";
import { listModelProfiles } from "../../packages/captain-core/index.ts";
import { badRequest, notFound } from "../http-error.ts";
import type { Router } from "../router.ts";
import { validateFactoryAction, validateFactoryRunCreate } from "../validators.ts";
import type { RouteDeps } from "./context.ts";

export function registerFactoryRoutes(router: Router, { host }: RouteDeps): void {
	router.get("/api/factory/capabilities", (ctx) => {
		ctx.json(200, {
			flavor: "local",
			captainHost: host.factory.host.kind,
			region: host.factory.host.region,
			blueprints: listBlueprints().map(({ id, name, bestFor }) => ({ id, name, bestFor })),
			modelProfiles: listModelProfiles().map(({ id, name, euCompliantByDefault }) => ({ id, name, euCompliantByDefault })),
			features: {
				lazyHandsOnDemand: true,
				goldfishQualityAudit: true,
				tokenEconomizer: true,
				euOnlyModeGuard: true,
			},
		});
	});

	router.get("/api/factory/blueprints", (ctx) => {
		ctx.json(200, { blueprints: listBlueprints() });
	});

	router.get("/api/factory/model-profiles", (ctx) => {
		ctx.json(200, { profiles: listModelProfiles() });
	});

	router.get("/api/factory/runs", (ctx) => {
		const projectId = ctx.url.searchParams.get("projectId") ?? undefined;
		ctx.json(200, { runs: host.factoryRunner.listRuns(projectId) });
	});

	router.post(
		"/api/factory/runs",
		async (ctx) => {
			const input = validateFactoryRunCreate(await ctx.readBody());
			const project =
				input.projectId && input.projectId !== "default"
					? host.projects().find((p) => p.id === input.projectId)
					: null;
			const blueprintId = input.blueprintId ?? project?.blueprintId ?? "automated-factory";
			if (!getBlueprint(blueprintId)) throw badRequest(`Unknown blueprint "${blueprintId}".`);
			const repoPath =
				(input.repoPath?.trim()) ||
				(typeof project?.repository === "string" && project.repository.trim()) ||
				"";
			if (!repoPath) {
				throw badRequest("Link a local Git checkout path in Project Settings before starting a Factory run.");
			}
			const projectGithubSlug = project?.githubUrl
				? String(project.githubUrl).replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "")
				: undefined;
			const detail = await host.factoryRunner.createRun({
				runId: input.runId,
				projectId: project?.id ?? input.projectId,
				blueprintId,
				repoPath,
				githubRepo: input.githubRepo?.trim() || projectGithubSlug,
				issueNumber: input.issueNumber,
				taskPrompt: input.taskPrompt,
				baseBranch: input.baseBranch?.trim() || undefined,
				modelProfile: input.modelProfile ?? (project?.modelProfile as typeof input.modelProfile),
				stageOverrides: input.stageOverrides ?? project?.stageOverrides,
				euOnlyMode: input.euOnlyMode ?? Boolean(project?.euOnlyMode),
				cloudActFree: input.cloudActFree ?? Boolean(project?.cloudActFree),
				disabledStageIds: input.disabledStageIds,
			});
			if (input.autoStart) {
				ctx.json(201, { run: host.factoryRunner.startAutoRun(detail.run.runId) });
				return;
			}
			ctx.json(201, { run: detail });
		},
		{ originError: "Use ADE to start a factory run." },
	);

	router.get("/api/factory/runs/:runId", (ctx) => {
		const detail = host.factoryRunner.getRun(ctx.params.runId);
		if (!detail) throw notFound("Factory run not found.");
		ctx.json(200, { run: detail });
	});

	router.post(
		"/api/factory/runs/:runId/:action(step|auto-run|steer|approve|pause|takeover)",
		async (ctx) => {
			const { runId, action } = ctx.params;
			const input = validateFactoryAction(action, await ctx.readBody());
			if (action === "step") {
				ctx.json(200, { run: await host.factoryRunner.stepRun(runId) });
			} else if (action === "auto-run") {
				ctx.json(200, { run: host.factoryRunner.startAutoRun(runId) });
			} else if (action === "steer") {
				ctx.json(200, { run: await host.factoryRunner.steerRun(runId, input.note ?? "") });
			} else if (action === "approve") {
				ctx.json(200, {
					run: await host.factoryRunner.approveRunStage(runId, input.decision ?? "approve", input.cardId, input.note),
				});
			} else if (action === "pause") {
				ctx.json(200, { run: await host.factoryRunner.pauseRun(runId) });
			} else if (action === "takeover") {
				ctx.json(200, { run: await host.factoryRunner.takeOverRun(runId, input.enable ?? true) });
			}
		},
		{ originError: "Use ADE to control factory runs." },
	);
}
