// A stage's checks, run by ADE itself before the stage can finish. Blueprints name them loosely
// ("build", "lint", "typecheck", "test"); ADE maps those to the project's real commands: the
// project's own check script when it has one, else the matching package.json scripts. A word
// the project has no command for is skipped (and said so), never a failure, so a project without
// a "build" script isn't blocked forever.

export type CheckStatus = "passed" | "failed" | "skipped";
export type CheckResult = {
	label: string;
	command: string;
	status: CheckStatus;
	exitCode: number | null;
	/** The end of the command's output (what failed). */
	output: string;
	ms: number;
};
export type StageChecks = {
	/** Where the commands came from: the project's check script, its package.json scripts, or nowhere. */
	source: "project" | "package" | "none";
	results: CheckResult[];
	/** Check words the project has no command for. */
	missing: string[];
	ok: boolean;
	at: number;
};

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const ALIASES: Record<string, string[]> = {
	build: ["build"],
	lint: ["lint"],
	typecheck: ["typecheck", "type-check", "check-types", "tsc"],
	test: ["test"],
	e2e: ["e2e", "test:e2e"],
};

/** npm's placeholder for "no tests": not a real check. */
const PLACEHOLDER = /no test specified/i;

export function packageManagerFor(files: { has(name: string): boolean }): PackageManager {
	if (files.has("pnpm-lock.yaml")) return "pnpm";
	if (files.has("yarn.lock")) return "yarn";
	if (files.has("bun.lock") || files.has("bun.lockb")) return "bun";
	return "npm";
}

function scriptCommand(manager: PackageManager, name: string) {
	if (manager === "yarn") return `yarn ${name}`;
	if (manager === "npm" && name === "test") return "npm test";
	return `${manager} run ${name}`;
}

export function resolveChecks(input: {
	words: readonly string[];
	/** The project's own check command (Project settings → check), if it has one. */
	projectCheck: string;
	/** The `scripts` of the workspace's package.json, if it has one. */
	packageScripts: Record<string, string> | null;
	packageManager: PackageManager;
}): { source: StageChecks["source"]; commands: Array<{ label: string; command: string }>; missing: string[] } {
	if (input.projectCheck.trim()) return { source: "project", commands: [{ label: "project check", command: input.projectCheck.trim() }], missing: [] };
	const commands: Array<{ label: string; command: string }> = [];
	const missing: string[] = [];
	const scripts = input.packageScripts ?? {};
	for (const word of input.words) {
		const candidates = ALIASES[word.toLowerCase()] ?? [word];
		const name = candidates.find(candidate => typeof scripts[candidate] === "string" && !PLACEHOLDER.test(scripts[candidate]));
		if (name) commands.push({ label: word, command: scriptCommand(input.packageManager, name) });
		else missing.push(word);
	}
	return { source: commands.length ? "package" : "none", commands, missing };
}

const TAIL = 2500;
const tail = (text: string) => (text.length > TAIL ? `…${text.slice(-TAIL)}` : text).trim();

/** Run the commands one after another and collect what each did. A command that isn't installed (exit 127) is skipped. */
export async function runChecks(
	plan: ReturnType<typeof resolveChecks>,
	runOne: (command: string) => Promise<{ exitCode: number | null; output: string }>,
	now: () => number = Date.now,
): Promise<StageChecks> {
	const results: CheckResult[] = [];
	for (const { label, command } of plan.commands) {
		const started = now();
		const { exitCode, output } = await runOne(command);
		const status: CheckStatus = exitCode === 0 ? "passed" : exitCode === 127 ? "skipped" : "failed";
		results.push({ label, command, status, exitCode, output: tail(output), ms: now() - started });
	}
	return { source: plan.source, results, missing: plan.missing, ok: results.every(result => result.status !== "failed"), at: now() };
}

/** What the agent is told when a check fails: which one, and the end of its output. */
export function failureText(stageName: string, checks: StageChecks) {
	const failed = checks.results.filter(result => result.status === "failed");
	const lines = [`ADE ran this stage's checks and ${failed.length === 1 ? "one failed" : `${failed.length} failed`}, so "${stageName}" is not finished.`];
	for (const result of failed) lines.push("", `✕ ${result.label} (\`${result.command}\`, exit ${result.exitCode ?? "?"}):`, result.output || "(no output)");
	lines.push("", "Fix what failed, then call finish_stage again; ADE runs the checks again.");
	return lines.join("\n");
}

/** One line for the stage's summary: what ran and passed, what was skipped. */
export function checksLine(checks: StageChecks) {
	const passed = checks.results.filter(result => result.status === "passed").map(result => result.label);
	const skipped = [...checks.results.filter(result => result.status === "skipped").map(result => result.label), ...checks.missing];
	if (!passed.length && !skipped.length) return "No checks are configured for this project.";
	return [passed.length ? `Checks passed: ${passed.join(", ")}.` : "", skipped.length ? `Not available here: ${skipped.join(", ")}.` : ""].filter(Boolean).join(" ");
}
