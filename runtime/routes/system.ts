import { browseDirectories, openInExternalApp, pickNativeFolder } from "../project-onboarding.ts";
import type { Router } from "../router.ts";
import {
	validateCopilotAuth,
	validateModelCredentials,
	validateOpenIn,
	validateProviderTools,
} from "../validators.ts";
import type { RouteDeps } from "./context.ts";

export function registerSystemRoutes(router: Router, { host }: RouteDeps): void {
	router.get("/api/health", async (ctx) => {
		ctx.json(200, await host.health(ctx.url.searchParams.get("provider") ?? undefined));
	});

	router.get("/api/models/catalog", async (ctx) => {
		ctx.json(200, await host.modelCatalog());
	});

	router.get("/api/events", (ctx) => {
		host.events.attachSse(ctx.response, ctx.url.searchParams.get("sessionId"));
	});

	router.get("/api/system/browse-dirs", (ctx) => {
		ctx.json(200, browseDirectories(ctx.url.searchParams.get("path") ?? undefined));
	});

	router.post(
		"/api/system/pick-folder",
		async (ctx) => {
			await ctx.readBody();
			const picked = await pickNativeFolder();
			ctx.json(200, { path: picked });
		},
		{ originError: "Use ADE to browse local folders." },
	);

	router.post(
		"/api/system/open-in",
		async (ctx) => {
			const input = validateOpenIn(await ctx.readBody());
			ctx.json(200, await openInExternalApp(input.app, input.path));
		},
		{ originError: "Use ADE to open a workspace in an external app." },
	);

	router.post(
		"/api/copilot/auth",
		async (ctx) => {
			ctx.json(200, await host.copilotAuth(validateCopilotAuth(await ctx.readBody()).action));
		},
		{ originError: "Use ADE Settings to manage Copilot sign-in." },
	);

	router.post(
		"/api/model-credentials",
		async (ctx) => {
			ctx.json(200, await host.modelCredentials(validateModelCredentials(await ctx.readBody())));
		},
		{ originError: "Use ADE Settings to manage model credentials." },
	);

	router.post(
		"/api/provider-tools",
		async (ctx) => {
			ctx.json(200, await host.providerTools(validateProviderTools(await ctx.readBody())));
		},
		{ originError: "Use ADE Settings to scan providers." },
	);
}
