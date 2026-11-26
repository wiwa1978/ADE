import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { TeamBoard } from "./team-board.ts";
import { createTeamTools } from "./team-tools.ts";

test("each agent acts as itself: the lead plans the board, members take tasks, post and claim files", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-teamtools-"));
	try {
		const board = new TeamBoard(dir);
		const ext = createTeamTools({ sessionId: "s", board, agents: async () => [{ id: "c-api", name: "api" }, { id: "c-ui", name: "ui" }] });
		const tool = (name: string) => (ext.tools ?? []).find(entry => entry.name === name) as unknown as { execute: (args: Record<string, unknown>, api: { conversationId: unknown }) => Promise<{ output: Array<{ text: string }> }> };
		const call = async (name: string, args: Record<string, unknown>, conversationId: unknown) => (await tool(name).execute(args, { conversationId })).output[0].text;
		const lead = ROOT_CONVERSATION_ID;

		assert.match(await call("team_tasks", { action: "add", title: "Theme in the API", owner: "api" }, lead), /Added T1/);
		assert.match(await call("team_tasks", { action: "add", title: "Toggle", owner: "ui", dependsOn: ["T1"] }, lead), /Added T2/);
		assert.match(await call("team_tasks", { action: "take", id: "T2" }, "c-ui"), /waits for T1/, "mistakes come back as answers, not errors");
		assert.match(await call("team_tasks", { action: "take", id: "T1" }, "c-api"), /You have T1/);
		assert.match(await call("team_claim", { paths: ["api/"] }, "c-api"), /Claimed: api/);
		assert.match(await call("team_claim", { paths: ["api/prefs.ts"] }, "c-ui"), /Refused: api\/prefs\.ts \(held by api\)/);
		assert.match(await call("team_post", { text: "Per user or device?", kind: "question", to: ["lead"] }, "c-api"), /Posted #1/);
		assert.match(await call("team_read", {}, lead), /#1 api \(question\): Per user or device\?/);
		assert.match(await call("team_tasks", { action: "send_back", id: "T1", note: "x" }, "c-ui"), /Only the lead/);
		assert.match(await call("team_tasks", { action: "done", id: "T1", result: "Added theme" }, "c-api"), /T2 can start/);
		assert.match(await call("team_tasks", {}, lead), /T1 \[done\] Theme in the API · api\nT2 \[todo\] Toggle · ui/);
		assert.equal(board.state("s").claims.length, 0, "finishing released api's claims");
		assert.deepEqual(new Set(board.state("s").events.map(event => event.from)), new Set(["lead", "tasks", "c-api", "claims", "board"]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("swarm tools: team_overview and team_focus wire goal, threads, and live worker focus", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-teamtools-swarm-"));
	try {
		const board = new TeamBoard(dir);
		const ext = createTeamTools({ sessionId: "s", board, agents: async () => [{ id: "c-zod", name: "zod-protocol" }] });
		const tool = (name: string) => (ext.tools ?? []).find(entry => entry.name === name) as unknown as { execute: (args: Record<string, unknown>, api: { conversationId: unknown }) => Promise<{ output: Array<{ text: string }> }> };
		const call = async (name: string, args: Record<string, unknown>, conversationId: unknown) => (await tool(name).execute(args, { conversationId })).output[0].text;
		const lead = ROOT_CONVERSATION_ID;

		assert.match(await call("team_overview", { action: "set_goal", title: "ADE Audit", goalTitle: "Harden security", goalSummary: "Zod + runtime + UI" }, lead), /Harden security/);
		assert.match(await call("team_overview", { action: "thread", title: "Zod safety", summary: "Validate all boundaries" }, lead), /Thread TH1 saved/);
		assert.match(await call("team_tasks", { action: "add", title: "Add Zod schemas", owner: "zod-protocol", threadId: "TH1" }, lead), /Added T1/);
		assert.match(await call("team_tasks", { action: "take", id: "T1" }, "c-zod"), /You have T1/);
		assert.match(await call("team_tasks", { action: "renew", id: "T1", leaseMs: 120_000 }, "c-zod"), /Renewed T1/);
		assert.match(await call("team_post", { text: "Schema check passed", channel: "review" }, "c-zod"), /Posted #1/);
		assert.match(await call("team_read", { channel: "ops" }, lead), /Nothing new/);
		assert.match(await call("team_read", { channel: "review" }, lead), /Schema check passed/);
		assert.match(await call("team_focus", { text: "Check MobilePairingManager constructor signature" }, "c-zod"), /Focus set/);
		assert.match(await call("team_overview", { action: "status" }, lead), /Zod safety \(0\/1\) · Now: Check MobilePairingManager/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
