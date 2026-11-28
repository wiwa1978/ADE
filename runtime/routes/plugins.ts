import {
	MarketplaceSourceAddRequestSchema,
	PluginInstallRequestSchema,
	PluginSettingsUpdateRequestSchema,
	PluginToggleRequestSchema,
} from "@ade/protocol";
import { badRequest } from "../http-error.ts";
import type { Router } from "../router.ts";
import type { RouteDeps } from "./context.ts";

export function registerPluginRoutes(router: Router, deps: RouteDeps) {
	const { plugins } = deps;
	if (!plugins) return;

	router.get("/api/plugins", (ctx) => {
		ctx.json(200, plugins.snapshot());
	});

	router.post("/api/plugins/:id/toggle", async (ctx) => {
		const parsed = PluginToggleRequestSchema.safeParse(await ctx.readBody());
		if (!parsed.success) throw badRequest("Provide { enabled: boolean }.");
		ctx.json(200, plugins.toggle(ctx.params.id, parsed.data.enabled));
	}, { originError: "Use ADE to enable or disable plugins." });

	router.put("/api/plugins/:id/settings", async (ctx) => {
		const parsed = PluginSettingsUpdateRequestSchema.safeParse(await ctx.readBody());
		if (!parsed.success) throw badRequest("Provide { values: Record<string, string | boolean> }.");
		ctx.json(200, plugins.updateSettings(ctx.params.id, parsed.data.values));
	}, { originError: "Use ADE to update plugin settings." });

	router.post("/api/plugins/:id/test-notification", async (ctx) => {
		await ctx.readBody().catch(() => ({}));
		ctx.json(200, await plugins.sendTestNotification(ctx.params.id));
	}, { originError: "Use ADE to test plugin notifications." });

	router.post("/api/plugins/install", async (ctx) => {
		const parsed = PluginInstallRequestSchema.safeParse(await ctx.readBody());
		if (!parsed.success) throw badRequest("Provide a valid pluginId.");
		ctx.json(200, plugins.install(parsed.data.pluginId, parsed.data.sourceId));
	}, { originError: "Use ADE to install plugins." });

	router.delete("/api/plugins/:id", (ctx) => {
		ctx.json(200, plugins.uninstall(ctx.params.id));
	}, { originError: "Use ADE to uninstall plugins." });

	router.post("/api/plugins/sources", async (ctx) => {
		const parsed = MarketplaceSourceAddRequestSchema.safeParse(await ctx.readBody());
		if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message || "Provide a GitHub repo or marketplace.json URL.");
		ctx.json(200, await plugins.addSource(parsed.data));
	}, { originError: "Use ADE to add marketplace sources." });

	router.delete("/api/plugins/sources/:id", (ctx) => {
		ctx.json(200, plugins.removeSource(ctx.params.id));
	}, { originError: "Use ADE to remove marketplace sources." });

	router.post("/api/plugins/refresh", async (ctx) => {
		await ctx.readBody().catch(() => ({}));
		ctx.json(200, await plugins.refreshSources());
	}, { originError: "Use ADE to refresh marketplace sources." });
}
