import type { Router } from "../router.ts";
import { validateMcpSave } from "../validators.ts";
import type { RouteDeps } from "./context.ts";
import { mcpScope } from "./scope.ts";

export function registerMcpRoutes(router: Router, { host }: RouteDeps): void {
	router.get("/api/mcp", (ctx) => {
		ctx.json(200, { servers: host.mcp.list() });
	});

	router.post(
		"/api/mcp",
		async (ctx) => {
			ctx.json(200, { server: host.mcp.save(validateMcpSave(await ctx.readBody())) });
		},
		{ originError: "Use ADE Settings to configure MCP servers." },
	);

	router.post(
		"/api/mcp/:id/connect",
		async (ctx) => {
			ctx.json(200, { server: await host.mcp.connect(ctx.params.id, mcpScope(host, ctx.url.searchParams.get("projectId"))) });
		},
		{ originError: "Use ADE Settings to connect MCP servers." },
	);

	router.post(
		"/api/mcp/:id/disconnect",
		(ctx) => {
			host.mcp.disconnect(ctx.params.id);
			ctx.json(200, { servers: host.mcp.list() });
		},
		{ originError: "Use ADE Settings to disconnect MCP servers." },
	);

	router.delete(
		"/api/mcp/:id",
		(ctx) => {
			host.mcp.remove(ctx.params.id);
			ctx.json(200, { servers: host.mcp.list() });
		},
		{ originError: "Use ADE Settings to remove MCP servers." },
	);
}
