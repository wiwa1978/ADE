import assert from "node:assert/strict";
import { test } from "node:test";
import { checksLine, failureText, packageManagerFor, resolveChecks, runChecks } from "./stage-checks.ts";

const scripts = { build: "vite build", lint: "oxlint", "type-check": "tsc -b", test: "node --test" };

test("check words map to the project's own commands; words without a script are skipped, not failed", () => {
	const plan = resolveChecks({ words: ["build", "lint", "typecheck", "test", "e2e"], projectCheck: "", packageScripts: scripts, packageManager: "npm" });
	assert.equal(plan.source, "package");
	assert.deepEqual(plan.commands.map(entry => entry.command), ["npm run build", "npm run lint", "npm run type-check", "npm test"]);
	assert.deepEqual(plan.missing, ["e2e"]);
	assert.deepEqual(resolveChecks({ words: ["test"], projectCheck: "", packageScripts: { test: "pnpm vitest" }, packageManager: "pnpm" }).commands, [{ label: "test", command: "pnpm run test" }]);
	assert.equal(resolveChecks({ words: ["test"], projectCheck: "", packageScripts: { test: "yarn jest" }, packageManager: "yarn" }).commands[0].command, "yarn test");

	// npm's placeholder test script isn't a check; no package.json means nothing to run.
	assert.deepEqual(resolveChecks({ words: ["test"], projectCheck: "", packageScripts: { test: 'echo "Error: no test specified" && exit 1' }, packageManager: "npm" }), { source: "none", commands: [], missing: ["test"] });
	assert.equal(resolveChecks({ words: ["build"], projectCheck: "", packageScripts: null, packageManager: "npm" }).source, "none");

	// The project's own check command is the user's definition of "checks" and wins.
	const own = resolveChecks({ words: ["build", "test"], projectCheck: " make verify ", packageScripts: scripts, packageManager: "npm" });
	assert.deepEqual(own, { source: "project", commands: [{ label: "project check", command: "make verify" }], missing: [] });

	assert.equal(packageManagerFor({ has: name => name === "pnpm-lock.yaml" }), "pnpm");
	assert.equal(packageManagerFor({ has: name => name === "bun.lockb" }), "bun");
	assert.equal(packageManagerFor({ has: () => false }), "npm");
});

test("running the checks: a failure is reported with the end of its output; a missing command is skipped", async () => {
	const plan = resolveChecks({ words: ["build", "lint", "test"], projectCheck: "", packageScripts: scripts, packageManager: "npm" });
	const outputs: Record<string, { exitCode: number | null; output: string }> = {
		"npm run build": { exitCode: 0, output: "built" },
		"npm run lint": { exitCode: 127, output: "oxlint: command not found" },
		"npm test": { exitCode: 1, output: `${"noise\n".repeat(1000)}FAIL src/a.test.ts: expected 2, got 3` },
	};
	const checks = await runChecks(plan, async command => outputs[command]);
	assert.deepEqual(checks.results.map(result => [result.label, result.status]), [["build", "passed"], ["lint", "skipped"], ["test", "failed"]]);
	assert.equal(checks.ok, false);
	assert.ok(checks.results[2].output.length <= 2600 && checks.results[2].output.endsWith("expected 2, got 3"));
	const text = failureText("Verify & E2E", checks);
	assert.match(text, /"Verify & E2E" is not finished[\s\S]*✕ test \(`npm test`, exit 1\)[\s\S]*expected 2, got 3[\s\S]*call finish_stage again/);
	assert.doesNotMatch(text, /✕ build|✕ lint/);

	const passing = await runChecks(plan, async () => ({ exitCode: 0, output: "" }));
	assert.equal(passing.ok, true);
	assert.equal(checksLine(passing), "Checks passed: build, lint, test.");
	assert.equal(checksLine(checks), "Checks passed: build. Not available here: lint.");
	assert.equal(checksLine({ source: "none", results: [], missing: [], ok: true, at: 0 }), "No checks are configured for this project.");
});
