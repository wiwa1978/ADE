import { execFile } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { GitFileChange, WorkspaceEntry, WorkspaceGitSummary } from "../packages/protocol/index.ts";
import { workspacePath } from "./coding-tools.ts";
import { isErrorCode, logger } from "./log.ts";
import { badRequest, internalError, payloadTooLarge } from "./http-error.ts";

export type { GitFileChange, WorkspaceEntry, WorkspaceGitSummary };

const execFileAsync = promisify(execFile);

const SKIP_EXPLORER = new Set([".git", "node_modules"]);
const SKIP_ARTEFACT_WALK = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".next",
	".nuxt",
	"__pycache__",
	".venv",
	"venv",
	".cache",
	"coverage",
	".claude",
	"target",
]);

const MIME_BY_EXT: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif",
	svg: "image/svg+xml",
	pdf: "application/pdf",
	html: "text/html; charset=utf-8",
	htm: "text/html; charset=utf-8",
	md: "text/markdown; charset=utf-8",
	mdx: "text/markdown; charset=utf-8",
	markdown: "text/markdown; charset=utf-8",
	txt: "text/plain; charset=utf-8",
	log: "text/plain; charset=utf-8",
	csv: "text/csv; charset=utf-8",
	json: "application/json; charset=utf-8",
	xml: "application/xml; charset=utf-8",
	py: "text/x-python; charset=utf-8",
	ts: "text/typescript; charset=utf-8",
	tsx: "text/typescript; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	jsx: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	cjs: "text/javascript; charset=utf-8",
	css: "text/css; charset=utf-8",
	scss: "text/css; charset=utf-8",
	yml: "text/yaml; charset=utf-8",
	yaml: "text/yaml; charset=utf-8",
	sh: "text/x-shellscript; charset=utf-8",
	zsh: "text/x-shellscript; charset=utf-8",
	bash: "text/x-shellscript; charset=utf-8",
	sql: "text/x-sql; charset=utf-8",
	rs: "text/x-rust; charset=utf-8",
	go: "text/x-go; charset=utf-8",
};

const LANG_BY_EXT: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	mjs: "javascript",
	cjs: "javascript",
	json: "json",
	css: "css",
	scss: "scss",
	less: "less",
	html: "html",
	htm: "html",
	xml: "xml",
	svg: "xml",
	md: "markdown",
	mdx: "markdown",
	markdown: "markdown",
	py: "python",
	rs: "rust",
	go: "go",
	java: "java",
	kt: "kotlin",
	c: "c",
	h: "c",
	cpp: "cpp",
	hpp: "cpp",
	rb: "ruby",
	php: "php",
	swift: "swift",
	sh: "bash",
	zsh: "bash",
	bash: "bash",
	yml: "yaml",
	yaml: "yaml",
	toml: "toml",
	sql: "sql",
	csv: "csv",
	ini: "ini",
	env: "bash",
	txt: "text",
};

