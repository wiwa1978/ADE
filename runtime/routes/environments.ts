import type { Router } from "../router.ts";
import { scanSshConfig } from "../ssh-config.ts";
import { validateEnvironmentActivate, validateEnvironmentAdd } from "../validators.ts";
import type { RouteDeps } from "./context.ts";

export function registerEnvironmentRoutes(router: Router, deps: RouteDeps): void {
	const environments = deps.environments;
	if (!environments) return;

	router.get("/api/environments", (ctx) => {
		ctx.json(200, environments.list());
	});

	router.get("/api/environments/ssh-hosts", (ctx) => {
		const configPath = ctx.url.searchParams.get("configPath") ?? undefined;
		ctx.json(200, scanSshConfig(configPath));
	});

	router.post(
		"/api/environments",
		async (ctx) => {
			ctx.json(200, { environment: environments.add(validateEnvironmentAdd(await ctx.readBody())) });
		},
		{ originError: "Use ADE Settings to add an SSH environment." },
	);

	router.post(
		"/api/environments/:id([0-9a-f-]{36})/connect",
		async (ctx) => {
			await ctx.readBody();
			ctx.json(200, await environments.connect(ctx.params.id));
		},
		{ originError: "Use ADE Settings to connect an environment." },
	);

	router.post(
		"/api/environments/active",
		async (ctx) => {
			const input = validateEnvironmentActivate(await ctx.readBody());
			ctx.json(200, await environments.activate(input.id));
		},
		{ originError: "Use ADE Settings to switch environments." },
	);

	router.delete(
		"/api/environments/:id([0-9a-f-]{36})",
		async (ctx) => {
			ctx.json(200, await environments.remove(ctx.params.id));
		},
		{ originError: "Use ADE Settings to remove an environment." },
	);
}
