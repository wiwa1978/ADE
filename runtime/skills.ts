import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import { isErrorCode, logger } from "./log.ts";

export type SkillSummary = {
	name: string;
	description: string;
	path: string;
	scope: "global" | "workspace";
};

export type RuleSummary = {
	name: string;
	path: string;
	scope: "global" | "workspace";
	content: string;
};

export type SlashCommandSummary = {
	name: string;
	description: string;
	prompt: string;
	scope: "builtin" | "global" | "workspace";
};

export type SkillsAndRulesCatalog = {
	skills: SkillSummary[];
	rules: RuleSummary[];
	commands: SlashCommandSummary[];
};

const BUILTIN_COMMANDS: SlashCommandSummary[] = [
	{
		name: "plan",
		description: "Analyze the request and write an Implementation Plan artifact before editing code",
		prompt: "First analyze the codebase and create a concise Implementation Plan artifact using write_artifact (kind='plan', requestApproval=true) plus update_tasks. Do not edit files until the plan is ready.",
		scope: "builtin",
	},
	{
		name: "compact",
		description: "Compact conversation history to save context window tokens",
		prompt: "__ADE_COMPACT__",
		scope: "builtin",
	},
	{
		name: "review",
		description: "Review current Git changes in the workspace and report issues or improvements",
		prompt: "Inspect the current workspace changes (git diff / modified files) and provide a structured code review highlighting bugs, regressions, edge cases, and suggestions.",
		scope: "builtin",
	},
	{
		name: "subagent",
		description: "Delegate parallel work to one or more subagents",
		prompt: "Break this request into clear sub-tasks and use spawn_subagent (with background=true when independent) to run focused subagents in parallel, then synthesize their results.",
		scope: "builtin",
	},
	{
		name: "browser",
		description: "Open and inspect a web page or local dev server in the built-in browser",
		prompt: "Use the built-in browser tools (browser_navigate, browser_snapshot, browser_screenshot) to inspect and verify the target page.",
		scope: "builtin",
	},
];

function isInsideRoot(canonicalRoot: string, candidate: string): boolean {
	const rel = relative(canonicalRoot, candidate);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** Verify no path segment between rootDir and targetPath is a symlink, and realpath stays inside rootDir. */
function resolveSafePath(rootDir: string, targetPath: string): string | null {
	let canonicalRoot: string;
	try {
		canonicalRoot = realpathSync(rootDir);
	} catch {
		return null;
	}
	const relFromCanonical = relative(canonicalRoot, targetPath);
	const rel =
		relFromCanonical === "" || (!isAbsolute(relFromCanonical) && relFromCanonical !== ".." && !relFromCanonical.startsWith(`..${sep}`))
			? relFromCanonical
			: relative(rootDir, targetPath);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return null;
	const parts = rel.split(sep).filter(Boolean);
	let current = canonicalRoot;
	for (const part of parts) {
		current = join(current, part);
		try {
			if (lstatSync(current).isSymbolicLink()) return null;
		} catch {
			return null;
		}
	}
	try {
		const realTarget = realpathSync(current);
		if (!isInsideRoot(canonicalRoot, realTarget)) return null;
		return realTarget;
	} catch {
		return null;
	}
}

function safeReadFile(rootDir: string, targetPath: string, maxBytes = 128_000): { realPath: string; content: string } | null {
	const realPath = resolveSafePath(rootDir, targetPath);
	if (!realPath) return null;
	try {
		const st = lstatSync(realPath);
		if (st.isSymbolicLink() || !st.isFile() || st.size > maxBytes) return null;
		return { realPath, content: readFileSync(realPath, "utf8") };
	} catch {
		return null;
	}
}

function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
	if (!match) return { body: raw };
	const meta: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const k = line.slice(0, idx).trim().toLowerCase();
		const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
		meta[k] = v;
	}
	return { name: meta.name, description: meta.description, body: match[2] };
}

