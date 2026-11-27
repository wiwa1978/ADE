// Where a session's commands run: this computer, its own Docker container, WSL2 (Windows), an
// SSH host, or a modular Cloud VM provider (Boat.dev, Daytona, E2B, or any registered driver).
//
// Every target answers three questions: how to run a command (the agent's shell commands and its
// subagents', Claude Code and Codex, setup/run/check scripts), how to open a terminal, and how to
// stop a command together with everything it started. Spawn points ask this module and fall back
// to this computer only for sessions that run locally. If a session's target isn't ready, commands
// fail with a clear message instead of quietly running on this computer.
//
// - Docker: one long-running container per session. The worktree, the repository's Git metadata
//   and ADE's worktree folder are mounted at the same absolute paths, so paths match inside and out.
// - WSL2: commands go through wsl.exe in the chosen distribution; Windows paths become /mnt/<drive>.
// - SSH and SSH-transport Cloud VMs (e.g. Boat.dev): the worktree is copied to the remote machine
//   with rsync before each command and copied back after it. Git commands run on this computer.
// - Exec-transport Cloud VMs (e.g. Daytona, E2B): commands execute via the provider's REST API
//   through runtime/cloud-providers/exec-bridge.ts. Idle VMs auto-sleep and wake on next command.
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { defaultCloudProviders, type CloudProviderId, type CloudProviderRegistry, type CloudVmDriver, type VmSize } from "./cloud-providers/index.ts";
import { badRequest, httpError } from "./http-error.ts";
import { getFreePort } from "./net-utils.ts";

const execute = promisify(execFile);
const EXEC_BRIDGE_PATH = fileURLToPath(new URL("./cloud-providers/exec-bridge.ts", import.meta.url));

export type RunTarget = "local" | "docker" | "wsl" | "ssh" | "boat" | "cloud";
export const RUN_TARGETS: RunTarget[] = ["local", "docker", "wsl", "ssh", "boat", "cloud"];
export const DEFAULT_DOCKER_IMAGE = "node:22-bookworm";
export const DEFAULT_REMOTE_ROOT = "ade-workspaces";
export const DEFAULT_IDLE_SLEEP_MINUTES = 15;

export type TargetState = "absent" | "preparing" | "running" | "sleeping" | "stopped" | "failed";
/** @deprecated kept for older imports */
export type DockerState = TargetState;

export type Invocation = { file: string; args: string[]; env?: Record<string, string> };

export type TargetSettings = {
	target: RunTarget;
	/** Docker */
	image: string;
	/** WSL2 distribution; empty = the default distribution. */
	wslDistro: string;
	/** SSH host or alias from ~/.ssh/config (user@host also works). */
	sshHost: string;
	/** Folder on the remote machine for workspaces, relative to its home folder unless absolute. */
	remoteRoot: string;
	/** Cloud VM provider ID (e.g. "boat", "daytona", "e2b"). Empty = first configured provider. */
	cloudProvider: CloudProviderId;
	/** Cloud VM size preset. */
	vmSize: VmSize;
	/** Minutes of inactivity before auto-sleeping a cloud VM (0 = disabled). */
	idleSleepMinutes: number;
};

type SessionTarget = TargetSettings & {
	container: string | null;
	port: number | null;
	/** Docker: absolute paths mounted at the same path. */
	mounts: string[];
	/** Legacy Boat.dev VM id (mirrored with vmId for compatibility). */
	boatId: string | null;
	/** Cloud VM provider sandbox/machine id. */
	vmId: string | null;
	/** Optional checkpoint/snapshot id returned when a provider sleeps via checkpoint. */
	vmCheckpoint: string | null;
	sshEndpoint: { host: string; port: number; user: string } | null;
	state: TargetState;
	message: string;
	lastActivityAt: number;
	updatedAt: number;
};

type Stored = { sessions: Record<string, SessionTarget>; projects: Record<string, TargetSettings> };

export type DockerRunner = (args: string[], options?: { timeout?: number }) => Promise<string>;
export type CommandRunner = (file: string, args: string[], options?: { timeout?: number }) => Promise<string>;
export type BoatApi = {
	create(name: string): Promise<{ id: string }>;
	get(id: string): Promise<{ state: string }>;
	resume(id: string): Promise<void>;
	authorizeKey(id: string, publicKey: string): Promise<{ hostKey: string; host: string; port: number }>;
	remove(id: string): Promise<void>;
};

export type CloudProviderAccess = {
	registry?: CloudProviderRegistry;
	driver: (providerId: CloudProviderId) => CloudVmDriver | null;
	values?: (providerId: CloudProviderId) => Record<string, string> | null;
	configuredIds?: () => CloudProviderId[];
};

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

