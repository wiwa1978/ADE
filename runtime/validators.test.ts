import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { request, requestText } from "../api.ts";
import {
	EscalationCardSchema,
	McpServerConfigSchema,
	RuntimeEventSchema,
} from "../packages/protocol/index.ts";
import { RuntimeEventBus } from "./events.ts";
import { LocalAgentHost } from "./host.ts";
import { MobilePairingManager } from "./mobile-pairing.ts";
import { createRuntimeServer } from "./server.ts";
import {
	validateApprovalRuleCreate,
	validateCodingTaskCreate,
	validateEnvironmentAdd,
	validateFactoryRunCreate,
	validateMobileDeviceRename,
	validateMobileEnable,
	validateMobilePair,
	validateMobileTunnel,
	validateProjectSave,
	validateSendMessage,
	validateTerminalCreate,
} from "./validators.ts";
import { WorktreeManager } from "./worktrees.ts";

function initGitRepo(dir: string) {
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "ade@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "ADE Test"], { cwd: dir });
	writeFileSync(join(dir, "hello.txt"), "initial\n", "utf8");
	execFileSync("git", ["add", "-A"], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
}

test("API boundary rejects wrong-type inputs with 400 on git and workspace-file routes", async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "ade-validate-state-"));
	const repoDir = mkdtempSync(join(tmpdir(), "ade-validate-repo-"));
	initGitRepo(repoDir);
	const host = new LocalAgentHost({ stateDirectory: stateDir, modelConfigFactory: () => ({}) as never });
	const manager = new WorktreeManager(stateDir);
	const sessionId = randomUUID();
	await host.createCodingTask({ id: sessionId, title: "Validate", repository: repoDir, kind: "checkout" }, manager);
	const server = createRuntimeServer({ host, worktreeManager: manager });
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	const send = (method: string, path: string, body: unknown) =>
		fetch(`${base}${path}`, {
			method,
			headers: {
				origin: "http://127.0.0.1:1420",
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});

	try {
		// Non-object JSON body
		assert.equal((await send("POST", "/api/workspace/git/commit", ["not-an-object"])).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/commit", "plain-string")).status, 400);

		// Git commit wrong types (previously caused 500 from (5).trim())
		assert.equal((await send("POST", "/api/workspace/git/commit", { sessionId, message: 5 })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/commit", { sessionId, message: "   " })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/commit", { sessionId: 42, message: "ok" })).status, 400);

		// Git stage / unstage wrong types (previously passed [1] into workspacePath/git add)
		assert.equal((await send("POST", "/api/workspace/git/stage", { sessionId, paths: [1] })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/stage", { sessionId, paths: "hello.txt" })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/stage", { sessionId: null, paths: [] })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/unstage", { sessionId, paths: [1] })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/unstage", { sessionId, paths: { a: 1 } })).status, 400);

		// Git discard wrong types
		assert.equal((await send("POST", "/api/workspace/git/discard", { sessionId, path: 123 })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/discard", { sessionId, path: "" })).status, 400);
		assert.equal((await send("POST", "/api/workspace/git/discard", { sessionId: true, path: "hello.txt" })).status, 400);

		// Workspace file write wrong types
		assert.equal((await send("PUT", "/api/workspace/file", { sessionId, path: 5, content: "ok" })).status, 400);
		assert.equal((await send("PUT", "/api/workspace/file", { sessionId, path: "hello.txt", content: 99 })).status, 400);
		assert.equal((await send("PUT", "/api/workspace/file", { sessionId: 123, path: "hello.txt", content: "ok" })).status, 400);
		assert.equal((await send("PUT", "/api/workspace/file", { sessionId, path: "", content: "ok" })).status, 400);

		// Valid workspace file write + stage + commit still succeed cleanly
		assert.equal((await send("PUT", "/api/workspace/file", { sessionId, path: "hello.txt", content: "updated\n" })).status, 200);
		assert.equal((await send("POST", "/api/workspace/git/stage", { sessionId, paths: ["hello.txt"] })).status, 200);
		assert.equal((await send("POST", "/api/workspace/git/commit", { sessionId, message: "Update hello" })).status, 200);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await host.close();
		manager.close();
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	}
});

