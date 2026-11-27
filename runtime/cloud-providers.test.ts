import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	CloudProviderRegistry,
	createDaytonaDriver,
	createE2bDriver,
	defaultCloudProviders,
	type CloudProviderDefinition,
	type CloudVmDriver,
	type CloudVmState,
} from "./cloud-providers/index.ts";
import { ExecutionTargets } from "./execution-targets.ts";
import { Integrations } from "./integrations.ts";

const notWindows = { skip: process.platform === "win32" ? "cloud targets are disabled on win32" : false };

function tempDir(prefix: string) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("CloudProviderRegistry ships boat, daytona, e2b and supports custom providers", () => {
	assert.deepEqual(defaultCloudProviders.ids().sort(), ["boat", "daytona", "e2b"]);
	const custom = new CloudProviderRegistry(defaultCloudProviders.list());
	const mockDef: CloudProviderDefinition = {
		id: "custom-vm",
		label: "Custom VM",
		description: "Test provider",
		website: "https://example.com",
		fields: [{ key: "apiKey", label: "API key", kind: "secret", required: true }],
		features: { sleep: "pause", keepsDisk: true, keepsMemory: true, transport: "exec" },
		sizes: { small: "1 vCPU, 2 GB", medium: "2 vCPU, 4 GB", large: "4 vCPU, 8 GB" },
		defaultSize: "medium",
		open() {
			throw new Error("not used");
		},
	};
	custom.register(mockDef);
	assert.equal(custom.has("custom-vm"), true);
	const described = custom.describeAll(id => id === "custom-vm");
	assert.equal(described.find(p => p.id === "custom-vm")?.configured, true);
	assert.equal(described.find(p => p.id === "daytona")?.configured, false);
});

test("Daytona REST driver covers verify, create with size, state, sleep, wake, exec, and destroy", async () => {
	const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
	const fakeFetch = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
		requests.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined });
		assert.equal(init.headers.authorization, "Bearer dtn_secret12345");
		if (init.method === "GET" && url.endsWith("/sandbox")) return new Response(JSON.stringify([]));
		if (init.method === "POST" && url.endsWith("/sandbox")) return new Response(JSON.stringify({ id: "sb_123", state: "started" }));
		if (init.method === "GET" && url.endsWith("/sandbox/sb_123")) return new Response(JSON.stringify({ id: "sb_123", state: "started" }));
		if (init.method === "POST" && url.endsWith("/toolbox/process/execute")) {
			return new Response(JSON.stringify({ exitCode: 0, stdout: "hello\n", stderr: "" }));
		}
		return new Response(JSON.stringify({ ok: true }));
	}) as unknown as typeof fetch;

	const driver = createDaytonaDriver("dtn_secret12345", fakeFetch);
	await driver.verify();
	assert.deepEqual(await driver.create({ name: "ade-1", size: "large" }), { id: "sb_123" });
	assert.equal(requests[1].body?.snapshot, "daytona-large");
	assert.equal(await driver.getState("sb_123"), "running");
	await driver.sleep("sb_123");
	assert.equal(requests.at(-1)?.url, "https://app.daytona.io/api/sandbox/sb_123/stop");
	assert.deepEqual(await driver.wake("sb_123"), { id: "sb_123" });
	assert.equal(requests.at(-1)?.url, "https://app.daytona.io/api/sandbox/sb_123/start");
	assert.deepEqual(await driver.exec!("sb_123", "echo hello"), { exitCode: 0, stdout: "hello\n", stderr: "" });
	await driver.destroy("sb_123");
	assert.equal(requests.at(-1)?.method, "DELETE");
});

test("E2B REST driver covers verify, create, pause, resume, keepAlive, and destroy", async () => {
	const requests: Array<{ method: string; url: string; headers: Record<string, string>; body?: Record<string, unknown> }> = [];
	const fakeFetch = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
		requests.push({ method: init.method, url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
		if (init.method === "GET" && url.endsWith("/templates")) return new Response(JSON.stringify([]));
		if (init.method === "POST" && url.endsWith("/sandboxes")) return new Response(JSON.stringify({ sandboxID: "e2b_vm1", state: "running" }));
		if (init.method === "GET" && url.endsWith("/sandboxes/e2b_vm1")) return new Response(JSON.stringify({ sandboxID: "e2b_vm1", state: "paused" }));
		if (init.method === "POST" && url.endsWith("/sandboxes/e2b_vm1/resume")) return new Response(JSON.stringify({ sandboxID: "e2b_vm1" }));
		return new Response(null, { status: 204 });
	}) as unknown as typeof fetch;

	const driver = createE2bDriver("e2b_testkey1234", fakeFetch);
	await driver.verify();
	assert.equal(requests[0].headers["X-API-Key"], "e2b_testkey1234");
	assert.deepEqual(await driver.create({ name: "ade-2", size: "small" }), { id: "e2b_vm1" });
	assert.equal(requests[1].body?.autoPause, true);
	assert.equal(await driver.getState("e2b_vm1"), "sleeping");
	await driver.sleep("e2b_vm1");
	assert.equal(requests.at(-1)?.url, "https://api.e2b.app/sandboxes/e2b_vm1/pause");
	assert.deepEqual(await driver.wake("e2b_vm1"), { id: "e2b_vm1" });
	await driver.keepAlive!("e2b_vm1");
	assert.equal(requests.at(-1)?.url, "https://api.e2b.app/sandboxes/e2b_vm1/timeout");
	await driver.destroy("e2b_vm1");
	assert.equal(requests.at(-1)?.method, "DELETE");
});