const defaultRun: CommandRunner = async (file, args, options = {}) => {
	try {
		const { stdout } = await execute(file, args, { timeout: options.timeout ?? 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
		return stdout;
	} catch (error) {
		const err = error as { code?: unknown; stderr?: unknown; message?: unknown };
		if (err?.code === "ENOENT") throw httpError(503, `${file} was not found on this computer.`);
		const detail = String(err?.stderr || err?.message || "").trim().split("\n").filter(Boolean).slice(-2).join(" ");
		throw httpError(502, detail || `${file} failed.`);
	}
};

/** Single-quote a string for a POSIX shell. */
export function q(value: string) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Kill a process and all its descendants by pid file, using /proc (works without procps). */
export function killTreeScript(pidFile: string) {
	return [
		`pid=$(cat ${q(pidFile)} 2>/dev/null) || exit 0`,
		'tree() { for p in /proc/[0-9]*; do pp=$(awk \'{print $4}\' "$p/stat" 2>/dev/null); [ "$pp" = "$1" ] && tree "${p#/proc/}"; done; kill -TERM "$1" 2>/dev/null; }',
		'tree "$pid"; rm -f ' + q(pidFile) + "; true",
	].join("\n");
}

/** `docker exec` arguments for a command in a session's container. Env values are passed by name only. */
export function dockerExecArgs(container: string, cwd: string, command: string, envNames: string[], interactive = false) {
	// Prefer bash, fall back to sh for minimal images.
	const shell = ["sh", "-c", 'if command -v bash >/dev/null 2>&1; then exec bash -lc "$1"; else exec sh -lc "$1"; fi', "ade", command];
	return ["exec", interactive ? "-it" : "-i", "-w", cwd, ...envNames.flatMap(name => ["-e", name]), container, ...shell];
}

export function dockerShellArgs(container: string, cwd: string, envNames: string[]) {
	return ["exec", "-it", "-w", cwd, ...envNames.flatMap(name => ["-e", name]), container, "sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi"];
}

/** C:\Users\me\code → /mnt/c/Users/me/code; \\wsl$\Ubuntu\home\me → /home/me. */
export function toWslPath(path: string) {
	const unc = /^\\\\wsl(?:\$|\.localhost)\\[^\\]+(\\.*)?$/i.exec(path);
	if (unc) return (unc[1] ?? "\\").replace(/\\/g, "/");
	const drive = /^([a-zA-Z]):[\\/]?(.*)$/.exec(path);
	if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`.replace(/\/+$/, "") || "/";
	return path.replace(/\\/g, "/");
}

/** WSLENV makes the named Windows environment variables available inside WSL. */
export function wslEnv(names: string[], existing = "") {
	const list = [...new Set([...existing.split(":").filter(Boolean), ...names.map(name => `${name}/u`)])];
	return list.join(":");
}

function validImage(value: unknown) {
	if (typeof value !== "string" || !value.trim()) return DEFAULT_DOCKER_IMAGE;
	const image = value.trim();
	if (image.length > 200 || !/^[a-z0-9][a-z0-9._\-/:@]*$/i.test(image)) throw badRequest("Enter a Docker image like node:22-bookworm or ghcr.io/org/image:tag.");
	return image;
}

function validHost(value: unknown) {
	if (typeof value !== "string" || !value.trim()) return "";
	const host = value.trim();
	if (host.length > 255 || host.startsWith("-") || !/^([A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$/.test(host)) throw badRequest("Enter an SSH host or alias from ~/.ssh/config, like build-server or me@10.0.0.5.");
	return host;
}

function validRemoteRoot(value: unknown) {
	if (typeof value !== "string" || !value.trim()) return DEFAULT_REMOTE_ROOT;
	const root = value.trim().replace(/\/+$/, "");
	if (
		!root ||
		root.length > 300 ||
		root.split("/").includes("..") ||
		!/^\/?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(root)
	) {
		throw badRequest("Enter a folder like ade-workspaces or /srv/ade.");
	}
	return root;
}

const SAFE_LOCAL_GIT_SUBCOMMANDS = new Set([
	"status", "diff", "log", "show", "branch", "rev-parse", "add", "commit",
	"checkout", "switch", "restore", "reset", "stash", "fetch", "pull", "push",
	"merge", "rebase", "cherry-pick", "tag", "remote", "rev-list", "ls-files",
	"blame", "shortlog", "describe", "clean", "rm", "mv", "grep", "diff-tree",
	"merge-base", "symbolic-ref", "for-each-ref",
]);

const FORBIDDEN_GIT_FLAGS = new Set([
	"-c", "--config-env", "--exec-path", "--git-dir", "--work-tree",
	"--upload-pack", "--receive-pack", "--ext-diff", "--textconv", "-C",
]);

/**
 * Strictly parse a single-line plain `git` command into argv without invoking a shell.
 * Rejects newlines, shell metacharacters, config/exec-path flags, and non-allowlisted subcommands.
 * Returns null if the command must NOT run locally.
 */
function parseSafeLocalGit(command: string): string[] | null {
	if (/[\r\n\0;&|`$<>()\\]/.test(command)) return null;
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
		} else if (ch === "'" || ch === '"') {
			quote = ch;
		} else if (/\s/.test(ch)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (quote) return null;
	if (current) tokens.push(current);
	if (tokens.length < 2 || tokens[0] !== "git") return null;

	const subcommand = tokens[1];
	if (subcommand.startsWith("-") || !SAFE_LOCAL_GIT_SUBCOMMANDS.has(subcommand)) return null;

	for (let i = 1; i < tokens.length; i++) {
		const tok = tokens[i];
		if (FORBIDDEN_GIT_FLAGS.has(tok)) return null;
		if (
			tok.startsWith("-c") && tok.length > 2 ||
			tok.startsWith("--config-env=") ||
			tok.startsWith("--exec-path=") ||
			tok.startsWith("--git-dir=") ||
			tok.startsWith("--work-tree=") ||
			tok.startsWith("--upload-pack=") ||
			tok.startsWith("--receive-pack=") ||
			tok.startsWith("--ext-diff") ||
			tok.startsWith("--textconv")
		) {
			return null;
		}
	}
	return tokens.slice(1);
}

let cachedRsyncProtectArgs: boolean | null = null;
function rsyncProtectArgsFlag(): string {
	if (cachedRsyncProtectArgs === null) {
		try {
			const out = execFileSync("rsync", ["--version"], { encoding: "utf8", timeout: 3000, windowsHide: true });
			const match = /version\s+(\d+)\.(\d+)/i.exec(out);
			cachedRsyncProtectArgs = Boolean(match && Number(match[1]) >= 3 && !/openrsync/i.test(out));
		} catch {
			cachedRsyncProtectArgs = false;
		}
	}
	return cachedRsyncProtectArgs ? "--protect-args " : "";
}

const RunTargetSchema = z.enum(["local", "docker", "wsl", "ssh", "boat", "cloud"]);
const TargetStateSchema = z.enum(["absent", "preparing", "running", "sleeping", "stopped", "failed"]);
const VmSizeSchema = z.enum(["small", "medium", "large"]);
const TargetSettingsSchema = z.object({
	target: RunTargetSchema.default("local"),
	image: z.string().default(DEFAULT_DOCKER_IMAGE),
	wslDistro: z.string().default(""),
	sshHost: z.string().default(""),
	remoteRoot: z.string().default(DEFAULT_REMOTE_ROOT),
	cloudProvider: z.string().default(""),
	vmSize: VmSizeSchema.default("medium"),
	idleSleepMinutes: z.number().finite().min(0).max(24 * 60).default(DEFAULT_IDLE_SLEEP_MINUTES),
});
const SessionTargetSchema = TargetSettingsSchema.extend({
	container: z.string().nullable().default(null),
	port: z.number().int().nullable().default(null),
	mounts: z.array(z.string()).default([]),
	boatId: z.string().nullable().default(null),
	vmId: z.string().nullable().default(null),
	vmCheckpoint: z.string().nullable().default(null),
	sshEndpoint: z.object({
		host: z.string(),
		port: z.number().int(),
		user: z.string(),
	}).nullable().default(null),
	state: TargetStateSchema.default("absent"),
	message: z.string().default(""),
	lastActivityAt: z.number().default(0),
	updatedAt: z.number().default(0),
});
const StoredSchema = z.object({
	sessions: z.record(z.string(), SessionTargetSchema).default({}),
	projects: z.record(z.string(), TargetSettingsSchema).default({}),
});

function validCloudProvider(value: unknown) {
	if (typeof value !== "string" || !value.trim()) return "";
	const id = value.trim();
	if (id.length > 64 || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw badRequest("Choose a valid cloud VM provider.");
	return id;
}

function validVmSize(value: unknown): VmSize {
	if (value === "small" || value === "medium" || value === "large") return value;
	return "medium";
}

function validIdleSleepMinutes(value: unknown): number {
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(num) || num < 0 || num > 24 * 60) throw badRequest("Idle sleep minutes must be between 0 and 1440.");
	return Math.round(num);
}