function scanSkillsDir(rootDir: string, dir: string, scope: "global" | "workspace"): SkillSummary[] {
	const safeDir = resolveSafePath(rootDir, dir);
	if (!safeDir) return [];
	const results: SkillSummary[] = [];
	try {
		for (const entry of readdirSync(safeDir, { withFileTypes: true })) {
			if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
			const skillFile = join(safeDir, entry.name, "SKILL.md");
			if (!existsSync(skillFile)) continue;
			try {
				const loaded = safeReadFile(rootDir, skillFile, 256_000);
				if (!loaded) continue;
				const parsed = parseFrontmatter(loaded.content);
				results.push({
					name: parsed.name || entry.name,
					description: parsed.description || parsed.body.trim().split("\n")[0]?.slice(0, 160) || "Custom skill",
					path: loaded.realPath,
					scope,
				});
			} catch (error) {
				logger.warn("Skipped unreadable skill file", { error, context: { skillFile, scope } });
			}
		}
	} catch (error) {
		if (!isErrorCode(error, "ENOENT", "EACCES")) {
			logger.warn("Could not scan skills directory", { error, context: { dir, scope } });
		}
	}
	return results;
}

function scanRules(workspace?: string | null): RuleSummary[] {
	const rules: RuleSummary[] = [];
	const homeAde = join(homedir(), ".ade");
	const sources: { rootDir: string; dir?: string; file?: string; scope: "global" | "workspace" }[] = [
		{ rootDir: homeAde, dir: join(homeAde, "rules"), scope: "global" },
	];
	if (workspace) {
		sources.push(
			{ rootDir: workspace, file: join(workspace, "AGENTS.md"), scope: "workspace" },
			{ rootDir: workspace, file: join(workspace, "CLAUDE.md"), scope: "workspace" },
			{ rootDir: workspace, dir: join(workspace, ".ade", "rules"), scope: "workspace" },
			{ rootDir: workspace, dir: join(workspace, ".agents", "rules"), scope: "workspace" },
		);
	}
	const seen = new Set<string>();
	for (const src of sources) {
		if (src.file && existsSync(src.file) && !seen.has(src.file)) {
			seen.add(src.file);
			try {
				const loaded = safeReadFile(src.rootDir, src.file, 64_000);
				if (loaded) {
					rules.push({
						name: basename(src.file),
						path: loaded.realPath,
						scope: src.scope,
						content: loaded.content.slice(0, 8000),
					});
				}
			} catch (error) {
				logger.warn("Skipped unreadable rules file", { error, context: { file: src.file, scope: src.scope } });
			}
		}
		if (src.dir) {
			const safeDir = resolveSafePath(src.rootDir, src.dir);
			if (!safeDir) continue;
			try {
				for (const entry of readdirSync(safeDir, { withFileTypes: true })) {
					if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith(".md")) continue;
					const full = join(safeDir, entry.name);
					if (seen.has(full)) continue;
					seen.add(full);
					const loaded = safeReadFile(src.rootDir, full, 64_000);
					if (!loaded) continue;
					rules.push({
						name: entry.name.replace(/\.md$/i, ""),
						path: loaded.realPath,
						scope: src.scope,
						content: loaded.content.slice(0, 6000),
					});
				}
			} catch (error) {
				if (!isErrorCode(error, "ENOENT", "EACCES")) {
					logger.warn("Could not scan rules directory", { error, context: { dir: src.dir, scope: src.scope } });
				}
			}
		}
	}
	return rules;
}

