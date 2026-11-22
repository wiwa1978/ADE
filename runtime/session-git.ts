// Git and GitHub operations for a coding session's workspace: branch status, branch-vs-base diff,
// push, and pull requests (create, view, mark ready, merge). GitHub calls go through the user's
// authenticated GitHub CLI (`gh`), so ADE never handles a GitHub token itself.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { workspacePath } from "./coding-tools.ts";

const execute = promisify(execFile);

export type CommandRunner = (command: "git" | "gh", args: string[], cwd: string) => Promise<string>;

function httpError(status: number, message: string) {
	return Object.assign(new Error(message), { statusCode: status });
}

const defaultRunner: CommandRunner = async (command, args, cwd) => {
	try {
		const { stdout } = await execute(command, args, {
			cwd,
			timeout: command === "gh" ? 60000 : 30000,
			maxBuffer: 8 * 1024 * 1024,
			windowsHide: true,
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", GIT_PAGER: "cat" },
		});
		return stdout;
	} catch (error) {
		const err = error as { code?: unknown; stderr?: unknown; message?: unknown };
		if (err?.code === "ENOENT") {
			throw httpError(503, command === "gh"
				? "GitHub CLI was not found. Install gh, then sign in with gh auth login --hostname github.com --web."
				: "Git was not found on this host.");
		}
		const detail = String(err?.stderr || err?.message || "").trim().split("\n").filter(Boolean).slice(-3).join(" ");
		throw Object.assign(new Error(detail || `${command} ${args[0]} failed.`), { statusCode: 502, stderr: String(err?.stderr ?? "") });
	}
};

export type BranchStatus = {
	branch: string | null;
	base: string | null;
	baseBranch: string | null;
	commitsAhead: number;
	upstream: string | null;
	unpushed: number;
	behindUpstream: number;
	hasRemote: boolean;
	uncommitted: number;
};

export type BranchDiffFile = { path: string; additions: number; deletions: number; status: "added" | "modified" | "deleted" | "renamed" };

export type PullRequestCheck = { name: string; status: "pending" | "success" | "failure" | "neutral"; url: string | null };

export type PullRequestInfo = {
	number: number;
	url: string;
	title: string;
	state: "OPEN" | "CLOSED" | "MERGED";
	isDraft: boolean;
	reviewDecision: string | null;
	mergeable: string | null;
	baseRefName: string;
	headRefName: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	checks: PullRequestCheck[];
	checksSummary: "none" | "pending" | "success" | "failure";
};

const PR_FIELDS = "number,url,title,state,isDraft,reviewDecision,mergeable,baseRefName,headRefName,additions,deletions,changedFiles,statusCheckRollup";

type RawCheckRollupItem = {
	conclusion?: unknown;
	state?: unknown;
	status?: unknown;
	name?: unknown;
	context?: unknown;
	detailsUrl?: unknown;
	targetUrl?: unknown;
};

type RawPullRequest = {
	number?: unknown;
	url?: unknown;
	title?: unknown;
	state?: unknown;
	isDraft?: unknown;
	reviewDecision?: unknown;
	mergeable?: unknown;
	baseRefName?: unknown;
	headRefName?: unknown;
	additions?: unknown;
	deletions?: unknown;
	changedFiles?: unknown;
	statusCheckRollup?: unknown;
};

function summarizeChecks(rollup: unknown): { checks: PullRequestCheck[]; checksSummary: PullRequestInfo["checksSummary"] } {
	const checks: PullRequestCheck[] = (Array.isArray(rollup) ? rollup : []).map((entry) => {
		const item = (entry && typeof entry === "object" ? entry : {}) as RawCheckRollupItem;
		// CheckRun has status/conclusion; StatusContext has state.
		const raw = String(item.conclusion || item.state || item.status || "").toUpperCase();
		const status: PullRequestCheck["status"] = ["SUCCESS"].includes(raw) ? "success"
			: ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(raw) ? "failure"
				: ["NEUTRAL", "SKIPPED", "STALE"].includes(raw) ? "neutral"
					: "pending";
		const url = typeof item.detailsUrl === "string" ? item.detailsUrl : typeof item.targetUrl === "string" ? item.targetUrl : null;
		return { name: String(item.name || item.context || "check"), status, url };
	});
	const checksSummary = !checks.length ? "none"
		: checks.some(c => c.status === "failure") ? "failure"
			: checks.some(c => c.status === "pending") ? "pending"
				: "success";
	return { checks, checksSummary };
}

