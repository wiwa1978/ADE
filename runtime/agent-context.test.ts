import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rankFiles, readInstructions, searchWorkspaceFiles, writeInstructions } from "./agent-context.ts";

test("@-mention ranking prefers file names and word starts", () => {
	const files = ["src/components/Button.tsx", "src/hooks/useButtonState.ts", "docs/about-buttons.md", "README.md", "src/utils/bt.ts"];
	assert.equal(rankFiles(files, "button")[0], "src/components/Button.tsx");
	assert.equal(rankFiles(files, "usebut")[0], "src/hooks/useButtonState.ts");
	assert.deepEqual(rankFiles(files, "zzz"), []);
	assert.equal(rankFiles(files, "")[0], "README.md", "top-level files first when nothing is typed");
});

test("workspace file search honors .gitignore and includes new files", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-context-"));
	try {
		execFileSync("git", ["init", "-q"], { cwd: dir });
		mkdirSync(join(dir, "src"));
		writeFileSync(join(dir, ".gitignore"), "dist/\n");
		writeFileSync(join(dir, "src", "login.ts"), "x");
		mkdirSync(join(dir, "dist"));
		writeFileSync(join(dir, "dist", "login.js"), "x");
		assert.deepEqual(await searchWorkspaceFiles(dir, "login"), ["src/login.ts"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("instruction files are read and written only by name", () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-instructions-"));
	try {
		assert.deepEqual(readInstructions(dir).map(file => [file.name, file.exists]), [["AGENTS.md", false], ["CLAUDE.md", false]]);
		const after = writeInstructions(dir, "AGENTS.md", "Use pnpm.");
		assert.equal(after[0].exists, true);
		assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), "Use pnpm.\n");
		assert.throws(() => writeInstructions(dir, "../evil.md", "x"), /Only AGENTS\.md and CLAUDE\.md/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
