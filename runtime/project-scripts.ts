// Per-project setup and run scripts (roadmap R1).
//
// - Setup runs once when a session's worktree is created (install dependencies, copy .env files).
// - Run starts the project's dev server inside a session's workspace on a free port, so several
//   sessions can run at the same time; the first URL it prints is opened in the browser panel.
//
// Scripts come from the project's settings in ADE, falling back to `.ade/project.json` committed in
// the repository ({ "setup": "...", "run": "...", "copy": [".env"] }) so a team can share them.
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import type { RuntimeEventBus } from "./events.ts";

export type ProjectScripts = { setup: string; run: string; copy: string[] };
export type ScriptKind = "setup" | "run";
export type ScriptStatus = "idle" | "running" | "succeeded" | "failed" | "stopped";
export type ScriptState = {
	kind: ScriptKind;
	status: ScriptStatus;
	command: string;
	output: string;
	exitCode: number | null;
	startedAt: number | null;
	endedAt: number | null;
	port: number | null;
	url: string | null;
};

const MAX_OUTPUT = 200_000;
const URL_PATTERN = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>]*)?/i;

function emptyScripts(): ProjectScripts {
	return { setup: "", run: "", copy: [] };
}

function sanitize(input: unknown): ProjectScripts {
	const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	const text = (field: unknown) => typeof field === "string" ? field.slice(0, 4000) : "";
	const copy = Array.isArray(value.copy) ? value.copy.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim()).slice(0, 50) : [];
	return { setup: text(value.setup), run: text(value.run), copy };
}

/** Free TCP port on loopback, so each session's dev server gets its own. */
export function freePort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => resolvePort(port));
		});
	});
}

/** Copy listed files (e.g. .env) from the project checkout into a new worktree. Paths must stay inside both. */
export function copyIntoWorktree(source: string, target: string, files: string[]): string[] {
	const copied: string[] = [];
	for (const file of files) {
		const relativePath = normalize(file).replace(/^[/\\]+/, "");
		if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) continue;
		const from = resolve(source, relativePath);
		const to = resolve(target, relativePath);
		if (relative(source, from).startsWith("..") || relative(target, to).startsWith("..")) continue;
		if (!existsSync(from) || !statSync(from).isFile() || existsSync(to)) continue;
		mkdirSync(dirname(to), { recursive: true });
		copyFileSync(from, to);
		copied.push(relativePath);
	}
	return copied;
}

export class ProjectScriptStore {
	#path: string;
	#data: Record<string, ProjectScripts>;

