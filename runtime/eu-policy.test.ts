import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EuPolicy, hostRegion } from "./eu-policy.ts";

test("regions: loopback is local, known EU hosts are EU, everything else needs the user's word", () => {
	assert.equal(hostRegion("http://localhost:11434/v1", false), "local");
	assert.equal(hostRegion("https://api.mistral.ai/v1", false), "eu");
	assert.equal(hostRegion("https://example.com/v1", false), "non-eu");
	assert.equal(hostRegion("https://example.com/v1", true), "eu");
	assert.equal(hostRegion("not a url", true), "non-eu");
});

test("EU-only mode fails closed: US providers and agent CLIs are blocked, EU/local ones and exceptions are not", () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-eu-"));
	try {
		let url = "";
		const eu = new EuPolicy(dir, () => url);
		eu.guardProvider("openai"); // off: nothing is blocked
		assert.equal(eu.engineBlock("codex"), null);
		eu.set({ euOnly: true });
		assert.throws(() => eu.guardProvider("openai"), /EU-only mode is on/);
		assert.throws(() => eu.guardProvider("anthropic"), /Settings → EU-only/);
		assert.throws(() => eu.guardProvider("github-copilot"));
		assert.throws(() => eu.guardProvider("compatible"), "no endpoint: unknown means blocked");
		url = "https://api.mistral.ai/v1";
		eu.guardProvider("compatible");
		url = "http://localhost:11434/v1";
		eu.guardProvider("compatible");
		url = "https://my-gateway.example.com/v1";
		assert.throws(() => eu.guardProvider("compatible"));
		eu.set({ compatibleInEu: true });
		eu.guardProvider("compatible");
		assert.match(eu.engineBlock("claude-code") ?? "", /Claude Code|claude-code/);
		assert.equal(eu.engineBlock("pi"), null);
		eu.set({ exceptions: ["provider:openai", "engine:codex", "bogus", "mcp:"] });
		eu.guardProvider("openai");
		assert.equal(eu.engineBlock("codex"), null);
		assert.deepEqual(eu.get().exceptions, ["provider:openai", "engine:codex"]);
		assert.equal(new EuPolicy(dir).get().euOnly, true, "the setting survives a restart");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
