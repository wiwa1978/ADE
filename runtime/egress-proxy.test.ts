import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { EgressCredentialProxy } from "./egress-proxy.ts";
import { EuPolicy } from "./eu-policy.ts";

describe("EgressCredentialProxy", () => {
	it("injects real API keys on outbound requests, hides them from child env, enforces EU-only mode, and tracks usage", async () => {
		const seen: Array<{ url: string; headers: Record<string, string> }> = [];
		const dir = mkdtempSync(join(tmpdir(), "ade-egress-proxy-"));
		const eu = new EuPolicy(dir, () => "https://api.mistral.ai/v1");
		const proxy = new EgressCredentialProxy({
			eu,
			resolveCredential: provider => {
				if (provider === "anthropic") return { apiKey: "sk-ant-REAL-SECRET", baseUrl: "https://api.anthropic.com" };
				if (provider === "openai") return { apiKey: "sk-openai-REAL-SECRET", baseUrl: "https://api.openai.com" };
				return { apiKey: "sk-mistral-REAL-SECRET", baseUrl: "https://api.mistral.ai/v1" };
			},
			fetchImpl: async (url, init) => {
				seen.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
				return new Response(JSON.stringify({ id: "msg_1", usage: { input_tokens: 150, output_tokens: 50 } }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});

		try {
			const env = proxy.envForSession("sess-1", { portOverride: 44190 });
			assert.ok(env.ANTHROPIC_API_KEY?.startsWith("ade-proxy-"));
			assert.notEqual(env.ANTHROPIC_API_KEY, "sk-ant-REAL-SECRET");
			assert.equal(env.ANTHROPIC_BASE_URL, "http://127.0.0.1:44190/anthropic");

			// 1. Missing/invalid token is rejected with 401
			const unauth = await proxy.processRequest({
				method: "POST",
				pathname: "/anthropic/v1/messages",
				headers: { "content-type": "application/json", "x-api-key": "wrong-token" },
				body: Buffer.from(JSON.stringify({ model: "claude" })),
			});
			assert.equal(unauth.status, 401);

			// 2. Valid opaque token forwards request with real API key injected
			const ok = await proxy.processRequest({
				method: "POST",
				pathname: "/anthropic/v1/messages",
				headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY! },
				body: Buffer.from(JSON.stringify({ model: "claude" })),
			});
			assert.equal(ok.status, 200);
			assert.equal(seen.length, 1);
			assert.equal(seen[0].url, "https://api.anthropic.com/v1/messages");
			assert.equal(seen[0].headers["x-api-key"], "sk-ant-REAL-SECRET");

			// 3. Usage metrics are tracked per session
			const [sessStats] = proxy.stats("sess-1");
			assert.equal(sessStats.requests, 1);
			assert.equal(sessStats.blocked, 0);
			assert.equal(sessStats.inputTokens, 150);
			assert.equal(sessStats.outputTokens, 50);

			// 4. EU-only mode blocks non-EU provider requests with 403 before reaching upstream
			eu.set({ euOnly: true });
			const blocked = await proxy.processRequest({
				method: "POST",
				pathname: "/anthropic/v1/messages",
				headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY! },
				body: Buffer.from(JSON.stringify({ model: "claude" })),
			});
			assert.equal(blocked.status, 403);
			assert.equal(seen.length, 1, "blocked request never reached upstream");

			// 5. EU compatible endpoint (Mistral) is still allowed under EU-only mode
			const compatOk = await proxy.processRequest({
				method: "POST",
				pathname: "/compatible/chat/completions",
				headers: { "content-type": "application/json", authorization: `Bearer ${env.ADE_COMPATIBLE_PROXY_KEY}` },
				body: Buffer.from(JSON.stringify({ model: "devstral" })),
			});
			assert.equal(compatOk.status, 200);
			assert.equal(seen[1].url, "https://api.mistral.ai/v1/chat/completions");
			assert.equal(seen[1].headers.authorization, "Bearer sk-mistral-REAL-SECRET");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
