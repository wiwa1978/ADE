import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { copilotId, createCopilotSignIn, createCopilotStore, isSecretStoreAvailable } from "./copilot-auth.ts";
import { LocalAgentHost } from "./host.ts";
import { createModelConfig, createRuntimeModels, safeErrorMessage } from "./models.ts";
import { createRuntimeServer } from "./server.ts";
import { scanProviderTools } from "./provider-tools.ts";

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

	test("Anthropic API keys expose Claude models", () => {
		const configured = createModelConfig({
			ADE_PROVIDER: "anthropic",
			ANTHROPIC_API_KEY: "fixture-anthropic-key",
		});
		assert.equal(configured.configured, true);
		assert.ok(configured.availableModels.length > 0);
		assert.ok(configured.availableModels.some(model => /claude/i.test(model.name) || /claude/i.test(model.id)));

		const missing = createModelConfig({ ADE_PROVIDER: "anthropic" });
		assert.equal(missing.configured, false);
		assert.match(missing.setupMessage, /ANTHROPIC_API_KEY/);
	});

	test("provider CLI discovery identifies installed host tools", async () => {
		const providers = await scanProviderTools(async command => command === "claude" || command === "codex");
		assert.equal(providers.find(item => item.id === "claude")?.available, true);
		assert.equal(providers.find(item => item.id === "codex")?.available, true);
		assert.equal(providers.find(item => item.id === "cursor")?.available, false);
	});
	assert.equal(local.configured, true);
	assert.equal(local.defaultModel, "local-model");
	assert.equal(local.availableModels[0].id, "local-model");
});

test("a CLI or unknown provider id uses the default API provider instead of failing health", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ade-unknown-provider-"));
	try {
		const runtime = createRuntimeModels({ ADE_PROVIDER: "not-a-provider", OPENAI_API_KEY: "fixture-key" }, dir);
		const fromCli = await runtime.config("claude");
		assert.equal(fromCli.provider, "openai");
		assert.equal(fromCli.configured, true);
		const fromDefault = await runtime.config();
		assert.equal(fromDefault.provider, "openai");
		const unset = createRuntimeModels({}, dir);
		const fallback = await unset.config("pi");
		assert.equal(fallback.provider, "openai");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
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
	const fetchMock = t.mock.method(globalThis, "fetch", (async (url: string | URL | Request, options?: RequestInit) => {
		assert.equal(String(url), "https://radius.pi.dev/v1/config");
		const headers = options?.headers as Record<string, string> | undefined;
		assert.equal(headers?.authorization, "Bearer fixture-key");
		return Response.json({ baseUrl: "https://radius.pi.dev", models: catalog });
	}) as typeof fetch);
	const runtime = createRuntimeModels({ RADIUS_API_KEY: "fixture-key", COPILOT_GITHUB_TOKEN: "must-not-use" }, tmpdir());
	const config = await runtime.config("radius");
	assert.equal(config.configured, true, config.setupMessage);
	assert.deepEqual(config.availableModels, [{ id: "fixture-model", name: "Account model" }]);
	assert.equal(config.resolveModel("balanced"), undefined);
	assert.equal(config.resolveModel("fixture-model")?.provider, "radius");
	assert.equal(await config.models.getAuth(copilotId), undefined, "ambient Copilot token must be ignored");
	await runtime.config("radius");
	assert.equal(fetchMock.mock.callCount(), 1);
});

test("Copilot sign-in publishes only the device challenge, supports cancellation and removes the local credential on sign-out", async () => {
	let signedOut: string | undefined;
	const signIn = createCopilotSignIn({
		async login(id, type, flow) {
			assert.equal(id, copilotId);
			assert.equal(type, "oauth");
			flow.notify({ type: "device_code", userCode: "TEST-CODE", verificationUri: "https://github.com/login/device" });
			await new Promise((_resolve, reject) => flow.signal?.addEventListener("abort", reject, { once: true }));
		},
		async logout(id) { signedOut = id; },
	});
	assert.deepEqual(signIn.start(), { status: "waiting", code: "TEST-CODE", url: "https://github.com/login/device" });
	assert.throws(() => signIn.start(), /already in progress/);
	assert.deepEqual(await signIn.cancel(), { status: "idle" });
	await signIn.signOut();
	assert.equal(signedOut, copilotId);
});

const skipWithoutSecretStore = !isSecretStoreAvailable();

