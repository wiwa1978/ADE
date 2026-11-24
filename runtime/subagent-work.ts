// The work a worktree subagent did: the files it changed on its own branch (committed or not)
// compared with where it started, one file's diff, and bringing its branch into the session.
import { execFile } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";
import { workspacePath } from "./coding-tools.ts";

const execute = promisify(execFile);

async function git(cwd: string, args: string[], allowFailure = false) {
	try {
		const { stdout } = await execute("git", args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 20_000, windowsHide: true });
		return stdout;
	} catch (error) {
		// Some commands (diff --no-index) exit 1 when there are differences; their output is still the answer.
		if (allowFailure) return (error as { stdout?: string }).stdout ?? null;
		throw error;
	}
}

export type SubagentFileChange = { path: string; added: number; removed: number; status: "added" | "modified" | "deleted" };
export type SubagentChanges = { base: string; files: SubagentFileChange[]; added: number; removed: number; commits: number };

/** Where the subagent's branch left the session's branch (or, without one, its first commit's parent). */
async function forkPoint(workspace: string, sessionBranch: string | null) {
	if (sessionBranch && !sessionBranch.startsWith("-")) {
		const base = await git(workspace, ["merge-base", "HEAD", sessionBranch], true);
		if (base?.trim()) return base.trim();
	}
	const upstream = await git(workspace, ["merge-base", "HEAD", "@{upstream}"], true);
	return upstream?.trim() || "HEAD";
}

/** Files the subagent changed since it started: its commits plus uncommitted and new files. */
export async function subagentChanges(workspace: string, sessionBranch: string | null): Promise<SubagentChanges> {
	const base = await forkPoint(workspace, sessionBranch);
	const numstat = (await git(workspace, ["diff", "--numstat", "-M", base])) ?? "";
	const nameStatus = (await git(workspace, ["diff", "--name-status", "-M", base])) ?? "";
	const statusOf = new Map<string, SubagentFileChange["status"]>();
	for (const line of nameStatus.split("\n").filter(Boolean)) {
		const [code, ...paths] = line.split("\t");
		statusOf.set(paths.at(-1) ?? "", code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified");
	}
	const files: SubagentFileChange[] = [];
	for (const line of numstat.split("\n").filter(Boolean)) {
		const [added, removed, ...rest] = line.split("\t");
		const path = rest.join("\t").replace(/^.*\{.* => (.*)\}.*$/, "$1").replace(/^.* => /, "");
		files.push({ path, added: Number(added) || 0, removed: Number(removed) || 0, status: statusOf.get(path) ?? "modified" });
	}
	const untracked = ((await git(workspace, ["ls-files", "--others", "--exclude-standard"])) ?? "").split("\n").filter(Boolean);
	for (const path of untracked.slice(0, 500)) {
		try {
			const resolved = workspacePath(workspace, path, { mustExist: true });
			if (lstatSync(resolved).isSymbolicLink()) continue;
		} catch {
			continue;
		}
		const content = await git(workspace, ["diff", "--no-index", "--numstat", "--", "/dev/null", path], true);
		const added = Number(content?.split("\t")[0]) || 0;
		files.push({ path, added, removed: 0, status: "added" });
	}
	const commits = Number((await git(workspace, ["rev-list", "--count", `${base}..HEAD`], true))?.trim()) || 0;
	return { base, files, added: files.reduce((sum, file) => sum + file.added, 0), removed: files.reduce((sum, file) => sum + file.removed, 0), commits };
}

/** One file's diff against where the subagent started (new files against nothing). */
export async function subagentFileDiff(workspace: string, sessionBranch: string | null, file: string) {
	if (!file || file.startsWith("-") || file.includes("\0")) {
		throw Object.assign(new Error("Choose a file from the list."), { statusCode: 400 });
	}
	// Reject path traversal, `.git` metadata access, and symlinks anywhere along the path.
	let resolved: string;
	try {
		resolved = workspacePath(workspace, file, { mustExist: false });
	} catch (error) {
		throw Object.assign(new Error(error instanceof Error ? error.message : "Invalid file path."), { statusCode: 400 });
	}
	const base = await forkPoint(workspace, sessionBranch);
	const tracked = await git(workspace, ["diff", "-M", base, "--", file]);
	if (tracked?.trim()) return tracked;
	// Verify realpath containment for untracked files before running `git diff --no-index`.
	try {
		const st = lstatSync(resolved);
		if (st.isSymbolicLink() || !st.isFile()) {
			throw Object.assign(new Error("Symbolic links are not allowed."), { statusCode: 400 });
		}
		const canonicalRoot = realpathSync(workspace);
		const realFile = realpathSync(resolved);
		const rel = relative(canonicalRoot, realFile);
		if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
			throw Object.assign(new Error("Path is outside the task workspace."), { statusCode: 400 });
		}
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode === 400) throw error;
		return "";
	}
	// New, untracked file: git exits 1 when there are differences, so read the output from the error.
	try {
		await execute("git", ["diff", "--no-index", "--", "/dev/null", file], { cwd: workspace, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
		return "";
	} catch (error) {
		return String((error as { stdout?: string }).stdout ?? "");
	}
}

/**
 * Bring a subagent's branch into the session's branch: commit what it left uncommitted on its own
 * branch, then merge. A merge that conflicts is undone and reported, so the session never ends up
 * half-merged.
 */
export async function mergeSubagentBranch(sessionWorkspace: string, subagentWorkspace: string, subagentBranch: string, label: string) {
	if (!subagentBranch || subagentBranch.startsWith("-")) {
		throw Object.assign(new Error("Invalid subagent branch name."), { statusCode: 400 });
	}
	const pending = (await git(subagentWorkspace, ["status", "--porcelain"])) ?? "";
	if (pending.trim()) {
		await git(subagentWorkspace, ["add", "-A"]);
		await git(subagentWorkspace, ["commit", "-m", `${label}: remaining changes`, "--no-verify"]);
	}
	try {
		await execute("git", ["merge", "--no-ff", "--no-edit", "-m", `Merge ${label} (${subagentBranch})`, "--", subagentBranch], { cwd: sessionWorkspace, maxBuffer: 16 * 1024 * 1024, timeout: 60_000, windowsHide: true });
		return { merged: true, message: `Merged ${label} into the session's branch.` };
	} catch (error) {
		const conflicted = ((await git(sessionWorkspace, ["diff", "--name-only", "--diff-filter=U"], true)) ?? "").split("\n").filter(Boolean);
		await git(sessionWorkspace, ["merge", "--abort"], true);
		const detail = conflicted.length ? `It conflicts in ${conflicted.slice(0, 5).join(", ")}${conflicted.length > 5 ? "…" : ""}.` : String((error as { stderr?: string }).stderr ?? (error as Error).message).trim().split("\n").slice(-2).join(" ");
		return { merged: false, message: `Couldn't merge ${label}. ${detail} Nothing was changed; ask the main agent to bring it together.` };
	}
}
