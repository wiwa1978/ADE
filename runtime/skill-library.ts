import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { badRequest, notFound } from "./http-error.ts";
import { findSkillDirs, parseFrontmatter, type GitSkillSourceRef } from "./skill-catalog.ts";

const run = promisify(execFile);

export type SkillSource = GitSkillSourceRef & {
	status: "ready" | "error";
	error: string | null;
	createdAt: number;
};

export type SkillPreview = {
	previewId: string;
	url: string;
	ref: string | null;
	subpath: string | null;
	commit: string | null;
	skills: { name: string; description: string; relPath: string; extraFiles: number; tokens: number }[];
};

type Row = { id: string; url: string; ref: string | null; subpath: string | null; dir: string; commit: string | null; syncedAt: number | null; status: string; error: string | null; createdAt: number };

/** Accepts https/ssh/git@/file URLs, absolute local paths, and GitHub shorthand (owner/repo). */
export function normalizeRepoUrl(value: unknown): string {
	if (typeof value !== "string") throw badRequest("Enter a Git repository URL.");
	const url = value.trim();
	if (!url || url.length > 500 || url.startsWith("-") || /[\s\0]/.test(url)) throw badRequest("Enter a valid Git repository URL.");
	if (/^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(url)) return `https://github.com/${url.replace(/\.git$/, "")}.git`;
	if (/^(https?:\/\/|ssh:\/\/|git@[\w.-]+:|file:\/\/)/.test(url) || isAbsolute(url)) return url;
	throw badRequest("Use an https:// or SSH Git URL, or owner/repo for GitHub.");
}

function normalizeRef(value: unknown): string | null {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value !== "string" || value.length > 200 || value.startsWith("-") || !/^[\w./-]+$/.test(value)) throw badRequest("Enter a valid branch or tag.");
	return value;
}

function normalizeSubpath(value: unknown): string | null {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value !== "string" || value.length > 300) throw badRequest("Enter a valid folder inside the repository.");
	const clean = normalize(value.trim()).replace(/^[/\\]+|[/\\]+$/g, "");
	if (!clean || clean === ".") return null;
	if (isAbsolute(clean) || clean.split(/[/\\]/).includes("..")) throw badRequest("The folder must be inside the repository.");
	return clean;
}

