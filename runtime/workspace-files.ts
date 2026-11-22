import { execFile } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { workspacePath } from "./coding-tools.ts";

const execFileAsync = promisify(execFile);

export type WorkspaceEntry = {
	name: string;
	path: string;
	kind: "file" | "directory";
	size?: number;
};

export type GitFileChange = {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed" | "untracked";
	staged: boolean;
	unstaged: boolean;
	additions: number;
	deletions: number;
};

export type WorkspaceGitSummary = {
	isGitRepo: boolean;
	branch: string | null;
	ahead: number;
	behind: number;
	additions: number;
	deletions: number;
	files: GitFileChange[];
};

const SKIP_EXPLORER = new Set([".git", "node_modules"]);

export function listWorkspaceDirectory(root: string, relPath = "."): WorkspaceEntry[] {
	const target = relPath === "." || !relPath ? root : workspacePath(root, relPath, { mustExist: true });
	const entries = readdirSync(target, { withFileTypes: true })
		.filter(e => !SKIP_EXPLORER.has(e.name) && !e.isSymbolicLink())
		.sort((a, b) => {
			if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	return entries.slice(0, 400).map(entry => {
		const full = join(target, entry.name);
		const rel = relative(root, full).replace(/\\/g, "/");
		let size: number | undefined;
		if (entry.isFile()) {
			try {
				size = statSync(full).size;
			} catch {
				// ignore
			}
		}
		return {
			name: entry.name,
			path: rel,
			kind: entry.isDirectory() ? "directory" : "file",
			...(size !== undefined ? { size } : {}),
		};
	});
}

export function readWorkspaceFile(root: string, relPath: string): { path: string; content: string; language: string; size: number; binary: boolean } {
	const full = workspacePath(root, relPath, { mustExist: true });
	const stat = lstatSync(full);
	if (!stat.isFile()) throw Object.assign(new Error("Path is not a file."), { statusCode: 400 });
	if (stat.size > 2_000_000) throw Object.assign(new Error("File is too large to open in the editor (>2MB)."), { statusCode: 413 });
	const buf = readFileSync(full);
	let binary = false;
	for (let i = 0; i < Math.min(buf.length, 4096); i++) {
		if (buf[i] === 0) {
			binary = true;
			break;
		}
	}
	const ext = extname(relPath).slice(1).toLowerCase();
	const langMap: Record<string, string> = {
		ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript",
		json: "json", css: "css", html: "html", md: "markdown", py: "python",
		rs: "rust", go: "go", sh: "bash", zsh: "bash", yml: "yaml", yaml: "yaml", toml: "toml", sql: "sql",
	};
	return {
		path: relPath.replace(/\\/g, "/"),
		content: binary ? "" : buf.toString("utf8"),
		language: langMap[ext] ?? "text",
		size: stat.size,
		binary,
	};
}

export function writeWorkspaceFile(root: string, relPath: string, content: string): { path: string; size: number } {
	if (typeof content !== "string") throw Object.assign(new Error("Content must be a string."), { statusCode: 400 });
	const full = workspacePath(root, relPath, { mustExist: false });
	writeFileSync(full, content, "utf8");
	return { path: relPath.replace(/\\/g, "/"), size: Buffer.byteLength(content, "utf8") };
}

async function runGit(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 6 * 1024 * 1024, timeout: 15_000 });
	return stdout;
}