test("terminal start keeps the folder the UI sends", () => {
	assert.equal(validateTerminalCreate({ cwd: "/tmp/x", cols: 80, rows: 24 }).cwd, "/tmp/x");
	assert.equal(validateTerminalCreate({ workspace: "/tmp/y" }).cwd, "/tmp/y");
});

test("validateProjectSave preserves blueprintLocked, stageOverrides, and validates modelProfile", () => {
	const saved = validateProjectSave({
		id: randomUUID(),
		name: "Demo",
		blueprintId: "speckit",
		blueprintLocked: true,
		modelProfile: "eu-only",
		stageOverrides: {
			implement: { provider: "mistral", model: "mistral-large" },
		},
	});
	assert.equal(saved.blueprintLocked, true);
	assert.equal(saved.modelProfile, "eu-only");
	assert.deepEqual(saved.stageOverrides, {
		implement: { provider: "mistral", model: "mistral-large" },
	});

	// Nullable stageOverrides clears saved overrides
	const cleared = validateProjectSave({ stageOverrides: null });
	assert.equal(cleared.stageOverrides, null);

	// Rejects invalid types/enums
	assert.throws(() => validateProjectSave({ blueprintLocked: "yes" }), { statusCode: 400 });
	assert.throws(() => validateProjectSave({ modelProfile: "not-a-profile" }), { statusCode: 400 });
	assert.throws(() => validateProjectSave({ stageOverrides: { implement: { provider: 42 } } }), { statusCode: 400 });
});

test("validateSendMessage preserves async boolean and rejects invalid async values", () => {
	assert.equal(validateSendMessage({ content: "Hello", async: true }).async, true);
	assert.equal(validateSendMessage({ content: "Hello", async: false }).async, false);
	assert.equal(validateSendMessage({ content: "Hello" }).async, undefined);
	assert.throws(() => validateSendMessage({ content: "Hello", async: "true" }), { statusCode: 400 });
});

test("validateFactoryRunCreate preserves issueTitle/issueBody and validates stageOverrides & modelProfile", () => {
	const input = validateFactoryRunCreate({
		repoPath: "/tmp/repo",
		issueNumber: 42,
		issueTitle: "Fix race condition",
		issueBody: "Steps to reproduce...",
		modelProfile: "eu-sovereign",
		stageOverrides: {
			review: { provider: "anthropic", model: "claude-sonnet-4", reasoning: "high" },
		},
	});
	assert.equal(input.issueTitle, "Fix race condition");
	assert.equal(input.issueBody, "Steps to reproduce...");
	assert.equal(input.modelProfile, "eu-sovereign");
	assert.equal(input.stageOverrides?.review?.provider, "anthropic");
	assert.equal(input.autoStart, false);

	assert.throws(() => validateFactoryRunCreate({ modelProfile: "invalid" }), { statusCode: 400 });
	assert.throws(() => validateFactoryRunCreate({ issueTitle: 123 }), { statusCode: 400 });
	assert.throws(() => validateFactoryRunCreate({ issueBody: false }), { statusCode: 400 });
	assert.throws(() => validateFactoryRunCreate({ stageOverrides: { review: { provider: "" } } }), { statusCode: 400 });
});

test("validateEnvironmentAdd and validateCodingTaskCreate strip unknown keys without body spreads", () => {
	const env = validateEnvironmentAdd({
		name: "Build box",
		sshHost: "builder",
		sshPort: 2222,
		remotePort: 4319,
		injected: "evil",
	});
	assert.equal(env.sshHost, "builder");
	assert.equal(env.sshPort, 2222);
	assert.equal("injected" in env, false);

	const task = validateCodingTaskCreate({
		title: "Task",
		repository: "/tmp/repo",
		kind: "worktree",
		runOn: "docker",
		dockerImage: "node:22",
		blueprintId: "speckit",
		attemptGroup: "grp-1",
		startFrom: { branch: "main" },
		extraField: "stripped",
	});
	assert.equal(task.runOn, "docker");
	assert.equal(task.dockerImage, "node:22");
	assert.equal(task.blueprintId, "speckit");
	assert.equal("extraField" in task, false);

	assert.throws(() => validateCodingTaskCreate({ runOn: "kubernetes" }), { statusCode: 400 });
});

