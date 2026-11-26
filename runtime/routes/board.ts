// Local board v2: session boards and project:<id> boards, over the team board.
import type { IncomingMessage } from "node:http";
import { forbidden } from "../http-error.ts";
import { projectBoardId } from "../team-board.ts";
import type { Router } from "../router.ts";
import type { RouteDeps } from "./context.ts";

function boardId(value: unknown): string {
	const raw = String(value ?? "").trim();
	if (raw.startsWith("project:")) return projectBoardId(raw.slice("project:".length));
	return raw;
}

function loopback(address: string | undefined): boolean {
	if (!address) return false;
	const host = address.replace(/^::ffff:/, "");
	return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function allowedBoardOrigin(origin: string | undefined): boolean {
	if (!origin) return true;
	if (origin === "tauri://localhost" || origin === "http://tauri.localhost" || origin === "https://tauri.localhost") return true;
	try {
		const url = new URL(origin);
		return (url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]" || url.hostname === "::1");
	} catch {
		return false;
	}
}

function loopbackHostHeader(hostHeader: string | undefined): boolean {
	if (!hostHeader) return true;
	try {
		const host = new URL(`http://${hostHeader}`).hostname;
		return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
	} catch {
		return false;
	}
}

export function registerBoardRoutes(router: Router, { host }: RouteDeps): void {
	const local = { requireAppOrigin: false as const };
	const guard = (request: IncomingMessage) => {
		const remote = request.socket?.remoteAddress;
		if (remote && !loopback(remote)) throw forbidden("The board is local only.");
		const headers = request.headers;
		if (headers["cf-connecting-ip"] || headers["x-forwarded-for"] || headers["x-forwarded-host"] || headers.forwarded) {
			throw forbidden("The board is local only and cannot be reached through a proxy or tunnel.");
		}
		if (!loopbackHostHeader(headers.host)) throw forbidden("The board is local only.");
		if (headers["sec-fetch-site"] === "cross-site" || !allowedBoardOrigin(headers.origin)) {
			throw forbidden("Cross-origin board requests are not allowed.");
		}
	};

	router.get("/api/board", (ctx) => {
		guard(ctx.request);
		const id = boardId(ctx.url.searchParams.get("board"));
		const channel = ctx.url.searchParams.get("channel");
		const state = host.team.state(id);
		ctx.json(200, { board: id, posts: host.team.posts(id, channel), tasks: state.tasks, lastSeq: state.posts.at(-1)?.seq ?? 0 });
	});

	router.post("/api/board/posts", async (ctx) => {
		guard(ctx.request);
		const body = await ctx.readBody();
		const post = host.team.post(boardId(body.board), String(body.as ?? "cli"), {
			text: String(body.text ?? ""),
			channel: body.channel == null ? null : String(body.channel),
			to: Array.isArray(body.to) ? body.to.map(String) : undefined,
		});
		ctx.json(200, { post });
	}, local);

	router.post("/api/board/tasks/claim", async (ctx) => {
		guard(ctx.request);
		const body = await ctx.readBody();
		const lease = typeof body.leaseMs === "number" ? body.leaseMs : undefined;
		ctx.json(200, host.team.claimTask(boardId(body.board), String(body.as ?? "cli"), String(body.id ?? ""), lease));
	}, local);

	router.post("/api/board/tasks/renew", async (ctx) => {
		guard(ctx.request);
		const body = await ctx.readBody();
		const lease = typeof body.leaseMs === "number" ? body.leaseMs : undefined;
		const token = body.token == null ? null : String(body.token);
		ctx.json(200, host.team.renewTask(boardId(body.board), String(body.as ?? "cli"), String(body.id ?? ""), token, lease));
	}, local);

	router.post("/api/board/tasks/complete", async (ctx) => {
		guard(ctx.request);
		const body = await ctx.readBody();
		const message = host.team.finishTask(boardId(body.board), String(body.as ?? "cli"), String(body.id ?? ""), String(body.result ?? ""), body.token == null ? null : String(body.token));
		ctx.json(200, { message });
	}, local);

	router.get("/api/board/wait", async (ctx) => {
		guard(ctx.request);
		const id = boardId(ctx.url.searchParams.get("board"));
		const after = Number(ctx.url.searchParams.get("after") ?? "0");
		const timeout = Number(ctx.url.searchParams.get("timeout") ?? "30000");
		const channel = ctx.url.searchParams.get("channel");
		ctx.json(200, await host.team.waitFor(id, { afterSeq: Number.isFinite(after) ? after : 0, channel, timeoutMs: Number.isFinite(timeout) ? timeout : 30_000 }));
	});
}