function slugify(value: string): string {
	return value.toLowerCase().replace(/\.git$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "skills";
}

async function git(args: string[], cwd?: string): Promise<string> {
	try {
		const { stdout } = await run("git", args, {
			cwd,
			timeout: 120_000,
			maxBuffer: 4 * 1024 * 1024,
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
			windowsHide: true,
		});
		return stdout.trim();
	} catch (error) {
		const stderr = (error as { stderr?: string }).stderr?.trim();
		// Keep git's reason, not its progress lines or our staging folder.
		const reason = stderr?.split("\n").map(line => line.trim()).filter(line => line && !/^(Cloning into|Receiving|Resolving|remote: (Enumerating|Counting|Compressing|Total))/.test(line)).slice(-2).join(" ").replaceAll(/'[^']*[\\/]skill-sources[\\/][^']*'/g, "the repository");
		throw badRequest(reason ? `git ${args[0]} failed: ${reason}` : `git ${args[0]} failed.`);
	}
}

function describeSkills(root: string) {
	return findSkillDirs(root, 5).map(dir => {
		const raw = readFileSync(join(dir, "SKILL.md"), "utf8");
		const meta = parseFrontmatter(raw);
		return {
			name: (meta.name || dir.split(sep).pop() || "skill").trim(),
			description: (meta.description || meta.body.trim().split("\n")[0]?.slice(0, 160) || "").trim(),
			relPath: relative(root, dir) || ".",
			extraFiles: readdirSync(dir).filter(name => name !== "SKILL.md" && !name.startsWith(".")).length,
			tokens: Math.ceil(statSync(join(dir, "SKILL.md")).size / 4),
		};
	});
}

/**
 * Skills that come from Git repositories (cloned into ~/.ade/skill-sources) and skills the user
 * writes in ADE (~/.ade/skills). Clones use this environment's git and its credentials.
 */
export class SkillLibrary {
	#db: DatabaseSync;
	#home: string;
	#previews = new Map<string, { dir: string; url: string; ref: string | null; subpath: string | null; commit: string | null; createdAt: number }>();

	constructor({ db, home = homedir() }: { db: DatabaseSync; home?: string }) {
		this.#db = db;
		this.#home = home;
		this.#db.exec(`CREATE TABLE IF NOT EXISTS skill_sources (
			id TEXT PRIMARY KEY,
			url TEXT NOT NULL,
			ref TEXT,
			subpath TEXT,
			dir TEXT NOT NULL,
			commitSha TEXT,
			syncedAt INTEGER,
			status TEXT NOT NULL DEFAULT 'ready',
			error TEXT,
			createdAt INTEGER NOT NULL
		)`);
	}

	get sourcesRoot() {
		return join(this.#home, ".ade", "skill-sources");
	}

	get userSkillsRoot() {
		return join(this.#home, ".ade", "skills");
	}

	list(): SkillSource[] {
		const rows = this.#db.prepare("SELECT id, url, ref, subpath, dir, commitSha AS \"commit\", syncedAt, status, error, createdAt FROM skill_sources ORDER BY createdAt ASC").all() as unknown as Row[];
		return rows.map(row => ({ ...row, status: row.status === "error" ? "error" : "ready" }));
	}

	get(id: string): SkillSource {
		const source = this.list().find(item => item.id === id);
		if (!source) throw notFound("Skill source not found.");
		return source;
	}

	/** Clone into a staging folder and list the skills found, without installing anything. */
	async preview(input: { url?: unknown; ref?: unknown; subpath?: unknown }): Promise<SkillPreview> {
		this.#dropOldPreviews();
		const url = normalizeRepoUrl(input.url);
		const ref = normalizeRef(input.ref);
		const subpath = normalizeSubpath(input.subpath);
		const previewId = randomUUID();
		const dir = join(this.sourcesRoot, ".staging", previewId);
		mkdirSync(join(this.sourcesRoot, ".staging"), { recursive: true });
		try {
			await git(["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), "--", url, dir]);
			const commit = await git(["rev-parse", "HEAD"], dir).catch(() => null);
			const root = subpath ? join(dir, subpath) : dir;
			if (!existsSync(root)) throw badRequest(`The folder "${subpath}" isn't in the repository.`);
			const skills = describeSkills(root);
			if (!skills.length) throw badRequest("No skills found: the repository has no folders with a SKILL.md.");
			this.#previews.set(previewId, { dir, url, ref, subpath, commit, createdAt: Date.now() });
			return { previewId, url, ref, subpath, commit, skills };
		} catch (error) {
			rmSync(dir, { recursive: true, force: true });
			throw error;
		}
	}

	/** Install a previewed source. */
	confirm(previewId: string): SkillSource {
		const preview = this.#previews.get(previewId);
		if (!preview || !existsSync(preview.dir)) throw notFound("The preview expired. Import the repository again.");
		this.#previews.delete(previewId);
		const id = randomUUID();
		const dir = join(this.sourcesRoot, `${slugify(preview.url)}-${id.slice(0, 8)}`);
		renameSync(preview.dir, dir);
		this.#db.prepare("INSERT INTO skill_sources (id, url, ref, subpath, dir, commitSha, syncedAt, status, error, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', NULL, ?)")
			.run(id, preview.url, preview.ref, preview.subpath, dir, preview.commit, Date.now(), Date.now());
		return this.get(id);
	}

	discardPreview(previewId: string): void {
		const preview = this.#previews.get(previewId);
		if (preview) rmSync(preview.dir, { recursive: true, force: true });
		this.#previews.delete(previewId);
	}

	/** Fetch the latest commit of the source's branch/tag and say whether it differs. */
	async checkForUpdates(id: string): Promise<{ updateAvailable: boolean; current: string | null; latest: string | null }> {
		const source = this.get(id);
		try {
			await git(["fetch", "--depth", "1", "origin", source.ref ?? "HEAD"], source.dir);
			const latest = await git(["rev-parse", "FETCH_HEAD"], source.dir);
			this.#setStatus(id, "ready", null);
			return { updateAvailable: Boolean(latest && latest !== source.commit), current: source.commit, latest };
		} catch (error) {
			this.#setStatus(id, "error", error instanceof Error ? error.message : String(error));
			throw error;
		}
	}

	async update(id: string): Promise<SkillSource> {
		const source = this.get(id);
		try {
			await git(["fetch", "--depth", "1", "origin", source.ref ?? "HEAD"], source.dir);
			await git(["reset", "--hard", "FETCH_HEAD"], source.dir);
			const commit = await git(["rev-parse", "HEAD"], source.dir);
			this.#db.prepare("UPDATE skill_sources SET commitSha=?, syncedAt=?, status='ready', error=NULL WHERE id=?").run(commit, Date.now(), id);
		} catch (error) {
			this.#setStatus(id, "error", error instanceof Error ? error.message : String(error));
			throw error;
		}
		return this.get(id);
	}

	remove(id: string): void {
		const source = this.get(id);
		if (resolve(source.dir).startsWith(resolve(this.sourcesRoot) + sep)) rmSync(source.dir, { recursive: true, force: true });
		this.#db.prepare("DELETE FROM skill_sources WHERE id=?").run(id);
	}

	// --- Skills written in ADE (~/.ade/skills) ---

	createUserSkill(input: { name?: unknown; description?: unknown; body?: unknown }): { name: string; path: string } {
		const name = typeof input.name === "string" ? input.name.trim() : "";
		if (!/^[A-Za-z0-9][\w .-]{0,63}$/.test(name)) throw badRequest("Use a skill name of letters, digits, spaces, dots, dashes or underscores (max 64).");
		const description = typeof input.description === "string" ? input.description.trim().replace(/\s+/g, " ").slice(0, 500) : "";
		if (!description) throw badRequest("Describe when the agent should use this skill.");
		const body = typeof input.body === "string" ? input.body : "";
		if (body.length > 100_000) throw badRequest("The skill is too long (max 100,000 characters).");
		const dir = join(this.userSkillsRoot, slugify(name));
		if (existsSync(dir)) throw badRequest(`A skill folder named "${slugify(name)}" already exists.`);
		mkdirSync(dir, { recursive: true });
		const path = join(dir, "SKILL.md");
		writeFileSync(path, `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`, "utf8");
		return { name, path };
	}

	/** Only skills ADE owns (~/.ade/skills) can be edited or deleted here. */
	#ownedSkillDir(path: unknown): string {
		if (typeof path !== "string" || !path) throw badRequest("Missing skill path.");
		const full = resolve(path);
		const dir = full.endsWith(`${sep}SKILL.md`) ? full.slice(0, -("SKILL.md".length + 1)) : full;
		const root = resolve(this.userSkillsRoot);
		if (!dir.startsWith(root + sep) || relative(root, dir).includes(sep)) throw badRequest("Only skills in ~/.ade/skills can be changed in ADE.");
		if (!existsSync(join(dir, "SKILL.md"))) throw notFound("Skill not found.");
		return dir;
	}

	readUserSkill(path: unknown): { path: string; content: string } {
		const dir = this.#ownedSkillDir(path);
		return { path: join(dir, "SKILL.md"), content: readFileSync(join(dir, "SKILL.md"), "utf8") };
	}

	writeUserSkill(path: unknown, content: unknown): { path: string } {
		const dir = this.#ownedSkillDir(path);
		if (typeof content !== "string" || content.length > 100_000) throw badRequest("The skill is too long (max 100,000 characters).");
		writeFileSync(join(dir, "SKILL.md"), content, "utf8");
		return { path: join(dir, "SKILL.md") };
	}

	deleteUserSkill(path: unknown): void {
		rmSync(this.#ownedSkillDir(path), { recursive: true, force: true });
	}

	#setStatus(id: string, status: "ready" | "error", error: string | null) {
		this.#db.prepare("UPDATE skill_sources SET status=?, error=? WHERE id=?").run(status, error, id);
	}

	#dropOldPreviews() {
		const cutoff = Date.now() - 30 * 60_000;
		for (const [id, preview] of this.#previews) if (preview.createdAt < cutoff) this.discardPreview(id);
	}
}
