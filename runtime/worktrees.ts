import { execFile, type ExecFileOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { badRequest, conflict, httpError } from "./http-error.ts";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorktreeOperationRow = {
	id: string;
	repository: string;
	branch: string;
	base: string;
	commitHash: string;
	target: string;
	status: string;
	message: string;
	createdAt: number;
	filters: string;
};

function gitEnvironment(): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
	for (const key of Object.keys(environment)) {
		if (key.toUpperCase().startsWith("GIT_") && key !== "GIT_TERMINAL_PROMPT" && key !== "GIT_OPTIONAL_LOCKS") delete environment[key];
	}
	return environment;
}

async function git(repository: string, args: string[], options: ExecFileOptions = {}) {
	return execFileAsync("git", ["-C", repository, ...args], {
		env: gitEnvironment(), timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true, ...options,
	});
}

function inputError(message: string, statusCode = 400) {
	return httpError(statusCode, message);
}

function samePath(left: string, right: string): boolean {
	try {
		const leftStat = statSync(left);
		const rightStat = statSync(right);
		if (leftStat.dev !== 0 && leftStat.ino !== 0 && rightStat.dev !== 0 && rightStat.ino !== 0) {
			return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
		}
	} catch {
		// Fall back to normalized paths if the target is temporarily unavailable.
	}
	const normalizePath = (value: string) => {
		const normalized = normalize(resolve(value)).replaceAll("/", "\\");
		return process.platform === "win32" ? normalized.toLowerCase() : normalized;
	};
	return normalizePath(left) === normalizePath(right);
}

export async function inspectWorktrees(repository: unknown) {
	if (typeof repository !== "string" || !isAbsolute(repository) || repository.includes("\0")) {
		throw badRequest("Enter an absolute path to a local Git checkout.");
	}
	let output: string;
	try {
		const res = await git(repository, ["-c", "core.fsmonitor=false", "worktree", "list", "--porcelain", "-z"], { timeout: 10000 });
		output = String(res.stdout);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw badRequest("Git is not installed or the checkout path does not exist.");
		throw badRequest("Could not inspect this Git checkout. Verify the path, Git trust settings, and repository access.");
	}
	const entries = [];
	for (const record of output.split("\0\0")) {
		if (!record) continue;
		const fields = record.split("\0");
		const path = fields.find(field => field.startsWith("worktree "))?.slice(9);
		if (!path) throw new Error("Git returned an invalid worktree list.");
		const ref = fields.find(field => field.startsWith("branch "))?.slice(7);
		entries.push({
			path,
			head: fields.find(field => field.startsWith("HEAD "))?.slice(5) ?? null,
			branch: ref?.startsWith("refs/heads/") ? ref.slice(11) : ref ?? null,
			detached: fields.includes("detached"),
			bare: fields.includes("bare"),
			locked: fields.some(field => field === "locked" || field.startsWith("locked ")),
			prunable: fields.some(field => field === "prunable" || field.startsWith("prunable ")),
		});
	}
	return entries;
}

export async function resolveCheckout(repository: string): Promise<string> {
	const entries = await inspectWorktrees(repository);
	const entry = entries.find(item => samePath(item.path, repository));
	if (!entry || entry.bare || entry.prunable) {
		throw inputError("Choose the root directory of an available Git checkout or worktree.");
	}
	return realpathSync(entry.path);
}

export async function resolveBaseCommit(repository: string, base: string): Promise<string> {
	let commit: string;
	try {
		const res = await git(repository, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
		commit = String(res.stdout);
	} catch {
		throw inputError("The checkout or base ref could not be resolved to a commit.");
	}
	commit = commit.trim();
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(commit)) throw inputError("Git returned an invalid base commit.");
	return commit;
}

/**
 * Remove an ADE-created worktree directory while keeping its branch. Only paths inside `allowedRoot`
 * (ADE's own worktree directory) are removed, so user checkouts are never touched.
 */
