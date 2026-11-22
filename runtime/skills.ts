import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";

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

function scanSkillsDir(dir: string, scope: "global" | "workspace"): SkillSummary[] {
	if (!existsSync(dir)) return [];
	const results: SkillSummary[] = [];
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const skillFile = join(dir, entry.name, "SKILL.md");
			if (!existsSync(skillFile)) continue;
			try {
				const raw = readFileSync(skillFile, "utf8");
				const parsed = parseFrontmatter(raw);
				results.push({
					name: parsed.name || entry.name,
					description: parsed.description || parsed.body.trim().split("\n")[0]?.slice(0, 160) || "Custom skill",
					path: skillFile,
					scope,
				});
			} catch {
				// skip unreadable skill
			}
		}
	} catch {
		// ignore
	}
	return results;
}

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
			} catch {
				// ignore
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
			} catch {
				// ignore
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
		} catch {
			// ignore
		}
	}
	return [...map.values()];
}

export function discoverSkillsAndRules(workspace?: string | null): SkillsAndRulesCatalog {
	const home = homedir();
	const skillsMap = new Map<string, SkillSummary>();
	for (const skill of scanSkillsDir(join(home, ".ade", "skills"), "global")) {
		skillsMap.set(skill.name, skill);
	}
	if (workspace) {
		for (const dir of [join(workspace, ".ade", "skills"), join(workspace, ".agents", "skills")]) {
			for (const skill of scanSkillsDir(dir, "workspace")) {
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
			const content = readFileSync(match.path, "utf8");
			return { output: [{ type: "text", text: content.slice(0, 24_000) }] };
		},
	});

	return defineExtension({
		name: "ade-skills",
		tools: [readSkill],
	});
}
