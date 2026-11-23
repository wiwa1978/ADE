// Starting a session from work that already exists: a branch (local or on origin) or a GitHub pull
// request. ADE makes sure a local branch exists, then the session's worktree checks that branch out.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { badRequest, httpError } from "./http-error.ts";

const execute = promisify(execFile);

export type StartFrom = { branch: string } | { pullRequest: number };

export type PreparedBranch = {
	branch: string;
	/** Commit the session's changes are measured against (where the branch left the default branch). */
	base: string;
	/** Pull request details when the session starts from one. */
	pullRequest?: { number: number; title: string; url: string; crossRepository: boolean };
};

type Runner = (command: "git" | "gh", args: string[], cwd: string) => Promise<string>;

const defaultRunner: Runner = async (command, args, cwd) => {
	try {
		const { stdout } = await execute(command, args, {
			cwd,
			timeout: 60000,
			maxBuffer: 4 * 1024 * 1024,
			windowsHide: true,
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
		});
		return stdout;
	} catch (error) {
		const err = error as { code?: unknown; stderr?: unknown; message?: unknown };
		if (err?.code === "ENOENT") throw httpError(503, command === "gh" ? "GitHub CLI was not found. Install gh and sign in to start from a pull request." : "Git was not found on this host.");
		const detail = String(err?.stderr || err?.message || "").trim().split("\n").filter(Boolean).slice(-2).join(" ");
		throw httpError(502, detail || `${command} ${args[0]} failed.`);
	}
};

/** Read and check the optional `startFrom` field of a new session. */
export function parseStartFrom(value: unknown): StartFrom | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) throw badRequest('Field "startFrom" must be an object.');
	const input = value as { branch?: unknown; pullRequest?: unknown };
	if (typeof input.branch === "string" && input.branch.trim()) {
		const branch = input.branch.trim().replace(/^origin\//, "");
		if (branch.length > 200 || branch.startsWith("-") || /[\s~^:?*[\\]|\.\.|@\{/.test(branch)) throw badRequest("Enter a valid branch name.");
		return { branch };
	}
	const number = typeof input.pullRequest === "number" ? input.pullRequest : typeof input.pullRequest === "string" ? Number(input.pullRequest.replace(/^#/, "")) : NaN;
	if (Number.isInteger(number) && number > 0 && number < 10_000_000) return { pullRequest: number };
	throw badRequest('Field "startFrom" needs a branch name or a pull request number.');
}

export function createStartFrom(run: Runner = defaultRunner) {
	const git = (cwd: string, ...args: string[]) => run("git", args, cwd);
	const tryGit = async (cwd: string, ...args: string[]) => {
		try {
			return (await git(cwd, ...args)).trim();
		} catch {
			return null;
		}
	};
	const hasRef = async (cwd: string, ref: string) => Boolean(await tryGit(cwd, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`));

	/** Where the branch left the repository's default branch, so the session's diff covers the whole branch. */
	async function forkPoint(repository: string, branch: string) {
		const symbolic = await tryGit(repository, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
		const candidates = [symbolic, "origin/main", "origin/master", "main", "master"].filter(Boolean) as string[];
		for (const candidate of candidates) {
			if (candidate === branch || !(await hasRef(repository, candidate))) continue;
			const base = await tryGit(repository, "merge-base", branch, candidate);
			if (base) return base;
		}
		return (await git(repository, "rev-parse", `${branch}^{commit}`)).trim();
	}

	async function fromBranch(repository: string, name: string): Promise<PreparedBranch> {
		if (!(await hasRef(repository, `refs/heads/${name}`))) {
			// Not local yet: look for it on origin and create a local branch that tracks it.
			const hasOrigin = (await tryGit(repository, "remote"))?.split("\n").includes("origin");
			if (hasOrigin) await tryGit(repository, "fetch", "--quiet", "origin", name);
			if (!(await hasRef(repository, `refs/remotes/origin/${name}`))) throw httpError(404, `Branch ${name} was not found locally or on origin.`);
			await git(repository, "branch", "--track", name, `origin/${name}`);
		}
		return { branch: name, base: await forkPoint(repository, name) };
	}

	async function fromPullRequest(repository: string, number: number): Promise<PreparedBranch> {
		let info: { number?: unknown; title?: unknown; url?: unknown; headRefName?: unknown; isCrossRepository?: unknown; state?: unknown };
		try {
			info = JSON.parse(await run("gh", ["pr", "view", String(number), "--json", "number,title,url,headRefName,isCrossRepository,state"], repository));
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			throw httpError(/could not find|no pull requests/i.test(message) ? 404 : 502, /could not find|no pull requests/i.test(message) ? `Pull request #${number} was not found in this repository.` : message || "Could not read the pull request.");
		}
		const pullRequest = { number, title: String(info.title ?? ""), url: String(info.url ?? ""), crossRepository: Boolean(info.isCrossRepository) };
		const head = String(info.headRefName ?? "");
		if (!pullRequest.crossRepository && head) {
			const prepared = await fromBranch(repository, head);
			return { ...prepared, pullRequest };
		}
		// A pull request from a fork: fetch its head into a local branch. Pushing goes to the fork's owner, not here.
		const branch = `ade/pr-${number}`;
		if (!(await hasRef(repository, `refs/heads/${branch}`))) await git(repository, "fetch", "--quiet", "origin", `pull/${number}/head:${branch}`);
		return { branch, base: await forkPoint(repository, branch), pullRequest };
	}

	return {
		prepare(repository: string, startFrom: StartFrom): Promise<PreparedBranch> {
			return "branch" in startFrom ? fromBranch(repository, startFrom.branch) : fromPullRequest(repository, startFrom.pullRequest);
		},
		/** Local and origin branches, newest first, for the branch picker. */
		async listBranches(repository: string) {
			// Pick up branches teammates pushed since the last fetch (best effort; works offline too).
			if ((await tryGit(repository, "remote"))?.split("\n").includes("origin")) await tryGit(repository, "fetch", "--quiet", "--prune", "origin");
			const out = await tryGit(repository, "for-each-ref", "--sort=-committerdate", "--count=200", "--format=%(refname)%09%(committerdate:unix)%09%(worktreepath)%09%(subject)", "refs/heads", "refs/remotes/origin");
			const seen = new Map<string, { name: string; remote: boolean; updatedAt: number; subject: string; checkedOutAt: string | null }>();
			for (const line of (out ?? "").split("\n").filter(Boolean)) {
				const [ref, date, worktree, ...subject] = line.split("\t");
				const remote = ref.startsWith("refs/remotes/origin/");
				const name = remote ? ref.slice("refs/remotes/origin/".length) : ref.slice("refs/heads/".length);
				if (name === "HEAD" || seen.has(name)) continue;
				// A branch checked out in another worktree (or the main checkout) can't be checked out again.
				seen.set(name, { name, remote, updatedAt: Number(date) * 1000, subject: subject.join("\t"), checkedOutAt: worktree || null });
			}
			return [...seen.values()];
		},
	};
}

export type StartFromService = ReturnType<typeof createStartFrom>;