function toPullRequest(input: unknown): PullRequestInfo {
	const raw = (input && typeof input === "object" ? input : {}) as RawPullRequest;
	return {
		number: Number(raw.number),
		url: String(raw.url ?? ""),
		title: String(raw.title ?? ""),
		state: raw.state === "MERGED" || raw.state === "CLOSED" ? raw.state : "OPEN",
		isDraft: Boolean(raw.isDraft),
		reviewDecision: typeof raw.reviewDecision === "string" && raw.reviewDecision ? raw.reviewDecision : null,
		mergeable: typeof raw.mergeable === "string" && raw.mergeable ? raw.mergeable : null,
		baseRefName: String(raw.baseRefName ?? ""),
		headRefName: String(raw.headRefName ?? ""),
		additions: Number(raw.additions ?? 0),
		deletions: Number(raw.deletions ?? 0),
		changedFiles: Number(raw.changedFiles ?? 0),
		...summarizeChecks(raw.statusCheckRollup),
	};
}

export function createSessionGit(run: CommandRunner = defaultRunner) {
	const git = (cwd: string, ...args: string[]) => run("git", args, cwd);
	const gh = (cwd: string, ...args: string[]) => run("gh", args, cwd);
	const tryGit = async (cwd: string, ...args: string[]) => {
		try {
			return (await git(cwd, ...args)).trim();
		} catch {
			return null;
		}
	};

	async function currentBranch(cwd: string) {
		const branch = await tryGit(cwd, "rev-parse", "--abbrev-ref", "HEAD");
		return branch && branch !== "HEAD" ? branch : null;
	}

	/** The repository's default branch on origin (e.g. main), used as the PR base. */
	async function defaultBaseBranch(cwd: string) {
		const symbolic = await tryGit(cwd, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
		if (symbolic) return symbolic.replace(/^origin\//, "");
		try {
			const name = (await gh(cwd, "repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name")).trim();
			if (name) return name;
		} catch {
			// fall through to common names
		}
		for (const candidate of ["main", "master"]) {
			if (await tryGit(cwd, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${candidate}`)) return candidate;
		}
		return null;
	}

	/** Commit the session's changes are measured against: the session's recorded base, else the merge-base with origin's default branch. */
	async function resolveBase(cwd: string, recordedBase: string | null) {
		if (recordedBase && recordedBase !== "HEAD" && await tryGit(cwd, "rev-parse", "--verify", "--quiet", `${recordedBase}^{commit}`)) return recordedBase;
		const baseBranch = await defaultBaseBranch(cwd);
		if (baseBranch) return tryGit(cwd, "merge-base", "HEAD", `origin/${baseBranch}`);
		return null;
	}

	return {
		async status(cwd: string, recordedBase: string | null): Promise<BranchStatus> {
			const [branch, base, baseBranch, upstream, remotes, porcelain] = await Promise.all([
				currentBranch(cwd),
				resolveBase(cwd, recordedBase),
				defaultBaseBranch(cwd),
				tryGit(cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"),
				tryGit(cwd, "remote"),
				tryGit(cwd, "status", "--porcelain"),
			]);
			const commitsAhead = base ? Number(await tryGit(cwd, "rev-list", "--count", `${base}..HEAD`) ?? 0) : 0;
			let unpushed = 0;
			let behindUpstream = 0;
			if (upstream) {
				const counts = await tryGit(cwd, "rev-list", "--left-right", "--count", "@{u}...HEAD");
				if (counts) [behindUpstream, unpushed] = counts.split(/\s+/).map(Number);
			} else {
				unpushed = commitsAhead;
			}
			return {
				branch,
				base,
				baseBranch,
				commitsAhead,
				upstream,
				unpushed,
				behindUpstream,
				hasRemote: Boolean(remotes?.split("\n").includes("origin")),
				uncommitted: porcelain ? porcelain.split("\n").filter(Boolean).length : 0,
			};
		},

		/** Files changed between the base and the working tree (committed and uncommitted tracked changes). */
		async branchDiffFiles(cwd: string, recordedBase: string | null): Promise<{ base: string | null; files: BranchDiffFile[] }> {
			const base = await resolveBase(cwd, recordedBase);
			if (!base) return { base: null, files: [] };
			const [numstat, nameStatus] = await Promise.all([
				git(cwd, "diff", "--numstat", "-M", base),
				git(cwd, "diff", "--name-status", "-M", base),
			]);
			const statuses = new Map<string, BranchDiffFile["status"]>();
			for (const line of nameStatus.split("\n").filter(Boolean)) {
				const [code, ...paths] = line.split("\t");
				const path = paths[paths.length - 1];
				statuses.set(path, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : code.startsWith("R") ? "renamed" : "modified");
			}
			const files = numstat.split("\n").filter(Boolean).map(line => {
				const [add, del, ...rest] = line.split("\t");
				let path = rest.join("\t");
				// Renames look like "src/{old => new}.ts" or "old => new".
				const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
				if (brace) path = `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/\//g, "/");
				else if (path.includes(" => ")) path = path.split(" => ")[1];
				return { path, additions: Number(add) || 0, deletions: Number(del) || 0, status: statuses.get(path) ?? "modified" };
			});
			return { base, files };
		},

		async branchDiffFile(cwd: string, recordedBase: string | null, file: string) {
			workspacePath(cwd, file, { mustExist: false });
			const base = await resolveBase(cwd, recordedBase);
			if (!base) return "";
			return git(cwd, "diff", "-M", base, "--", file);
		},

		async push(cwd: string) {
			const branch = await currentBranch(cwd);
			if (!branch) throw httpError(409, "The workspace is not on a branch, so there is nothing to push.");
			await git(cwd, "push", "--set-upstream", "origin", branch);
			return { branch };
		},

		/** The pull request for the workspace's current branch, or null when there is none. */
		async pullRequest(cwd: string): Promise<PullRequestInfo | null> {
			const branch = await currentBranch(cwd);
			if (!branch) return null;
			try {
				return toPullRequest(JSON.parse(await gh(cwd, "pr", "view", branch, "--json", PR_FIELDS)));
			} catch (error) {
				const err = error as { stderr?: unknown; message?: unknown };
				if (/no pull requests found|could not find/i.test(String(err?.stderr ?? err?.message ?? ""))) return null;
				throw error;
			}
		},

		async createPullRequest(cwd: string, input: { title?: unknown; body?: unknown; draft?: unknown; base?: unknown }) {
			const title = typeof input.title === "string" ? input.title.trim() : "";
			if (!title || title.length > 256) throw httpError(400, "Enter a pull request title (up to 256 characters).");
			const body = typeof input.body === "string" ? input.body.slice(0, 60000) : "";
			const branch = await currentBranch(cwd);
			if (!branch) throw httpError(409, "The workspace is not on a branch.");
			const base = typeof input.base === "string" && /^[\w./-]{1,200}$/.test(input.base) ? input.base : await defaultBaseBranch(cwd);
			if (base === branch) throw httpError(409, `This workspace is on ${branch}, the base branch. Start a worktree session to open a pull request.`);
			await git(cwd, "push", "--set-upstream", "origin", branch);
			const args = ["pr", "create", "--head", branch, "--title", title, "--body", body];
			if (base) args.push("--base", base);
			if (input.draft === true) args.push("--draft");
			await gh(cwd, ...args);
			return this.pullRequest(cwd);
		},

		async markReady(cwd: string) {
			const pr = await this.pullRequest(cwd);
			if (!pr) throw httpError(404, "There is no pull request for this branch.");
			await gh(cwd, "pr", "ready", String(pr.number));
			return this.pullRequest(cwd);
		},

		async merge(cwd: string, method: unknown) {
			const pr = await this.pullRequest(cwd);
			if (!pr) throw httpError(404, "There is no pull request for this branch.");
			const flag = method === "merge" ? "--merge" : method === "rebase" ? "--rebase" : "--squash";
			// The branch stays checked out in the worktree, so it is not deleted here; archiving cleans up.
			await gh(cwd, "pr", "merge", String(pr.number), flag);
			return this.pullRequest(cwd);
		},

		async listPullRequests(cwd: string, repository: string, state: "open" | "closed" | "merged" | "all" = "open") {
			if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repository)) throw httpError(400, "Provide a valid owner/repository slug.");
			const raw = JSON.parse(await gh(cwd, "pr", "list", "-R", repository, "--state", state, "--limit", "50",
				"--json", "number,title,url,state,isDraft,author,headRefName,baseRefName,updatedAt,reviewDecision,statusCheckRollup"));
			return (Array.isArray(raw) ? raw : []).map(item => ({
				number: Number(item.number),
				title: String(item.title ?? ""),
				url: String(item.url ?? ""),
				state: String(item.state ?? "OPEN"),
				isDraft: Boolean(item.isDraft),
				author: String(item.author?.login ?? ""),
				headRefName: String(item.headRefName ?? ""),
				baseRefName: String(item.baseRefName ?? ""),
				updatedAt: String(item.updatedAt ?? ""),
				reviewDecision: item.reviewDecision || null,
				checksSummary: summarizeChecks(item.statusCheckRollup).checksSummary,
			}));
		},
	};
}

export type SessionGit = ReturnType<typeof createSessionGit>;
