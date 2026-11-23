// Where a session's commands run: on this computer, or in a Docker container of its own.
//
// A Docker session gets one long-running container ("ade-<id>") from the project's image. Its
// worktree, the repository's Git metadata and ADE's worktree folder are mounted at the same
// absolute paths, so file paths are identical inside and out and subagent worktrees work too.
// The ADE agent's shell commands (and its subagents'), terminals and setup/run/check scripts are
// run with `docker exec` in that container. One port is published for the Run script.
//
// If a Docker session's container isn't available, commands fail with a clear message instead
// of quietly running on this computer.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { badRequest, httpError } from "./http-error.ts";
import { freePort } from "./project-scripts.ts";

const execute = promisify(execFile);

export type RunTarget = "local" | "docker";
export const DEFAULT_DOCKER_IMAGE = "node:22-bookworm";

export type DockerState = "absent" | "preparing" | "running" | "stopped" | "failed";

type SessionTarget = {
	target: RunTarget;
	image: string;
	container: string | null;
	port: number | null;
	/** Absolute paths mounted into the container (at the same path). */
	mounts: string[];
	state: DockerState;
	message: string;
	updatedAt: number;
};

type Stored = { sessions: Record<string, SessionTarget>; projects: Record<string, { target: RunTarget; image: string }> };

export type DockerRunner = (args: string[], options?: { timeout?: number }) => Promise<string>;

