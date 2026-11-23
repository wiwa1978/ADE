// Bridge between the main agent's subagent tools (inside Pi Durable) and the runner for subagents
// on other harnesses (Claude Code, Codex). The runtime installs both at startup.
import type { SubagentHarness, SubagentPolicy } from "./subagent-policy.ts";
import { DEFAULT_SUBAGENT_POLICY } from "./subagent-policy.ts";

export type ExternalSubagentRunner = {
	/** Which external CLIs are available on this computer (or can be installed on the run target). */
	installed(sessionId: string): Set<SubagentHarness>;
	/** Start (or resume, after a restart) the subagent's run. */
	start(input: { sessionId: string; conversationId: string; harness: Exclude<SubagentHarness, "pi">; cwd: string; task: string; readOnly: boolean }): void;
	message(sessionId: string, conversationId: string, text: string): void;
	wait(sessionId: string, conversationId: string): Promise<{ status: "completed" | "failed"; text: string }>;
	stop(sessionId: string, conversationId: string): boolean;
};

let runner: ExternalSubagentRunner | null = null;
let policySource: () => SubagentPolicy = () => DEFAULT_SUBAGENT_POLICY;

export function setExternalSubagentRunner(next: ExternalSubagentRunner | null, policy?: () => SubagentPolicy) {
	runner = next;
	if (policy) policySource = policy;
}

export function externalSubagents() {
	return runner;
}

export function subagentPolicy() {
	return policySource();
}
