// Workspace checkpoints (roadmap R2): a snapshot of a session's files before every agent turn, so
// the user can roll the workspace back to any earlier point.
//
// Snapshots are ordinary Git commits written with a temporary index (the user's index, HEAD and
// branches are never touched) and kept under private refs: refs/ade/checkpoints/<session>/<n>.
// Untracked files are included; ignored files (node_modules, build output) are not.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { workspacePath } from "./coding-tools.ts";

const execFileAsync = promisify(execFile);

export type Checkpoint = {
	id: string;
	ref: string;
	commit: string;
	head: string;
	label: string;
	createdAt: number;
	filesChanged: number;
};

type Meta = { label: string; head: string; createdAt: number };

function refPrefix(sessionId: string) {
	if (!/^[\w-]+$/.test(sessionId)) throw Object.assign(new Error("Invalid session id."), { statusCode: 400 });
	return `refs/ade/checkpoints/${sessionId}`;
}

async function git(cwd: string, args: string[], env: Record<string, string> = {}) {
	const { stdout } = await execFileAsync("git", args, {
		cwd,
		timeout: 60000,
		maxBuffer: 16 * 1024 * 1024,
		windowsHide: true,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...env },
	});
	return stdout.trim();
}

/** Tree of the current working directory (tracked + untracked, minus ignored), via a throwaway index. */
async function snapshotTree(cwd: string) {
	const dir = mkdtempSync(join(tmpdir(), "ade-index-"));
	const index = join(dir, "index");
	try {
		const env = { GIT_INDEX_FILE: index };
		await git(cwd, ["read-tree", "HEAD"], env).catch(() => undefined);
		await git(cwd, ["add", "-A", "--", "."], env);
		return await git(cwd, ["write-tree"], env);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

export function createCheckpoints() {
	return {
		/** Take a checkpoint; skipped (returns null) when nothing changed since the last one. */
		async create(sessionId: string, cwd: string, label: string): Promise<Checkpoint | null> {
			const prefix = refPrefix(sessionId);
			const head = await git(cwd, ["rev-parse", "HEAD"]);
			const tree = await snapshotTree(cwd);
			const existing = await this.list(sessionId, cwd);
			const last = existing[0];
			if (last && (await git(cwd, ["rev-parse", `${last.commit}^{tree}`])) === tree && last.head === head) return null;
			const meta: Meta = { label: label.replace(/\s+/g, " ").trim().slice(0, 160) || "Checkpoint", head, createdAt: Date.now() };
			const commit = await git(cwd, ["commit-tree", tree, "-p", head, "-m", `ADE checkpoint\n\n${JSON.stringify(meta)}`], {
				GIT_AUTHOR_NAME: "ADE", GIT_AUTHOR_EMAIL: "ade@localhost", GIT_COMMITTER_NAME: "ADE", GIT_COMMITTER_EMAIL: "ade@localhost",
			});
			const next = (existing.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1).toString().padStart(5, "0");
			await git(cwd, ["update-ref", `${prefix}/${next}`, commit]);
			return { id: next, ref: `${prefix}/${next}`, commit, head, label: meta.label, createdAt: meta.createdAt, filesChanged: 0 };
		},

		/** Newest first, with how many files differ from the current workspace. */
		async list(sessionId: string, cwd: string): Promise<Checkpoint[]> {
			const prefix = refPrefix(sessionId);
			const raw = await git(cwd, ["for-each-ref", "--sort=-refname", "--format=%(refname)%00%(objectname)%00%(contents:body)%00%00", `${prefix}/`]);
			const items = raw.split("\u0000\u0000").map(chunk => chunk.replace(/^\n/, "")).filter(Boolean).map(chunk => {
				const [ref, commit, body] = chunk.split("\u0000");
				let meta: Meta = { label: "Checkpoint", head: "", createdAt: 0 };
				try { meta = { ...meta, ...JSON.parse(body.trim()) }; } catch { /* keep defaults for foreign refs */ }
				return { id: ref.slice(prefix.length + 1), ref, commit, head: meta.head, label: meta.label, createdAt: meta.createdAt, filesChanged: 0 };
			});
			return items;
		},

		/** Count files that differ between each checkpoint and the current workspace. */
		async withChanges(sessionId: string, cwd: string): Promise<Checkpoint[]> {
			const items = await this.list(sessionId, cwd);
			if (!items.length) return items;
			const current = await snapshotTree(cwd);
			return Promise.all(items.map(async item => {
				const names = await git(cwd, ["diff", "--name-only", item.commit, current]).catch(() => "");
				return { ...item, filesChanged: names ? names.split("\n").length : 0 };
			}));
		},

		/**
		 * Put the workspace back exactly as it was at a checkpoint: files (including deletions of files
		 * created since) and HEAD. The current state is saved as a new checkpoint first, so a restore
		 * can itself be undone.
		 */
		async restore(sessionId: string, cwd: string, id: string) {
			const items = await this.list(sessionId, cwd);
			const target = items.find(item => item.id === id);
			if (!target) throw Object.assign(new Error("Checkpoint not found."), { statusCode: 404 });
			await this.create(sessionId, cwd, `Before restoring "${target.label}"`);
			const current = await snapshotTree(cwd);
			const added = (await git(cwd, ["diff", "--name-only", "--diff-filter=A", target.commit, current])).split("\n").filter(Boolean);
			for (const file of added) {
				try { unlinkSync(workspacePath(cwd, file, { mustExist: true })); } catch { /* already gone or outside the workspace */ }
			}
			if (target.head && (await git(cwd, ["rev-parse", "HEAD"])) !== target.head) await git(cwd, ["reset", "--quiet", target.head]);
			// Write the checkpoint's files into the working tree, then leave the index matching HEAD.
			await git(cwd, ["checkout", target.commit, "--", "."]);
			await git(cwd, ["reset", "--quiet"]);
			return { restored: target };
		},

		async clear(sessionId: string, cwd: string) {
			for (const item of await this.list(sessionId, cwd)) await git(cwd, ["update-ref", "-d", item.ref]).catch(() => undefined);
		},
	};
}

export type Checkpoints = ReturnType<typeof createCheckpoints>;
