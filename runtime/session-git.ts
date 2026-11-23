// Git and GitHub operations for a coding session's workspace: branch status, branch-vs-base diff,
// push, and pull requests (create, view, mark ready, merge). GitHub calls go through the user's
// authenticated GitHub CLI (`gh`), so ADE never handles a GitHub token itself.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { workspacePath } from "./coding-tools.ts";
import { badGateway, httpError } from "./http-error.ts";

const execute = promisify(execFile);

export type CommandRunner = (command: "git" | "gh", args: string[], cwd: string) => Promise<string>;

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
		throw badGateway(detail || `${command} ${args[0]} failed.`, { stderr: String(err?.stderr ?? "") });
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
	/** The ref new work on the base branch is read from (origin/main, or main when there is no remote). */
	baseRef: string | null;
	/** Commits on the base branch that this branch does not have yet (as of the last fetch). */
	behindBase: number;
	/** Files with unresolved conflicts from an "update from base" merge in progress. */
	conflicts: string[];
	mergeInProgress: boolean;
};

export type FeedbackComment = { author: string; body: string; createdAt: string };

/** One piece of reviewer feedback on a pull request. */
export type FeedbackItem = {
	id: string;
	kind: "thread" | "review" | "comment";
	author: string;
	body: string;
	createdAt: string;
	/** Inline review threads only. */
	path?: string;
	line?: number | null;
	resolved?: boolean;
	outdated?: boolean;
	replies?: FeedbackComment[];
	/** Review state for whole-PR reviews (CHANGES_REQUESTED, COMMENTED, APPROVED). */
	state?: string;
};

export type FailedRun = { id: number; name: string; url: string; log: string };

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

