import type { Router } from "../router.ts";
import { validateTerminalCreate, validateTerminalInput, validateTerminalResize } from "../validators.ts";
import type { RouteDeps } from "./context.ts";

export function registerTerminalRoutes(router: Router, deps: RouteDeps): void {
	const terminals = deps.terminals;
	if (!terminals) return;

	router.get("/api/terminals/:id([0-9a-f-]{36})/output", (ctx) => {
		ctx.json(200, terminals.read(ctx.params.id, ctx.url.searchParams.get("cursor") ?? undefined));
	});

	router.post(
		"/api/terminals",
		async (ctx) => {
			ctx.json(200, terminals.create(validateTerminalCreate(await ctx.readBody())));
		},
		{ originError: "Use ADE to start a terminal." },
	);

	router.post(
		"/api/terminals/:id([0-9a-f-]{36})/input",
		async (ctx) => {
			const input = validateTerminalInput(await ctx.readBody());
			ctx.json(200, terminals.write(ctx.params.id, input.data));
		},
		{ originError: "Use ADE to send terminal input." },
	);

	router.post(
		"/api/terminals/:id([0-9a-f-]{36})/resize",
		async (ctx) => {
			ctx.json(200, terminals.resize(ctx.params.id, validateTerminalResize(await ctx.readBody())));
		},
		{ originError: "Use ADE to resize a terminal." },
	);

	router.delete(
		"/api/terminals/:id([0-9a-f-]{36})",
		(ctx) => {
			ctx.json(200, terminals.close(ctx.params.id));
		},
		{ originError: "Use ADE to close a terminal." },
	);
}
