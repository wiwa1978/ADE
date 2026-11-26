import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openSpecBlueprint } from "@ade/blueprints";
import { EuPolicy } from "./eu-policy.ts";
import { ModelRouting, type CatalogProvider } from "./model-routing.ts";

const catalog: CatalogProvider[] = [
	{ id: "anthropic", configured: true, defaultModel: "claude-sonnet-4-5", models: [{ id: "claude-sonnet-4-5" }, { id: "claude-opus-4-5" }, { id: "claude-haiku-4-5" }] },
	{ id: "openai", configured: true, defaultModel: "gpt-5", models: [{ id: "gpt-5" }] },
	{ id: "compatible", configured: true, defaultModel: "mistral-large-latest", models: [{ id: "mistral-large-latest" }] },
];
const stage = openSpecBlueprint.stages.find(item => item.id === "propose_delta")!;
const session = { provider: "anthropic", model: "claude-sonnet-4-5" };

function setup(compatibleUrl = "https://api.mistral.ai/v1", providers = catalog) {
	const dir = mkdtempSync(join(tmpdir(), "ade-routing-"));
	const eu = new EuPolicy(dir, () => compatibleUrl);
	return { eu, routing: new ModelRouting(async () => providers, eu), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the Captain keeps the user's model unless the project sets one for the stage", async () => {
	const { routing, done } = setup();
	try {
		assert.deepEqual(await routing.forTurn(null, null, session), { ...session, source: "session" });
		assert.equal((await routing.forTurn(stage, { modelProfile: "balanced" }, session)).source, "session", "the default profile means no choice was made");
		const pinned = await routing.forTurn(stage, { stageOverrides: { propose_delta: { provider: "openai", model: "gpt-5" } } }, session);
		assert.deepEqual([pinned.provider, pinned.model, pinned.source], ["openai", "gpt-5", "stage-override"]);
		// A pinned model that isn't set up isn't swapped in.
		const missing = await routing.forTurn(stage, { stageOverrides: { propose_delta: { provider: "openai", model: "gpt-9" } } }, session);
		assert.equal(missing.provider, "anthropic");
		// A profile the project chose supplies the role's model when it's available.
		const profile = await routing.forTurn(stage, { modelProfile: "max-quality" }, session);
		assert.deepEqual([profile.provider, profile.model, profile.source], ["anthropic", "claude-opus-4-5", "role-default"]);
	} finally { done(); }
});

test("the reviewer runs on another model family than the Captain when one is set up", async () => {
	const { routing, done } = setup();
	try {
		const review = await routing.reviewer(stage, null, session);
		assert.equal(review.independent, true);
		assert.notEqual(review.model?.provider, "anthropic");
		const only = setup("", [catalog[0]]);
		const same = await only.routing.reviewer(stage, null, session);
		assert.deepEqual([same.model, same.independent], [null, false], "no second family: the review says so, it doesn't pretend");
		only.done();
	} finally { done(); }
});

test("EU-only mode keeps both the Captain and the reviewer on EU or local models", async () => {
	const { routing, eu, done } = setup("https://api.mistral.ai/v1");
	try {
		eu.set({ euOnly: true });
		const review = await routing.reviewer(stage, null, { provider: "compatible", model: "mistral-large-latest" });
		assert.equal(review.model, null, "only EU models are allowed, and the Captain already runs on the only one");
		const us = await routing.forTurn(stage, { stageOverrides: { propose_delta: { provider: "openai", model: "gpt-5" } } }, { provider: "compatible", model: "mistral-large-latest" });
		assert.equal(us.provider, "compatible", "a pinned US model is not used");
		eu.set({ exceptions: ["provider:openai"] });
		const allowed = await routing.reviewer(stage, null, { provider: "compatible", model: "mistral-large-latest" });
		assert.equal(allowed.model?.provider, "openai", "an exception makes a US reviewer possible");
	} finally { done(); }
});

test("per-project euOnlyMode blocks US providers even when global EU-only is off", async () => {
	const { routing, eu, done } = setup("https://api.mistral.ai/v1");
	try {
		assert.equal(eu.on, false);
		assert.throws(() => eu.guardProvider("openai", true), /EU-only mode is on/);
		assert.match(eu.engineBlock("claude-code", true) ?? "", /EU-only mode is on/);
		const us = await routing.forTurn(
			stage,
			{ euOnlyMode: true, stageOverrides: { propose_delta: { provider: "openai", model: "gpt-5" } } },
			{ provider: "compatible", model: "mistral-large-latest" },
		);
		assert.equal(us.provider, "compatible", "per-project EU-only rejects pinned US model");
		const review = await routing.reviewer(stage, { euOnlyMode: true }, { provider: "compatible", model: "mistral-large-latest" });
		assert.equal(review.model, null, "per-project EU-only rejects US reviewer");
	} finally { done(); }
});
