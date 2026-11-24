import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import { isErrorCode, logger } from "./log.ts";
import { effectiveSkills, parseFrontmatter, scanSkillLandscape } from "./skill-catalog.ts";

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
		name: "swarm",
		description: "Run a coordinated multi-agent swarm with Goal, Threads, shared Board, and parallel workers",
		prompt: "Coordinate this request in Swarm mode: 1) Call team_overview (action='set_goal') with a concise title, goalTitle, and goalSummary, and create 2–4 workstream threads via team_overview (action='thread'). 2) Add concrete tasks via team_tasks (linked to threadId with clear owners and dependencies). 3) Spawn parallel workers using spawn_subagent (background=true; mode='worktree' for independent code changes or 'readonly' for audits). 4) Keep live progress visible with team_focus, coordinate on team_post/team_read, verify changes, and synthesize the final result.",
		scope: "builtin",
	},
	{
		name: "browser",
		description: "Open and inspect a web page or local dev server in the built-in browser",
		prompt: "Use the built-in browser tools (browser_navigate, browser_snapshot, browser_screenshot) to inspect and verify the target page.",
		scope: "builtin",
	},
];

function scanRules(workspace?: string | null): RuleSummary[] {
	const rules: RuleSummary[] = [];
	const home = homedir();
	const sources: { dir?: string; file?: string; scope: "global" | "workspace" }[] = [
		{ dir: join(home, ".ade", "rules"), scope: "global" },
	];
	if (workspace) {
		sources.push(
			{ file: join(workspace, "AGENTS.md"), scope: "workspace" },
			{ file: join(workspace, "CLAUDE.md"), scope: "workspace" },
			{ dir: join(workspace, ".ade", "rules"), scope: "workspace" },
			{ dir: join(workspace, ".agents", "rules"), scope: "workspace" },
		);
	}
	const seen = new Set<string>();
	for (const src of sources) {
		if (src.file && existsSync(src.file) && !seen.has(src.file)) {
			seen.add(src.file);
			try {
				const stat = statSync(src.file);
				if (stat.isFile() && stat.size < 64_000) {
					rules.push({
						name: basename(src.file),
						path: src.file,
						scope: src.scope,
						content: readFileSync(src.file, "utf8").slice(0, 8000),
					});
				}
			} catch (error) {
				logger.warn("Skipped unreadable rules file", { error, context: { file: src.file, scope: src.scope } });
			}
		}
		if (src.dir && existsSync(src.dir)) {
			try {
				for (const entry of readdirSync(src.dir, { withFileTypes: true })) {
					if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
					const full = join(src.dir, entry.name);
					if (seen.has(full)) continue;
					seen.add(full);
					rules.push({
						name: entry.name.replace(/\.md$/i, ""),
						path: full,
						scope: src.scope,
						content: readFileSync(full, "utf8").slice(0, 6000),
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
	const dirs: { dir: string; scope: "global" | "workspace" }[] = [
		{ dir: join(homedir(), ".ade", "commands"), scope: "global" },
	];
	if (workspace) {
		dirs.push(
			{ dir: join(workspace, ".ade", "commands"), scope: "workspace" },
			{ dir: join(workspace, ".agents", "commands"), scope: "workspace" },
		);
	}
	for (const { dir, scope } of dirs) {
		if (!existsSync(dir)) continue;
		try {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
				const raw = readFileSync(join(dir, entry.name), "utf8");
				const parsed = parseFrontmatter(raw);
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

export type SkillFilter = (name: string) => boolean;

/**
 * The skills, rules and slash commands a session sees. Skills come from the whole landscape
 * (see skill-catalog.ts): one per name, and only those that are on (`isActive`).
 */
export function discoverSkillsAndRules(workspace?: string | null, isActive: SkillFilter = () => true): SkillsAndRulesCatalog {
	const skills = effectiveSkills(scanSkillLandscape({ workspace }))
		.filter(skill => isActive(skill.name))
		.map(skill => ({ name: skill.name, description: skill.description, path: skill.path, scope: skill.scope }));
	return {
		skills,
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

export function createSkillsExtension(workspace?: string | null, isActive: SkillFilter = () => true) {
	const readSkill = defineTool({
		name: "read_skill",
		description: "Load the full SKILL.md instructions for an available skill by name.",
		parameters: obj({ name: str({ description: "Skill name" }) }),
		replay: "safe",
		async execute(args) {
			// Checked on every call, so turning a skill off applies straight away.
			const catalog = discoverSkillsAndRules(workspace, isActive);
			const match = catalog.skills.find(s => s.name.toLowerCase() === args.name.trim().toLowerCase());
			if (!match) {
				const names = catalog.skills.map(s => s.name).join(", ") || "(none)";
				throw new Error(`Skill "${args.name}" not found. Available skills: ${names}`);
			}
			const content = readFileSync(match.path, "utf8");
			return { output: [{ type: "text", text: content.slice(0, 24_000) }] };
		},
	});

	return defineExtension({
		name: "ade-skills",
		tools: [readSkill],
	});
}
