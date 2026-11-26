import type { Router } from "../router.ts";
import { validateTerminalCreate, validateTerminalInput, validateTerminalResize } from "../validators.ts";
import type { RouteDeps } from "./context.ts";

export function registerTerminalRoutes(router: Router, deps: RouteDeps): void {
	const terminals = deps.terminals;
	if (!terminals) return;

	router.get("/api/terminals/:id([0-9a-f-]{36})/output", (ctx) => {
		ctx.json(200, terminals.read(ctx.params.id, ctx.url.searchParams.get("cursor") ?? undefined));
	});

	router.get("/api/terminals/:id([0-9a-f-]{36})/stream", (ctx) => {
		const cursor = ctx.url.searchParams.get("cursor") ?? undefined;
		// Validate terminal id and cursor before opening the SSE response.
		terminals.read(ctx.params.id, cursor);
		ctx.response.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-content-type-options": "nosniff",
		});
		let closed = false;
		let unsubscribe = () => {};
		const heartbeat = setInterval(() => {
			if (closed) return;
			try {
				ctx.response.write(": ping\n\n");
			} catch {
				cleanup();
			}
		}, 20_000);
		heartbeat.unref?.();
		const cleanup = () => {
			if (closed) return;
			closed = true;
			clearInterval(heartbeat);
			unsubscribe();
			try {
				if (!ctx.response.writableEnded) ctx.response.end();
			} catch {
				// Client already disconnected.
			}
		};
		ctx.response.once("close", cleanup);
		ctx.response.once("error", cleanup);
		unsubscribe = terminals.subscribe(ctx.params.id, cursor, event => {
			if (closed) return;
			try {
				ctx.response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
				if (event.type === "exit") cleanup();
			} catch {
				cleanup();
			}
		});
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
