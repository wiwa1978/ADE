import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Integrations, validateWebhook } from "./integrations.ts";

test("Slack webhook: validated, stored privately, and posts messages", async () => {
	assert.throws(() => validateWebhook("http://hooks.slack.com/x"), /https/);
	assert.throws(() => validateWebhook("not a url"), /valid URL/);
	const received: string[] = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", chunk => { body += chunk; });
		req.on("end", () => { received.push(JSON.parse(body).text); res.end("ok"); });
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const dir = mkdtempSync(join(tmpdir(), "ade-integrations-"));
	try {
		const integrations = new Integrations(dir);
		assert.equal(await integrations.notify("nothing configured"), false);
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
		const status = integrations.setSlack(url, { automations: false });
		assert.deepEqual(status.slack, { configured: true, events: { finished: true, needsApproval: true, failed: true, automations: false } });
		assert.ok(!JSON.stringify(status).includes("127.0.0.1"), "the webhook URL is never returned");
		assert.equal(integrations.wants("automations"), false);
		assert.equal(await integrations.notify("hello"), true);
		assert.deepEqual(received, ["hello"]);
		if (process.platform !== "win32") assert.equal(statSync(join(dir, "integrations.json")).mode & 0o777, 0o600);
		integrations.setSlack(undefined, { automations: true });
		assert.equal(new Integrations(dir).wants("automations"), true, "events can change without re-entering the webhook");
		integrations.removeSlack();
		assert.equal(readFileSync(join(dir, "integrations.json"), "utf8").includes("hook"), false);
	} finally {
		server.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("Linear: the key is checked before it's saved, and issues are mapped", async () => {
	const calls: Array<{ auth: string; query: string }> = [];
	const fakeFetch = (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
		const { query } = JSON.parse(init.body) as { query: string };
		calls.push({ auth: init.headers.authorization, query });
		if (init.headers.authorization === "lin_api_bad_key_123") return new Response("{}", { status: 401 });
		const data = query.includes("viewer { name")
			? { viewer: { name: "Wim" } }
			: { viewer: { assignedIssues: { nodes: [{ id: "1", identifier: "ENG-7", title: "Fix login", description: "Steps", url: "https://linear.app/x/issue/ENG-7", state: { name: "Todo" }, team: { key: "ENG" } }] } } };
		return new Response(JSON.stringify({ data }), { status: 200 });
	}) as unknown as typeof fetch;
	const dir = mkdtempSync(join(tmpdir(), "ade-linear-"));
	try {
		const integrations = new Integrations(dir, fakeFetch);
		await assert.rejects(integrations.linearIssues(""), /Connect Linear/);
		await assert.rejects(integrations.setLinear("lin_api_bad_key_123"), /rejected/);
		assert.equal(integrations.status().linear.configured, false);
		assert.deepEqual((await integrations.setLinear("lin_api_good_key_123")).linear, { configured: true, viewer: "Wim" });
		const issues = await integrations.linearIssues("");
		assert.deepEqual(issues.map(issue => [issue.identifier, issue.title, issue.state, issue.team]), [["ENG-7", "Fix login", "Todo", "ENG"]]);
		assert.equal(calls.at(-1)?.auth, "lin_api_good_key_123");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
