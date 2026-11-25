// Local board v2: session boards and project:<id> boards, over the team board.
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

export function registerBoardRoutes(router: Router, { host }: RouteDeps): void {
	const local = { requireAppOrigin: false as const };
	const guard = (remote: string | undefined) => {
		if (remote && !loopback(remote)) throw forbidden("The board is local only.");
	};

	router.get("/api/board", (ctx) => {
		guard(ctx.request.socket.remoteAddress);
		const id = boardId(ctx.url.searchParams.get("board"));
		const channel = ctx.url.searchParams.get("channel");
		const state = host.team.state(id);
		ctx.json(200, { board: id, posts: host.team.posts(id, channel), tasks: state.tasks, lastSeq: state.posts.at(-1)?.seq ?? 0 });
	});

	router.post("/api/board/posts", async (ctx) => {
		guard(ctx.request.socket.remoteAddress);
		const body = await ctx.readBody();
		const post = host.team.post(boardId(body.board), String(body.as ?? "cli"), {
			text: String(body.text ?? ""),
			channel: body.channel == null ? null : String(body.channel),
			to: Array.isArray(body.to) ? body.to.map(String) : undefined,
		});
		ctx.json(200, { post });
	}, local);

	router.post("/api/board/tasks/claim", async (ctx) => {
		guard(ctx.request.socket.remoteAddress);
		const body = await ctx.readBody();
		const lease = typeof body.leaseMs === "number" ? body.leaseMs : undefined;
		ctx.json(200, host.team.claimTask(boardId(body.board), String(body.as ?? "cli"), String(body.id ?? ""), lease));
	}, local);

	router.post("/api/board/tasks/complete", async (ctx) => {
		guard(ctx.request.socket.remoteAddress);
		const body = await ctx.readBody();
		const message = host.team.finishTask(boardId(body.board), String(body.as ?? "cli"), String(body.id ?? ""), String(body.result ?? ""), body.token == null ? null : String(body.token));
		ctx.json(200, { message });
	}, local);

	router.get("/api/board/wait", async (ctx) => {
		guard(ctx.request.socket.remoteAddress);
		const id = boardId(ctx.url.searchParams.get("board"));
		const after = Number(ctx.url.searchParams.get("after") ?? "0");
		const timeout = Number(ctx.url.searchParams.get("timeout") ?? "30000");
		const channel = ctx.url.searchParams.get("channel");
		ctx.json(200, await host.team.waitFor(id, { afterSeq: Number.isFinite(after) ? after : 0, channel, timeoutMs: Number.isFinite(timeout) ? timeout : 30_000 }));
	});
}