const defaultDocker: DockerRunner = async (args, options = {}) => {
	try {
		const { stdout } = await execute("docker", args, { timeout: options.timeout ?? 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
		return stdout;
	} catch (error) {
		const err = error as { code?: unknown; stderr?: unknown; message?: unknown };
		if (err?.code === "ENOENT") throw httpError(503, "Docker isn't installed on this computer. Install Docker Desktop (or another Docker engine) to run sessions in containers.");
		const detail = String(err?.stderr || err?.message || "").trim().split("\n").filter(Boolean).slice(-2).join(" ");
		if (/Cannot connect to the Docker daemon|Is the docker daemon running|docker.sock/i.test(detail)) throw httpError(503, "Docker isn't running. Start Docker Desktop and try again.");
		throw httpError(502, detail || `docker ${args[0]} failed.`);
	}
};

/** `docker exec` arguments for a command in a session's container. Env values are passed by name only. */
export function dockerExecArgs(container: string, cwd: string, command: string, envNames: string[], interactive = false) {
	// Prefer bash, fall back to sh for minimal images.
	const shell = ["sh", "-c", 'if command -v bash >/dev/null 2>&1; then exec bash -lc "$1"; else exec sh -lc "$1"; fi', "ade", command];
	return ["exec", interactive ? "-it" : "-i", "-w", cwd, ...envNames.flatMap(name => ["-e", name]), container, ...shell];
}

export function dockerShellArgs(container: string, cwd: string, envNames: string[]) {
	return ["exec", "-it", "-w", cwd, ...envNames.flatMap(name => ["-e", name]), container, "sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi"];
}

function validImage(value: unknown) {
	if (typeof value !== "string" || !value.trim()) return DEFAULT_DOCKER_IMAGE;
	const image = value.trim();
	if (image.length > 200 || !/^[a-z0-9][a-z0-9._\-/:@]*$/i.test(image)) throw badRequest("Enter a Docker image like node:22-bookworm or ghcr.io/org/image:tag.");
	return image;
}

function inside(child: string, parent: string) {
	return child === parent || child.startsWith(`${parent}${sep}`);
}

export class ExecutionTargets {
	#file: string;
	#data: Stored;
	#docker: DockerRunner;
	#worktreesRoot: string | null;
	#pending = new Map<string, Promise<SessionTarget>>();

	constructor(stateDirectory: string, options: { docker?: DockerRunner; worktreesRoot?: string | null } = {}) {
		this.#file = join(stateDirectory, "execution-targets.json");
		this.#docker = options.docker ?? defaultDocker;
		this.#worktreesRoot = options.worktreesRoot ?? null;
		this.#data = this.#load();
	}

	#load(): Stored {
		try {
			if (existsSync(this.#file)) {
				const parsed = JSON.parse(readFileSync(this.#file, "utf8")) as Partial<Stored>;
				return { sessions: parsed.sessions ?? {}, projects: parsed.projects ?? {} };
			}
		} catch {
			// Start over if the file is damaged.
		}
		return { sessions: {}, projects: {} };
	}

	#save() {
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#data, null, 2));
		renameSync(temp, this.#file);
	}

	// --- Project defaults ---

	projectDefault(projectId: string | null | undefined) {
		return (projectId && this.#data.projects[projectId]) || { target: "local" as RunTarget, image: DEFAULT_DOCKER_IMAGE };
	}

	setProjectDefault(projectId: string, input: { target?: unknown; image?: unknown }) {
		const target: RunTarget = input.target === "docker" ? "docker" : "local";
		this.#data.projects[projectId] = { target, image: validImage(input.image) };
		this.#save();
		return this.#data.projects[projectId];
	}

	// --- Sessions ---

	session(sessionId: string): SessionTarget {
		return this.#data.sessions[sessionId] ?? { target: "local", image: DEFAULT_DOCKER_IMAGE, container: null, port: null, mounts: [], state: "absent", message: "", updatedAt: 0 };
	}

	isDocker(sessionId: string) {
		return this.#data.sessions[sessionId]?.target === "docker";
	}

	/** Choose where a session runs. Switching to Docker prepares the container in the background. */
	setTarget(sessionId: string, input: { target?: unknown; image?: unknown }, paths: { workspace: string; repository?: string | null }) {
		const target: RunTarget = input.target === "docker" ? "docker" : "local";
		const current = this.session(sessionId);
		const image = validImage(input.image ?? current.image);
		const next: SessionTarget = { ...current, target, image, updatedAt: Date.now() };
		if (target === "local") {
			next.state = current.container ? "stopped" : "absent";
			next.message = "";
		}
		if (target === "docker" && (image !== current.image || current.state === "absent" || current.state === "failed")) {
			next.state = "preparing";
			next.message = "Starting the container…";
		}
		this.#data.sessions[sessionId] = next;
		this.#save();
		if (target === "docker") {
			if (current.container && image !== current.image) {
				// A different image needs a new container.
				void this.#docker(["rm", "-f", current.container]).catch(() => undefined).then(() => this.ensure(sessionId, paths)).catch(() => undefined);
				this.#data.sessions[sessionId] = { ...next, container: null };
			} else {
				void this.ensure(sessionId, paths).catch(() => undefined);
			}
		} else if (current.container) {
			void this.#docker(["stop", "-t", "2", current.container]).catch(() => undefined);
		}
		return this.session(sessionId);
	}

	/** Make sure a Docker session's container exists and is running. */
	ensure(sessionId: string, paths: { workspace: string; repository?: string | null }): Promise<SessionTarget> {
		const pending = this.#pending.get(sessionId);
		if (pending) return pending;
		const work = this.#ensure(sessionId, paths).finally(() => this.#pending.delete(sessionId));
		this.#pending.set(sessionId, work);
		return work;
	}

	async #ensure(sessionId: string, paths: { workspace: string; repository?: string | null }): Promise<SessionTarget> {
		const record = this.session(sessionId);
		if (record.target !== "docker") return record;
		const update = (patch: Partial<SessionTarget>) => {
			this.#data.sessions[sessionId] = { ...this.session(sessionId), ...patch, updatedAt: Date.now() };
			this.#save();
			return this.session(sessionId);
		};
		try {
			if (record.container) {
				const state = (await this.#docker(["inspect", "-f", "{{.State.Running}}", record.container]).catch(() => "missing")).trim();
				if (state === "true") return update({ state: "running", message: "" });
				if (state === "false") {
					await this.#docker(["start", record.container]);
					return update({ state: "running", message: "" });
				}
			}
			update({ state: "preparing", message: `Pulling ${record.image} if needed and starting the container…` });
			const workspace = realpathSync(paths.workspace);
			const mounts = new Set<string>([workspace]);
			// The worktree's Git metadata lives in the main repository; mount it so git works inside.
			try {
				const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: workspace, encoding: "utf8", timeout: 5000 }).trim();
				if (common) mounts.add(realpathSync(common));
			} catch {
				// Not a Git checkout.
			}
			// Subagents create their own worktrees next to the session's; mount that folder too.
			if (this.#worktreesRoot && existsSync(this.#worktreesRoot)) mounts.add(realpathSync(this.#worktreesRoot));
			// Drop mounts already covered by a parent mount.
			const list = [...mounts].sort((a, b) => a.length - b.length).filter((path, index, all) => !all.slice(0, index).some(parent => inside(path, parent)));
			const port = record.port ?? await freePort();
			const name = `ade-${sessionId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
			await this.#docker(["rm", "-f", name]).catch(() => undefined);
			const user = process.platform === "linux" && typeof process.getuid === "function" ? ["--user", `${process.getuid()}:${process.getgid?.() ?? process.getuid()}`] : [];
			await this.#docker([
				"run", "-d", "--init", "--name", name,
				"--label", "ade.session=" + sessionId,
				...list.flatMap(path => ["-v", `${path}:${path}`]),
				"-w", workspace,
				"-p", `127.0.0.1:${port}:${port}`,
				"-e", `PORT=${port}`,
				...user,
				record.image, "sleep", "infinity",
			], { timeout: 15 * 60_000 });
			return update({ container: name, port, mounts: list, state: "running", message: "" });
		} catch (error) {
			return update({ state: "failed", message: error instanceof Error ? error.message : String(error) });
		}
	}

	async status(sessionId: string) {
		const record = this.session(sessionId);
		if (record.target !== "docker" || !record.container || record.state === "preparing") return record;
		const running = (await this.#docker(["inspect", "-f", "{{.State.Running}}", record.container]).catch(() => "missing")).trim();
		const state: DockerState = running === "true" ? "running" : running === "false" ? "stopped" : "absent";
		if (state !== record.state && record.state !== "failed") {
			this.#data.sessions[sessionId] = { ...record, state };
			this.#save();
		}
		return this.session(sessionId);
	}

	/** Remove a session's container (archive or delete). Its files stay in the worktree. */
	async remove(sessionId: string) {
		const record = this.#data.sessions[sessionId];
		if (!record) return;
		if (record.container) await this.#docker(["rm", "-f", record.container]).catch(() => undefined);
		delete this.#data.sessions[sessionId];
		this.#save();
	}

	async dockerAvailable() {
		try {
			return { available: true, version: (await this.#docker(["version", "--format", "{{.Server.Version}}"], { timeout: 10_000 })).trim(), message: "" };
		} catch (error) {
			return { available: false, version: null, message: error instanceof Error ? error.message : String(error) };
		}
	}

	/**
	 * How to run a command for this session: null = on this computer; otherwise the docker exec
	 * invocation, or a command that explains why the container isn't available.
	 */
	commandFor(sessionId: string | null | undefined, cwd: string, command: string, envNames: string[]): { file: string; args: string[] } | null {
		const record = sessionId ? this.#data.sessions[sessionId] : undefined;
		if (!record || record.target !== "docker") return null;
		if (!record.container || record.state === "failed" || record.state === "preparing" || !this.#covers(record, cwd)) {
			return { file: "/bin/sh", args: ["-c", `echo "${this.#unavailable(record, cwd).replace(/"/g, "'")}" >&2; exit 125`] };
		}
		return { file: "docker", args: dockerExecArgs(record.container, cwd, command, envNames) };
	}

	shellFor(sessionId: string | null | undefined, cwd: string, envNames: string[]): { file: string; args: string[] } | null {
		const record = sessionId ? this.#data.sessions[sessionId] : undefined;
		if (!record || record.target !== "docker") return null;
		if (!record.container || record.state === "failed" || record.state === "preparing" || !this.#covers(record, cwd)) {
			return { file: "/bin/sh", args: ["-c", `echo "${this.#unavailable(record, cwd).replace(/"/g, "'")}"; exec sleep 3600`] };
		}
		return { file: "docker", args: dockerShellArgs(record.container, cwd, envNames) };
	}

	/** The session whose workspace contains this folder (for terminals, which only know a folder). */
	sessionForPath(cwd: string, workspaces: Array<{ id: string; path: string | null | undefined }>) {
		let real: string;
		try {
			real = realpathSync(cwd);
		} catch {
			real = resolve(cwd);
		}
		for (const item of workspaces) {
			if (!item.path || !this.isDocker(item.id)) continue;
			let base: string;
			try {
				base = realpathSync(item.path);
			} catch {
				continue;
			}
			if (inside(real, base)) return item.id;
		}
		return null;
	}

	#covers(record: SessionTarget, cwd: string) {
		let real: string;
		try {
			real = realpathSync(cwd);
		} catch {
			real = resolve(cwd);
		}
		return record.mounts.some(mount => inside(real, mount));
	}

	#unavailable(record: SessionTarget, cwd: string) {
		if (record.state === "preparing") return "ADE: this session runs in Docker and its container is still starting. Try again in a moment.";
		if (record.state === "failed") return `ADE: this session runs in Docker, but its container could not start: ${record.message}`;
		if (record.container && !this.#covers(record, cwd)) return `ADE: ${cwd} is not mounted in this session's Docker container.`;
		return "ADE: this session runs in Docker, but its container isn't running. Open Run to start it.";
	}
}

// Spawn points ask the runtime where a session's commands run; the runtime installs the lookup.
let current: ExecutionTargets | null = null;
let terminalSession: (cwd: string) => string | null = () => null;

export function setExecutionTargets(targets: ExecutionTargets | null, sessionForCwd?: (cwd: string) => string | null) {
	current = targets;
	terminalSession = sessionForCwd ?? (() => null);
}

export function commandInvocation(sessionId: string | null | undefined, cwd: string, command: string, envNames: string[]) {
	return current?.commandFor(sessionId, cwd, command, envNames) ?? null;
}

export function terminalInvocation(cwd: string, envNames: string[]) {
	const sessionId = terminalSession(cwd);
	return sessionId ? current?.shellFor(sessionId, cwd, envNames) ?? null : null;
}

export function sessionPort(sessionId: string) {
	const record = current?.session(sessionId);
	return record?.target === "docker" ? record.port : null;
}

/** End a process started in a session's container (by its pid file) and its children. */
export function stopInContainer(sessionId: string, pidFile: string) {
	const record = current?.session(sessionId);
	if (!record?.container) return;
	const script = `pid=$(cat ${pidFile} 2>/dev/null) || exit 0; pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null; true`;
	execFile("docker", ["exec", record.container, "sh", "-c", script], { timeout: 10_000 }, () => undefined);
}

export function runsInDocker(sessionId: string | null | undefined) {
	return Boolean(sessionId && current?.isDocker(sessionId));
}
