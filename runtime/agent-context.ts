// What agents see beyond the prompt: files the user points at with @, and the instruction files
// (AGENTS.md, CLAUDE.md) that agents read at the start of every session.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { badRequest } from "./http-error.ts";

const execute = promisify(execFile);

/** Instruction files ADE lets you edit, and which agents read them. */
export const instructionFiles = [
	{ name: "AGENTS.md", readBy: "Codex, the ADE agent and most other agents" },
	{ name: "CLAUDE.md", readBy: "Claude Code" },
] as const;

export type InstructionFileName = (typeof instructionFiles)[number]["name"];

const MAX_INSTRUCTIONS = 200_000;

export function readInstructions(repository: string) {
	return instructionFiles.map(file => {
		const path = join(repository, file.name);
		const exists = existsSync(path);
		return { ...file, exists, content: exists ? readFileSync(path, "utf8").slice(0, MAX_INSTRUCTIONS) : "" };
	});
}

export function writeInstructions(repository: string, name: unknown, content: unknown) {
	const file = instructionFiles.find(item => item.name === name);
	if (!file) throw badRequest(`Only ${instructionFiles.map(item => item.name).join(" and ")} can be edited here.`);
	if (typeof content !== "string" || content.length > MAX_INSTRUCTIONS) throw badRequest("Instructions must be text under 200 KB.");
	writeFileSync(join(repository, file.name), content.endsWith("\n") || !content ? content : `${content}\n`);
	return readInstructions(repository);
}

/** Files in a workspace (tracked and untracked, honoring .gitignore), cached briefly per workspace. */
const fileCache = new Map<string, { at: number; files: string[] }>();

async function workspaceFiles(cwd: string): Promise<string[]> {
	const cached = fileCache.get(cwd);
	if (cached && Date.now() - cached.at < 15_000) return cached.files;
	let files: string[] = [];
	try {
		const { stdout } = await execute("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 15000, windowsHide: true });
		files = [...new Set(stdout.split("\0").filter(Boolean))];
	} catch {
		files = [];
	}
	fileCache.set(cwd, { at: Date.now(), files });
	return files;
}

/**
 * Rank paths for an @-mention query: every query character must appear in order; matches in the
 * file name, at word starts, and close together rank higher; shorter paths break ties.
 */
export function rankFiles(files: string[], query: string, limit = 30): string[] {
	const q = query.trim().toLowerCase();
	if (!q) return files.filter(file => !file.includes("/")).concat(files.filter(file => file.includes("/"))).slice(0, limit);
	const scored: Array<{ file: string; score: number }> = [];
	for (const file of files) {
		const lower = file.toLowerCase();
		const nameStart = lower.lastIndexOf("/") + 1;
		let score = 0;
		let position = -1;
		let ok = true;
		for (const char of q) {
			const next = lower.indexOf(char, position + 1);
			if (next < 0) { ok = false; break; }
			if (next === position + 1) score += 3;
			if (next >= nameStart) score += 2;
			if (next === nameStart || "/-_.".includes(lower[next - 1] ?? "/")) score += 4;
			position = next;
		}
		if (!ok) continue;
		if (lower.slice(nameStart).startsWith(q)) score += 20;
		if (lower.includes(q)) score += 10;
		scored.push({ file, score: score - file.length * 0.05 });
	}
	return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.file);
}

export async function searchWorkspaceFiles(cwd: string, query: string) {
	return rankFiles(await workspaceFiles(cwd), query);
}
