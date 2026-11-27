import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SessionBackupManager } from "./session-backup.ts";

describe("SessionBackupManager", () => {
	it("initializes a git backup repo, commits session snapshots, deduplicates unchanged turns, and reads backups back", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ade-session-backup-"));
		try {
			const mgr = new SessionBackupManager(dir);
			const cfg = mgr.update({ enabled: true, branch: "main" });
			assert.equal(cfg.enabled, true);

			const first = await mgr.backupSession({
				session: {
					id: "sess-1",
					label: "Fix auth race",
					projectId: "proj-1",
					engine: "opencode",
					workspacePath: "/tmp/repo",
					branch: "ade/fix-auth",
					updatedAt: 1000,
					messages: [{ role: "user", content: "Fix auth race" }],
				},
				blueprint: { id: "automated-factory", stage: "implement" },
			});
			assert.equal(first.committed, true);
			assert.ok(first.commit);
			assert.equal(first.error, null);

			// Unchanged snapshot does not create a duplicate commit
			const second = await mgr.backupSession({
				session: {
					id: "sess-1",
					label: "Fix auth race",
					projectId: "proj-1",
					engine: "opencode",
					workspacePath: "/tmp/repo",
					branch: "ade/fix-auth",
					updatedAt: 1000,
					messages: [{ role: "user", content: "Fix auth race" }],
				},
				blueprint: { id: "automated-factory", stage: "implement" },
			});
			assert.equal(second.committed, false);

			// Updated snapshot creates a new commit
			const third = await mgr.backupSession({
				session: {
					id: "sess-1",
					label: "Fix auth race",
					projectId: "proj-1",
					engine: "opencode",
					workspacePath: "/tmp/repo",
					branch: "ade/fix-auth",
					updatedAt: 2000,
					messages: [
						{ role: "user", content: "Fix auth race" },
						{ role: "assistant", content: "Fixed in auth.ts" },
					],
				},
				blueprint: { id: "automated-factory", stage: "verify" },
			});
			assert.equal(third.committed, true);
			assert.notEqual(third.commit, first.commit);

			const list = mgr.listBackups();
			assert.equal(list.length, 1);
			assert.equal(list[0].sessionId, "sess-1");
			assert.equal(list[0].messageCount, 2);

			const snap = mgr.readBackup("sess-1");
			assert.equal(snap.version, 1);
			assert.equal(snap.session.label, "Fix auth race");
			assert.equal((snap.blueprint as { stage: string }).stage, "verify");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