function validDistro(value: unknown) {
	if (typeof value !== "string" || !value.trim()) return "";
	const distro = value.trim();
	if (distro.length > 100 || !/^[A-Za-z0-9._-]+$/.test(distro)) throw badRequest("Enter a WSL distribution name like Ubuntu.");
	return distro;
}

function inside(child: string, parent: string) {
	return child === parent || child.startsWith(`${parent}${sep}`);
}

/** The real path, also for a folder that doesn't exist (yet): its nearest existing parent is resolved, so Windows short names (RUNNER~1) don't make equal paths look different. */
function real(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		const full = resolve(path);
		const parent = dirname(full);
		return parent === full ? full : join(real(parent), basename(full));
	}
}

const DEFAULT_SETTINGS: TargetSettings = {
	target: "local",
	image: DEFAULT_DOCKER_IMAGE,
	wslDistro: "",
	sshHost: "",
	remoteRoot: DEFAULT_REMOTE_ROOT,
	cloudProvider: "",
	vmSize: "medium",
	idleSleepMinutes: DEFAULT_IDLE_SLEEP_MINUTES,
};

function wrapLegacyBoat(api: BoatApi): CloudVmDriver {
	return {
		id: "boat",
		async verify() {
			// Legacy BoatApi does not expose verify; handled by Integrations.
		},
		async create({ name }) {
			return api.create(name);
		},
		async getState(id) {
			const { state } = await api.get(id);
			if (["ready", "idle", "running"].includes(state)) return "running";
			if (["archived", "stopped", "paused"].includes(state)) return "sleeping";
			if (["error", "cancelled"].includes(state)) return "error";
			return "provisioning";
		},
		async sleep() {
			return {};
		},
		async wake(id) {
			await api.resume(id);
			return { id };
		},
		async authorizeSsh(id, publicKey) {
			const access = await api.authorizeKey(id, publicKey);
			return { ...access, user: "user" };
		},
		async destroy(id) {
			await api.remove(id);
		},
	};
}

function isCloudTarget(target: RunTarget): boolean {
	return target === "cloud" || target === "boat";
}

export class ExecutionTargets {
	#file: string;
	#stateDirectory: string;
	#data: Stored;
	#docker: DockerRunner;
	#run: CommandRunner;
	#worktreesRoot: string | null;
	#boat: (() => BoatApi | null) | null;
	#cloud: CloudProviderAccess | null;
	#registry: CloudProviderRegistry;
	#pending = new Map<string, Promise<SessionTarget>>();
	#platform: NodeJS.Platform;
	#idleTimer: ReturnType<typeof setInterval> | null = null;
	#pollIntervalMs: number;

	constructor(stateDirectory: string, options: {
		docker?: DockerRunner;
		run?: CommandRunner;
		worktreesRoot?: string | null;
		boat?: () => BoatApi | null;
		cloud?: CloudProviderAccess | null;
		platform?: NodeJS.Platform;
		pollIntervalMs?: number;
	} = {}) {
		this.#stateDirectory = stateDirectory;
		this.#file = join(stateDirectory, "execution-targets.json");
		this.#docker = options.docker ?? defaultDocker;
		this.#run = options.run ?? defaultRun;
		this.#worktreesRoot = options.worktreesRoot ?? null;
		this.#boat = options.boat ?? null;
		this.#cloud = options.cloud ?? null;
		this.#registry = options.cloud?.registry ?? defaultCloudProviders;
		this.#platform = options.platform ?? process.platform;
		this.#pollIntervalMs = options.pollIntervalMs ?? 2000;
		this.#data = this.#load();
	}