export async function removeWorktree({ repository, path, allowedRoot }: { repository: string; path: string; allowedRoot: string }) {
	const root = resolve(allowedRoot);
	const target = resolve(path);
	if (!target.startsWith(`${root}${sep}`)) throw badRequest("Only worktrees created by ADE can be removed.");
	await execFileAsync("git", ["worktree", "remove", "--force", target], { cwd: repository, timeout: 30000, windowsHide: true, env: gitEnvironment() });
	await execFileAsync("git", ["worktree", "prune"], { cwd: repository, timeout: 30000, windowsHide: true }).catch(() => undefined);
}

/** Recreate an ADE worktree from its kept branch (used when restoring an archived session). */
export async function restoreWorktree({ repository, path, branch, allowedRoot }: { repository: string; path: string; branch: string; allowedRoot: string }) {
	const root = resolve(allowedRoot);
	const target = resolve(path);
	if (!target.startsWith(`${root}${sep}`)) throw badRequest("Only worktrees created by ADE can be restored.");
	if (existsSync(target)) throw conflict("The worktree folder already exists.");
	await execFileAsync("git", ["worktree", "add", target, branch], { cwd: repository, timeout: 60000, windowsHide: true, env: gitEnvironment() });
}

export class WorktreeManager {
	#db: DatabaseSync;
	#stateDirectory: string;
	#active = new Map<string, Promise<WorktreeOperationRow>>();
	#busyRepositories = new Set<string>();