test("mobile and approval rule validators enforce enums, finite ports, and formats", () => {
	assert.deepEqual(validateMobileEnable({ enabled: true, port: 4320, mode: "tailscale" }), {
		enabled: true,
		port: 4320,
		mode: "tailscale",
	});
	assert.throws(() => validateMobileEnable({ port: 0 }), { statusCode: 400 });
	assert.throws(() => validateMobileEnable({ port: 70000 }), { statusCode: 400 });
	assert.throws(() => validateMobileEnable({ port: 4320.5 }), { statusCode: 400 });
	assert.throws(() => validateMobileEnable({ port: Number.NaN }), { statusCode: 400 });
	assert.throws(() => validateMobileEnable({ mode: "bluetooth" }), { statusCode: 400 });

	assert.deepEqual(validateMobilePair({ mode: "lan" }), { mode: "lan" });
	assert.throws(() => validateMobilePair({ mode: "invalid" }), { statusCode: 400 });

	assert.deepEqual(validateMobileTunnel({ action: "stop" }), { action: "stop" });
	assert.deepEqual(validateMobileTunnel({}), { action: "start" });
	assert.throws(() => validateMobileTunnel({ action: "restart" }), { statusCode: 400 });

	assert.deepEqual(validateMobileDeviceRename({ name: "  My Phone  " }), { name: "My Phone" });
	assert.throws(() => validateMobileDeviceRename({ name: "   " }), { statusCode: 400 });
	assert.throws(() => validateMobileDeviceRename({ name: 123 }), { statusCode: 400 });

	assert.deepEqual(validateApprovalRuleCreate({ prefix: " git push ", effect: "deny" }), {
		prefix: "git push",
		effect: "deny",
		toolName: "run_command",
	});
	assert.throws(() => validateApprovalRuleCreate({ prefix: "   " }), { statusCode: 400 });
	assert.throws(() => validateApprovalRuleCreate({ prefix: "git push", effect: "maybe" }), { statusCode: 400 });
	assert.throws(() => validateApprovalRuleCreate({ prefix: "git push", toolName: "bad tool" }), { statusCode: 400 });
});

