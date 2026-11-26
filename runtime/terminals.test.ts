import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { IPty } from "node-pty";
import { createRuntimeServer } from "./server.ts";
import { EngineManager } from "./engines.ts";
import { TerminalManager, type TerminalStreamEvent } from "./terminals.ts";

const directories: string[] = [];
const servers: Server[] = [];

function temporaryDirectory() {
	const directory = mkdtempSync(join(tmpdir(), "ade-terminal-"));
	directories.push(directory);
	return directory;
}

async function listen(server: Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	servers.push(server);
	return (server.address() as AddressInfo).port;
}

afterEach(async () => {
	for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fakePty() {
	const dataListeners: ((data: string) => void)[] = [];
	const exitListeners: ((event: { exitCode: number }) => void)[] = [];
	const pty = {
		writes: [] as string[],
		resizes: [] as { cols: number; rows: number }[],
		killed: false,
		onData(listener: (data: string) => void) { dataListeners.push(listener); return { dispose() {} }; },
		onExit(listener: (event: { exitCode: number }) => void) { exitListeners.push(listener); return { dispose() {} }; },
		write(data: string) { this.writes.push(data); },
		resize(cols: number, rows: number) { this.resizes.push({ cols, rows }); },
		kill() { this.killed = true; for (const listener of exitListeners) listener({ exitCode: 0 }); },
		emitData(data: string) { for (const listener of dataListeners) listener(data); },
	};
	return pty;
}

test("terminal sessions spawn a user-operated shell in the selected workspace and stream bounded output", () => {
	const cwd = temporaryDirectory();
	const pty = fakePty();
	const spawned: { shell: string; args: string[] | string; options: { cwd?: string } }[] = [];
	const manager = new TerminalManager({
		environment: { SHELL: "/bin/zsh", HOME: "/tmp" },
		maxOutputCharacters: 8,
		spawn: ((shell: string, args: string[], options: { cwd?: string }) => { spawned.push({ shell, args, options }); return pty as unknown as IPty; }) as never,
	});
	const created = manager.create({ cwd, cols: 90, rows: 30 });
	assert.equal(spawned[0].shell, process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
	assert.deepEqual(spawned[0].args, []);
	assert.equal(spawned[0].options.cwd, realpathSync.native(cwd));
	assert.equal(created.cwd, realpathSync.native(cwd));

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

// ConPTY needs a console window, which the Windows CI runner doesn't have.
test("the system PTY executes input from the terminal session", { skip: process.platform === "win32" ? "ConPTY needs a console" : false }, async () => {
	const cwd = temporaryDirectory();
	const manager = new TerminalManager();
	let id: string | undefined;
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
	const manager = new TerminalManager({ spawn: (() => fakePty() as unknown as IPty) as never });
	assert.throws(() => manager.create({ cwd: "relative/path" }), /absolute workspace/);
	assert.throws(() => manager.create({ cwd: join(temporaryDirectory(), "missing") }), /directory is unavailable/);
	const cwd = temporaryDirectory();
	assert.throws(() => manager.create({ cwd, cols: 2 }), /Terminal columns/);
	const created = manager.create({ cwd });
	assert.throws(() => manager.write(created.id, "x".repeat(8193)), /8192/);
	const homeTerminal = manager.create({ cwd: "~" });
	assert.ok(homeTerminal.cwd.length > 0);
	manager.closeAll();
});

test("terminal API routes require an approved ADE origin", async () => {
	const calls: { cwd: string }[] = [];
	const terminals = {
		create: (input: { cwd: string }) => { calls.push(input); return { id: "00000000-0000-4000-8000-000000000001", cwd: input.cwd }; },
		read: (id: string, cursor: unknown) => ({ id, cursor: Number(cursor), data: "", exited: false }),
		write: (id: string, data: string) => ({ id, data }),
		resize: (id: string, input: Record<string, unknown>) => ({ id, ...input }),
		close: (id: string) => ({ id, closed: true }),
	};
	const server = createRuntimeServer({ host: {} as never, worktreeManager: {} as never, terminals: terminals as unknown as TerminalManager });
	const port = await listen(server);
	const url = `http://127.0.0.1:${port}/api/terminals`;
	const body = JSON.stringify({ cwd: temporaryDirectory() });
	const rejected = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
	assert.equal(rejected.status, 403);
	const accepted = await fetch(url, {
		method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:1420" }, body,
	});
	assert.equal(accepted.status, 200);
	assert.equal((await accepted.json() as { cwd: string }).cwd, calls[0].cwd);
});

test("terminal mode spawns interactive harnesses (Claude Code, Codex, Copilot) and reattaches by sessionId", () => {
	const cwd = temporaryDirectory();
	const spawned: { command: string; args: string[]; pty: ReturnType<typeof fakePty> }[] = [];
	const manager = new TerminalManager({
		spawn: ((command: string, args: string[]) => {
			const pty = fakePty();
			spawned.push({ command, args, pty });
			return pty as unknown as IPty;
		}) as never,
	});

	const claude = manager.create({ cwd, harness: "claude-code", sessionId: "sess-1", initialPrompt: "Fix login" });
	assert.equal(spawned[0].command, "claude");
	assert.deepEqual(spawned[0].args, ["Fix login"]);
	assert.equal(claude.shell, "Claude Code");
	assert.equal(claude.harness, "claude-code");
	assert.equal(claude.reused, false);
	assert.equal(manager.isSessionActive("sess-1"), true);

	// Reopening the same session reattaches instead of spawning a second PTY.
	const reattached = manager.create({ cwd, harness: "claude-code", sessionId: "sess-1", cols: 120, rows: 40 });
	assert.equal(reattached.id, claude.id);
	assert.equal(reattached.reused, true);
	assert.equal(spawned.length, 1);
	assert.deepEqual(spawned[0].pty.resizes, [{ cols: 120, rows: 40 }]);

	const codex = manager.create({ cwd, harness: "codex", sessionId: "sess-2" });
	assert.equal(spawned[1].command, "codex");
	assert.deepEqual(spawned[1].args, []);
	assert.equal(codex.shell, "Codex");

	const copilot = manager.create({ cwd, harness: "copilot", sessionId: "sess-3", initialPrompt: "Add tests" });
	assert.equal(spawned[2].command, "copilot");
	assert.deepEqual(spawned[2].args, ["-i", "Add tests"]);
	assert.equal(copilot.shell, "GitHub Copilot");

	const piCli = manager.create({ cwd, harness: "pi-cli", sessionId: "sess-4", initialPrompt: "Refactor auth" });
	assert.equal(spawned[3].command, "pi");
	assert.deepEqual(spawned[3].args, ["Refactor auth"]);
	assert.equal(piCli.shell, "Pi CLI");

	const omp = manager.create({ cwd, harness: "oh-my-pi", sessionId: "sess-5" });
	assert.equal(spawned[4].command, "omp");
	assert.deepEqual(spawned[4].args, []);
	assert.equal(omp.shell, "Oh My Pi");

	const opencode = manager.create({ cwd, harness: "opencode", sessionId: "sess-6", initialPrompt: "Fix CSS" });
	assert.equal(spawned[5].command, "opencode");
	assert.deepEqual(spawned[5].args, ["--prompt", "Fix CSS"]);
	assert.equal(opencode.shell, "OpenCode");

	const gemini = manager.create({ cwd, harness: "gemini", sessionId: "sess-7", initialPrompt: "Explain flow" });
	assert.equal(spawned[6].command, "gemini");
	assert.deepEqual(spawned[6].args, ["-i", "Explain flow"]);
	assert.equal(gemini.shell, "Gemini CLI");

	assert.equal(manager.closeBySession("sess-1"), 1);
	assert.equal(manager.isSessionActive("sess-1"), false);
	assert.equal(spawned[0].pty.killed, true);
	manager.closeAll();
});

test("terminal subscribe replays buffered output and streams live chunks + exit over SSE", async () => {
	const cwd = temporaryDirectory();
	const pty = fakePty();
	const manager = new TerminalManager({
		spawn: (() => pty as unknown as IPty) as never,
	});
	const created = manager.create({ cwd, harness: "claude-code", sessionId: "sess-sse" });
	pty.emitData("boot> ");

	const received: TerminalStreamEvent[] = [];
	const unsubscribe = manager.subscribe(created.id, 0, event => received.push(event));
	assert.equal(received.length, 1);
	assert.equal(received[0].type, "output");
	if (received[0].type === "output") {
		assert.equal(received[0].data, "boot> ");
		assert.equal(received[0].cursor, 6);
	}

	pty.emitData("ready\r\n");
	assert.equal(received.length, 2);
	if (received[1].type === "output") {
		assert.equal(received[1].data, "ready\r\n");
		assert.equal(received[1].cursor, 13);
	}

	// Verify the HTTP SSE endpoint streams buffered + live events and closes on exit.
	const server = createRuntimeServer({ host: {} as never, worktreeManager: {} as never, terminals: manager });
	const port = await listen(server);
	const response = await fetch(`http://127.0.0.1:${port}/api/terminals/${created.id}/stream?cursor=0`);
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let text = "";
	const readMore = async () => {
		const { value, done } = await reader.read();
		if (value) text += decoder.decode(value, { stream: true });
		return done;
	};
	await readMore();
	assert.match(text, /event: output/);
	assert.match(text, /boot> ready/);
	pty.kill();
	let done = false;
	while (!done && !text.includes("event: exit")) done = await readMore();
	assert.match(text, /event: exit/);
	unsubscribe();
	manager.closeAll();
});

test("EngineManager supports terminal mode for Claude Code, Codex, and Copilot", () => {
	const stateDirectory = temporaryDirectory();
	const engines = new EngineManager({ stateDirectory });
	const list = engines.available();
	const copilotEntry = list.find(e => e.id === "copilot");
	assert.ok(copilotEntry);
	assert.deepEqual(copilotEntry.modes, ["terminal"]);

	// Copilot, Pi CLI, and OpenCode reject chat mode and default to terminal mode.
	assert.throws(() => engines.setEngine("sess-cop-chat", "copilot", null, "chat"), /does not support chat mode/);
	assert.throws(() => engines.setEngine("sess-pi-chat", "pi-cli", null, "chat"), /does not support chat mode/);
	const cop = engines.setEngine("sess-cop", "copilot");
	assert.equal(cop?.engine, "copilot");
	assert.equal(cop?.interactionMode, "terminal");
	const piCli = engines.setEngine("sess-pi-cli", "pi-cli");
	assert.equal(piCli?.engine, "pi-cli");
	assert.equal(piCli?.interactionMode, "terminal");
	const opencode = engines.setEngine("sess-opencode", "opencode");
	assert.equal(opencode?.engine, "opencode");
	assert.equal(opencode?.interactionMode, "terminal");

	// Claude Code can be configured in terminal mode and rejects headless send().
	const claudeTerm = engines.setEngine("sess-claude-term", "claude-code", null, "terminal");
	assert.equal(claudeTerm?.interactionMode, "terminal");
	assert.throws(() => engines.send("sess-claude-term", stateDirectory, "hello", "ask"), /terminal mode/);
});