	#load(): Stored {
		try {
			if (existsSync(this.#file)) {
				const parsed = StoredSchema.safeParse(JSON.parse(readFileSync(this.#file, "utf8")));
				if (parsed.success) return parsed.data;
			}
		} catch {
			// Start over if the file is damaged.
		}
		return { sessions: {}, projects: {} };
	}

	#save() {
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.${randomUUID()}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#data, null, 2), { mode: 0o600 });
		renameSync(temp, this.#file);
	}

	/** Which targets this computer can offer (WSL2 only on Windows; SSH and Cloud VMs on macOS/Linux). */
	available(): RunTarget[] {
		return (["local", "docker", "wsl", "ssh", "cloud"] as RunTarget[])
			.filter(target => target !== "wsl" || this.#platform === "win32")
			.filter(target => !((target === "ssh" || target === "cloud") && this.#platform === "win32"));
	}

	#resolveCloudProviderId(record: Pick<TargetSettings, "target" | "cloudProvider">): CloudProviderId {
		if (record.target === "boat") return "boat";
		if (record.cloudProvider) return record.cloudProvider;
		const configured = this.#cloud?.configuredIds?.() ?? [];
		if (configured.length > 0) return configured[0];
		return "boat";
	}

	#cloudDriverFor(providerId: CloudProviderId): CloudVmDriver | null {
		const fromCloud = this.#cloud?.driver(providerId);
		if (fromCloud) return fromCloud;
		if (providerId === "boat") {
			const legacy = this.#boat?.();
			if (legacy) return wrapLegacyBoat(legacy);
		}
		return null;
	}

	#cloudTransport(providerId: CloudProviderId): "ssh" | "exec" {
		const def = this.#registry.get(providerId);
		if (def) return def.features.transport;
		const driver = this.#cloudDriverFor(providerId);
		if (driver?.exec && !driver.authorizeSsh) return "exec";
		return "ssh";
	}

	#cloudLabel(providerId: CloudProviderId): string {
		return this.#registry.get(providerId)?.label ?? providerId;
	}

	#settings(input: Partial<Record<keyof TargetSettings, unknown>>, base: TargetSettings): TargetSettings {
		const target = RUN_TARGETS.includes(input.target as RunTarget) ? input.target as RunTarget : base.target;
		const allowed = target === "boat" ? this.#platform !== "win32" : this.available().includes(target);
		if (!allowed) throw badRequest(target === "wsl" ? "WSL2 is only available on Windows." : "SSH and Cloud VM targets need ssh and rsync, which aren't available on Windows yet; use WSL2.");
		const next: TargetSettings = {
			target,
			image: input.image === undefined ? base.image : validImage(input.image),
			wslDistro: input.wslDistro === undefined ? base.wslDistro : validDistro(input.wslDistro),
			sshHost: input.sshHost === undefined ? base.sshHost : validHost(input.sshHost),
			remoteRoot: input.remoteRoot === undefined ? base.remoteRoot : validRemoteRoot(input.remoteRoot),
			cloudProvider: target === "boat"
				? "boat"
				: (input.cloudProvider === undefined ? base.cloudProvider : validCloudProvider(input.cloudProvider)),
			vmSize: input.vmSize === undefined ? base.vmSize : validVmSize(input.vmSize),
			idleSleepMinutes: input.idleSleepMinutes === undefined ? base.idleSleepMinutes : validIdleSleepMinutes(input.idleSleepMinutes),
		};
		if (target === "ssh" && !next.sshHost) throw badRequest("Enter the SSH host to run on.");
		return next;
	}

	// --- Project defaults ---

	projectDefault(projectId: string | null | undefined): TargetSettings {
		return { ...DEFAULT_SETTINGS, ...((projectId && this.#data.projects[projectId]) || {}) };
	}

	setProjectDefault(projectId: string, input: Partial<Record<keyof TargetSettings, unknown>>) {
		this.#data.projects[projectId] = this.#settings(input, this.projectDefault(projectId));
		this.#save();
		return this.#data.projects[projectId];
	}

	// --- Sessions ---

	session(sessionId: string): SessionTarget {
		const defaults: SessionTarget = {
			...DEFAULT_SETTINGS,
			container: null,
			port: null,
			mounts: [],
			boatId: null,
			vmId: null,
			vmCheckpoint: null,
			sshEndpoint: null,
			state: "absent",
			message: "",
			lastActivityAt: 0,
			updatedAt: 0,
		};
		// Older records may miss newer fields; fill them in and mirror boatId <-> vmId.
		const merged = { ...defaults, ...(this.#data.sessions[sessionId] as Partial<SessionTarget> | undefined) };
		if (!merged.vmId && merged.boatId) merged.vmId = merged.boatId;
		if (!merged.boatId && merged.vmId && (merged.target === "boat" || merged.cloudProvider === "boat")) merged.boatId = merged.vmId;
		return merged;
	}

	/** True when the session's commands run anywhere but this computer. */
	isManaged(sessionId: string) {
		const target = this.#data.sessions[sessionId]?.target;
		return Boolean(target && target !== "local");
	}

	isDocker(sessionId: string) {
		return this.isManaged(sessionId);
	}

	#update(sessionId: string, patch: Partial<SessionTarget>) {
		this.#data.sessions[sessionId] = { ...this.session(sessionId), ...patch, updatedAt: Date.now() };
		this.#save();
		return this.session(sessionId);
	}

	/** Record activity on a session so idle auto-sleep knows it is in use. */
	touchActivity(sessionId: string) {
		const record = this.#data.sessions[sessionId];
		if (!record) return;
		record.lastActivityAt = Date.now();
	}

	/** Choose where a session runs. Preparing the target happens in the background. */
	setTarget(sessionId: string, input: Partial<Record<keyof TargetSettings, unknown>>, paths: { workspace: string; repository?: string | null }) {
		const current = this.session(sessionId);
		const settings = this.#settings(input, current.updatedAt ? current : { ...current, ...this.projectDefault(null) });
		const changedMachine =
			settings.target !== current.target ||
			settings.image !== current.image ||
			settings.sshHost !== current.sshHost ||
			settings.wslDistro !== current.wslDistro ||
			settings.remoteRoot !== current.remoteRoot ||
			settings.cloudProvider !== current.cloudProvider ||
			settings.vmSize !== current.vmSize;
		const previous = { ...current };
		const next = this.#update(sessionId, { ...settings, ...(changedMachine ? { state: settings.target === "local" ? "absent" : "preparing", message: settings.target === "local" ? "" : "Preparing…" } : {}) });
		if (changedMachine) {
			void this.#release(previous).then(() => {
				if (changedMachine && previous.target === "docker") this.#update(sessionId, { container: null, mounts: [] });
				if (changedMachine && isCloudTarget(previous.target) && (!isCloudTarget(settings.target) || settings.cloudProvider !== previous.cloudProvider || settings.vmSize !== previous.vmSize)) {
					this.#update(sessionId, { boatId: null, vmId: null, vmCheckpoint: null, sshEndpoint: null });
				}
				return settings.target === "local" ? null : this.ensure(sessionId, paths);
			}).catch(() => undefined);
		}
		return next;
	}

	/** Stop what a previous target was using (container or VM) when a session moves elsewhere. */
	async #release(previous: SessionTarget) {
		if (previous.target === "docker" && previous.container) await this.#docker(["rm", "-f", previous.container]).catch(() => undefined);
	}

	/** Make sure a session's target is ready: container running, SSH host reachable, Cloud VM awake. */
	ensure(sessionId: string, paths: { workspace: string; repository?: string | null }): Promise<SessionTarget> {
		const pending = this.#pending.get(sessionId);
		if (pending) return pending;
		const work = this.#ensure(sessionId, paths).finally(() => this.#pending.delete(sessionId));
		this.#pending.set(sessionId, work);
		return work;
	}

	/** Wake a sleeping cloud VM on demand before running a command or agent turn. */
	async wakeIfSleeping(sessionId: string, paths: { workspace: string; repository?: string | null }): Promise<SessionTarget> {
		const record = this.session(sessionId);
		if (isCloudTarget(record.target) && (record.state === "sleeping" || record.state === "stopped")) {
			return this.ensure(sessionId, paths);
		}
		return record;
	}

	/** Put a running cloud VM to sleep to save cost while preserving disk (and RAM if supported). */
	async sleep(sessionId: string): Promise<SessionTarget> {
		const record = this.session(sessionId);
		if (!isCloudTarget(record.target)) throw badRequest("Only Cloud VM targets can be put to sleep.");
		const vmId = record.vmId ?? record.boatId;
		if (!vmId) throw badRequest("No cloud VM has been created for this session yet.");
		const providerId = this.#resolveCloudProviderId(record);
		const driver = this.#cloudDriverFor(providerId);
		if (!driver) throw httpError(409, `Configure ${this.#cloudLabel(providerId)} in Settings → Integrations first.`);
		this.#update(sessionId, { state: "preparing", message: `Putting ${this.#cloudLabel(providerId)} VM to sleep…` });
		try {
			const res = await driver.sleep(vmId);
			return this.#update(sessionId, {
				state: "sleeping",
				message: "",
				vmCheckpoint: res.checkpoint ?? record.vmCheckpoint,
			});
		} catch (error) {
			return this.#update(sessionId, { state: "failed", message: error instanceof Error ? error.message : String(error) });
		}
	}