test("Integrations stores, verifies, and removes modular cloud providers alongside legacy boat", async () => {
	const d = tempDir("ade-cloud-int-");
	try {
		const fakeFetch = (async (url: string) => {
			if (url.includes("daytona")) return new Response(JSON.stringify([]));
			if (url.includes("e2b")) return new Response(JSON.stringify([]));
			return new Response(JSON.stringify({ ok: true, sandboxes: [] }));
		}) as unknown as typeof fetch;

		const integrations = new Integrations(d.root, { fetch: fakeFetch });
		assert.equal(integrations.cloudDriver("daytona"), null);

		const afterDaytona = await integrations.setCloudProvider("daytona", { apiKey: "dtn_validkey12345" });
		assert.equal(afterDaytona.cloudProviders.find(p => p.id === "daytona")?.configured, true);
		assert.ok(integrations.cloudDriver("daytona"));

		await integrations.setBoat("boat_legacykey12345");
		assert.equal(integrations.status().boat.configured, true);
		assert.equal(integrations.status().cloudProviders.find(p => p.id === "boat")?.configured, true);

		integrations.removeCloudProvider("daytona");
		assert.equal(integrations.cloudDriver("daytona"), null);
		assert.equal(integrations.status().cloudProviders.find(p => p.id === "daytona")?.configured, false);
	} finally {
		d.cleanup();
	}
});

test("ExecutionTargets cloud lifecycle: create with size, exec bridge, idle auto-sleep, keepAlive, auto-wake, and destroy", notWindows, async () => {
	const d = tempDir("ade-cloud-target-");
	const workspace = join(d.root, "ws");
	mkdirSync(workspace);
	const events: string[] = [];
	let vmState: CloudVmState = "provisioning";

	const fakeDriver: CloudVmDriver = {
		id: "daytona",
		async verify() {},
		async create({ name, size }) {
			events.push(`create:${name}:${size}`);
			vmState = "running";
			return { id: "vm_001" };
		},
		async getState(id) {
			events.push(`state:${id}:${vmState}`);
			return vmState;
		},
		async sleep(id) {
			events.push(`sleep:${id}`);
			vmState = "sleeping";
			return { checkpoint: "ckpt_1" };
		},
		async wake(id, checkpoint) {
			events.push(`wake:${id}:${checkpoint ?? "none"}`);
			vmState = "running";
			return { id: "vm_002" };
		},
		async keepAlive(id) {
			events.push(`keepAlive:${id}`);
		},
		async destroy(id) {
			events.push(`destroy:${id}`);
		},
		async exec() {
			return { exitCode: 0, stdout: "ok", stderr: "" };
		},
	};

	try {
		const targets = new ExecutionTargets(join(d.root, "state"), {
			pollIntervalMs: 10,
			cloud: {
				driver: id => (id === "daytona" ? fakeDriver : null),
				values: id => (id === "daytona" ? { apiKey: "dtn_test12345" } : null),
				configuredIds: () => ["daytona"],
			},
		});

		targets.setTarget("sess-1", { target: "cloud", cloudProvider: "daytona", vmSize: "large", idleSleepMinutes: 5 }, { workspace });
		const ready = await targets.ensure("sess-1", { workspace });
		assert.equal(ready.state, "running");
		assert.equal(ready.vmId, "vm_001");
		assert.equal(ready.vmSize, "large");
		assert.ok(events.includes("create:ade-sess-1:large"));

		// Exec-transport provider routes commands through the local exec-bridge.
		const inv = targets.commandFor("sess-1", workspace, "npm test", ["FOO"]);
		assert.equal(inv?.file, process.execPath);
		assert.match(inv?.args[0] ?? "", /exec-bridge\.ts$/);
		assert.ok(inv?.env?.ADE_CLOUD_EXEC_PAYLOAD);

		// Busy session is not put to sleep; keepAlive is called instead.
		const futureBusy = Date.now() + 10 * 60_000;
		const sleptWhileBusy = await targets.sleepIdleVms(futureBusy, id => id === "sess-1");
		assert.deepEqual(sleptWhileBusy, []);
		assert.ok(events.includes("keepAlive:vm_001"));

		// Idle session beyond idleSleepMinutes is automatically put to sleep.
		const futureIdle = Date.now() + 20 * 60_000;
		const sleptIdle = await targets.sleepIdleVms(futureIdle, () => false);
		assert.deepEqual(sleptIdle, ["sess-1"]);
		assert.equal(targets.session("sess-1").state, "sleeping");
		assert.equal(targets.session("sess-1").vmCheckpoint, "ckpt_1");

		// Auto-wake restores from checkpoint and updates vmId.
		const woken = await targets.wakeIfSleeping("sess-1", { workspace });
		assert.equal(woken.state, "running");
		assert.equal(woken.vmId, "vm_002");
		assert.equal(woken.vmCheckpoint, null);
		assert.ok(events.includes("wake:vm_001:ckpt_1"));

		// Archiving destroys the cloud VM.
		await targets.remove("sess-1");
		assert.ok(events.includes("destroy:vm_002"));
	} finally {
		d.cleanup();
	}
});
