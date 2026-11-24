import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { logger } from "./log.ts";

/**
 * The skill landscape of this environment: every SKILL.md ADE can find, where it lives and
 * where it came from. Each environment (this computer, an SSH host) runs its own runtime, so
 * this always describes the machine the runtime is on.
 */

export type SkillOriginKind = "project" | "git" | "ade" | "tool";

export type SkillOrigin = {
	kind: SkillOriginKind;
	/** Human label, e.g. "ADE", "Claude Code", "github.com/acme/skills". */
	label: string;
	/** The folder ADE scanned. */
	root: string;
	/** For skills found in other tools' folders. */
	tool?: string;
	/** For Git sources. */
	sourceId?: string;
	repoUrl?: string;
	ref?: string | null;
	commit?: string | null;
	syncedAt?: number | null;
};

export type CatalogSkill = {
	/** Stable id: origin root + folder. */
	key: string;
	name: string;
	description: string;
	/** Path of SKILL.md. */
	path: string;
	/** Folder of the skill. */
	dir: string;
	scope: "global" | "workspace";
	origin: SkillOrigin;
	bytes: number;
	/** Rough size in tokens (bytes / 4). */
	tokens: number;
	/** Other files next to SKILL.md (scripts, references, assets). */
	extraFiles: number;
	/** Set when another skill with the same name wins; the key of that skill. */
	shadowedBy: string | null;
};

export type GitSkillSourceRef = {
	id: string;
	url: string;
	ref: string | null;
	subpath: string | null;
	dir: string;
	commit: string | null;
	syncedAt: number | null;
};

type Root = { dir: string; depth: number; origin: Omit<SkillOrigin, "root">; scope: "global" | "workspace" };

const RANK: Record<SkillOriginKind, number> = { project: 0, git: 1, ade: 2, tool: 3 };
const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", "dist", "build"]);
const MAX_SKILLS_PER_ROOT = 500;

let sourceProvider: () => GitSkillSourceRef[] = () => [];
let catalogHome: string | null = null;

/** The host tells the catalog which Git sources are installed (avoids a database dependency here) and which home to scan. */
export function configureSkillCatalog(options: { sources: () => GitSkillSourceRef[]; home?: string | null }): void {
	sourceProvider = options.sources;
	catalogHome = options.home ?? null;
}

export function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
	if (!match) return { body: raw };
	const meta: Record<string, string> = {};
	const lines = match[1].split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s/.test(line)) continue;
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const k = line.slice(0, idx).trim().toLowerCase();
		let v = line.slice(idx + 1).trim();
		if (/^[|>][+-]?$/.test(v)) {
			// YAML block scalar: the indented lines below are the value.
			const block: string[] = [];
			while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
			v = block.filter(Boolean).join(v.startsWith("|") ? "\n" : " ");
		}
		meta[k] = v.replace(/^["']|["']$/g, "");
	}
	return { name: meta.name, description: meta.description, body: match[2] };
}

/** Folders that hold a SKILL.md, up to `depth` levels below `dir`. A skill folder isn't searched further. */
export function findSkillDirs(dir: string, depth: number): string[] {
	const found: string[] = [];
	const walk = (current: string, level: number) => {
		if (found.length >= MAX_SKILLS_PER_ROOT) return;
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		if (level > 0 && entries.some(entry => entry.isFile() && entry.name === "SKILL.md")) {
			found.push(current);
			return;
		}
		if (level >= depth) return;
		for (const entry of entries) {
			if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
			walk(join(current, entry.name), level + 1);
		}
	};
	if (existsSync(join(dir, "SKILL.md"))) return [dir];
	walk(dir, 0);
	return found.sort();
}

function shortRepo(url: string): string {
	return url.replace(/^(https?:\/\/|ssh:\/\/|git@)/, "").replace(/^([^/:]+):/, "$1/").replace(/\.git$/, "");
}