export function detectMimeType(relPath: string): string {
	const ext = extname(relPath).slice(1).toLowerCase();
	return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export type WorkspaceFlatFile = {
	path: string;
	name: string;
	ext: string;
	size: number;
	modifiedAt: number;
	mimeType: string;
};

export function listWorkspaceFilesFlat(root: string, maxFiles = 300): WorkspaceFlatFile[] {
	const results: WorkspaceFlatFile[] = [];
	const queue: string[] = [root];
	let visitedDirs = 0;

	while (queue.length > 0 && visitedDirs < 600 && results.length < maxFiles * 2) {
		const dir = queue.shift()!;
		visitedDirs++;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) {
				if (SKIP_ARTEFACT_WALK.has(entry.name)) continue;
				queue.push(join(dir, entry.name));
				continue;
			}
			if (!entry.isFile()) continue;
			const full = join(dir, entry.name);
			let stat;
			try {
				stat = statSync(full);
			} catch {
				continue;
			}
			const rel = relative(root, full).replace(/\\/g, "/");
			const ext = extname(entry.name).slice(1).toLowerCase();
			results.push({
				path: rel,
				name: entry.name,
				ext,
				size: stat.size,
				modifiedAt: Math.round(stat.mtimeMs),
				mimeType: detectMimeType(rel),
			});
		}
	}

	results.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path));
	return results.slice(0, maxFiles);
}

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
			} catch (error) {
				// File may disappear or become inaccessible between readdir and stat.
				if (!isErrorCode(error, "ENOENT", "EACCES", "EPERM")) {
					logger.debug("Could not stat workspace file during directory listing", { error, context: { path: full } });
				}
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

export function readWorkspaceFile(root: string, relPath: string): { path: string; content: string; language: string; size: number; binary: boolean; mimeType: string } {
	const full = workspacePath(root, relPath, { mustExist: true });
	const stat = lstatSync(full);
	if (!stat.isFile()) throw badRequest("Path is not a file.");
	const mimeType = detectMimeType(relPath);
	const isPreviewableBinary = mimeType.startsWith("image/") || mimeType === "application/pdf";
	const maxSize = isPreviewableBinary ? 15_000_000 : 2_000_000;
	if (stat.size > maxSize) throw payloadTooLarge(`File is too large to open (${isPreviewableBinary ? ">15MB" : ">2MB"}).`);
	const ext = extname(relPath).slice(1).toLowerCase();
	const isSvg = ext === "svg";
	if (isPreviewableBinary && !isSvg) {
		return {
			path: relPath.replace(/\\/g, "/"),
			content: "",
			language: ext || "binary",
			size: stat.size,
			binary: true,
			mimeType,
		};
	}
	const buf = readFileSync(full);
	let binary = false;
	for (let i = 0; i < Math.min(buf.length, 4096); i++) {
		if (buf[i] === 0) {
			binary = true;
			break;
		}
	}
	return {
		path: relPath.replace(/\\/g, "/"),
		content: binary ? "" : buf.toString("utf8"),
		language: LANG_BY_EXT[ext] ?? "text",
		size: stat.size,
		binary,
		mimeType,
	};
}

export function readWorkspaceFileRaw(root: string, relPath: string): { path: string; buffer: Buffer; mimeType: string; size: number } {
	const full = workspacePath(root, relPath, { mustExist: true });
	const stat = lstatSync(full);
	if (!stat.isFile()) throw badRequest("Path is not a file.");
	if (stat.size > 20_000_000) throw payloadTooLarge("File is too large to preview (>20MB).");
	const buffer = readFileSync(full);
	return {
		path: relPath.replace(/\\/g, "/"),
		buffer,
		mimeType: detectMimeType(relPath),
		size: stat.size,
	};
}

export function writeWorkspaceFile(root: string, relPath: string, content: string): { path: string; size: number } {
	if (typeof content !== "string") throw badRequest("Content must be a string.");
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
			} catch (error) {
				// An unborn repository (no HEAD commit yet) fails `git diff --cached --numstat`; log any other error.
				const stderr = String((error as { stderr?: unknown })?.stderr ?? "");
				if (!/bad revision|unknown revision|ambiguous argument 'HEAD'/i.test(stderr)) {
					logger.debug("git diff --numstat failed", { error, context: { workspace, diffArgs } });
				}
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
				} catch (error) {
					if (!isErrorCode(error, "ENOENT", "EACCES", "EPERM")) {
						logger.debug("Could not count lines for untracked file", { error, context: { workspace, path: item.path } });
					}
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
	} catch (error) {
		const stderr = String((error as { stderr?: unknown })?.stderr ?? "");
		if (!/not a git repository/i.test(stderr) && !isErrorCode(error, "ENOENT")) {
			logger.warn("git status failed for workspace", { error, context: { workspace } });
		}
		return { isGitRepo: false, branch: null, ahead: 0, behind: 0, additions: 0, deletions: 0, files: [] };
	}
}

export async function getWorkspaceFileDiff(workspace: string, filePath: string, staged = false): Promise<string> {
	workspacePath(workspace, filePath, { mustExist: false });
	const args = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
	let out: string;
	try {
		out = await runGit(workspace, args);
	} catch (error) {
		logger.warn("git diff failed for workspace file", { error, context: { workspace, filePath, staged } });
		throw internalError(`Could not load Git diff for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (out.trim()) return out;
	// Check if untracked file — synthesize unified diff
	try {
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
	} catch (error) {
		// Deleted or non-existent file simply has no untracked content to synthesize.
		if (isErrorCode(error, "ENOENT") || (error instanceof Error && /does not exist|not found/i.test(error.message))) {
			return "";
		}
		logger.warn("Could not read untracked file for diff synthesis", { error, context: { workspace, filePath } });
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
	if (!trimmed) throw badRequest("Enter a commit message.");
	const out = await runGit(workspace, ["commit", "-m", trimmed]);
	const hash = (await runGit(workspace, ["rev-parse", "--short", "HEAD"])).trim();
	return { hash, summary: out.trim() };
}
