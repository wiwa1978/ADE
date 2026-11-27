// Git-backed session state backups: snapshots session transcripts, blueprint stage progress,
// and team board state into a dedicated Git repository (and optionally pushes to a private
// remote) after turns or on demand for disaster recovery and cross-machine portability.
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { badRequest, notFound } from "./http-error.ts";

const execFileAsync = promisify(execFile);

export type SessionBackupConfig = {
	enabled: boolean;
	repoPath: string;
	remoteUrl: string;
	branch: string;
	autoPush: boolean;
	lastBackupAt: number | null;
	lastCommit: string | null;
	lastError: string | null;
};

export type SessionBackupSnapshot = {
	version: 1;
	backedUpAt: number;
	session: {
		id: string;
		label: string;
		projectId: string | null;
		engine?: string;
		workspacePath?: string | null;
		branch?: string | null;
		updatedAt: number | null;
		messages: unknown[];
	};
	blueprint?: unknown;
	team?: unknown;
};

export type SessionBackupSummary = {
	sessionId: string;
	label: string;
	projectId: string | null;
	backedUpAt: number;
	messageCount: number;
};

function safeSessionFile(sessionId: string): string {
	if (!/^[\w-]+$/.test(sessionId)) throw badRequest("Invalid session id.");
	return `${sessionId}.json`;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync(
		"git",
		["-c", "core.hooksPath=/dev/null", ...args],
		{ cwd, encoding: "utf8", timeout: 20_000, windowsHide: true },
	);
	return stdout.trim();
}

export class SessionBackupManager {
	#file: string;
	#defaultRepoPath: string;
	#config: SessionBackupConfig;
	#queue: Promise<void> = Promise.resolve();

	constructor(stateDirectory: string) {
		this.#file = join(stateDirectory, "session-backup.json");
		this.#defaultRepoPath = join(stateDirectory, "session-backups-repo");
		this.#config = this.#load();
	}

