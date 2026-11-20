import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { copilotId, createCopilotSignIn, createCopilotStore } from "./copilot-auth.mjs";
import { LocalAgentHost } from "./host.mjs";
import { createModelConfig, createRuntimeModels, safeErrorMessage } from "./models.mjs";
import { createRuntimeServer } from "./server.mjs";

test("compatible providers require HTTPS away from loopback and an explicit model", () => {
	assert.throws(() => createModelConfig({
		ADE_PROVIDER: "compatible",
		ADE_COMPATIBLE_URL: "http://models.example/v1",
		ADE_COMPATIBLE_MODEL: "model-a",
	}), /HTTPS/);
	assert.throws(() => createModelConfig({
		ADE_PROVIDER: "compatible",
		ADE_COMPATIBLE_URL: "https://models.example/v1",
		ADE_COMPATIBLE_MODEL: "model-a",
	}), /ADE_COMPATIBLE_KEY/);

	const local = createModelConfig({
		ADE_PROVIDER: "compatible",
		ADE_COMPATIBLE_URL: "http://127.0.0.1:11434/v1",
		ADE_COMPATIBLE_MODEL: "local-model",
	});
	assert.equal(local.configured, true);
	assert.equal(local.defaultModel, "local-model");
	assert.equal(local.availableModels[0].id, "local-model");
});

test("provider errors redact configured secrets and URL query values", () => {
	const error = safeErrorMessage(
		new Error("Request failed for https://models.example/v1?token=private-value"),
		{ ADE_COMPATIBLE_KEY: "private-value" },
	);
	assert.doesNotMatch(error, /private-value/);
	assert.doesNotMatch(error, /token=/);
});

test("Radius uses the authenticated account catalog and rejects models outside it", async (t) => {
	const catalog = [{ id: "fixture-model", name: "Account model", reasoning: true, input: ["text"], cost: {}, contextWindow: 8192, maxTokens: 1024 }];
	const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
		assert.equal(String(url), "https://radius.pi.dev/v1/config");
		assert.equal(options.headers.authorization, "Bearer fixture-key");
		return Response.json({ baseUrl: "https://radius.pi.dev", models: catalog });
	});
	const runtime = createRuntimeModels({ RADIUS_API_KEY: "fixture-key", COPILOT_GITHUB_TOKEN: "must-not-use" }, tmpdir());
	const config = await runtime.config("radius");
	assert.equal(config.configured, true, config.setupMessage);
	assert.deepEqual(config.availableModels, [{ id: "fixture-model", name: "Account model" }]);
	assert.equal(config.resolveModel("balanced"), undefined);
	assert.equal(config.resolveModel("fixture-model")?.provider, "radius");
	assert.equal(await config.models.getAuth(copilotId), undefined, "ambient Copilot token must be ignored");
	await runtime.config("radius");
	assert.equal(fetch.mock.callCount(), 1);
});

test("Copilot sign-in publishes only the device challenge, supports cancellation and removes the local credential on sign-out", async () => {
	let signedOut;
	const signIn = createCopilotSignIn({
		async login(id, type, flow) {
			assert.equal(id, copilotId);
			assert.equal(type, "oauth");
			flow.notify({ type: "device_code", userCode: "TEST-CODE", verificationUri: "https://github.com/login/device" });
			await new Promise((resolve, reject) => flow.signal.addEventListener("abort", reject, { once: true }));
		},
		async logout(id) { signedOut = id; },
	});
	assert.deepEqual(signIn.start(), { status: "waiting", code: "TEST-CODE", url: "https://github.com/login/device" });
	assert.throws(() => signIn.start(), /already in progress/);
	assert.deepEqual(await signIn.cancel(), { status: "idle" });
	await signIn.signOut();
	assert.equal(signedOut, copilotId);
});

