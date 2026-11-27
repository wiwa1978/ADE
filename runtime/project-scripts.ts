// Per-project setup and run scripts (roadmap R1).
//
// - Setup runs once when a session's worktree is created (install dependencies, copy .env files).
// - Run starts the project's dev server inside a session's workspace on a free port, so several
//   sessions can run at the same time; the first URL it prints is opened in the browser panel.
//
// Scripts come from the project's settings in ADE, falling back to `.ade/project.json` committed in
// the repository ({ "setup": "...", "run": "...", "copy": [".env"] }) ONLY after the repository's
// `.ade/project.json` content hash has been explicitly trusted by the user.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	constants,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { RuntimeEventBus } from "./events.ts";
import { redact, secretEnv } from "./project-secrets.ts";
import { commandInvocation, sessionPort, sessionTarget, stopOnTarget } from "./execution-targets.ts";
import { getFreePort } from "./net-utils.ts";

export { getFreePort as freePort } from "./net-utils.ts";

export type ProjectScripts = {
	setup: string;
	run: string;
	copy: string[];
	/** Hook: runs in the workspace after every agent turn that changed files (lint, typecheck, tests). */
	check: string;
	/** Send a failing check's output back to the agent automatically (at most twice in a row). */
	checkAutoFix: boolean;
};
export type ScriptKind = "setup" | "run" | "check";
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
	/** Folder the script runs in. */
	cwd?: string;
};

const MAX_OUTPUT = 200_000;
const URL_PATTERN = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>]*)?/i;

const RawScriptsFileSchema = z.record(z.string(), z.unknown());
const TrustStoreSchema = z.record(z.string(), z.string());

function emptyScripts(): ProjectScripts {
	return { setup: "", run: "", copy: [], check: "", checkAutoFix: false };
}

function sanitize(input: unknown): ProjectScripts {
	const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	const text = (field: unknown) => typeof field === "string" ? field.slice(0, 4000) : "";
	const copy = Array.isArray(value.copy)
		? value.copy
			.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
			.map(item => item.trim())
			.slice(0, 50)
		: [];
	return { setup: text(value.setup), run: text(value.run), copy, check: text(value.check), checkAutoFix: value.checkAutoFix === true };
}

function isInsideRoot(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** Verify no existing path segment between root and target is a symbolic link. */
function hasSymlinkSegment(canonicalRoot: string, relPath: string): { symlink: boolean; exists: boolean } {
	const parts = relPath.split(sep).filter(Boolean);
	let current = canonicalRoot;
	for (let i = 0; i < parts.length; i++) {
		current = join(current, parts[i]);
		try {
			const st = lstatSync(current);
			if (st.isSymbolicLink()) return { symlink: true, exists: true };
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
				return { symlink: false, exists: false };
			}
			return { symlink: true, exists: false };
		}
	}
	return { symlink: false, exists: true };
}

function safeRepoKey(repository: string): string {
	try {
		return realpathSync(repository);
	} catch {
		return resolve(repository);
	}
}

/** Read `.ade/project.json` safely, rejecting symlinks or paths escaping the repository root. */
function readRepoProjectJsonRaw(repository: string): string | null {
	let canonicalRepo: string;
	try {
		canonicalRepo = realpathSync(repository);
	} catch {
		return null;
	}
	const adeDir = join(canonicalRepo, ".ade");
	const configFile = join(adeDir, "project.json");
	try {
		if (lstatSync(adeDir).isSymbolicLink()) return null;
		const st = lstatSync(configFile);
		if (st.isSymbolicLink() || !st.isFile() || st.size > 128_000) return null;
		const realConfig = realpathSync(configFile);
		if (!isInsideRoot(canonicalRepo, realConfig)) return null;
		return readFileSync(realConfig, "utf8");
	} catch {
		return null;
	}
}