	#load(): SessionBackupConfig {
		const defaults: SessionBackupConfig = {
			enabled: false,
			repoPath: this.#defaultRepoPath,
			remoteUrl: "",
			branch: "main",
			autoPush: false,
			lastBackupAt: null,
			lastCommit: null,
			lastError: null,
		};
		try {
			if (existsSync(this.#file)) {
				const parsed = JSON.parse(readFileSync(this.#file, "utf8")) as Partial<SessionBackupConfig>;
				return { ...defaults, ...parsed, repoPath: parsed.repoPath?.trim() || this.#defaultRepoPath };
			}
		} catch {
			// Start with defaults if file is damaged.
		}
		return defaults;
	}

	#save() {
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#config, null, 2), { mode: 0o600 });
		renameSync(temp, this.#file);
		chmodSync(this.#file, 0o600);
	}

	status(): SessionBackupConfig {
		return { ...this.#config };
	}

	update(input: Partial<Pick<SessionBackupConfig, "enabled" | "repoPath" | "remoteUrl" | "branch" | "autoPush">>): SessionBackupConfig {
		if (typeof input.enabled === "boolean") this.#config.enabled = input.enabled;
		if (typeof input.repoPath === "string") {
			const trimmed = input.repoPath.trim();
			this.#config.repoPath = trimmed ? resolve(trimmed) : this.#defaultRepoPath;
		}
		if (typeof input.remoteUrl === "string") {
			const url = input.remoteUrl.trim();
			if (url && !/^(https?:\/\/|ssh:\/\/|git@|\/)/i.test(url)) {
				throw badRequest("Remote URL must be an https://, ssh://, git@, or local repository path.");
			}
			this.#config.remoteUrl = url;
		}
		if (typeof input.branch === "string" && input.branch.trim()) {
			const branch = input.branch.trim();
			if (!/^[a-zA-Z0-9._/-]{1,80}$/.test(branch) || branch.includes("..")) {
				throw badRequest("Invalid git branch name.");
			}
			this.#config.branch = branch;
		}
		if (typeof input.autoPush === "boolean") this.#config.autoPush = input.autoPush;
		this.#save();
		return this.status();
	}

	async #ensureRepo(): Promise<string> {
		const repo = this.#config.repoPath;
		mkdirSync(join(repo, "sessions"), { recursive: true });
		if (!existsSync(join(repo, ".git"))) {
			await runGit(repo, ["init", "-b", this.#config.branch]);
			await runGit(repo, ["config", "user.name", "ADE Session Backup"]);
			await runGit(repo, ["config", "user.email", "ade-backup@local"]);
		}
		if (this.#config.remoteUrl) {
			const existing = await runGit(repo, ["remote"]).catch(() => "");
			if (existing.split(/\r?\n/).includes("origin")) {
				await runGit(repo, ["remote", "set-url", "origin", this.#config.remoteUrl]);
			} else {
				await runGit(repo, ["remote", "add", "origin", this.#config.remoteUrl]);
			}
		}
		return repo;
	}

	/** Serialize git operations so concurrent turns never clash on index.lock. */
	backupSession(snapshot: Omit<SessionBackupSnapshot, "version" | "backedUpAt">): Promise<{ committed: boolean; commit: string | null; pushed: boolean; error: string | null }> {
		const run = async () => {
			try {
				const repo = await this.#ensureRepo();
				const fileName = safeSessionFile(snapshot.session.id);
				const filePath = join(repo, "sessions", fileName);
				const payload: SessionBackupSnapshot = {
					version: 1,
					backedUpAt: Date.now(),
					...snapshot,
				};
				// Compare without volatile backedUpAt so unchanged sessions don't create noisy commits.
				let unchanged = false;
				if (existsSync(filePath)) {
					try {
						const prev = JSON.parse(readFileSync(filePath, "utf8")) as Partial<SessionBackupSnapshot>;
						const prevNorm = JSON.stringify({ session: prev.session, blueprint: prev.blueprint, team: prev.team });
						const nextNorm = JSON.stringify({ session: payload.session, blueprint: payload.blueprint, team: payload.team });
						unchanged = prevNorm === nextNorm;
					} catch {
						unchanged = false;
					}
				}
				if (unchanged) {
					return { committed: false, commit: this.#config.lastCommit, pushed: false, error: null };
				}

				const temp = `${filePath}.tmp`;
				writeFileSync(temp, JSON.stringify(payload, null, 2));
				renameSync(temp, filePath);

				await runGit(repo, ["add", join("sessions", fileName)]);
				const status = await runGit(repo, ["status", "--porcelain"]);
				if (!status) {
					return { committed: false, commit: this.#config.lastCommit, pushed: false, error: null };
				}

				const safeLabel = (snapshot.session.label || snapshot.session.id).replace(/[\r\n]/g, " ").slice(0, 60);
				await runGit(repo, ["commit", "-m", `backup(session): ${safeLabel} (${snapshot.session.id})`]);
				const commit = await runGit(repo, ["rev-parse", "--short", "HEAD"]);

				let pushed = false;
				let pushError: string | null = null;
				if (this.#config.autoPush && this.#config.remoteUrl) {
					try {
						await runGit(repo, ["push", "-u", "origin", this.#config.branch]);
						pushed = true;
					} catch (err) {
						pushError = err instanceof Error ? err.message : String(err);
					}
				}

				this.#config.lastBackupAt = payload.backedUpAt;
				this.#config.lastCommit = commit;
				this.#config.lastError = pushError;
				this.#save();
				return { committed: true, commit, pushed, error: pushError };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.#config.lastError = message;
				this.#save();
				return { committed: false, commit: this.#config.lastCommit, pushed: false, error: message };
			}
		};

		const resultPromise = this.#queue.then(run, run);
		this.#queue = resultPromise.then(() => undefined, () => undefined);
		return resultPromise;
	}

	listBackups(): SessionBackupSummary[] {
		const dir = join(this.#config.repoPath, "sessions");
		if (!existsSync(dir)) return [];
		const summaries: SessionBackupSummary[] = [];
		for (const file of readdirSync(dir)) {
			if (!file.endsWith(".json")) continue;
			try {
				const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as SessionBackupSnapshot;
				if (!parsed?.session?.id) continue;
				summaries.push({
					sessionId: parsed.session.id,
					label: parsed.session.label ?? parsed.session.id,
					projectId: parsed.session.projectId ?? null,
					backedUpAt: parsed.backedUpAt ?? 0,
					messageCount: Array.isArray(parsed.session.messages) ? parsed.session.messages.length : 0,
				});
			} catch {
				// Skip damaged snapshot files.
			}
		}
		return summaries.sort((a, b) => b.backedUpAt - a.backedUpAt);
	}

	readBackup(sessionId: string): SessionBackupSnapshot {
		const filePath = join(this.#config.repoPath, "sessions", safeSessionFile(sessionId));
		if (!existsSync(filePath)) throw notFound("Backed-up session not found.");
		return JSON.parse(readFileSync(filePath, "utf8")) as SessionBackupSnapshot;
	}
}