export async function getWorkspaceGitSummary(workspace: string): Promise<WorkspaceGitSummary> {
	try {
		const statusOut = await runGit(workspace, ["status", "--porcelain=v1", "-b"]);
		const lines = statusOut.split("\n").filter(Boolean);
		let branch: string | null = null;
		let ahead = 0;
		let behind = 0;
		const fileMap = new Map<string, GitFileChange>();

		for (const line of lines) {
			if (line.startsWith("## ")) {
				const header = line.slice(3);
				branch = header.split("...")[0].replace(/^No commits yet on /, "").trim();
				const aheadMatch = /ahead (\d+)/.exec(header);
				const behindMatch = /behind (\d+)/.exec(header);
				if (aheadMatch) ahead = Number(aheadMatch[1]);
				if (behindMatch) behind = Number(behindMatch[1]);
				continue;
			}
			const x = line[0];
			const y = line[1];
			let filePath = line.slice(3).trim();
			if (filePath.includes(" -> ")) filePath = filePath.split(" -> ").pop()!.trim();
			if (filePath.startsWith('"') && filePath.endsWith('"')) filePath = filePath.slice(1, -1);

			const isUntracked = x === "?" && y === "?";
			const staged = !isUntracked && x !== " ";
			const unstaged = isUntracked || y !== " ";
			const code = isUntracked ? "?" : x !== " " ? x : y;
			const status: GitFileChange["status"] =
				code === "?" ? "untracked"
				: code === "A" ? "added"
				: code === "D" ? "deleted"
				: code === "R" ? "renamed"
				: "modified";

			fileMap.set(filePath, {
				path: filePath,
				status,
				staged,
				unstaged,
				additions: 0,
				deletions: 0,
			});
		}

		// Collect numstat for unstaged + staged changes
		let totalAdditions = 0;
		let totalDeletions = 0;
		for (const diffArgs of [["diff", "--numstat"], ["diff", "--cached", "--numstat"]]) {
			try {
				const numstat = await runGit(workspace, diffArgs);
				for (const line of numstat.split("\n").filter(Boolean)) {
					const [addStr, delStr, pathPart] = line.split("\t");
					if (!pathPart) continue;
					const add = addStr === "-" ? 0 : Number(addStr) || 0;
					const del = delStr === "-" ? 0 : Number(delStr) || 0;
					totalAdditions += add;
					totalDeletions += del;
					const item = fileMap.get(pathPart);
					if (item) {
						item.additions += add;
						item.deletions += del;
					}
				}
			} catch {
				// ignore if no HEAD yet
			}
		}

		// Estimate additions for untracked text files
		for (const item of fileMap.values()) {
			if (item.status === "untracked") {
				try {
					const full = workspacePath(workspace, item.path, { mustExist: true });
					const stat = statSync(full);
					if (stat.isFile() && stat.size < 500_000) {
						const count = readFileSync(full, "utf8").split("\n").length;
						item.additions = count;
						totalAdditions += count;
					}
				} catch {
					// ignore
				}
			}
		}

		return {
			isGitRepo: true,
			branch,
			ahead,
			behind,
			additions: totalAdditions,
			deletions: totalDeletions,
			files: [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
		};
	} catch {
		return { isGitRepo: false, branch: null, ahead: 0, behind: 0, additions: 0, deletions: 0, files: [] };
	}
}

export async function getWorkspaceFileDiff(workspace: string, filePath: string, staged = false): Promise<string> {
	workspacePath(workspace, filePath, { mustExist: false });
	try {
		const args = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
		const out = await runGit(workspace, args);
		if (out.trim()) return out;
		// Check if untracked file — synthesize unified diff
		const full = workspacePath(workspace, filePath, { mustExist: true });
		const stat = statSync(full);
		if (stat.isFile() && stat.size < 500_000) {
			const lines = readFileSync(full, "utf8").replace(/\n$/, "").split("\n");
			return [
				`diff --git a/${filePath} b/${filePath}`,
				"new file mode 100644",
				"--- /dev/null",
				`+++ b/${filePath}`,
				`@@ -0,0 +1,${lines.length} @@`,
				...lines.map(l => `+${l}`),
			].join("\n");
		}
		return "";
	} catch {
		return "";
	}
}

export async function gitStageFiles(workspace: string, paths: string[]): Promise<void> {
	if (!paths.length) {
		await runGit(workspace, ["add", "-A"]);
		return;
	}
	for (const p of paths) workspacePath(workspace, p, { mustExist: false });
	await runGit(workspace, ["add", "--", ...paths]);
}

export async function gitUnstageFiles(workspace: string, paths: string[]): Promise<void> {
	if (!paths.length) {
		await runGit(workspace, ["reset", "HEAD"]);
		return;
	}
	for (const p of paths) workspacePath(workspace, p, { mustExist: false });
	await runGit(workspace, ["reset", "HEAD", "--", ...paths]);
}

export async function gitDiscardFile(workspace: string, filePath: string): Promise<void> {
	workspacePath(workspace, filePath, { mustExist: false });
	await runGit(workspace, ["checkout", "--", filePath]);
}

export async function gitCommitChanges(workspace: string, message: string): Promise<{ hash: string; summary: string }> {
	const trimmed = message.trim();
	if (!trimmed) throw Object.assign(new Error("Enter a commit message."), { statusCode: 400 });
	const out = await runGit(workspace, ["commit", "-m", trimmed]);
	const hash = (await runGit(workspace, ["rev-parse", "--short", "HEAD"])).trim();
	return { hash, summary: out.trim() };
}