function scanCommands(workspace?: string | null): SlashCommandSummary[] {
	const map = new Map<string, SlashCommandSummary>();
	for (const cmd of BUILTIN_COMMANDS) map.set(cmd.name, cmd);
	const homeAde = join(homedir(), ".ade");
	const dirs: { rootDir: string; dir: string; scope: "global" | "workspace" }[] = [
		{ rootDir: homeAde, dir: join(homeAde, "commands"), scope: "global" },
	];
	if (workspace) {
		dirs.push(
			{ rootDir: workspace, dir: join(workspace, ".ade", "commands"), scope: "workspace" },
			{ rootDir: workspace, dir: join(workspace, ".agents", "commands"), scope: "workspace" },
		);
	}
	for (const { rootDir, dir, scope } of dirs) {
		const safeDir = resolveSafePath(rootDir, dir);
		if (!safeDir) continue;
		try {
			for (const entry of readdirSync(safeDir, { withFileTypes: true })) {
				if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith(".md")) continue;
				const loaded = safeReadFile(rootDir, join(safeDir, entry.name), 64_000);
				if (!loaded) continue;
				const parsed = parseFrontmatter(loaded.content);
				const name = (parsed.name || entry.name.replace(/\.md$/i, "")).toLowerCase().replace(/[^a-z0-9-_]/g, "-");
				map.set(name, {
					name,
					description: parsed.description || "Custom slash command",
					prompt: parsed.body.trim(),
					scope,
				});
			}
		} catch (error) {
			if (!isErrorCode(error, "ENOENT", "EACCES")) {
				logger.warn("Could not scan custom commands directory", { error, context: { dir, scope } });
			}
		}
	}
	return [...map.values()];
}

export function discoverSkillsAndRules(workspace?: string | null): SkillsAndRulesCatalog {
	const homeAde = join(homedir(), ".ade");
	const skillsMap = new Map<string, SkillSummary>();
	for (const skill of scanSkillsDir(homeAde, join(homeAde, "skills"), "global")) {
		skillsMap.set(skill.name, skill);
	}
	if (workspace) {
		for (const dir of [join(workspace, ".ade", "skills"), join(workspace, ".agents", "skills")]) {
			for (const skill of scanSkillsDir(workspace, dir, "workspace")) {
				skillsMap.set(skill.name, skill);
			}
		}
	}
	return {
		skills: [...skillsMap.values()],
		rules: scanRules(workspace),
		commands: scanCommands(workspace),
	};
}

export function buildSkillsAndRulesPrompt(catalog: SkillsAndRulesCatalog): string {
	const sections: string[] = [];
	if (catalog.rules.length) {
		sections.push(
			"## Workspace & User Rules\n" +
			catalog.rules.map(r => `### ${r.name} (${r.scope})\n${r.content.trim()}`).join("\n\n"),
		);
	}
	if (catalog.skills.length) {
		sections.push(
			"## Available Skills (call read_skill with the skill name to load full instructions)\n" +
			catalog.skills.map(s => `- ${s.name} (${s.scope}): ${s.description}`).join("\n"),
		);
	}
	return sections.join("\n\n");
}

export function createSkillsExtension(workspace?: string | null) {
	const readSkill = defineTool({
		name: "read_skill",
		description: "Load the full SKILL.md instructions for an available skill by name.",
		parameters: obj({ name: str({ description: "Skill name" }) }),
		replay: "safe",
		async execute(args) {
			const catalog = discoverSkillsAndRules(workspace);
			const match = catalog.skills.find(s => s.name.toLowerCase() === args.name.trim().toLowerCase());
			if (!match) {
				const names = catalog.skills.map(s => s.name).join(", ") || "(none)";
				throw new Error(`Skill "${args.name}" not found. Available skills: ${names}`);
			}
			const rootDir = match.scope === "workspace" && workspace ? workspace : join(homedir(), ".ade");
			const loaded = safeReadFile(rootDir, match.path, 256_000);
			if (!loaded) {
				throw new Error(`Skill "${args.name}" is unavailable or points outside its allowed directory.`);
			}
			return { output: [{ type: "text", text: loaded.content.slice(0, 24_000) }] };
		},
	});

	return defineExtension({
		name: "ade-skills",
		tools: [readSkill],
	});
}
