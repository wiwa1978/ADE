// Which harness a subagent runs on. The main agent is always the ADE agent on Pi Durable, which
// survives restarts and coordinates the work; subagents can run on Pi (with any configured model),
// Claude Code or Codex. The customer decides which are allowed and whether the main agent picks
// the best one per task or always uses a fixed one.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { badRequest } from "./http-error.ts";

export type SubagentHarness = "pi" | "claude-code" | "codex";
export const SUBAGENT_HARNESSES: SubagentHarness[] = ["pi", "claude-code", "codex"];

export type SubagentPolicy = {
	/** Harnesses subagents may use. Pi is always allowed: it's the fallback. */
	allowed: SubagentHarness[];
	/** "agent": the main agent picks per subagent; otherwise every subagent uses this harness. */
	choice: "agent" | SubagentHarness;
	/** Model for Pi subagents as "provider/model"; empty = the main agent's model. */
	piModel: string;
	/** Model passed to Claude Code (--model) and Codex (-m); empty = their own default. */
	claudeModel: string;
	codexModel: string;
};

export const DEFAULT_SUBAGENT_POLICY: SubagentPolicy = { allowed: [...SUBAGENT_HARNESSES], choice: "agent", piModel: "", claudeModel: "", codexModel: "" };

export const harnessNames: Record<SubagentHarness, string> = { pi: "ADE agent (Pi)", "claude-code": "Claude Code", codex: "Codex" };

/** What each harness is good at, shown to the main agent when it chooses. */
export const harnessGuidance: Record<SubagentHarness, string> = {
	pi: "the ADE agent itself (durable: survives restarts, can be messaged mid-task). Best for research, reading and explaining code, planning, reviews, small edits, and tasks that need ADE's own tools such as the browser.",
	"claude-code": "Anthropic's Claude Code. Best for larger features and refactors across many files, following a repository's conventions, and careful work in big codebases.",
	codex: "OpenAI's Codex. Best for well-specified code changes, fixing failing tests or builds, and tasks that mostly run commands to verify their work.",
};

function sanitize(input: unknown, base: SubagentPolicy): SubagentPolicy {
	const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	const allowed = Array.isArray(value.allowed)
		? SUBAGENT_HARNESSES.filter(harness => (value.allowed as unknown[]).includes(harness))
		: base.allowed;
	if (!allowed.includes("pi")) allowed.unshift("pi");
	const choice = value.choice === undefined ? base.choice : value.choice === "agent" || SUBAGENT_HARNESSES.includes(value.choice as SubagentHarness) ? value.choice as SubagentPolicy["choice"] : null;
	if (!choice) throw badRequest("Choose who picks the subagent harness: the main agent, or one fixed harness.");
	if (choice !== "agent" && !allowed.includes(choice)) throw badRequest(`${harnessNames[choice]} must be allowed to be the fixed choice.`);
	const text = (key: "piModel" | "claudeModel" | "codexModel") => {
		if (value[key] === undefined) return base[key];
		const model = typeof value[key] === "string" ? (value[key] as string).trim() : "";
		if (model.length > 120 || /[\s'"`$\\]/.test(model)) throw badRequest("Enter a model name without spaces or quotes.");
		return model;
	};
	const piModel = text("piModel");
	if (piModel && !/^[\w.-]+\/[\w.:/-]+$/.test(piModel)) throw badRequest("Pi subagent model must look like provider/model, e.g. anthropic/claude-sonnet-5-5.");
	return { allowed, choice, piModel, claudeModel: text("claudeModel"), codexModel: text("codexModel") };
}

export class SubagentPolicyStore {
	#file: string;
	#policy: SubagentPolicy;

	constructor(stateDirectory: string) {
		this.#file = join(stateDirectory, "subagent-policy.json");
		this.#policy = DEFAULT_SUBAGENT_POLICY;
		try {
			if (existsSync(this.#file)) this.#policy = sanitize(JSON.parse(readFileSync(this.#file, "utf8")), DEFAULT_SUBAGENT_POLICY);
		} catch {
			this.#policy = DEFAULT_SUBAGENT_POLICY;
		}
	}

	get() {
		return this.#policy;
	}

	set(input: unknown) {
		this.#policy = sanitize(input, this.#policy);
		mkdirSync(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		writeFileSync(temp, JSON.stringify(this.#policy, null, 2));
		renameSync(temp, this.#file);
		return this.#policy;
	}
}

/** Harnesses a subagent can use right now: allowed by the customer and installed (Pi always is). */
export function usableHarnesses(policy: SubagentPolicy, installed: ReadonlySet<SubagentHarness>) {
	return policy.allowed.filter(harness => harness === "pi" || installed.has(harness));
}

/**
 * The harness a new subagent runs on, and why. A fixed choice wins; otherwise the main agent's
 * request is used when it's usable, and Pi is the fallback.
 */
export function resolveHarness(requested: unknown, policy: SubagentPolicy, installed: ReadonlySet<SubagentHarness>): { harness: SubagentHarness; note: string } {
	const usable = usableHarnesses(policy, installed);
	if (policy.choice !== "agent") {
		if (usable.includes(policy.choice)) return { harness: policy.choice, note: "" };
		return { harness: "pi", note: `${harnessNames[policy.choice]} is set as the subagent harness but isn't installed, so this subagent runs on Pi.` };
	}
	const wanted = typeof requested === "string" ? requested.trim().toLowerCase().replace(/\s+/g, "-") : "";
	const normalized = (wanted === "claude" ? "claude-code" : wanted) as SubagentHarness;
	if (!wanted || wanted === "auto") return { harness: "pi", note: "" };
	if (!SUBAGENT_HARNESSES.includes(normalized)) return { harness: "pi", note: `Unknown harness "${wanted}"; using Pi.` };
	if (usable.includes(normalized)) return { harness: normalized, note: "" };
	return { harness: "pi", note: `${harnessNames[normalized]} isn't ${policy.allowed.includes(normalized) ? "installed" : "allowed in Settings → Subagents"}, so this subagent runs on Pi.` };
}

/** The part of spawn_subagent's description that tells the main agent how to choose. */
export function harnessChoiceText(policy: SubagentPolicy, installed: ReadonlySet<SubagentHarness>) {
	const usable = usableHarnesses(policy, installed);
	if (policy.choice !== "agent" || usable.length === 1) {
		const fixed = policy.choice === "agent" ? "pi" : usable.includes(policy.choice) ? policy.choice : "pi";
		return ` Subagents run on ${harnessNames[fixed]} (set by the user); omit 'harness'.`;
	}
	return ` Choose the harness that best fits each task with 'harness': ${usable.map(harness => `'${harness}' = ${harnessGuidance[harness]}`).join(" ")} Pick by fit, not habit; say in one line why you chose it.`;
}
