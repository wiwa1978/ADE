import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerBoardRoutes } from "./routes/board.ts";
import { Router } from "./router.ts";
import { TeamBoard } from "./team-board.ts";
import { runBoard } from "../scripts/ade-board.ts";

test("ade board talks to the local board routes", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-board-http-"));
	const board = new TeamBoard(dir);
	const router = new Router();
	registerBoardRoutes(router, { host: { team: board } } as never);
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const handled = await router.dispatch({
			request,
			response,
			url,
			json: (status, value) => {
				response.writeHead(status, { "content-type": "application/json" });
				response.end(JSON.stringify(value));
			},
			requireWorkspace: () => "",
		}, {
			origins: [],
			readBody: async (incoming) => JSON.parse(await new Promise<string>((resolve, reject) => {
				const chunks: Buffer[] = [];
				incoming.on("data", (chunk) => chunks.push(chunk));
				incoming.on("end", () => resolve(Buffer.concat(chunks).toString("utf8") || "{}"));
				incoming.on("error", reject);
			})) as Record<string, unknown>,
		});
		if (!handled) {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	process.env.ADE_RUNTIME_URL = `http://127.0.0.1:${port}`;
	try {
		board.addTask("s1", "lead", { title: "Ship" });
		const claim = await runBoard(["task", "claim", "--session", "s1", "--id", "T1", "--as", "bee"]) as { claimToken: string };
		assert.ok(claim.claimToken);
		const done = await runBoard(["task", "complete", "--session", "s1", "--id", "T1", "--as", "bee", "--token", claim.claimToken, "--result", "shipped"]) as { message: string };
		assert.match(done.message, /Done/);
		const waiting = runBoard(["wait", "--project", "alpha", "--channel", "ops", "--after", "0", "--timeout", "2000"]);
		await runBoard(["post", "--project", "alpha", "--channel", "ops", "--text", "hello", "--as", "bee"]);
		const heard = await waiting as { matched: boolean; posts: { text: string }[] };
		assert.equal(heard.matched, true);
		assert.equal(heard.posts[0]?.text, "hello");
		const read = await runBoard(["read", "--session", "s1"]) as { tasks: { status: string }[] };
		assert.equal(read.tasks[0]?.status, "done");
	} finally {
		delete process.env.ADE_RUNTIME_URL;
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		rmSync(dir, { recursive: true, force: true });
	}
});
