import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_DOCKER_IMAGE, dockerExecArgs, ExecutionTargets, type DockerRunner } from "./execution-targets.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=ade@test", "-c", "user.name=ADE", ...args], { cwd, encoding: "utf8" });

function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "ade-exec-")));
	const repo = join(root, "repo");
	const worktrees = join(root, "state", "worktrees");
	mkdirSync(repo);
	mkdirSync(worktrees, { recursive: true });
	git(repo, "init", "-q", "-b", "main");
	writeFileSync(join(repo, "a.txt"), "x");
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

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test("exec arguments pass env by name and prefer bash", () => {
	const args = dockerExecArgs("ade-x", "/w", "npm test", ["API_KEY"]);
	assert.deepEqual(args.slice(0, 7), ["exec", "-i", "-w", "/w", "-e", "API_KEY", "ade-x"]);
	assert.equal(args.at(-1), "npm test");
	assert.ok(!args.join(" ").includes("="), "no values on the command line");
});

test("a Docker session gets a container with its worktree, Git metadata and worktree folder mounted", async () => {
	const f = fixture();
	const { docker, calls } = fakeDocker();
	try {
		const targets = new ExecutionTargets(join(f.root, "state"), { docker, worktreesRoot: f.worktrees });
		assert.equal(targets.commandFor("s1", f.workspace, "ls", []), null, "sessions run on this computer by default");

		targets.setTarget("s1", { target: "docker" }, { workspace: f.workspace, repository: f.repo });
		assert.equal(targets.session("s1").state, "preparing");
		const preparing = targets.commandFor("s1", f.workspace, "ls", []);
		assert.match(preparing!.args.join(" "), /still starting/, "commands never fall back to this computer while the container starts");
		await targets.ensure("s1", { workspace: f.workspace, repository: f.repo });
		await settle();

		const run = calls.find(args => args[0] === "run")!;
		const mounts = run.flatMap((arg, index) => (arg === "-v" ? [run[index + 1]] : []));
		assert.deepEqual(mounts.sort(), [`${join(f.repo, ".git")}:${join(f.repo, ".git")}`, `${f.worktrees}:${f.worktrees}`].sort(), "the worktree is inside the worktree folder, so it isn't mounted twice");
		assert.equal(run.at(-3), DEFAULT_DOCKER_IMAGE);
		const record = targets.session("s1");
		assert.equal(record.state, "running");
		assert.ok(run.includes(`127.0.0.1:${record.port}:${record.port}`), "one port is published for the Run script");

		const command = targets.commandFor("s1", join(f.workspace, "src"), "npm test", ["TOKEN"]);
		assert.equal(command?.file, "docker");
		assert.deepEqual(command?.args.slice(0, 3), ["exec", "-i", "-w"]);
		// A subagent's worktree next to the session's is mounted too.
		assert.equal(targets.commandFor("s1", join(f.worktrees, "sub-1"), "ls", [])?.file, "docker");
		assert.match(targets.commandFor("s1", "/etc", "ls", [])!.args.join(" "), /not mounted/);

		assert.equal(targets.sessionForPath(join(f.workspace, "src"), [{ id: "s1", path: f.workspace }]), "s1");
		assert.equal(targets.shellFor("s1", f.workspace, [])?.args.includes("-it"), true);

		await targets.remove("s1");
		assert.ok(calls.some(args => args[0] === "rm" && args.at(-1) === record.container));
		assert.equal(targets.isDocker("s1"), false);
	} finally {
		f.cleanup();
	}
});

test("a container that can't start is reported, and commands fail instead of running locally", async () => {
	const f = fixture();
	const { docker } = fakeDocker("Unable to find image 'nope:latest' locally");
	try {
		const targets = new ExecutionTargets(join(f.root, "state"), { docker, worktreesRoot: f.worktrees });
		assert.throws(() => targets.setTarget("s1", { target: "docker", image: "bad image!" }, { workspace: f.workspace }), /Docker image like/);
		targets.setTarget("s1", { target: "docker", image: "nope" }, { workspace: f.workspace });
		await targets.ensure("s1", { workspace: f.workspace });
		const record = targets.session("s1");
		assert.equal(record.state, "failed");
		assert.match(record.message, /Unable to find image/);
		const command = targets.commandFor("s1", f.workspace, "ls", []);
		assert.equal(command?.file, "/bin/sh");
		assert.match(command!.args.join(" "), /could not start/);
		// Back to this computer: commands run locally again.
		targets.setTarget("s1", { target: "local" }, { workspace: f.workspace });
		assert.equal(targets.commandFor("s1", f.workspace, "ls", []), null);
	} finally {
		f.cleanup();
	}
});
