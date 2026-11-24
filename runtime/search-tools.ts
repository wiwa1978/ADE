import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { bool, int, obj, opt, str } from "@earendil-works/pi-schema";
import { workspacePath } from "./coding-tools.ts";
import { isErrorCode, logger } from "./log.ts";

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "target", ".next", ".turbo", ".cache", "__pycache__"]);

function isBinaryBuffer(buf: Buffer): boolean {
	const check = Math.min(buf.length, 4096);
	for (let i = 0; i < check; i++) {
		if (buf[i] === 0) return true;
	}
	return false;
}

function globToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "__DOUBLE_STAR__")
		.replace(/\*/g, "[^/]*")
		.replace(/__DOUBLE_STAR__/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`(^|/)${escaped}$`, "i");
}

async function walkFiles(dir: string, maxFiles: number, acc: string[] = []): Promise<string[]> {
	if (acc.length >= maxFiles) return acc;
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return acc;
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (acc.length >= maxFiles) break;
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			await walkFiles(join(dir, entry.name), maxFiles, acc);
		} else if (entry.isFile()) {
			acc.push(join(dir, entry.name));
		}
	}
	return acc;
}

export async function runWorkspaceGrep(root: string, opts: {
	query: string;
	path?: string;
	isRegex?: boolean;
	caseSensitive?: boolean;
	maxResults?: number;
}): Promise<string> {
	const searchRoot = opts.path ? workspacePath(root, opts.path, { mustExist: true }) : root;
	const maxResults = Math.min(Math.max(opts.maxResults ?? 60, 1), 200);

	// Try ripgrep first if available. Always terminate options with "--" so a query like "--pre=..."
	// can never be interpreted as an rg CLI flag.
	try {
		const args = [
			"--line-number",
			"--no-heading",
			"--color=never",
			"--max-count", "20",
			"--glob", "!.git",
			"--glob", "!node_modules",
		];
		if (!opts.caseSensitive) args.push("--ignore-case");
		if (!opts.isRegex) args.push("--fixed-strings");
		args.push("--", opts.query, searchRoot);
		const { stdout } = await execFileAsync("rg", args, {
			cwd: root,
			maxBuffer: 2 * 1024 * 1024,
			timeout: 10_000,
		});
		const lines = stdout.trim().split("\n").filter(Boolean);
		const formatted = lines.slice(0, maxResults).map(line => {
			const rel = line.startsWith(root) ? line.slice(root.length + 1) : line;
			return rel.length > 260 ? `${rel.slice(0, 260)}…` : rel;
		});
		if (!formatted.length) return "No matches found.";
		return formatted.join("\n") + (lines.length > maxResults ? `\n[Truncated: showing ${maxResults} of ${lines.length} matches]` : "");
	} catch (error) {
		if ((error as { code?: unknown })?.code === 1) return "No matches found.";
		// Fall through to pure Node search if rg is not installed
	}

	let matcher: RegExp;
	try {
		const flags = opts.caseSensitive ? "" : "i";
		matcher = opts.isRegex
			? new RegExp(opts.query, flags)
			: new RegExp(opts.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
	} catch (err) {
		throw new Error(`Invalid search pattern: ${err instanceof Error ? err.message : String(err)}`);
	}

	const rootStat = await stat(searchRoot);
	const files = rootStat.isFile() ? [searchRoot] : await walkFiles(searchRoot, 2500);
	const matches: string[] = [];
	for (const file of files) {
		if (matches.length >= maxResults) break;
		try {
			const fileStat = await stat(file);
			if (fileStat.size > 1_500_000) continue;
			const buf = await readFile(file);
			if (isBinaryBuffer(buf)) continue;
			const lines = buf.toString("utf8").split("\n");
			const rel = relative(root, file).replace(/\\/g, "/");
			let perFile = 0;
			for (let i = 0; i < lines.length; i++) {
				if (matcher.test(lines[i])) {
					const preview = lines[i].trim().slice(0, 220);
					matches.push(`${rel}:${i + 1}: ${preview}`);
					perFile++;
					if (matches.length >= maxResults || perFile >= 15) break;
				}
			}
		} catch (error) {
			// Skip files that vanish or lack read permissions during workspace grep.
			if (!isErrorCode(error, "ENOENT", "EACCES", "EPERM", "EISDIR")) {
				logger.debug("Skipped unreadable file during workspace grep", { error, context: { file } });
			}
		}
	}
	if (!matches.length) return "No matches found.";
	return matches.join("\n") + (matches.length >= maxResults ? `\n[Truncated at ${maxResults} matches]` : "");
}

export async function runWorkspaceFind(root: string, opts: { pattern: string; path?: string; maxResults?: number }): Promise<string> {
	const searchRoot = opts.path ? workspacePath(root, opts.path, { mustExist: true }) : root;
	const maxResults = Math.min(Math.max(opts.maxResults ?? 100, 1), 300);
	const files = await walkFiles(searchRoot, 5000);
	const regex = opts.pattern.includes("*") || opts.pattern.includes("?")
		? globToRegex(opts.pattern)
		: new RegExp(opts.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
	const matches: string[] = [];
	for (const file of files) {
		const rel = relative(root, file).replace(/\\/g, "/");
		if (regex.test(rel)) {
			matches.push(rel);
			if (matches.length >= maxResults) break;
		}
	}
	if (!matches.length) return "No files matched.";
	return matches.join("\n") + (matches.length >= maxResults ? `\n[Truncated at ${maxResults} results]` : "");
}

export function createSearchTools(root: string, identity: { dev: string; ino: string }) {
	const verifyWorkspace = async () => {
		const info = await stat(root, { bigint: true });
		if (String(info.dev) !== identity.dev || String(info.ino) !== identity.ino) {
			throw new Error("The task workspace has changed or been replaced.");
		}
	};

	const grepTool = defineTool({
		name: "grep_search",
		description: "Search for text or regex patterns across files in the workspace. Returns relative file paths, line numbers, and matching lines.",
		parameters: obj({
			query: str({ description: "Search string or regular expression" }),
			path: opt(str({ description: "Optional workspace-relative subdirectory or file to search within" })),
			isRegex: opt(bool({ description: "Treat query as a regular expression (default false)" })),
			caseSensitive: opt(bool({ description: "Case-sensitive search (default false)" })),
			maxResults: opt(int({ description: "Maximum number of matches to return (default 60)" })),
		}),
		replay: "safe",
		async execute(args) {
			await verifyWorkspace();
			const result = await runWorkspaceGrep(root, args);
			return { output: [{ type: "text", text: result }] };
		},
	});

	const findTool = defineTool({
		name: "find_files",
		description: "Find files in the workspace by name substring or glob pattern (e.g. '*.tsx', 'src/**/*.ts').",
		parameters: obj({
			pattern: str({ description: "Filename substring or glob pattern" }),
			path: opt(str({ description: "Optional workspace-relative subdirectory" })),
			maxResults: opt(int({ description: "Maximum number of files to return (default 100)" })),
		}),
		replay: "safe",
		async execute(args) {
			await verifyWorkspace();
			const result = await runWorkspaceFind(root, args);
			return { output: [{ type: "text", text: result }] };
		},
	});

	return defineExtension({
		name: "ade-search",
		tools: [grepTool, findTool],
	});
}