test("HTTP boundary rejects invalid enums/types across agent-workflow, mobile, approvals, and project routes", async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "ade-validate-routes-"));
	const repoDir = mkdtempSync(join(tmpdir(), "ade-validate-routes-repo-"));
	initGitRepo(repoDir);
	const host = new LocalAgentHost({ stateDirectory: stateDir, modelConfigFactory: () => ({}) as never });
	const manager = new WorktreeManager(stateDir);
	const mobilePairing = new MobilePairingManager({ stateDirectory: stateDir });
	const projectId = randomUUID();
	const sessionId = randomUUID();
	await host.createCodingTask({ id: sessionId, title: "Routes", repository: repoDir, kind: "checkout" }, manager);
	const server = createRuntimeServer({ host, worktreeManager: manager, mobilePairing });
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	const send = (method: string, path: string, body: unknown) =>
		fetch(`${base}${path}`, {
			method,
			headers: {
				origin: "http://127.0.0.1:1420",
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});

	try {
		// LIVE BUG 1 over HTTP: blueprintLocked persists via POST /api/projects
		const createdProjRes = await send("POST", "/api/projects", {
			id: projectId,
			name: "Locked Project",
			repository: repoDir,
			blueprintId: "speckit",
			blueprintLocked: true,
			modelProfile: "eu-only",
			stageOverrides: { implement: { provider: "mistral", model: "mistral-large" } },
		});
		assert.equal(createdProjRes.status, 200);
		const createdProj = (await createdProjRes.json()) as {
			project: { blueprintLocked: boolean; modelProfile: string; stageOverrides?: Record<string, { provider: string; model: string }> };
		};
		assert.equal(createdProj.project.blueprintLocked, true);
		assert.equal(createdProj.project.modelProfile, "eu-only");
		assert.deepEqual(createdProj.project.stageOverrides, {
			implement: { provider: "mistral", model: "mistral-large" },
		});

		// Agent workflow mutating routes reject invalid types/enums with 400
		assert.equal((await send("POST", `/api/sessions/${sessionId}/stages/decision`, { decision: "maybe" })).status, 400);
		assert.equal((await send("PUT", `/api/sessions/${sessionId}/blueprint`, { blueprintId: 123 })).status, 400);
		assert.equal((await send("POST", `/api/sessions/${sessionId}/team/plans/t1`, { decision: "reject" })).status, 400);
		assert.equal((await send("POST", `/api/sessions/${sessionId}/team/posts`, { text: 123 })).status, 400);
		assert.equal((await send("PUT", `/api/sessions/${sessionId}/team/settings`, { requirePlans: "yes" })).status, 400);
		assert.equal((await send("PUT", `/api/projects/${projectId}/scripts`, { copy: "not-an-array" })).status, 400);
		assert.equal((await send("PUT", "/api/limits", { taskCost: -5 })).status, 400);
		assert.equal((await send("PUT", "/api/subagent-policy", { choice: "invalid" })).status, 400);
		assert.equal((await send("PUT", `/api/projects/${projectId}/run-on`, { target: "k8s" })).status, 400);
		assert.equal((await send("PUT", `/api/sessions/${sessionId}/run-on`, { target: "k8s" })).status, 400);
		assert.equal((await send("PUT", "/api/integrations/slack", { events: { finished: "yes" } })).status, 400);
		assert.equal((await send("PUT", "/api/integrations/linear", { apiKey: "short" })).status, 400);
		assert.equal((await send("PUT", "/api/integrations/boat", { apiKey: 999 })).status, 400);
		assert.equal((await send("POST", `/api/projects/${projectId}/automations`, { name: "A", prompt: "P", trigger: { type: "invalid" } })).status, 400);
		assert.equal((await send("PUT", `/api/projects/${projectId}/secrets`, { name: 123, value: "abc" })).status, 400);
		assert.equal((await send("PUT", `/api/projects/${projectId}/instructions`, { name: "README.md", content: "hi" })).status, 400);
		assert.equal((await send("POST", `/api/sessions/${sessionId}/checkpoints`, { label: 42 })).status, 400);
		assert.equal((await send("POST", `/api/sessions/${sessionId}/engine`, { engine: "unknown" })).status, 400);

		// Approvals rules route rejects invalid inputs with 400
		assert.equal((await send("POST", "/api/approvals/rules", { prefix: "   " })).status, 400);
		assert.equal((await send("POST", "/api/approvals/rules", { prefix: "git push", effect: "nope" })).status, 400);
		assert.equal((await send("POST", "/api/approvals/rules", { prefix: "git push", toolName: "rm" })).status, 400);

		// Mobile routes reject invalid mode, port, action, name with 400
		assert.equal((await send("POST", "/api/mobile/enable", { mode: "wifi" })).status, 400);
		assert.equal((await send("POST", "/api/mobile/enable", { port: 99999 })).status, 400);
		assert.equal((await send("POST", "/api/mobile/pair", { mode: "wifi" })).status, 400);
		assert.equal((await send("POST", "/api/mobile/tunnel", { action: "bounce" })).status, 400);
		assert.equal((await send("PATCH", "/api/mobile/devices/dev-1", { name: "" })).status, 400);

		// Invalid async on messages route returns 400
		assert.equal((await send("POST", `/api/coding-tasks/${sessionId}/messages`, { content: "hi", async: "nope" })).status, 400);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await mobilePairing.close();
		await host.close();
		manager.close();
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	}
});