	/** Sweep running cloud VMs that have been idle longer than their configured idleSleepMinutes. */
	async sleepIdleVms(now = Date.now(), isBusy?: (sessionId: string) => boolean): Promise<string[]> {
		const slept: string[] = [];
		for (const sessionId of Object.keys(this.#data.sessions)) {
			const record = this.session(sessionId);
			if (!isCloudTarget(record.target) || record.state !== "running") continue;
			if (!record.vmId && !record.boatId) continue;
			if (record.idleSleepMinutes <= 0) continue;
			if (isBusy?.(sessionId)) {
				this.touchActivity(sessionId);
				const providerId = this.#resolveCloudProviderId(record);
				const driver = this.#cloudDriverFor(providerId);
				const vmId = record.vmId ?? record.boatId;
				if (driver?.keepAlive && vmId) void driver.keepAlive(vmId).catch(() => undefined);
				continue;
			}
			const lastActive = record.lastActivityAt || record.updatedAt;
			if (now - lastActive < record.idleSleepMinutes * 60_000) continue;
			const updated = await this.sleep(sessionId).catch(() => null);
			if (updated?.state === "sleeping") slept.push(sessionId);
		}
		return slept;
	}

	startIdleSweep(intervalMs = 60_000, isBusy?: (sessionId: string) => boolean) {
		this.stopIdleSweep();
		this.#idleTimer = setInterval(() => {
			void this.sleepIdleVms(Date.now(), isBusy);
		}, intervalMs);
		this.#idleTimer.unref?.();
	}

	stopIdleSweep() {
		if (this.#idleTimer) clearInterval(this.#idleTimer);
		this.#idleTimer = null;
	}

	async #ensure(sessionId: string, paths: { workspace: string; repository?: string | null }): Promise<SessionTarget> {
		const record = this.session(sessionId);
		try {
			if (record.target === "docker") return await this.#ensureDocker(sessionId, record, paths);
			if (record.target === "wsl") {
				const list = (await this.#run("wsl.exe", ["-l", "-q"], { timeout: 15_000 })).replace(/\0/g, "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
				if (record.wslDistro && !list.includes(record.wslDistro)) throw new Error(`WSL distribution ${record.wslDistro} isn't installed. Installed: ${list.join(", ") || "none"}.`);
				return this.#update(sessionId, { state: "running", message: "" });
			}
			if (record.target === "ssh") {
				await this.#run("ssh", [...this.#sshOptions(record), this.#sshDestination(record), "command -v rsync >/dev/null || { echo 'rsync is not installed on the remote machine' >&2; exit 3; }; mkdir -p " + this.#remoteExpr(record.remoteRoot)], { timeout: 30_000 });
				return this.#update(sessionId, { state: "running", message: "", lastActivityAt: Date.now() });
			}
			if (isCloudTarget(record.target)) {
				const ready = await this.#ensureCloud(sessionId, record);
				const providerId = this.#resolveCloudProviderId(ready);
				if (this.#cloudTransport(providerId) === "ssh") {
					await this.#run("ssh", [...this.#sshOptions(ready), this.#sshDestination(ready), "command -v rsync >/dev/null || { echo 'rsync is not installed on the remote machine' >&2; exit 3; }; mkdir -p " + this.#remoteExpr(ready.remoteRoot)], { timeout: 30_000 });
				}
				return this.#update(sessionId, { state: "running", message: "", lastActivityAt: Date.now() });
			}
			return record;
		} catch (error) {
			return this.#update(sessionId, { state: "failed", message: error instanceof Error ? error.message : String(error) });
		}
	}

	async #ensureDocker(sessionId: string, record: SessionTarget, paths: { workspace: string; repository?: string | null }) {
		if (record.container) {
			const state = (await this.#docker(["inspect", "-f", "{{.State.Running}}", record.container]).catch(() => "missing")).trim();
			if (state === "true") return this.#update(sessionId, { state: "running", message: "" });
			if (state === "false") {
				await this.#docker(["start", record.container]);
				return this.#update(sessionId, { state: "running", message: "" });
			}
		}
		this.#update(sessionId, { state: "preparing", message: `Pulling ${record.image} if needed and starting the container…` });
		const workspace = realpathSync.native(paths.workspace);
		const mounts = new Set<string>([workspace]);
		// The worktree's Git metadata lives in the main repository; mount it so git works inside.
		try {
			const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: workspace, encoding: "utf8", timeout: 5000 }).trim();
			if (common) mounts.add(realpathSync.native(common));
		} catch {
			// Not a Git checkout.
		}
		// Subagents create their own worktrees next to the session's; mount that folder too.
		if (this.#worktreesRoot && existsSync(this.#worktreesRoot)) mounts.add(realpathSync.native(this.#worktreesRoot));
		// Claude Code and Codex keep their sign-in and conversations here; mount them read-only so they work inside.
		const home = homedir();
		const safeExistingReal = (path: string): string | null => {
			try {
				return existsSync(path) ? realpathSync.native(path) : null;
			} catch {
				return null;
			}
		};
		const agentHomes = [join(home, ".codex"), join(home, ".claude")]
			.map(safeExistingReal)
			.filter((path): path is string => Boolean(path));
		const agentFiles = [join(home, ".claude.json")]
			.map(safeExistingReal)
			.filter((path): path is string => Boolean(path));
		const list = [...mounts].sort((a, b) => a.length - b.length).filter((path, index, all) => !all.slice(0, index).some(parent => inside(path, parent)));
		const port = record.port ?? await getFreePort();
		const name = `ade-${sessionId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
		await this.#docker(["rm", "-f", name]).catch(() => undefined);
		const user = this.#platform === "linux" && typeof process.getuid === "function" ? ["--user", `${process.getuid()}:${process.getgid?.() ?? process.getuid()}`] : [];
		await this.#docker([
			"run", "-d", "--init", "--name", name,
			"--cap-drop=ALL",
			"--security-opt=no-new-privileges:true",
			"--pids-limit=256",
			"--label", "ade.session=" + sessionId,
			...list.flatMap(path => ["-v", `${path}:${path}`]),
			...agentHomes.flatMap(path => ["-v", `${path}:${path}:ro`]),
			...agentFiles.flatMap(path => ["-v", `${path}:${path}:ro`]),
			"-w", workspace,
			"-p", `127.0.0.1:${port}:${port}`,
			"-e", `PORT=${port}`,
			// Same home folder as on this computer, so the mounted agent sign-ins are found.
			"-e", `HOME=${home}`,
			// The container is the sandbox: let Claude Code skip permission prompts when asked to, even as root.
			"-e", "IS_SANDBOX=1",
			...user,
			record.image, "sleep", "infinity",
		], { timeout: 15 * 60_000 });
		return this.#update(sessionId, { container: name, port, mounts: list, state: "running", message: "" });
	}

	#knownHostsFileFor(providerId: CloudProviderId) {
		return join(this.#stateDirectory, providerId === "boat" ? "boat_known_hosts" : "cloud_known_hosts");
	}

	#updateCloudKnownHosts(providerId: CloudProviderId, vmId: string, hostKey: string | null) {
		const knownHostsFile = this.#knownHostsFileFor(providerId);
		mkdirSync(this.#stateDirectory, { recursive: true });
		let lines: string[] = [];
		try {
			if (existsSync(knownHostsFile)) {
				lines = readFileSync(knownHostsFile, "utf8").split(/\r?\n/).filter(Boolean);
			}
		} catch {
			lines = [];
		}
		const prefix = `${vmId} `;
		const next = lines.filter(line => !line.startsWith(prefix));
		if (hostKey !== null) {
			const cleanId = vmId.replace(/[\r\n]/g, "");
			const cleanKey = hostKey.replace(/[\r\n]/g, "");
			next.push(`${cleanId} ${cleanKey}`);
		}
		const temp = `${knownHostsFile}.${randomUUID()}.tmp`;
		writeFileSync(temp, next.length ? `${next.join("\n")}\n` : "", { mode: 0o600 });
		renameSync(temp, knownHostsFile);
	}

	async #ensureCloud(sessionId: string, record: SessionTarget): Promise<SessionTarget> {
		const providerId = this.#resolveCloudProviderId(record);
		const label = this.#cloudLabel(providerId);
		const driver = this.#cloudDriverFor(providerId);
		if (!driver) {
			throw new Error(providerId === "boat"
				? "Add a Boat.dev API key in Settings → Integrations first."
				: `Add a ${label} API key in Settings → Integrations first.`);
		}
		let vmId = record.vmId ?? record.boatId;
		let checkpoint = record.vmCheckpoint;
		if (!vmId) {
			this.#update(sessionId, { cloudProvider: providerId, state: "preparing", message: `Creating a ${label} VM (${record.vmSize})…` });
			vmId = (await driver.create({ name: `ade-${sessionId.slice(0, 8)}`, size: record.vmSize, labels: { session: sessionId } })).id;
			this.#update(sessionId, { cloudProvider: providerId, vmId, ...(providerId === "boat" ? { boatId: vmId } : {}) });
		}
		// Wait until the VM is running; wake it automatically if it was sleeping or stopped.
		let wokeOnce = false;
		for (let attempt = 0; attempt < 120; attempt++) {
			const state = await driver.getState(vmId);
			if (state === "running") break;
			if ((state === "sleeping" || state === "stopped") && !wokeOnce) {
				wokeOnce = true;
				this.#update(sessionId, { state: "preparing", message: `Waking the ${label} VM…` });
				const woken = await driver.wake(vmId, checkpoint);
				vmId = woken.id;
				checkpoint = null;
				this.#update(sessionId, { vmId, vmCheckpoint: null, ...(providerId === "boat" ? { boatId: vmId } : {}) });
			} else if (state === "error") {
				throw new Error(`The ${label} VM is in an error state.`);
			}
			await new Promise(resolveWait => setTimeout(resolveWait, this.#pollIntervalMs));
		}
		if (driver.authorizeSsh) {
			// Authorize ADE's key and pin the VM's host key (it can change after every resume).
			const key = this.#cloudSshKey();
			const access = await driver.authorizeSsh(vmId, readFileSync(`${key}.pub`, "utf8").trim());
			if (access.hostKey) this.#updateCloudKnownHosts(providerId, vmId, access.hostKey);
			return this.#update(sessionId, {
				cloudProvider: providerId,
				vmId,
				vmCheckpoint: null,
				...(providerId === "boat" ? { boatId: vmId } : {}),
				sshEndpoint: { host: access.host, port: access.port, user: access.user || "user" },
			});
		}
		return this.#update(sessionId, {
			cloudProvider: providerId,
			vmId,
			vmCheckpoint: null,
			...(providerId === "boat" ? { boatId: vmId } : {}),
			sshEndpoint: null,
		});
	}

	#cloudSshKey() {
		const key = join(this.#stateDirectory, "boat_ed25519");
		if (!existsSync(key)) {
			mkdirSync(this.#stateDirectory, { recursive: true });
			execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", "ade", "-f", key], { stdio: "ignore" });
			chmodSync(key, 0o600);
		}
		return key;
	}

	async status(sessionId: string) {
		const record = this.session(sessionId);
		if (record.target !== "docker" || !record.container || record.state === "preparing") return record;
		const running = (await this.#docker(["inspect", "-f", "{{.State.Running}}", record.container]).catch(() => "missing")).trim();
		const state: TargetState = running === "true" ? "running" : running === "false" ? "stopped" : "absent";
		if (state !== record.state && record.state !== "failed") this.#update(sessionId, { state });
		return this.session(sessionId);
	}

	/** Remove what a session used (container, cloud VM) when it's archived. Its files stay in the worktree. */
	async remove(sessionId: string) {
		const record = this.#data.sessions[sessionId];
		if (!record) return;
		if (record.container) await this.#docker(["rm", "-f", record.container]).catch(() => undefined);
		const vmId = record.vmId ?? record.boatId;
		if (vmId) {
			const providerId = this.#resolveCloudProviderId(record);
			await this.#cloudDriverFor(providerId)?.destroy(vmId).catch(() => undefined);
			this.#updateCloudKnownHosts(providerId, vmId, null);
		}
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

	// --- SSH helpers (SSH hosts and SSH-transport cloud VMs) ---

	#sshOptions(record: SessionTarget, interactive = false) {
		const options = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30"];
		if (interactive) options.push("-t");
		const vmId = record.vmId ?? record.boatId;
		if (isCloudTarget(record.target) && vmId && record.sshEndpoint) {
			const providerId = this.#resolveCloudProviderId(record);
			options.push(
				"-i", join(this.#stateDirectory, "boat_ed25519"),
				"-o", "IdentitiesOnly=yes",
				"-o", `UserKnownHostsFile=${this.#knownHostsFileFor(providerId)}`,
				"-o", `HostKeyAlias=${vmId}`,
				"-o", "StrictHostKeyChecking=yes",
				"-p", String(record.sshEndpoint.port),
			);
		}
		return options;
	}

	#sshDestination(record: SessionTarget) {
		if (isCloudTarget(record.target)) {
			const label = this.#cloudLabel(this.#resolveCloudProviderId(record));
			if (!record.sshEndpoint) throw new Error(`The ${label} VM isn't ready yet.`);
			return `${record.sshEndpoint.user}@${record.sshEndpoint.host}`;
		}
		return record.sshHost;
	}

	#cloudExecInvocation(record: SessionTarget, command: string, envNames: string[], options: { pidFile?: string } = {}): Invocation {
		const providerId = this.#resolveCloudProviderId(record);
		const label = this.#cloudLabel(providerId);
		const vmId = record.vmId ?? record.boatId;
		const values = this.#cloud?.values?.(providerId);
		if (!vmId || !values) return failing(`ADE: ${label} VM isn't ready or credentials aren't configured.`);
		const pid = options.pidFile ? `echo $$ > ${q(options.pidFile)}; ` : "";
		const payload = JSON.stringify({
			providerId,
			values,
			vmId,
			command: `${pid}${command}`,
			envNames,
		});
		return {
			file: process.execPath,
			args: [EXEC_BRIDGE_PATH],
			env: { ADE_CLOUD_EXEC_PAYLOAD: payload },
		};
	}

	/** A remote path in shell form: relative paths are under the remote user's home folder. */
	#remoteExpr(path: string) {
		return path.startsWith("/") ? q(path) : `"$HOME"/${q(path)}`;
	}

	/** The local folder that gets synced for a working directory, and its remote counterpart. */
	#remoteFor(record: SessionTarget, cwd: string, workspaces: string[]) {
		const target = real(cwd);
		let base = workspaces.map(real).find(path => inside(target, path)) ?? null;
		if (!base && this.#worktreesRoot) {
			const root = real(this.#worktreesRoot);
			if (inside(target, root) && target !== root) base = join(root, relative(root, target).split(sep)[0]);
		}
		if (!base) return null;
		const remoteBase = `${record.remoteRoot}/${basename(base)}`;
		const rel = relative(base, target).split(sep).join("/");
		return { base, remoteBase, remoteCwd: rel ? `${remoteBase}/${rel}` : remoteBase };
	}

	/** rsync exclude patterns: .git plus the project's root .gitignore (negations can't be expressed, so they're dropped). */
	#excludeFile(base: string) {
		const lines = [".git", ".ade-run.pid"];
		try {
			lines.push(...readFileSync(join(base, ".gitignore"), "utf8").split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#") && !line.startsWith("!")));
		} catch {
			// No .gitignore.
		}
		const file = join(this.#stateDirectory, "sync-excludes", `${basename(base)}.txt`);
		mkdirSync(dirname(file), { recursive: true });
		const temp = `${file}.${randomUUID()}.tmp`;
		writeFileSync(temp, `${lines.join("\n")}\n`);
		renameSync(temp, file);
		return file;
	}

	#sshInvocation(record: SessionTarget, cwd: string, command: string, envNames: string[], workspaces: string[], options: { pidFile?: string; background?: boolean; forwardPort?: number | null; interactive?: boolean }): Invocation {
		const remote = this.#remoteFor(record, cwd, workspaces);
		if (!remote) return failing(`ADE: ${cwd} isn't part of this session's workspace, so it can't run on the remote machine.`);
		const ssh = ["ssh", ...this.#sshOptions(record)].map(q).join(" ");
		const destination = q(this.#sshDestination(record));
		const excludes = q(this.#excludeFile(remote.base));
		const protectArgs = rsyncProtectArgsFlag();
		const rsyncUp = `RSYNC_PROTECT_ARGS=1 rsync -az ${protectArgs}--delete --exclude-from=${excludes} -e ${q(["ssh", ...this.#sshOptions(record)].join(" "))} ${q(`${remote.base}/`)} ${destination}:${q(`${remote.remoteBase}/`)}`;
		// Foreground commands also bring deletions back; background ones only bring new and changed
		// files, so they never undo edits made on this computer while they ran.
		const rsyncDown = `RSYNC_PROTECT_ARGS=1 rsync -azu ${protectArgs}${options.background ? "" : "--delete "}--exclude-from=${excludes} -e ${q(["ssh", ...this.#sshOptions(record)].join(" "))} ${destination}:${q(`${remote.remoteBase}/`)} ${q(`${remote.base}/`)}`;
		const remoteDir = this.#remoteExpr(remote.remoteCwd);
		const pid = options.pidFile ? `echo $$ > ${q(options.pidFile)}; ` : "";
		if (options.interactive) {
			const shell = `cd ${remoteDir} 2>/dev/null || cd; exec "\${SHELL:-bash}" -l`;
			return { file: "/bin/sh", args: ["-c", `${rsyncUp} || echo 'ADE: could not copy the workspace to the remote machine.'\nssh ${["-t", ...this.#sshOptions(record)].map(q).join(" ")} ${destination} ${q(shell)}\n${rsyncDown}`] };
		}
		// Secrets travel as NUL-separated NAME=value pairs on stdin, never on a command line.
		const remoteScript = `mkdir -p ${remoteDir} && cd ${remoteDir} || exit 125; while IFS= read -r -d '' kv; do export "$kv"; done; ${pid}exec bash -lc ${q(command)}`;
		const envPairs = envNames.length ? `printf '%s\\0' ${envNames.map(name => `"${name}=\${${name}:-}"`).join(" ")}` : "true";
		const forward = options.forwardPort ? `-L ${options.forwardPort}:127.0.0.1:${options.forwardPort} ` : "";
		const script = [
			`${rsyncUp} || { echo 'ADE: could not copy the workspace to the remote machine.' >&2; exit 125; }`,
			`${envPairs} | ${ssh} ${forward}${destination} ${q(`bash -c ${q(remoteScript)}`)}`,
			"code=$?",
			rsyncDown,
			"exit $code",
		].join("\n");
		return { file: "/bin/sh", args: ["-c", script] };
	}

	// --- Running things ---

	/**
	 * How to run a command for this session: null = on this computer; otherwise the invocation,
	 * or a command that explains why the target isn't available.
	 */
	commandFor(sessionId: string | null | undefined, cwd: string, command: string, envNames: string[], options: { pidFile?: string; background?: boolean; forwardPort?: number | null; workspaces?: string[] } = {}): Invocation | null {
		const record = sessionId ? this.#data.sessions[sessionId] : undefined;
		if (!record || record.target === "local") return null;
		const full = this.session(sessionId!);
		if (full.state === "failed" || full.state === "preparing" || full.state === "absent" || full.state === "sleeping") return failing(this.#unavailable(full));
		this.touchActivity(sessionId!);
		const pid = options.pidFile ? `echo $$ > ${q(options.pidFile)}; ` : "";
		if (full.target === "docker") {
			if (!full.container || !this.#covers(full, cwd)) return failing(this.#unavailable(full, cwd));
			return { file: "docker", args: dockerExecArgs(full.container, cwd, `${pid}${command}`, envNames) };
		}
		if (full.target === "wsl") {
			const args = [...(full.wslDistro ? ["-d", full.wslDistro] : []), "--cd", toWslPath(cwd), "--", "bash", "-lc", `${pid}${command}`];
			return { file: "wsl.exe", args, env: { WSLENV: wslEnv(envNames, process.env.WSLENV) } };
		}
		// SSH and Cloud VMs: strictly validated plain git commands run directly via execFile (no shell);
		// everything else runs remotely.
		const localGitArgs = parseSafeLocalGit(command);
		if (localGitArgs) return { file: "git", args: localGitArgs };
		if (isCloudTarget(full.target) && this.#cloudTransport(this.#resolveCloudProviderId(full)) === "exec") {
			return this.#cloudExecInvocation(full, command, envNames, options);
		}
		return this.#sshInvocation(full, cwd, command, envNames, options.workspaces ?? [], options);
	}

	shellFor(sessionId: string | null | undefined, cwd: string, envNames: string[], workspaces: string[] = []): Invocation | null {
		const record = sessionId ? this.#data.sessions[sessionId] : undefined;
		if (!record || record.target === "local") return null;
		const full = this.session(sessionId!);
		const explain = (text: string) => ({ file: "/bin/sh", args: ["-c", `echo ${q(text)}; exec sleep 3600`] });
		if (full.state === "failed" || full.state === "preparing" || full.state === "absent" || full.state === "sleeping") return explain(this.#unavailable(full));
		this.touchActivity(sessionId!);
		if (full.target === "docker") {
			if (!full.container || !this.#covers(full, cwd)) return explain(this.#unavailable(full, cwd));
			return { file: "docker", args: dockerShellArgs(full.container, cwd, envNames) };
		}
		if (full.target === "wsl") {
			return { file: "wsl.exe", args: [...(full.wslDistro ? ["-d", full.wslDistro] : []), "--cd", toWslPath(cwd)], env: { WSLENV: wslEnv(envNames, process.env.WSLENV) } };
		}
		if (isCloudTarget(full.target) && this.#cloudTransport(this.#resolveCloudProviderId(full)) === "exec") {
			const label = this.#cloudLabel(this.#resolveCloudProviderId(full));
			return explain(`ADE: ${label} VMs execute commands over API rather than an interactive SSH shell.`);
		}
		return this.#sshInvocation(full, cwd, "", envNames, workspaces, { interactive: true });
	}

	/** Stop a command started with a pid file, with everything it started, on the session's target. */
	stopProcess(sessionId: string, pidFile: string, cwd: string, workspaces: string[] = []) {
		const record = this.session(sessionId);
		const script = killTreeScript(pidFile);
		if (record.target === "docker" && record.container) {
			execFile("docker", ["exec", record.container, "sh", "-c", script], { timeout: 10_000 }, () => undefined);
		} else if (record.target === "wsl") {
			execFile("wsl.exe", [...(record.wslDistro ? ["-d", record.wslDistro] : []), "--", "sh", "-c", script], { timeout: 10_000 }, () => undefined);
		} else if (isCloudTarget(record.target) && this.#cloudTransport(this.#resolveCloudProviderId(record)) === "exec") {
			const providerId = this.#resolveCloudProviderId(record);
			const vmId = record.vmId ?? record.boatId;
			const driver = this.#cloudDriverFor(providerId);
			if (vmId && driver?.exec) void driver.exec(vmId, script, { timeoutMs: 10_000 }).catch(() => undefined);
		} else if ((record.target === "ssh" || isCloudTarget(record.target)) && this.#remoteFor(record, cwd, workspaces)) {
			try {
				execFile("ssh", [...this.#sshOptions(record), this.#sshDestination(record), `sh -c ${q(script)}`], { timeout: 15_000 }, () => undefined);
			} catch {
				// The remote machine is gone; nothing to stop.
			}
		}
	}

	/** The session whose workspace contains this folder (for terminals, which only know a folder). */
	sessionForPath(cwd: string, workspaces: Array<{ id: string; path: string | null | undefined }>) {
		const target = real(cwd);
		for (const item of workspaces) {
			if (!item.path || !this.isManaged(item.id)) continue;
			if (inside(target, real(item.path))) return item.id;
		}
		return null;
	}

	#covers(record: SessionTarget, cwd: string) {
		const target = real(cwd);
		return record.mounts.some(mount => inside(target, mount));
	}

	#unavailable(record: SessionTarget, cwd?: string) {
		const where = record.target === "docker"
			? "Docker"
			: record.target === "wsl"
				? "WSL2"
				: isCloudTarget(record.target)
					? `a ${this.#cloudLabel(this.#resolveCloudProviderId(record))} VM`
					: `SSH host ${record.sshHost}`;
		if (record.state === "preparing") return `ADE: this session runs on ${where}, which is still starting. Try again in a moment.`;
		if (record.state === "sleeping") return `ADE: this session runs on ${where}, which is asleep. Open Run to wake it or send a message.`;
		if (record.state === "failed") return `ADE: this session runs on ${where}, but it isn't available: ${record.message}`;
		if (cwd && record.target === "docker" && record.container && !this.#covers(record, cwd)) return `ADE: ${cwd} is not mounted in this session's Docker container.`;
		return `ADE: this session runs on ${where}, but it isn't running. Open Run to start it.`;
	}
}

function failing(message: string): Invocation {
	return { file: "/bin/sh", args: ["-c", `echo ${q(message)} >&2; exit 125`] };
}

// Spawn points ask the runtime where a session's commands run; the runtime installs the lookup.
let current: ExecutionTargets | null = null;
let terminalSession: (cwd: string) => string | null = () => null;
let sessionWorkspaces: (sessionId: string) => string[] = () => [];

export function setExecutionTargets(targets: ExecutionTargets | null, sessionForCwd?: (cwd: string) => string | null, workspacesOf?: (sessionId: string) => string[]) {
	current = targets;
	terminalSession = sessionForCwd ?? (() => null);
	sessionWorkspaces = workspacesOf ?? (() => []);
}

export async function wakeTargetIfSleeping(sessionId: string | null | undefined, workspace: string) {
	if (!sessionId || !current) return;
	await current.wakeIfSleeping(sessionId, { workspace });
}

export function commandInvocation(sessionId: string | null | undefined, cwd: string, command: string, envNames: string[], options: { pidFile?: string; background?: boolean; forwardPort?: number | null } = {}) {
	if (!sessionId) return null;
	return current?.commandFor(sessionId, cwd, command, envNames, { ...options, workspaces: sessionWorkspaces(sessionId) }) ?? null;
}

export function terminalInvocation(cwd: string, envNames: string[]) {
	const sessionId = terminalSession(cwd);
	return sessionId ? current?.shellFor(sessionId, cwd, envNames, sessionWorkspaces(sessionId)) ?? null : null;
}

/** The port the session's Run script should use: Docker's published port (SSH forwards a local one). */
export function sessionPort(sessionId: string) {
	const record = current?.session(sessionId);
	return record?.target === "docker" ? record.port : null;
}

export function sessionTarget(sessionId: string | null | undefined): RunTarget {
	return (sessionId && current?.session(sessionId).target) || "local";
}

/** Stop a process started with a pid file on the session's target, and everything it started. */
export function stopOnTarget(sessionId: string, pidFile: string, cwd: string) {
	current?.stopProcess(sessionId, pidFile, cwd, sessionWorkspaces(sessionId));
}

/** @deprecated use stopOnTarget */
export function stopInContainer(sessionId: string, pidFile: string) {
	const record = current?.session(sessionId);
	if (record) stopOnTarget(sessionId, pidFile, record.mounts[0] ?? "");
}

export function runsInDocker(sessionId: string | null | undefined) {
	return Boolean(sessionId && current?.isManaged(sessionId));
}

export function runsElsewhere(sessionId: string | null | undefined) {
	return runsInDocker(sessionId);
}