test("Copilot credentials survive reopen encrypted and constrain the picker to account models", { skip: process.platform !== "win32" }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "ade-copilot-auth-"));
	const credential = {
		type: "oauth", access: "fixture-access", refresh: "fixture-refresh",
		expires: Date.now() + 3600000, availableModelIds: ["gpt-5.3-codex", "not-in-the-pinned-catalog"],
	};
	try {
		await createCopilotStore(dir).modify(copilotId, async () => credential);
		assert.doesNotMatch(await readFile(join(dir, "copilot-auth.dpapi"), "utf8"), /fixture-access|fixture-refresh/);
		assert.deepEqual(await createCopilotStore(dir).read(copilotId), credential);
		const runtime = createRuntimeModels({}, dir);
		const config = await runtime.config(copilotId);
		assert.equal(config.configured, true, config.setupMessage);
		assert.deepEqual(config.availableModels.map(model => model.id), ["gpt-5.3-codex"]);
		await runtime.signIn.signOut();
		assert.equal(await createCopilotStore(dir).read(copilotId), undefined);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("saved API keys are protected, take precedence, survive restart, and can be removed", { skip: process.platform !== "win32" }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "ade-api-keys-"));
	const environment = {
		OPENAI_API_KEY: "fixture-environment-key",
		ADE_COMPATIBLE_URL: "https://models.example/v1",
		ADE_COMPATIBLE_MODEL: "fixture-model",
	};
	try {
		const runtime = createRuntimeModels(environment, dir);
		assert.equal((await runtime.credentialStatus()).find(item => item.provider === "openai").source, "environment");
		await runtime.changeCredential("save", "openai", "fixture-saved-key");
		await runtime.changeCredential("save", "compatible", "fixture-compatible-key");
		assert.doesNotMatch(await readFile(join(dir, "provider-openai-auth.dpapi"), "utf8"), /fixture-saved-key/);
		assert.doesNotMatch(await readFile(join(dir, "provider-compatible-auth.dpapi"), "utf8"), /fixture-compatible-key/);

		const reopened = createRuntimeModels(environment, dir);
		assert.equal((await reopened.credentialStatus()).find(item => item.provider === "openai").source, "saved");
		const openai = await reopened.config("openai");
		assert.equal(openai.configured, true);
		assert.equal((await openai.models.getAuth("openai")).auth.apiKey, "fixture-saved-key");
		assert.doesNotMatch(reopened.safeErrorMessage(new Error("failure: fixture-saved-key")), /fixture-saved-key/);
		const compatible = await reopened.config("compatible");
		assert.equal(compatible.configured, true);
		assert.equal((await compatible.models.getAuth("compatible")).auth.apiKey, "fixture-compatible-key");

		await reopened.changeCredential("remove", "openai");
		assert.equal((await reopened.credentialStatus()).find(item => item.provider === "openai").source, "environment");
		assert.equal((await openai.models.getAuth("openai")).auth.apiKey, "fixture-environment-key");
		await reopened.changeCredential("remove", "compatible");
		assert.equal((await reopened.config("compatible")).configured, false);
		assert.equal(await compatible.models.getAuth("compatible"), undefined);
		await assert.rejects(reopened.changeCredential("save", "openai", "bad\nkey"), /valid API key/);
		await assert.rejects(reopened.changeCredential("save", "unknown", "fixture"), /Unknown API-key provider/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("changing a saved Radius key refreshes the account's model catalog", { skip: process.platform !== "win32" }, async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "ade-radius-keys-"));
	const fetch = t.mock.method(globalThis, "fetch", async (_url, options) => {
		const id = options.headers.authorization === "Bearer fixture-first-key" ? "first-model" : "second-model";
		return Response.json({ baseUrl: "https://radius.pi.dev", models: [
			{ id, name: id, reasoning: true, input: ["text"], cost: {}, contextWindow: 8192, maxTokens: 1024 },
		] });
	});
	try {
		const runtime = createRuntimeModels({}, dir);
		await runtime.changeCredential("save", "radius", "fixture-first-key");
		assert.deepEqual((await runtime.config("radius")).availableModels.map(model => model.id), ["first-model"]);
		await runtime.changeCredential("save", "radius", "fixture-second-key");
		assert.deepEqual((await runtime.config("radius")).availableModels.map(model => model.id), ["second-model"]);
		assert.equal(fetch.mock.callCount(), 2);
		await runtime.changeCredential("remove", "radius");
		assert.equal((await runtime.config("radius")).configured, false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the Settings credential API protects writes and returns only status across host restarts", { skip: process.platform !== "win32" }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "ade-credential-api-"));
	let host;
	let server;
	const start = async () => {
		host = new LocalAgentHost({ stateDirectory: dir, environment: {} });
		server = createRuntimeServer({ host, worktreeManager: {} });
		await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	};
	const stop = async () => {
		await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		server = undefined;
		await host.close();
		host = undefined;
	};
	const post = (body, origin = "http://127.0.0.1:1420") => fetch(
		`http://127.0.0.1:${server.address().port}/api/model-credentials`,
		{ method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": "application/json" }, body: JSON.stringify(body) },
	);
	try {
		await start();
		assert.equal((await post({ action: "status" }, null)).status, 403);
		assert.equal((await post({ action: "save", provider: "openai", key: "fixture-api-key" }, "https://example.com")).status, 403);
		const saved = await post({ action: "save", provider: "openai", key: "fixture-api-key" });
		assert.equal(saved.status, 200);
		const savedBody = await saved.text();
		assert.doesNotMatch(savedBody, /fixture-api-key/);
		assert.equal(JSON.parse(savedBody).credentials.find(item => item.provider === "openai").source, "saved");
		assert.equal((await host.health("openai")).configured, true);
		assert.doesNotMatch(host.safeErrorMessage(new Error("fixture-api-key")), /fixture-api-key/);
		await stop();
		await start();
		const status = await (await post({ action: "status" })).json();
		assert.equal(status.credentials.find(item => item.provider === "openai").source, "saved");
		assert.equal((await host.health("openai")).configured, true);
		assert.doesNotMatch((await readFile(join(dir, "ade-host.sqlite"))).toString("utf8"), /fixture-api-key/);
		const removed = await post({ action: "remove", provider: "openai" });
		assert.equal((await removed.json()).credentials.find(item => item.provider === "openai").source, "none");
		assert.equal((await host.health("openai")).configured, false);
	} finally {
		if (server) await new Promise(resolve => server.close(resolve));
		if (host) await host.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("Pi Durable sends with a saved compatible-provider key after restart", { skip: process.platform !== "win32" }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "ade-credential-turn-"));
	const requests = [];
	let requestStarted;
	let releaseRequest;
	const started = new Promise(resolve => { requestStarted = resolve; });
	const release = new Promise(resolve => { releaseRequest = resolve; });
	const provider = createServer((request, response) => {
		requests.push({ path: request.url, authorization: request.headers.authorization });
		requestStarted();
		void release.then(() => {
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write(`data: ${JSON.stringify({
				id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model",
				choices: [{ index: 0, delta: { role: "assistant", content: "Fixture response" }, finish_reason: null }],
			})}\n\n`);
			response.write(`data: ${JSON.stringify({
				id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			})}\n\n`);
			response.end("data: [DONE]\n\n");
		});
	});
	await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
	const environment = {
		ADE_PROVIDER: "compatible",
		ADE_COMPATIBLE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
		ADE_COMPATIBLE_MODEL: "fixture-model",
	};
	let host;
	try {
		host = new LocalAgentHost({ stateDirectory: dir, environment });
		await host.modelCredentials({ action: "save", provider: "compatible", key: "fixture-request-key" });
		await host.close();
		host = new LocalAgentHost({ stateDirectory: dir, environment });
		const turn = host.send("personal", {
			id: randomUUID(), content: "A fixture question", provider: "compatible", model: "fixture-model", reasoning: "none",
		});
		await started;
		await assert.rejects(host.modelCredentials({ action: "remove", provider: "compatible" }), /Wait for active work/);
		releaseRequest();
		const session = await turn;
		assert.ok(session.messages.some(message => message.role === "assistant" && message.content === "Fixture response"));
		assert.deepEqual(requests, [{ path: "/v1/chat/completions", authorization: "Bearer fixture-request-key" }]);
	} finally {
		releaseRequest();
		if (host) await host.close();
		await new Promise(resolve => provider.close(resolve));
		await rm(dir, { recursive: true, force: true });
	}
});