/** gh errors that just mean "there is no GitHub pull request here" (none yet, or the remote is not on GitHub). */
const NO_PULL_REQUEST = /no pull requests found|could not find|none of the git remotes|not a github|no git remotes/i;

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

	/** Where new base-branch work comes from: origin/<default>, else a local main/master. */
	async function baseRef(cwd: string) {
		const baseBranch = await defaultBaseBranch(cwd);
		if (baseBranch && await tryGit(cwd, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${baseBranch}`)) return { ref: `origin/${baseBranch}`, branch: baseBranch, remote: true };
		for (const candidate of [baseBranch, "main", "master"].filter(Boolean) as string[]) {
			if (await tryGit(cwd, "rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`)) return { ref: candidate, branch: candidate, remote: false };
		}
		return null;
	}

	async function untrackedFiles(cwd: string) {
		const out = await tryGit(cwd, "ls-files", "--others", "--exclude-standard");
		return out ? out.split("\n").filter(Boolean) : [];
	}

	async function conflictedFiles(cwd: string) {
		const out = await tryGit(cwd, "diff", "--name-only", "--diff-filter=U");
		return out ? out.split("\n").filter(Boolean) : [];
	}

	/** owner/name of the repository a pull request URL points at. */
	function repoFromUrl(url: string) {
		const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url);
		return match ? { owner: match[1], name: match[2] } : null;
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
			const target = await baseRef(cwd);
			const onBase = Boolean(branch && target && branch === target.branch);
			const behindBase = target && !onBase ? Number(await tryGit(cwd, "rev-list", "--count", `HEAD..${target.ref}`) ?? 0) : 0;
			const mergeInProgress = Boolean(await tryGit(cwd, "rev-parse", "-q", "--verify", "MERGE_HEAD"));
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
				baseRef: target?.ref ?? null,
				behindBase,
				conflicts: mergeInProgress ? await conflictedFiles(cwd) : [],
				mergeInProgress,
			};
		},

		/** Fetch the base branch so "behind" counts are current. Quietly does nothing offline or without a remote. */
		async fetchBase(cwd: string) {
			const target = await baseRef(cwd);
			if (!target?.remote) return false;
			return (await tryGit(cwd, "fetch", "--quiet", "origin", target.branch)) !== null;
		},

		/**
		 * Bring the base branch's new commits into this branch with a merge (never rewrites the
		 * session's history). Conflicts are left in place for the agent or the user to resolve.
		 */
		async updateFromBase(cwd: string): Promise<{ result: "up-to-date" | "updated" | "conflicts"; baseRef: string; conflicts: string[] }> {
			if (await tryGit(cwd, "rev-parse", "-q", "--verify", "MERGE_HEAD")) throw httpError(409, "An update is already in progress. Resolve the conflicts or abort it first.");
			const porcelain = await tryGit(cwd, "status", "--porcelain", "--untracked-files=no");
			if (porcelain) throw httpError(409, "Commit or discard the uncommitted changes before updating the branch.");
			const target = await baseRef(cwd);
			if (!target) throw httpError(409, "Could not find the base branch to update from.");
			const branch = await currentBranch(cwd);
			if (branch === target.branch) throw httpError(409, `This workspace is on ${branch} itself.`);
			if (target.remote) await git(cwd, "fetch", "--quiet", "origin", target.branch);
			const behind = Number(await tryGit(cwd, "rev-list", "--count", `HEAD..${target.ref}`) ?? 0);
			if (!behind) return { result: "up-to-date", baseRef: target.ref, conflicts: [] };
			try {
				await git(cwd, "merge", "--no-edit", "--no-ff", target.ref);
				return { result: "updated", baseRef: target.ref, conflicts: [] };
			} catch (error) {
				const conflicts = await conflictedFiles(cwd);
				if (conflicts.length) return { result: "conflicts", baseRef: target.ref, conflicts };
				await tryGit(cwd, "merge", "--abort");
				throw error;
			}
		},

		/** Stage the files that had conflicts (once no conflict markers are left) and commit the merge. */
		async finishMerge(cwd: string) {
			if (!await tryGit(cwd, "rev-parse", "-q", "--verify", "MERGE_HEAD")) throw httpError(409, "There is no update in progress.");
			const files = await conflictedFiles(cwd);
			const marked = files.filter(file => {
				const path = workspacePath(cwd, file, { mustExist: false });
				return existsSync(path) && /^(<{7}|>{7})( |$)/m.test(readFileSync(path, "utf8"));
			});
			if (marked.length) throw httpError(409, `Conflict markers are still in ${marked.join(", ")}. Resolve them first.`);
			if (files.length) await git(cwd, "add", "-A", "--", ...files);
			await git(cwd, "commit", "--no-edit");
			return { finished: true };
		},

		async abortMerge(cwd: string) {
			if (!await tryGit(cwd, "rev-parse", "-q", "--verify", "MERGE_HEAD")) throw httpError(409, "There is no update in progress.");
			await git(cwd, "merge", "--abort");
			return { aborted: true };
		},

		/** Unresolved review threads, review summaries and conversation comments on the branch's pull request. */
		async reviewFeedback(cwd: string): Promise<{ number: number; items: FeedbackItem[] } | null> {
			const branch = await currentBranch(cwd);
			if (!branch) return null;
			let raw: { number?: unknown; url?: unknown; reviews?: unknown; comments?: unknown };
			try {
				raw = JSON.parse(await gh(cwd, "pr", "view", branch, "--json", "number,url,reviews,comments"));
			} catch (error) {
				const err = error as { stderr?: unknown; message?: unknown };
				if (NO_PULL_REQUEST.test(String(err?.stderr ?? err?.message ?? ""))) return null;
				throw error;
			}
			const number = Number(raw.number);
			const login = (value: unknown) => String((value as { login?: unknown } | null)?.login ?? "someone");
			const items: FeedbackItem[] = [];
			const repo = repoFromUrl(String(raw.url ?? ""));
			if (repo) {
				const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved isOutdated path line originalLine comments(first:30){nodes{author{login} body createdAt}}}}}}}`;
				try {
					const data = JSON.parse(await gh(cwd, "api", "graphql", "-f", `query=${query}`, "-F", `owner=${repo.owner}`, "-F", `name=${repo.name}`, "-F", `number=${number}`));
					const threads = data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
					for (const thread of threads) {
						const comments = (thread?.comments?.nodes ?? []).map((c: { author?: unknown; body?: unknown; createdAt?: unknown }) => ({ author: login(c.author), body: String(c.body ?? ""), createdAt: String(c.createdAt ?? "") }));
						if (!comments.length) continue;
						items.push({
							id: `thread:${thread.id}`,
							kind: "thread",
							author: comments[0].author,
							body: comments[0].body,
							createdAt: comments[0].createdAt,
							path: String(thread.path ?? ""),
							line: typeof thread.line === "number" ? thread.line : typeof thread.originalLine === "number" ? thread.originalLine : null,
							resolved: Boolean(thread.isResolved),
							outdated: Boolean(thread.isOutdated),
							replies: comments.slice(1),
						});
					}
				} catch {
					// Inline threads are best effort; reviews and comments below still come through.
				}
			}
			for (const [index, review] of (Array.isArray(raw.reviews) ? raw.reviews : []).entries()) {
				const body = String(review?.body ?? "").trim();
				if (!body) continue;
				items.push({ id: `review:${index}`, kind: "review", author: login(review?.author), body, createdAt: String(review?.submittedAt ?? ""), state: String(review?.state ?? "") });
			}
			for (const [index, comment] of (Array.isArray(raw.comments) ? raw.comments : []).entries()) {
				const body = String(comment?.body ?? "").trim();
				if (!body) continue;
				items.push({ id: `comment:${index}`, kind: "comment", author: login(comment?.author), body, createdAt: String(comment?.createdAt ?? "") });
			}
			return { number, items };
		},

		/** Failed GitHub Actions runs for the branch's latest pushed commit, with the tail of each failed log. */
		async failedRuns(cwd: string): Promise<FailedRun[]> {
			const branch = await currentBranch(cwd);
			if (!branch) return [];
			const head = await tryGit(cwd, "rev-parse", "@{u}") ?? await tryGit(cwd, "rev-parse", "HEAD");
			const runs = JSON.parse(await gh(cwd, "run", "list", "--branch", branch, "--limit", "30", "--json", "databaseId,name,workflowName,conclusion,headSha,url")) as Array<{ databaseId: number; name?: string; workflowName?: string; conclusion?: string; headSha?: string; url?: string }>;
			const failed = runs.filter(run => run.headSha === head && ["failure", "timed_out", "startup_failure"].includes(String(run.conclusion)));
			const result: FailedRun[] = [];
			for (const run of failed.slice(0, 4)) {
				let log = "";
				try {
					log = await gh(cwd, "run", "view", String(run.databaseId), "--log-failed");
				} catch (error) {
					log = error instanceof Error ? error.message : "The log could not be read.";
				}
				result.push({ id: run.databaseId, name: String(run.workflowName || run.name || "workflow"), url: String(run.url ?? ""), log: tailLog(log) });
			}
			return result;
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
			// New files the agent hasn't committed yet are part of the branch's changes too.
			const known = new Set(files.map(file => file.path));
			for (const path of await untrackedFiles(cwd)) {
				if (known.has(path)) continue;
				files.push({ path, additions: countLines(join(cwd, path)), deletions: 0, status: "added" });
			}
			return { base, files };
		},

		async branchDiffFile(cwd: string, recordedBase: string | null, file: string) {
			workspacePath(cwd, file, { mustExist: false });
			const base = await resolveBase(cwd, recordedBase);
			if (!base) return "";
			if ((await untrackedFiles(cwd)).includes(file)) return newFileDiff(cwd, file);
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
				if (NO_PULL_REQUEST.test(String(err?.stderr ?? err?.message ?? ""))) return null;
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

function readSmallText(path: string) {
	try {
		const info = statSync(path);
		if (!info.isFile() || info.size > 1_000_000) return null;
		const text = readFileSync(path, "utf8");
		return text.includes("\0") ? null : text;
	} catch {
		return null;
	}
}

function countLines(path: string) {
	const text = readSmallText(path);
	if (!text) return 0;
	return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** A unified diff for a file that isn't in Git yet: every line is added. */
function newFileDiff(cwd: string, file: string) {
	const text = readSmallText(join(cwd, file));
	if (text === null) return `diff --git a/${file} b/${file}\nnew file\nBinary or large file not shown\n`;
	const lines = text.split("\n");
	if (text.endsWith("\n")) lines.pop();
	return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join("\n")}\n`;
}

// ANSI color codes in CI logs (the escape character is intentional here).
// oxlint-disable-next-line no-control-regex
const ANSI_COLOR = /\x1b\[[0-9;]*m/g;

/** Keep the end of a CI log (where the error is), without the job/step/timestamp prefix gh adds. */
export function tailLog(log: string, maxLines = 80, maxChars = 3500) {
	const lines = log.split("\n").map(line => {
		const parts = line.split("\t");
		const text = parts.length >= 3 ? parts.slice(2).join("\t") : line;
		return text.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, "").replace(ANSI_COLOR, "");
	}).filter(line => line.trim());
	let tail = lines.slice(-maxLines).join("\n");
	if (tail.length > maxChars) tail = tail.slice(-maxChars);
	return tail;
}