export function skillRoots(workspace: string | null | undefined, home = catalogHome ?? homedir(), sources: GitSkillSourceRef[] = sourceProvider()): Root[] {
	const roots: Root[] = [];
	if (workspace) {
		roots.push(
			{ dir: join(workspace, ".ade", "skills"), depth: 2, scope: "workspace", origin: { kind: "project", label: "Project (.ade)" } },
			{ dir: join(workspace, ".agents", "skills"), depth: 2, scope: "workspace", origin: { kind: "project", label: "Project (.agents)" } },
			{ dir: join(workspace, ".claude", "skills"), depth: 2, scope: "workspace", origin: { kind: "project", label: "Project (.claude)", tool: "Claude Code" } },
			{ dir: join(workspace, ".github", "skills"), depth: 2, scope: "workspace", origin: { kind: "project", label: "Project (.github)", tool: "GitHub Copilot" } },
		);
	}
	for (const source of sources) {
		roots.push({
			dir: source.subpath ? join(source.dir, source.subpath) : source.dir,
			depth: 5,
			scope: "global",
			origin: { kind: "git", label: shortRepo(source.url), sourceId: source.id, repoUrl: source.url, ref: source.ref, commit: source.commit, syncedAt: source.syncedAt },
		});
	}
	roots.push({ dir: join(home, ".ade", "skills"), depth: 2, scope: "global", origin: { kind: "ade", label: "ADE" } });
	const tools: [string, string, number][] = [
		["Claude Code", join(home, ".claude", "skills"), 2],
		["Claude Code plugins", join(home, ".claude", "plugins"), 7],
		["Codex", join(home, ".codex", "skills"), 2],
		["Gemini CLI", join(home, ".gemini", "skills"), 2],
		["Gemini CLI extensions", join(home, ".gemini", "extensions"), 4],
		["Antigravity", join(home, ".gemini", "antigravity", "skills"), 2],
		["Cursor", join(home, ".cursor", "skills"), 2],
		["Shared (~/.agents)", join(home, ".agents", "skills"), 2],
	];
	for (const [tool, dir, depth] of tools) roots.push({ dir, depth, scope: "global", origin: { kind: "tool", label: tool, tool } });
	return roots;
}

function readSkill(dir: string, root: Root): CatalogSkill | null {
	const path = join(dir, "SKILL.md");
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = parseFrontmatter(raw);
		const folder = dir.split(sep).pop() ?? dir;
		let extraFiles = 0;
		try {
			extraFiles = readdirSync(dir).filter(name => name !== "SKILL.md" && !name.startsWith(".")).length;
		} catch {
			// unreadable folder: count stays 0
		}
		const bytes = statSync(path).size;
		const rel = relative(root.dir, dir) || ".";
		return {
			key: `${root.origin.kind}:${root.dir}:${rel}`,
			name: (parsed.name || folder).trim(),
			description: (parsed.description || parsed.body.trim().split("\n")[0]?.slice(0, 160) || "Custom skill").trim(),
			path,
			dir,
			scope: root.scope,
			origin: { ...root.origin, root: root.dir },
			bytes,
			tokens: Math.ceil(bytes / 4),
			extraFiles,
			shadowedBy: null,
		};
	} catch (error) {
		logger.warn("Skipped unreadable skill file", { error, context: { path } });
		return null;
	}
}

/**
 * Every skill in this environment (plus the workspace's own), including shadowed copies.
 * When two skills share a name: project beats Git source beats ADE beats other tools.
 */
export function scanSkillLandscape(options: { workspace?: string | null; home?: string; sources?: GitSkillSourceRef[] } = {}): CatalogSkill[] {
	const roots = skillRoots(options.workspace, options.home, options.sources);
	const skills: CatalogSkill[] = [];
	const seenDirs = new Set<string>();
	for (const root of roots) {
		if (!existsSync(root.dir)) continue;
		for (const dir of findSkillDirs(root.dir, root.depth)) {
			if (seenDirs.has(dir)) continue;
			seenDirs.add(dir);
			const skill = readSkill(dir, root);
			if (skill) skills.push(skill);
		}
	}
	const winners = new Map<string, CatalogSkill>();
	const ordered = [...skills].sort((a, b) => RANK[a.origin.kind] - RANK[b.origin.kind]);
	for (const skill of ordered) {
		const name = skill.name.toLowerCase();
		const winner = winners.get(name);
		if (winner) skill.shadowedBy = winner.key;
		else winners.set(name, skill);
	}
	return ordered;
}

/** The skills that count: one per name (the winner). */
export function effectiveSkills(landscape: CatalogSkill[]): CatalogSkill[] {
	return landscape.filter(skill => !skill.shadowedBy);
}
