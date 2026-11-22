import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { EnvironmentManager } from "./environments.ts";
import { createRuntimeServer } from "./server.ts";

const directories = [];
const servers = [];

function temporaryDirectory() {
	const directory = mkdtempSync(join(tmpdir(), "ade-environments-"));
	directories.push(directory);
	return directory;
}

async function listen(server) {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	servers.push(server);
	return server.address().port;
}

afterEach(async () => {
	for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve));
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fakeSsh({ online = true } = {}) {
	const calls = [];
	const healthRequests = [];
	const spawn = (command, args, options) => {
		const child = new EventEmitter();
		child.stderr = new EventEmitter();
		child.exitCode = null;
		child.killed = false;
		child.kill = () => { child.killed = true; child.exitCode = 0; child.emit("exit", 0); return true; };
		const forward = args[args.indexOf("-L") + 1];
		const localPort = Number(forward.split(":")[1]);
		const server = createHttpServer((request, response) => {
			healthRequests.push({ host: request.headers.host, url: request.url });
			response.writeHead(online ? 200 : 503, { "content-type": "application/json" });
			response.end(JSON.stringify({ online }));
		});
		server.listen(localPort, "127.0.0.1");
		servers.push(server);
		calls.push({ command, args, options, child });
		return child;
	};
	return { calls, spawn, healthRequests };
}

test("SSH environments persist only connection metadata and connect through strict key-based OpenSSH", async () => {
	const directory = temporaryDirectory();
	const ssh = fakeSsh();
	const manager = new EnvironmentManager(directory, { spawn: ssh.spawn, connectTimeoutMs: 500 });
	const environment = manager.add({ name: "Build server", sshHost: "builder", sshPort: 2222, remotePort: 4321 });
	assert.equal(environment.kind, "ssh");
	assert.equal(environment.status, "disconnected");
	assert.equal(manager.list().activeId, "local");

	const connected = await manager.connect(environment.id);
	assert.equal(connected.activeId, environment.id);
	assert.equal(connected.environments.find(item => item.id === environment.id).status, "connected");
	assert.equal(ssh.calls.length, 1);
	assert.equal(ssh.calls[0].command, "ssh");
	assert.equal(ssh.calls[0].options.shell, undefined);
	assert.ok(ssh.calls[0].args.includes("BatchMode=yes"));
	assert.ok(ssh.calls[0].args.includes("StrictHostKeyChecking=yes"));
	assert.ok(ssh.calls[0].args.includes("ExitOnForwardFailure=yes"));
	assert.ok(ssh.calls[0].args.includes("-p"));
	assert.equal(ssh.healthRequests[0].host, "127.0.0.1:4321");
	assert.equal(ssh.healthRequests[0].url, "/api/health");
	const localPort = Number(ssh.calls[0].args[ssh.calls[0].args.indexOf("-L") + 1].split(":")[1]);
	assert.deepEqual(manager.proxyTarget(), { localPort, remotePort: 4321 });

	await manager.activate("local");
	assert.equal(ssh.calls[0].child.killed, true);
	assert.equal(manager.list().activeId, "local");
	manager.close();

	const reopened = new EnvironmentManager(directory);
	assert.equal(reopened.list().environments.find(item => item.id === environment.id).status, "disconnected");
	assert.equal(reopened.list().activeId, "local");
	reopened.close();
});

test("SSH environment validation rejects option injection and invalid ports", () => {
	const manager = new EnvironmentManager(temporaryDirectory());
	assert.throws(() => manager.add({ name: "Bad", sshHost: "-oProxyCommand=touch" }), /valid SSH host/);
	assert.throws(() => manager.add({ name: "Bad", sshHost: "user@server;id" }), /valid SSH host/);
	assert.throws(() => manager.add({ name: "Bad", sshHost: "server", sshPort: 0 }), /SSH port/);
	assert.throws(() => manager.add({ name: "Bad", sshHost: "server", remotePort: 65536 }), /ADE runtime port/);
	assert.throws(() => manager.add({ name: " ", sshHost: "server" }), /name/);
	manager.close();
});

test("a failed SSH connection keeps the local environment active and cleans up the process", async () => {
	const ssh = fakeSsh({ online: false });
	const manager = new EnvironmentManager(temporaryDirectory(), { spawn: ssh.spawn, connectTimeoutMs: 1 });
	const environment = manager.add({ name: "Offline", sshHost: "offline" });
	await assert.rejects(manager.connect(environment.id), /Could not reach the ADE runtime through SSH/);
	assert.equal(manager.list().activeId, "local");
	assert.equal(manager.list().environments.find(item => item.id === environment.id).status, "error");
	assert.equal(ssh.calls[0].child.killed, true);
	manager.close();
});

test("environment management routes are local-origin protected", async () => {
	const manager = new EnvironmentManager(temporaryDirectory());
	const server = createRuntimeServer({ host: {}, worktreeManager: {}, environments: manager });
	const port = await listen(server);
	const endpoint = `http://127.0.0.1:${port}/api/environments`;
	const rejected = await fetch(endpoint, {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "Build server", sshHost: "builder" }),
	});
	assert.equal(rejected.status, 403);
	const accepted = await fetch(endpoint, {
		method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:1420" },
		body: JSON.stringify({ name: "Build server", sshHost: "builder" }),
	});
	assert.equal(accepted.status, 200);
	assert.equal((await accepted.json()).environment.kind, "ssh");
	manager.close();
});

test("the local runtime proxies app API requests over the selected SSH tunnel", async () => {
	const seen = [];
	const remote = createHttpServer((request, response) => {
		seen.push({ host: request.headers.host, origin: request.headers.origin, url: request.url });
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ online: true, provider: new URL(request.url, "http://remote").searchParams.get("provider") }));
	});
	const remotePort = await listen(remote);
	const environments = {
		list: () => ({ activeId: "remote", environments: [] }),
		proxyTarget: () => ({ localPort: remotePort, remotePort: 4319 }),
	};
	const server = createRuntimeServer({
		host: { health: async () => ({ online: false }) },
		worktreeManager: {},
		environments,
	});
	const localPort = await listen(server);
	const response = await fetch(`http://127.0.0.1:${localPort}/api/health?provider=openai`, {
		headers: { origin: "http://127.0.0.1:1420" },
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { online: true, provider: "openai" });
	assert.equal(seen[0].host, "127.0.0.1:4319");
	assert.equal(seen[0].origin, "http://127.0.0.1:1420");
});