	constructor(stateDirectory: string) {
		this.#path = join(stateDirectory, "project-scripts.json");
		try {
			const raw = JSON.parse(readFileSync(this.#path, "utf8"));
			this.#data = raw && typeof raw === "object" ? Object.fromEntries(Object.entries(raw).map(([id, value]) => [id, sanitize(value)])) : {};
		} catch {
			this.#data = {};
		}
	}

	/** Scripts saved in ADE for a project (may be empty). */
	saved(projectId: string): ProjectScripts {
		return this.#data[projectId] ?? emptyScripts();
	}

	save(projectId: string, input: unknown): ProjectScripts {
		this.#data[projectId] = sanitize(input);
		writeFileSync(`${this.#path}.tmp`, JSON.stringify(this.#data, null, 2));
		renameSync(`${this.#path}.tmp`, this.#path);
		return this.#data[projectId];
	}

	/** Scripts committed in the repository's `.ade/project.json`, if any. */
	fromRepository(repository: string | null): ProjectScripts | null {
		if (!repository) return null;
		try {
			return sanitize(JSON.parse(readFileSync(join(repository, ".ade", "project.json"), "utf8")));
		} catch {
			return null;
		}
	}

	/** Effective scripts: each field from ADE's settings, else from the repository file. */
	effective(projectId: string, repository: string | null): ProjectScripts & { source: { setup: string; run: string; copy: string } } {
		const saved = this.saved(projectId);
		const repo = this.fromRepository(repository) ?? emptyScripts();
		return {
			setup: saved.setup || repo.setup,
			run: saved.run || repo.run,
			copy: saved.copy.length ? saved.copy : repo.copy,
			source: {
				setup: saved.setup ? "ade" : repo.setup ? "repository" : "none",
				run: saved.run ? "ade" : repo.run ? "repository" : "none",
				copy: saved.copy.length ? "ade" : repo.copy.length ? "repository" : "none",
			},
		};
	}
}

export class ScriptRunner {
	#states = new Map<string, ScriptState>();
	#children = new Map<string, ChildProcess>();
	#events?: RuntimeEventBus;
	#environment: NodeJS.ProcessEnv;

	constructor({ events, environment = process.env }: { events?: RuntimeEventBus; environment?: NodeJS.ProcessEnv } = {}) {
		this.#events = events;
		this.#environment = environment;
	}

	#key(sessionId: string, kind: ScriptKind) {
		return `${sessionId}:${kind}`;
	}

	state(sessionId: string, kind: ScriptKind): ScriptState {
		return this.#states.get(this.#key(sessionId, kind)) ?? { kind, status: "idle", command: "", output: "", exitCode: null, startedAt: null, endedAt: null, port: null, url: null };
	}

	#emit(sessionId: string) {
		this.#events?.emit("processes.update", { sessionId, scripts: { setup: this.state(sessionId, "setup").status, run: this.state(sessionId, "run").status } }, sessionId);
	}

	async start(sessionId: string, kind: ScriptKind, command: string, cwd: string, extraEnv: Record<string, string> = {}): Promise<ScriptState> {
		if (!command.trim()) throw Object.assign(new Error(`No ${kind} script is configured for this project. Add one in the project's settings.`), { statusCode: 400 });
		const key = this.#key(sessionId, kind);
		if (this.#children.has(key)) throw Object.assign(new Error(`The ${kind} script is already running.`), { statusCode: 409 });
		const port = kind === "run" ? await freePort() : null;
		const state: ScriptState = { kind, status: "running", command, output: "", exitCode: null, startedAt: Date.now(), endedAt: null, port, url: null };
		this.#states.set(key, state);
		const shell = process.platform === "win32" ? this.#environment.COMSPEC || "cmd.exe" : this.#environment.SHELL || "/bin/sh";
		const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
		const child = spawn(shell, args, {
			cwd,
			env: { ...this.#environment, ...extraEnv, ...(port ? { PORT: String(port) } : {}), FORCE_COLOR: "0", CI: kind === "setup" ? "1" : this.#environment.CI ?? "" },
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
			windowsHide: true,
		});
		this.#children.set(key, child);
		const append = (chunk: Buffer) => {
			state.output = (state.output + chunk.toString("utf8")).slice(-MAX_OUTPUT);
			if (kind === "run" && !state.url) {
				const match = URL_PATTERN.exec(state.output);
				if (match) {
					state.url = match[0].replace("0.0.0.0", "localhost").replace(/[).,;]+$/, "");
					this.#emit(sessionId);
				}
			}
		};
		child.stdout?.on("data", append);
		child.stderr?.on("data", append);
		child.on("error", error => {
			state.output += `\n${error.message}\n`;
		});
		child.on("close", code => {
			this.#children.delete(key);
			state.exitCode = code;
			state.endedAt = Date.now();
			if (state.status === "running") state.status = code === 0 ? "succeeded" : "failed";
			this.#emit(sessionId);
		});
		if (kind === "run" && port) {
			// Fall back to the assigned port when the server doesn't print a URL.
			setTimeout(() => {
				if (state.status === "running" && !state.url) {
					state.url = `http://localhost:${port}`;
					this.#emit(sessionId);
				}
			}, 8000).unref();
		}
		this.#emit(sessionId);
		return state;
	}

	stop(sessionId: string, kind: ScriptKind): ScriptState {
		const key = this.#key(sessionId, kind);
		const child = this.#children.get(key);
		const state = this.state(sessionId, kind);
		if (child?.pid) {
			state.status = "stopped";
			try {
				// Kill the whole process group so dev servers' child processes stop too.
				if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
				else child.kill();
			} catch {
				child.kill();
			}
		}
		this.#emit(sessionId);
		return state;
	}

	stopAll(sessionId?: string) {
		for (const key of [...this.#children.keys()]) {
			const [id, kind] = key.split(":") as [string, ScriptKind];
			if (!sessionId || id === sessionId) this.stop(id, kind);
		}
	}
}