test("Copilot credentials survive reopen encrypted and constrain the picker to account models", { skip: skipWithoutSecretStore }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "ade-copilot-auth-"));
	const credential = {
		type: "oauth" as const, access: "fixture-access", refresh: "fixture-refresh",
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

test("saved API keys are protected, take precedence, survive restart, and can be removed", { skip: skipWithoutSecretStore }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "ade-api-keys-"));
	const environment = {
		OPENAI_API_KEY: "fixture-environment-key",
		ADE_COMPATIBLE_URL: "https://models.example/v1",
		ADE_COMPATIBLE_MODEL: "fixture-model",
	};
	try {
		const runtime = createRuntimeModels(environment, dir);
		assert.equal((await runtime.credentialStatus()).find(item => item.provider === "openai")?.source, "environment");
		await runtime.changeCredential("save", "openai", "fixture-saved-key");
		await runtime.changeCredential("save", "compatible", "fixture-compatible-key");
		assert.doesNotMatch(await readFile(join(dir, "provider-openai-auth.dpapi"), "utf8"), /fixture-saved-key/);
		assert.doesNotMatch(await readFile(join(dir, "provider-compatible-auth.dpapi"), "utf8"), /fixture-compatible-key/);

		const reopened = createRuntimeModels(environment, dir);
		assert.equal((await reopened.credentialStatus()).find(item => item.provider === "openai")?.source, "saved");
		const openai = await reopened.config("openai");
		assert.equal(openai.configured, true);
		assert.equal(((await openai.models.getAuth("openai"))?.auth as { apiKey?: string } | undefined)?.apiKey, "fixture-saved-key");
		assert.doesNotMatch(reopened.safeErrorMessage(new Error("failure: fixture-saved-key")), /fixture-saved-key/);
		const compatible = await reopened.config("compatible");
		assert.equal(compatible.configured, true);
		assert.equal(((await compatible.models.getAuth("compatible"))?.auth as { apiKey?: string } | undefined)?.apiKey, "fixture-compatible-key");

		await reopened.changeCredential("remove", "openai");
		assert.equal((await reopened.credentialStatus()).find(item => item.provider === "openai")?.source, "environment");
		assert.equal(((await openai.models.getAuth("openai"))?.auth as { apiKey?: string } | undefined)?.apiKey, "fixture-environment-key");
		await reopened.changeCredential("remove", "compatible");
		assert.equal((await reopened.config("compatible")).configured, false);
		assert.equal(await compatible.models.getAuth("compatible"), undefined);
		await assert.rejects(reopened.changeCredential("save", "openai", "bad\nkey"), /valid API key/);
		await assert.rejects(reopened.changeCredential("save", "unknown", "fixture"), /Unknown API-key provider/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("changing a saved Radius key refreshes the account's model catalog", { skip: skipWithoutSecretStore }, async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "ade-radius-keys-"));
	const fetchMock = t.mock.method(globalThis, "fetch", (async (_url: string | URL | Request, options?: RequestInit) => {
		const headers = options?.headers as Record<string, string> | undefined;
		const id = headers?.authorization === "Bearer fixture-first-key" ? "first-model" : "second-model";
		return Response.json({ baseUrl: "https://radius.pi.dev", models: [
			{ id, name: id, reasoning: true, input: ["text"], cost: {}, contextWindow: 8192, maxTokens: 1024 },
		] });
	}) as typeof fetch);
	try {
		const runtime = createRuntimeModels({}, dir);
		await runtime.changeCredential("save", "radius", "fixture-first-key");
		assert.deepEqual((await runtime.config("radius")).availableModels.map(model => model.id), ["first-model"]);
		await runtime.changeCredential("save", "radius", "fixture-second-key");
		assert.deepEqual((await runtime.config("radius")).availableModels.map(model => model.id), ["second-model"]);
		assert.equal(fetchMock.mock.callCount(), 2);
		await runtime.changeCredential("remove", "radius");
		assert.equal((await runtime.config("radius")).configured, false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the Settings credential API protects writes and returns only status across host restarts", { skip: skipWithoutSecretStore }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "ade-credential-api-"));
	let host: LocalAgentHost | undefined;
	let server: Server | undefined;
	const start = async () => {
		host = new LocalAgentHost({ stateDirectory: dir, environment: {} });
		server = createRuntimeServer({ host, worktreeManager: {} as never });
		await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
	};
	const stop = async () => {
		await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
		server = undefined;
		await host!.close();
		host = undefined;
	};
	const post = (body: Record<string, unknown>, origin: string | null = "http://127.0.0.1:1420") => fetch(
		`http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/model-credentials`,
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
		assert.equal((JSON.parse(savedBody) as { credentials: { provider: string; source: string }[] }).credentials.find(item => item.provider === "openai")?.source, "saved");
		assert.equal((await host!.health("openai")).configured, true);
		assert.doesNotMatch(host!.safeErrorMessage(new Error("fixture-api-key")), /fixture-api-key/);
		await stop();
		await start();
		const status = await (await post({ action: "status" })).json() as { credentials: { provider: string; source: string }[] };
		assert.equal(status.credentials.find(item => item.provider === "openai")?.source, "saved");
		assert.equal((await host!.health("openai")).configured, true);
		assert.doesNotMatch((await readFile(join(dir, "ade-host.sqlite"))).toString("utf8"), /fixture-api-key/);
		const removed = await post({ action: "remove", provider: "openai" });
		assert.equal(((await removed.json()) as { credentials: { provider: string; source: string }[] }).credentials.find(item => item.provider === "openai")?.source, "none");
		assert.equal((await host!.health("openai")).configured, false);
	} finally {
		if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
		if (host) await host.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("Pi Durable sends with a saved compatible-provider key after restart", { skip: skipWithoutSecretStore }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "ade-credential-turn-"));
	const requests: { path: string | undefined; authorization: string | undefined }[] = [];
	let requestStarted: (() => void) | undefined;
	let releaseRequest: (() => void) | undefined;
	const started = new Promise<void>(resolve => { requestStarted = resolve; });
	const release = new Promise<void>(resolve => { releaseRequest = resolve; });
	const provider = createServer((request, response) => {
		requests.push({ path: request.url, authorization: request.headers.authorization });
		requestStarted?.();
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
	await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
	const environment = {
		ADE_PROVIDER: "compatible",
		ADE_COMPATIBLE_URL: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`,
		ADE_COMPATIBLE_MODEL: "fixture-model",
	};
	let host: LocalAgentHost | undefined;
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
		releaseRequest?.();
		const session = await turn as { messages: { role: string; content: string }[] };
		assert.ok(session.messages.some(message => message.role === "assistant" && message.content === "Fixture response"));
		assert.deepEqual(requests, [{ path: "/v1/chat/completions", authorization: "Bearer fixture-request-key" }]);
		await host.modelCredentials({ action: "remove", provider: "compatible" });
	} finally {
		releaseRequest?.();
		if (host) await host.close();
		await new Promise<void>(resolve => provider.close(() => resolve()));
		await rm(dir, { recursive: true, force: true });
	}
});