function hashContent(raw: string): string {
	return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Copy listed files (e.g. .env) from the project checkout into a new worktree.
 * Rejects path traversal, `.git` segments, and any symbolic link in either source or target.
 */
export function copyIntoWorktree(source: string, target: string, files: string[]): string[] {
	let canonicalSource: string;
	let canonicalTarget: string;
	try {
		canonicalSource = realpathSync(source);
		canonicalTarget = realpathSync(target);
	} catch {
		return [];
	}

	const copied: string[] = [];
	for (const file of files) {
		if (typeof file !== "string" || !file || file.includes("\0")) continue;
		const relativePath = normalize(file).replace(/^[/\\]+/, "");
		if (!relativePath || relativePath === "." || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
			continue;
		}
		const segments = relativePath.split(sep).filter(Boolean);
		if (segments.some(part => part === ".." || part.toLowerCase() === ".git")) continue;

		const from = resolve(canonicalSource, relativePath);
		const to = resolve(canonicalTarget, relativePath);
		if (!isInsideRoot(canonicalSource, from) || !isInsideRoot(canonicalTarget, to)) continue;

		// Reject symlinks anywhere along the source path
		const srcCheck = hasSymlinkSegment(canonicalSource, relativePath);
		if (srcCheck.symlink || !srcCheck.exists) continue;
		let fromStat;
		let realFrom: string;
		try {
			fromStat = lstatSync(from);
			if (fromStat.isSymbolicLink() || !fromStat.isFile()) continue;
			realFrom = realpathSync(from);
		} catch {
			continue;
		}
		if (!isInsideRoot(canonicalSource, realFrom)) continue;

		// Reject symlinks anywhere along the target path (including dangling symlinks at target)
		const dstCheck = hasSymlinkSegment(canonicalTarget, relativePath);
		if (dstCheck.symlink || dstCheck.exists) continue;

		const destDir = dirname(to);
		mkdirSync(destDir, { recursive: true });
		try {
			const realDestDir = realpathSync(destDir);
			if (!isInsideRoot(canonicalTarget, realDestDir)) continue;
			copyFileSync(realFrom, to, constants.COPYFILE_EXCL);
			copied.push(relativePath);
		} catch {
			// Skip if destination already exists or failed race check
		}
	}
	return copied;
}

export class ProjectScriptStore {
	#path: string;
	#trustPath: string;
	#data: Record<string, ProjectScripts>;
	#trustedHashes: Record<string, string>;

	constructor(stateDirectory: string) {
		this.#path = join(stateDirectory, "project-scripts.json");
		this.#trustPath = join(stateDirectory, "project-scripts-trust.json");
		this.#data = this.#loadScripts();
		this.#trustedHashes = this.#loadTrust();
	}

	#loadScripts(): Record<string, ProjectScripts> {
		try {
			if (!existsSync(this.#path)) return {};
			const parsed = RawScriptsFileSchema.safeParse(JSON.parse(readFileSync(this.#path, "utf8")));
			if (!parsed.success) return {};
			return Object.fromEntries(Object.entries(parsed.data).map(([id, value]) => [id, sanitize(value)]));
		} catch {
			return {};
		}
	}

	#loadTrust(): Record<string, string> {
		try {
			if (!existsSync(this.#trustPath)) return {};
			const parsed = TrustStoreSchema.safeParse(JSON.parse(readFileSync(this.#trustPath, "utf8")));
			return parsed.success ? parsed.data : {};
		} catch {
			return {};
		}
	}

	#saveTrust(): void {
		mkdirSync(dirname(this.#trustPath), { recursive: true });
		const tmp = `${this.#trustPath}.${randomUUID()}.tmp`;
		writeFileSync(tmp, JSON.stringify(this.#trustedHashes, null, 2), { mode: 0o600 });
		renameSync(tmp, this.#trustPath);
	}

	/** Scripts saved in ADE for a project (may be empty). */
	saved(projectId: string): ProjectScripts {
		return this.#data[projectId] ?? emptyScripts();
	}

	save(projectId: string, input: unknown): ProjectScripts {
		this.#data[projectId] = sanitize(input);
		mkdirSync(dirname(this.#path), { recursive: true });
		const tmp = `${this.#path}.${randomUUID()}.tmp`;
		writeFileSync(tmp, JSON.stringify(this.#data, null, 2));
		renameSync(tmp, this.#path);
		return this.#data[projectId];
	}

	/** SHA-256 hash of `.ade/project.json` in the repository, or null if absent/invalid. */
	repoScriptHash(repository: string | null): string | null {
		if (!repository) return null;
		const raw = readRepoProjectJsonRaw(repository);
		if (raw === null) return null;
		return hashContent(raw);
	}

	/** Whether the repository's current `.ade/project.json` hash has been explicitly trusted. */
	isRepoScriptTrusted(repository: string | null): boolean {
		if (!repository) return false;
		const hash = this.repoScriptHash(repository);
		if (!hash) return false;
		return this.#trustedHashes[safeRepoKey(repository)] === hash;
	}

	/** Trust the current `.ade/project.json` hash for a repository so its scripts can run. */
	trustRepoScripts(repository: string): { trusted: boolean; hash: string | null } {
		const hash = this.repoScriptHash(repository);
		if (!hash) return { trusted: false, hash: null };
		this.#trustedHashes[safeRepoKey(repository)] = hash;
		this.#saveTrust();
		return { trusted: true, hash };
	}

	/** Revoke trust for a repository's `.ade/project.json`. */
	revokeRepoScriptsTrust(repository: string): void {
		const key = safeRepoKey(repository);
		if (key in this.#trustedHashes) {
			delete this.#trustedHashes[key];
			this.#saveTrust();
		}
	}

	/** Scripts committed in the repository's `.ade/project.json`, if any. */
	fromRepository(repository: string | null): ProjectScripts | null {
		if (!repository) return null;
		const raw = readRepoProjectJsonRaw(repository);
		if (raw === null) return null;
		try {
			return sanitize(JSON.parse(raw));
		} catch {
			return null;
		}
	}

	/**
	 * Effective scripts: each field from ADE's settings, else from the repository file
	 * ONLY if the repository's `.ade/project.json` hash has been trusted.
	 */
	effective(
		projectId: string,
		repository: string | null,
	): ProjectScripts & { source: { setup: string; run: string; copy: string; check: string }; repoTrusted: boolean } {
		const saved = this.saved(projectId);
		const repoTrusted = this.isRepoScriptTrusted(repository);
		const repo = repoTrusted ? (this.fromRepository(repository) ?? emptyScripts()) : emptyScripts();
		return {
			setup: saved.setup || repo.setup,
			run: saved.run || repo.run,
			copy: saved.copy.length ? saved.copy : repo.copy,
			check: saved.check || repo.check,
			checkAutoFix: saved.check ? saved.checkAutoFix : repo.checkAutoFix,
			repoTrusted,
			source: {
				check: saved.check ? "ade" : repo.check ? "repository" : "none",
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
		this.#events?.emit("processes.update", { sessionId, scripts: { setup: this.state(sessionId, "setup").status, run: this.state(sessionId, "run").status, check: this.state(sessionId, "check").status } }, sessionId);
	}

	async start(sessionId: string, kind: ScriptKind, command: string, cwd: string, extraEnv: Record<string, string> = {}, onFinish?: (state: ScriptState) => void): Promise<ScriptState> {
		if (!command.trim()) throw Object.assign(new Error(`No ${kind} script is configured for this project. Add one in the project's settings.`), { statusCode: 400 });
		const key = this.#key(sessionId, kind);
		if (this.#children.has(key)) throw Object.assign(new Error(`The ${kind} script is already running.`), { statusCode: 409 });
		// Sessions that run elsewhere run their scripts there. Docker publishes one port for Run;
		// SSH and Boat.dev forward a free local port to the same port on the remote machine.
		const target = sessionTarget(sessionId);
		const docker = target !== "local";
		const port = kind === "run" ? (target === "docker" ? sessionPort(sessionId) : null) ?? await getFreePort() : null;
		const state: ScriptState = { kind, status: "running", command, output: "", exitCode: null, startedAt: Date.now(), endedAt: null, port, url: null, cwd };
		this.#states.set(key, state);
		const secrets = secretEnv(cwd);
		const env: Record<string, string> = {
			...secrets, ...extraEnv,
			...(port ? { PORT: String(port) } : {}),
			// Dev servers in a container must listen on all interfaces to be reachable from this computer.
			...(docker ? { HOST: "0.0.0.0" } : {}),
			FORCE_COLOR: "0",
			CI: kind === "setup" ? "1" : this.#environment.CI ?? "",
		};
		// The pid file lets Stop end the script and its children over there (killing the local client alone doesn't).
		const pidFile = `/tmp/ade-${kind}-${sessionId.slice(0, 12)}.pid`;
		const inContainer = docker ? commandInvocation(sessionId, cwd, command, Object.keys(env), { pidFile, background: kind === "run", forwardPort: kind === "run" && (target === "ssh" || target === "boat" || target === "cloud") ? port : null }) : null;
		const shell = process.platform === "win32" ? this.#environment.COMSPEC || "cmd.exe" : this.#environment.SHELL || "/bin/sh";
		const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
		const child = spawn(inContainer?.file ?? shell, inContainer?.args ?? args, {
			cwd,
			env: { ...this.#environment, ...env, ...inContainer?.env },
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
			windowsHide: true,
		});
		this.#children.set(key, child);
		const append = (chunk: Buffer) => {
			state.output = redact(state.output + chunk.toString("utf8"), secrets).slice(-MAX_OUTPUT);
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
			onFinish?.(state);
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
			if (sessionTarget(sessionId) !== "local") stopOnTarget(sessionId, `/tmp/ade-${kind}-${sessionId.slice(0, 12)}.pid`, state.cwd ?? "");
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
