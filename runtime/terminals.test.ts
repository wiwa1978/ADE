import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createRuntimeServer } from "./server.ts";
import { TerminalManager } from "./terminals.ts";

const directories = [];
const servers = [];

function temporaryDirectory() {
	const directory = mkdtempSync(join(tmpdir(), "ade-terminal-"));
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

function fakePty() {
	const dataListeners = [];
	const exitListeners = [];
	const pty = {
		writes: [], resizes: [], killed: false,
		onData(listener) { dataListeners.push(listener); return { dispose() {} }; },
		onExit(listener) { exitListeners.push(listener); return { dispose() {} }; },
		write(data) { this.writes.push(data); },
		resize(cols, rows) { this.resizes.push({ cols, rows }); },
		kill() { this.killed = true; for (const listener of exitListeners) listener({ exitCode: 0 }); },
		emitData(data) { for (const listener of dataListeners) listener(data); },
	};
	return pty;
}

test("terminal sessions spawn a user-operated shell in the selected workspace and stream bounded output", () => {
	const cwd = temporaryDirectory();
	const pty = fakePty();
	const spawned = [];
	const manager = new TerminalManager({
		environment: { SHELL: "/bin/zsh", HOME: "/tmp" },
		maxOutputCharacters: 8,
		spawn: (shell, args, options) => { spawned.push({ shell, args, options }); return pty; },
	});
	const created = manager.create({ cwd, cols: 90, rows: 30 });
	assert.equal(spawned[0].shell, "/bin/zsh");
	assert.deepEqual(spawned[0].args, []);
	assert.equal(spawned[0].options.cwd, realpathSync(cwd));
	assert.equal(created.cwd, realpathSync(cwd));

	pty.emitData("hello ");
	pty.emitData("world");
	const output = manager.read(created.id, 0);
	assert.equal(output.data, "lo world");
	assert.equal(output.truncated, true);
	assert.equal(output.cursor, 11);
	assert.equal(output.baseCursor, 3);

	assert.deepEqual(manager.write(created.id, "ls\r"), { ok: true });
	assert.deepEqual(pty.writes, ["ls\r"]);
	assert.deepEqual(manager.resize(created.id, { cols: 100, rows: 40 }), { ok: true, cols: 100, rows: 40 });
	assert.deepEqual(pty.resizes, [{ cols: 100, rows: 40 }]);
	assert.deepEqual(manager.close(created.id), { closed: true });
	assert.equal(pty.killed, true);
	assert.throws(() => manager.read(created.id, 0), /not found/);
	manager.closeAll();
});

test("the system PTY executes input from the terminal session", async () => {
	const cwd = temporaryDirectory();
	const manager = new TerminalManager();
	let id;
	try {
		const terminal = manager.create({ cwd });
		id = terminal.id;
		manager.write(id, "echo ADE_PTY_READY\r");
		let cursor = 0;
		let output = "";
		const deadline = Date.now() + 5_000;
		while (Date.now() < deadline && !output.includes("ADE_PTY_READY")) {
			const result = manager.read(id, cursor);
			output += result.data;
			cursor = result.cursor;
			if (!output.includes("ADE_PTY_READY")) await new Promise(resolve => setTimeout(resolve, 50));
		}
		assert.match(output, /ADE_PTY_READY/);
	} finally {
		if (id) manager.close(id);
		manager.closeAll();
	}
});

test("terminal sessions reject invalid workspaces, dimensions, and oversized input", () => {
	const manager = new TerminalManager({ spawn: () => fakePty() });
	assert.throws(() => manager.create({ cwd: "relative/path" }), /absolute workspace/);
	assert.throws(() => manager.create({ cwd: join(temporaryDirectory(), "missing") }), /directory is unavailable/);
	const cwd = temporaryDirectory();
	assert.throws(() => manager.create({ cwd, cols: 2 }), /Terminal columns/);
	const created = manager.create({ cwd });
	assert.throws(() => manager.write(created.id, "x".repeat(8193)), /8192/);
	manager.closeAll();
});

test("terminal API routes require an approved ADE origin", async () => {
	const calls = [];
	const terminals = {
		create: input => { calls.push(input); return { id: "00000000-0000-4000-8000-000000000001", cwd: input.cwd }; },
		read: (id, cursor) => ({ id, cursor: Number(cursor), data: "", exited: false }),
		write: (id, data) => ({ id, data }),
		resize: (id, input) => ({ id, ...input }),
		close: id => ({ id, closed: true }),
	};
	const server = createRuntimeServer({ host: {}, worktreeManager: {}, terminals });
	const port = await listen(server);
	const url = `http://127.0.0.1:${port}/api/terminals`;
	const body = JSON.stringify({ cwd: temporaryDirectory() });
	const rejected = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
	assert.equal(rejected.status, 403);
	const accepted = await fetch(url, {
		method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:1420" }, body,
	});
	assert.equal(accepted.status, 200);
	assert.equal((await accepted.json()).cwd, calls[0].cwd);
});
