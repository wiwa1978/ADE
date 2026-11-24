import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBoatApi } from "./boat.ts";
import { DEFAULT_DOCKER_IMAGE, dockerExecArgs, ExecutionTargets, q, toWslPath, wslEnv, type BoatApi, type DockerRunner } from "./execution-targets.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=ade@test", "-c", "user.name=ADE", ...args], { cwd, encoding: "utf8" });

function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "ade-exec-")));
	const repo = join(root, "repo");
	const worktrees = join(root, "state", "worktrees");
	mkdirSync(repo);
	mkdirSync(worktrees, { recursive: true });
	git(repo, "init", "-q", "-b", "main");
	writeFileSync(join(repo, "a.txt"), "x");
	writeFileSync(join(repo, ".gitignore"), "node_modules/\n*.log\n");
	git(repo, "add", ".");
	git(repo, "commit", "-qm", "init");
	const workspace = join(worktrees, "s1");
	git(repo, "worktree", "add", "-q", "-b", "ade/s1", workspace);
	return { root, repo, worktrees, workspace, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function fakeDocker(fail?: string) {
	const calls: string[][] = [];
	const running = new Set<string>();
	const docker: DockerRunner = async args => {
		calls.push(args);
		if (fail && args[0] === "run") throw new Error(fail);
		if (args[0] === "run") running.add(args[args.indexOf("--name") + 1]);
		if (args[0] === "inspect") return running.has(args.at(-1)!) ? "true\n" : "false\n";
		if (args[0] === "rm") running.delete(args.at(-1)!);
		return "";
	};
	return { docker, calls };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

test("exec arguments pass env by name and prefer bash", () => {
	const args = dockerExecArgs("ade-x", "/w", "npm test", ["API_KEY"]);
	assert.deepEqual(args.slice(0, 7), ["exec", "-i", "-w", "/w", "-e", "API_KEY", "ade-x"]);
	assert.equal(args.at(-1), "npm test");
	assert.ok(!args.join(" ").includes("="), "no values on the command line");
	assert.equal(q("it's"), `'it'\\''s'`);
});

test("Docker: a container per session with its worktree, Git metadata and agent sign-ins mounted", async () => {
	const f = fixture();
	const { docker, calls } = fakeDocker();
	try {
		const targets = new ExecutionTargets(join(f.root, "state"), { docker, worktreesRoot: f.worktrees });
		assert.equal(targets.commandFor("s1", f.workspace, "ls", []), null, "sessions run on this computer by default");

		targets.setTarget("s1", { target: "docker" }, { workspace: f.workspace, repository: f.repo });
		assert.equal(targets.session("s1").state, "preparing");
		assert.match(targets.commandFor("s1", f.workspace, "ls", [])!.args.join(" "), /still starting/, "never falls back to this computer while starting");
		await settle();
		await targets.ensure("s1", { workspace: f.workspace, repository: f.repo });

		const run = calls.find(args => args[0] === "run")!;
		// ADE mounts real paths (on Windows the temp folder has a short 8.3 name, e.g. RUNNER~1).
		const root = realpathSync.native(f.root);
		const mounts = run.flatMap((arg, index) => (arg === "-v" ? [run[index + 1].split(":")[0]] : [])).filter(path => path.startsWith(root));
		assert.deepEqual(mounts.sort(), [join(realpathSync.native(f.repo), ".git"), realpathSync.native(f.worktrees)].sort(), "the worktree sits inside the worktree folder, so it isn't mounted twice");
		assert.ok(run.includes("IS_SANDBOX=1") && run.some(arg => arg.startsWith("HOME=")), "agent CLIs find their sign-in and may skip prompts in the container");
		assert.equal(run.at(-3), DEFAULT_DOCKER_IMAGE);
		const record = targets.session("s1");
		assert.equal(record.state, "running");
		assert.ok(run.includes(`127.0.0.1:${record.port}:${record.port}`), "one port is published for the Run script");

		const command = targets.commandFor("s1", join(f.workspace, "src"), "npm test", ["TOKEN"], { pidFile: "/tmp/p.pid" });
		assert.equal(command?.file, "docker");
		assert.match(command!.args.at(-1)!, /^echo \$\$ > '\/tmp\/p.pid'; npm test$/, "a pid file lets Stop end it in the container");
		assert.equal(targets.commandFor("s1", join(f.worktrees, "sub-1"), "ls", [])?.file, "docker", "subagent worktrees are mounted too");
		assert.match(targets.commandFor("s1", "/etc", "ls", [])!.args.join(" "), /not mounted/);
		assert.equal(targets.sessionForPath(join(f.workspace, "src"), [{ id: "s1", path: f.workspace }]), "s1");

		await targets.remove("s1");
		assert.ok(calls.some(args => args[0] === "rm" && args.at(-1) === record.container));
		assert.equal(targets.isManaged("s1"), false);
	} finally {
		f.cleanup();
	}
});

test("Docker: a container that can't start is reported, and commands fail instead of running locally", async () => {
	const f = fixture();
	const { docker } = fakeDocker("Unable to find image 'nope:latest' locally");
	try {
		const targets = new ExecutionTargets(join(f.root, "state"), { docker, worktreesRoot: f.worktrees });
		assert.throws(() => targets.setTarget("s1", { target: "docker", image: "bad image!" }, { workspace: f.workspace }), /Docker image like/);
		targets.setTarget("s1", { target: "docker", image: "nope" }, { workspace: f.workspace });
		await settle();
		await targets.ensure("s1", { workspace: f.workspace });
		assert.equal(targets.session("s1").state, "failed");
		const command = targets.commandFor("s1", f.workspace, "ls", []);
		assert.equal(command?.file, "/bin/sh");
		assert.match(command!.args.join(" "), /isn.*t available: Unable to find image/);
		targets.setTarget("s1", { target: "local" }, { workspace: f.workspace });
		assert.equal(targets.commandFor("s1", f.workspace, "ls", []), null, "back to this computer");
	} finally {
		f.cleanup();
	}
});

test("WSL2: Windows paths and environment are translated, and it's only offered on Windows", async () => {
	assert.equal(toWslPath("C:\\Users\\me\\code\\app"), "/mnt/c/Users/me/code/app");
	assert.equal(toWslPath("D:\\"), "/mnt/d");
	assert.equal(toWslPath("\\\\wsl$\\Ubuntu\\home\\me\\app"), "/home/me/app");
	assert.equal(wslEnv(["API_KEY", "PORT"], "FOO/p"), "FOO/p:API_KEY/u:PORT/u");

	const dir = mkdtempSync(join(tmpdir(), "ade-wsl-"));
	try {
		const mac = new ExecutionTargets(dir, { platform: "darwin" });
		assert.ok(!mac.available().includes("wsl"));
		assert.throws(() => mac.setTarget("s1", { target: "wsl" }, { workspace: dir }), /only available on Windows/);

		const windows = new ExecutionTargets(dir, { platform: "win32", run: async () => "Ubuntu\r\nDebian\r\n" });
		assert.deepEqual(windows.available(), ["local", "docker", "wsl"]);
		windows.setTarget("s1", { target: "wsl", wslDistro: "Ubuntu" }, { workspace: dir });
		await settle();
		await windows.ensure("s1", { workspace: dir });
		assert.equal(windows.session("s1").state, "running");
		const command = windows.commandFor("s1", "C:\\code\\app", "npm test", ["API_KEY"]);
		assert.deepEqual(command, { file: "wsl.exe", args: ["-d", "Ubuntu", "--cd", "/mnt/c/code/app", "--", "bash", "-lc", "npm test"], env: { WSLENV: wslEnv(["API_KEY"], process.env.WSLENV) } });
		windows.setTarget("s2", { target: "wsl", wslDistro: "Arch" }, { workspace: dir });
		await settle();
		await windows.ensure("s2", { workspace: dir });
		assert.match(windows.session("s2").message, /Arch isn't installed. Installed: Ubuntu, Debian/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// SSH and Boat.dev targets need ssh and rsync, which ADE doesn't offer on Windows (use WSL2 there).
const notWindows = { skip: process.platform === "win32" ? "ssh and rsync aren't available on Windows" : false };

test("SSH: the worktree is synced up, the command runs remotely with secrets on stdin, and results sync back", notWindows, async () => {
	const f = fixture();
	// A stand-in for ssh that runs the remote command on this computer with HOME set to a "remote" folder.
	const remoteHome = join(f.root, "remote-home");
	const bin = join(f.root, "bin");
	mkdirSync(remoteHome);
	mkdirSync(bin);
	writeFileSync(join(bin, "ssh"), `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o|-p|-i|-L) shift 2;; -t|-T) shift;; -*) shift;; *) break;; esac; done\nshift\ncd "${remoteHome}" && HOME="${remoteHome}" exec sh -c "$*"\n`);
	chmodSync(join(bin, "ssh"), 0o755);
	const path = `${bin}:${process.env.PATH}`;
	try {
		const run = async (file: string, args: string[]) => execFileSync(file, args, { encoding: "utf8", env: { ...process.env, PATH: path } });
		const targets = new ExecutionTargets(join(f.root, "state"), { worktreesRoot: f.worktrees, run });
		assert.throws(() => targets.setTarget("s1", { target: "ssh" }, { workspace: f.workspace }), /Enter the SSH host/);
		targets.setTarget("s1", { target: "ssh", sshHost: "build-box", remoteRoot: "ade-ws" }, { workspace: f.workspace });
		await settle();
		const ready = await targets.ensure("s1", { workspace: f.workspace });
		assert.equal(ready.state, "running", ready.message);

		mkdirSync(join(f.workspace, "node_modules"));
		writeFileSync(join(f.workspace, "node_modules", "big.js"), "local only");
		const invocation = targets.commandFor("s1", f.workspace, "cat a.txt; echo \"secret=$TOKEN\"; echo made-remotely > out.txt", ["TOKEN"], { workspaces: [f.workspace] })!;
		assert.equal(invocation.file, "/bin/sh");
		assert.ok(!invocation.args.join(" ").includes("s3cret"), "secret values aren't on any command line");
		const result = spawnSync(invocation.file, invocation.args, { encoding: "utf8", env: { ...process.env, PATH: path, TOKEN: "s3cret" } });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^x\s*secret=s3cret/);
		assert.equal(readFileSync(join(f.workspace, "out.txt"), "utf8"), "made-remotely\n", "files created remotely come back");
		assert.equal(existsSync(join(remoteHome, "ade-ws", "s1", "node_modules")), false, "ignored folders aren't copied");
		assert.equal(existsSync(join(remoteHome, "ade-ws", "s1", ".git")), false, "Git stays on this computer");
		assert.equal(targets.commandFor("s1", f.workspace, "git status", [], { workspaces: [f.workspace] }), null, "plain git commands run here");

		const failing = targets.commandFor("s1", f.workspace, "exit 7", [], { workspaces: [f.workspace] })!;
		assert.equal(spawnSync(failing.file, failing.args, { env: { ...process.env, PATH: path } }).status, 7, "the remote exit code comes through");
		assert.match(targets.commandFor("s1", "/etc", "ls", [], { workspaces: [f.workspace] })!.args.join(" "), /part of this session.*workspace/);
	} finally {
		f.cleanup();
	}
});

test("Boat.dev: a VM is created, its key authorized and host key pinned, and it's deleted on archive", notWindows, async () => {
	const f = fixture();
	const calls: string[] = [];
	let state = "provisioning";
	const boat: BoatApi = {
		create: async name => { calls.push(`create ${name}`); return { id: "bx_abcdefgh" }; },
		get: async () => { const now = state; state = "ready"; return { state: now }; },
		resume: async () => { calls.push("resume"); },
		authorizeKey: async (id, key) => { calls.push(`key ${id} ${key.split(" ")[0]}`); return { hostKey: "ssh-ed25519 AAAAhost", host: "203.0.113.7", port: 22 }; },
		remove: async id => { calls.push(`remove ${id}`); },
	};
	try {
		const targets = new ExecutionTargets(join(f.root, "state"), { worktreesRoot: f.worktrees, boat: () => boat, run: async () => "" });
		targets.setTarget("s1", { target: "boat" }, { workspace: f.workspace });
		await settle();
		const ready = await targets.ensure("s1", { workspace: f.workspace });
		assert.equal(ready.state, "running", ready.message);
		assert.deepEqual(calls.slice(0, 2), ["create ade-s1", "key bx_abcdefgh ssh-ed25519"]);
		assert.equal(readFileSync(join(f.root, "state", "boat_known_hosts"), "utf8"), "bx_abcdefgh ssh-ed25519 AAAAhost\n");
		const command = targets.commandFor("s1", f.workspace, "npm test", [], { workspaces: [f.workspace] })!.args.join(" ");
		assert.match(command, /HostKeyAlias=bx_abcdefgh/);
		assert.match(command, /user@203\.0\.113\.7/);
		await targets.remove("s1");
		assert.deepEqual(calls.at(-1), "remove bx_abcdefgh");

		const none = new ExecutionTargets(join(f.root, "state2"), { worktreesRoot: f.worktrees, boat: () => null });
		none.setTarget("s1", { target: "boat" }, { workspace: f.workspace });
		await settle();
		assert.match((await none.ensure("s1", { workspace: f.workspace })).message, /Boat.dev API key/);
	} finally {
		f.cleanup();
	}
});

test("Boat.dev API client follows the documented endpoints", async () => {
	const requests: Array<{ method: string; url: string; headers: Record<string, string>; body?: string }> = [];
	const fakeFetch = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
		requests.push({ method: init.method, url, headers: init.headers, body: init.body });
		if (url.endsWith("/sshkey")) return new Response(JSON.stringify({ ok: true, hostKey: "ssh-ed25519 HK", machineIp: "198.51.100.2", sshEndpoint: "gw.boat.dev:2201" }));
		if (init.method === "POST" && url.endsWith("/sandboxes")) return new Response(JSON.stringify({ ok: true, sandbox: { id: "bx_23456789", state: "provisioning" } }), { status: 202 });
		if (init.method === "GET" && url.includes("/sandboxes/")) return new Response(JSON.stringify({ ok: true, sandbox: { id: "bx_23456789", state: "ready" } }));
		return new Response(JSON.stringify({ ok: true }), { status: 202 });
	}) as unknown as typeof fetch;
	const api = createBoatApi("boat_testkey123", fakeFetch);
	assert.deepEqual(await api.create("ade-1"), { id: "bx_23456789" });
	assert.equal((await api.get("bx_23456789")).state, "ready");
	assert.deepEqual(await api.authorizeKey("bx_23456789", "ssh-ed25519 AAA ade"), { hostKey: "ssh-ed25519 HK", host: "gw.boat.dev", port: 2201 });
	await api.remove("bx_23456789");
	assert.equal(requests[0].url, "https://boat.dev/api/v1/sandboxes");
	assert.equal(requests[0].headers.authorization, "Bearer boat_testkey123");
	assert.equal(requests.at(-1)?.headers["X-Ascii-Confirm-Delete"], "bx_23456789");
	assert.equal(JSON.parse(requests[2].body!).key, "ssh-ed25519 AAA ade");

	const denied = createBoatApi("boat_badkey12345", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
	await assert.rejects(denied.check(), /rejected the API key/);
});