test("protocol discriminated schemas and typed RuntimeEventBus validate payloads", () => {
	const stdioMcp = McpServerConfigSchema.parse({
		id: "mcp-1",
		name: "GitHub",
		transport: "stdio",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-github"],
		enabled: true,
	});
	assert.equal(stdioMcp.transport, "stdio");
	assert.throws(() => McpServerConfigSchema.parse({ id: "1", name: "Bad", transport: "http", enabled: true }));

	const resolvedCard = EscalationCardSchema.parse({
		id: "esc-1",
		runId: "run-1",
		stageId: "review",
		kind: "approve_stage",
		title: "Approve",
		summary: "Summary",
		options: [{ id: "approve", label: "Approve" }],
		sourceSubagentIds: [],
		status: "resolved",
		resolution: { optionId: "approve", resolvedAt: 1000 },
		createdAt: 900,
	});
	assert.equal(resolvedCard.status, "resolved");
	assert.throws(() =>
		EscalationCardSchema.parse({
			id: "esc-2",
			runId: "run-1",
			stageId: "review",
			kind: "approve_stage",
			title: "Missing resolution",
			summary: "Summary",
			options: [],
			sourceSubagentIds: [],
			status: "resolved",
			createdAt: 900,
		}),
	);

	const bus = new RuntimeEventBus();
	const received: unknown[] = [];
	bus.on("team.update", (event) => {
		received.push(RuntimeEventSchema.parse(event));
	});
	bus.emit("team.update", { sessionId: "s1", events: 2, tasks: 1 }, "s1");
	assert.equal(received.length, 1);
	bus.close();
});

test("api.ts request supports Zod schema validation, 204 No Content, non-JSON 502 HTML errors, and requestText", async () => {
	let lastAuthHeader: string | undefined;
	const mockServer = createServer((req, res) => {
		lastAuthHeader = req.headers.authorization;
		if (req.url === "/ok-json") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ id: "item-1", count: 3 }));
			return;
		}
		if (req.url === "/bad-shape") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ id: 999 }));
			return;
		}
		if (req.url === "/no-content") {
			res.writeHead(204);
			res.end();
			return;
		}
		if (req.url === "/gateway-error") {
			res.writeHead(502, { "content-type": "text/html" });
			res.end("<html><body>502 Bad Gateway</body></html>");
			return;
		}
		if (req.url === "/transcript") {
			res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
			res.end("# Session Transcript\n\nHello!");
			return;
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: "Not found" }));
	});
	await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
	const port = (mockServer.address() as AddressInfo).port;
	const endpoint = { flavor: "remote" as const, baseUrl: `http://127.0.0.1:${port}`, authToken: "secret-token" };
	const ItemSchema = z.object({ id: z.string(), count: z.number() });

	try {
		const valid = await request("/ok-json", undefined, endpoint, ItemSchema);
		assert.deepEqual(valid, { id: "item-1", count: 3 });
		assert.equal(lastAuthHeader, "Bearer secret-token");

		await assert.rejects(
			() => request("/bad-shape", undefined, endpoint, ItemSchema),
			(err: unknown) => err instanceof z.ZodError,
		);

		const empty = await request("/no-content", { method: "DELETE" }, endpoint);
		assert.equal(empty, undefined);

		await assert.rejects(
			() => request("/gateway-error", { method: "POST" }, endpoint),
			/didn't answer properly \(status 502\)/,
		);

		const md = await requestText("/transcript", undefined, endpoint);
		assert.equal(md, "# Session Transcript\n\nHello!");
		assert.equal(lastAuthHeader, "Bearer secret-token");

		await assert.rejects(
			() => requestText("/gateway-error", { method: "POST" }, endpoint),
			/didn't answer properly \(status 502\)/,
		);
	} finally {
		await new Promise<void>((resolve) => mockServer.close(() => resolve()));
	}
});