	/** Directory that holds worktrees created by ADE. */
	get root(): string {
		return join(this.#stateDirectory, "worktrees");
	}

	constructor(stateDirectory: string) {
		this.#stateDirectory = stateDirectory;
		this.#db = new DatabaseSync(join(stateDirectory, "worktrees.sqlite"));
		this.#db.exec(`
			PRAGMA journal_mode=WAL;
			CREATE TABLE IF NOT EXISTS operations (
				id TEXT PRIMARY KEY, repository TEXT NOT NULL, branch TEXT NOT NULL,
				base TEXT NOT NULL, commitHash TEXT NOT NULL, target TEXT NOT NULL,
				status TEXT NOT NULL, message TEXT NOT NULL, createdAt INTEGER NOT NULL,
				filters TEXT NOT NULL DEFAULT '[]'
			);
		`);
		if (!this.#db.prepare("PRAGMA table_info(operations)").all().some(column => column.name === "filters")) {
			this.#db.exec("ALTER TABLE operations ADD COLUMN filters TEXT NOT NULL DEFAULT '[]'");
		}
		this.#db.prepare("UPDATE operations SET status='attention', message=? WHERE status='running'")
			.run("ADE stopped during creation. Inspect the target and Git worktree list before taking further action; ADE will not retry or remove it.");
	}

	list(): WorktreeOperationRow[] {
		return this.#db.prepare("SELECT * FROM operations ORDER BY createdAt DESC, id DESC LIMIT 100").all() as WorktreeOperationRow[];
	}

	get(id: string): WorktreeOperationRow | undefined {
		return this.#db.prepare("SELECT * FROM operations WHERE id=?").get(id) as WorktreeOperationRow | undefined;
	}

	async create(input: { id?: unknown; repository?: unknown; branch?: unknown; base?: unknown } | null | undefined): Promise<WorktreeOperationRow> {
		if (typeof input?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) {
			throw inputError("A valid operation ID is required.");
		}
		if (typeof input.repository !== "string" || !isAbsolute(input.repository) || input.repository.includes("\0") ||
			typeof input.branch !== "string" || !input.branch || input.branch.length > 200 ||
			typeof input.base !== "string" || !input.base || input.base.length > 200 || input.base.startsWith("-") || input.base.includes("\0")) {
			throw inputError("Provide an absolute checkout path, a new branch name, and a base ref.");
		}
		const opId = input.id;
		const branch = input.branch;
		const base = input.base;
		let repository: string;
		try {
			repository = realpathSync(input.repository);
		} catch {
			throw inputError("The repository path does not exist or cannot be accessed.");
		}
		const existing = this.#db.prepare("SELECT * FROM operations WHERE id=?").get(opId) as WorktreeOperationRow | undefined;
		if (existing) {
			if (existing.repository !== repository || existing.branch !== branch || existing.base !== base) {
				throw inputError("This operation ID was already used with different inputs.", 409);
			}
			return this.#active.get(opId) ?? existing;
		}
		if (this.#busyRepositories.has(repository)) throw inputError("Another ADE worktree operation is running for this checkout.", 409);
		this.#busyRepositories.add(repository);
		try {
			// Validation is read-only and happens before admission.
			await git(repository, ["check-ref-format", `refs/heads/${branch}`]).catch(() => { throw inputError("Enter a valid new Git branch name."); });
			const commitHash = await resolveBaseCommit(repository, base);
			let filterKeys: string[] = [];
			try {
				const result = await git(repository, ["config", "--includes", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|smudge|process)$"]);
				filterKeys = String(result.stdout).split("\0").filter(Boolean);
			} catch (error) {
				if ((error as { code?: unknown })?.code !== 1) throw inputError("Could not verify Git filter configuration.");
			}
			const filters = [...new Set(filterKeys.map(key => key.slice(0, key.lastIndexOf("."))))];
			if (filters.some(key => !/^filter\.[^\r\n=]+$/i.test(key))) throw inputError("A Git filter name cannot be safely disabled.");
			try {
				await git(repository, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
				throw inputError("That branch already exists. Choose a new branch name.");
			} catch (error) {
				const errObj = error as { statusCode?: number; code?: unknown };
				if (errObj?.statusCode) throw error;
				if (errObj?.code !== 1) throw inputError("Could not verify whether the branch exists.");
			}
			const target = join(this.#stateDirectory, "worktrees", opId);
			if (existsSync(target)) throw inputError("The managed worktree target already exists; it will not be overwritten.", 409);
			const hooks = join(this.#stateDirectory, "disabled-hooks", randomUUID());
			mkdirSync(hooks, { recursive: true });
			mkdirSync(join(this.#stateDirectory, "worktrees"), { recursive: true });
			this.#db.prepare("INSERT INTO operations (id,repository,branch,base,commitHash,target,status,message,createdAt,filters) VALUES (?,?,?,?,?,?, 'running', ?, ?, ?)")
				.run(opId, repository, branch, base, commitHash, target, "Creating worktree.", Date.now(), JSON.stringify(filters));
			const operation = this.#createAdmitted({ id: opId, repository, branch, commitHash, target, hooks, filters });
			this.#active.set(opId, operation);
			return await operation;
		} finally {
			this.#active.delete(opId);
			this.#busyRepositories.delete(repository);
		}
	}

	async #createAdmitted({ id, repository, branch, commitHash, target, hooks, filters }: {
		id: string;
		repository: string;
		branch: string;
		commitHash: string;
		target: string;
		hooks: string;
		filters: string[];
	}): Promise<WorktreeOperationRow> {
		let status: string;
		let message: string;
		try {
			await git(repository, [
				"-c", `core.hooksPath=${hooks}`, "-c", "core.fsmonitor=false", "-c", "submodule.recurse=false",
				...filters.flatMap(filter => ["-c", `${filter}.clean=`, "-c", `${filter}.smudge=`, "-c", `${filter}.process=`, "-c", `${filter}.required=false`]),
				"worktree", "add", "-b", branch, "--", target, commitHash,
			]);
			const observed = await inspectWorktrees(repository);
			const entry = observed.find(item => samePath(item.path, target));
			if (!entry || entry.branch !== branch || entry.head?.toLowerCase() !== commitHash.toLowerCase()) {
				throw new Error("Git registration did not match the requested branch and commit.");
			}
			status = "completed";
			message = filters.length
				? `Worktree created with external Git filters disabled (${filters.join(", ")}). Filtered files may contain raw pointers or other unprocessed content.`
				: "Worktree created.";
		} catch (error) {
			status = "attention";
			const errObj = error as { stderr?: unknown; message?: unknown };
			message = `Creation did not finish cleanly: ${String(errObj?.stderr || errObj?.message || error).trim().slice(0, 1000)}. Inspect the target and Git worktree list; ADE will not retry or remove it.`;
		}
		this.#db.prepare("UPDATE operations SET status=?, message=? WHERE id=?").run(status, message, id);
		return this.#db.prepare("SELECT * FROM operations WHERE id=?").get(id) as WorktreeOperationRow;
	}

	close() {
		if (this.#active.size) throw new Error("Cannot close while worktree creation is running.");
		this.#db.close();
	}
}
