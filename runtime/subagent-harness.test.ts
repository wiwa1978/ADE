import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { LocalAgentHost } from "./host.ts";
import { setExternalSubagentRunner, type ExternalSubagentRunner } from "./subagent-harness.ts";
import { DEFAULT_SUBAGENT_POLICY, harnessChoiceText, resolveHarness, SubagentPolicyStore, type SubagentHarness } from "./subagent-policy.ts";
import { WorktreeManager } from "./worktrees.ts";

const all = new Set<SubagentHarness>(["pi", "claude-code", "codex"]);

test("the main agent's harness pick is honored within the user's rules, with Pi as the fallback", () => {
	assert.deepEqual(resolveHarness("codex", DEFAULT_SUBAGENT_POLICY, all), { harness: "codex", note: "" });
	assert.deepEqual(resolveHarness("Claude", DEFAULT_SUBAGENT_POLICY, all), { harness: "claude-code", note: "" });
	assert.equal(resolveHarness(undefined, DEFAULT_SUBAGENT_POLICY, all).harness, "pi");
	assert.match(resolveHarness("codex", DEFAULT_SUBAGENT_POLICY, new Set(["pi"])).note, /isn't installed/);
	const noCodex = { ...DEFAULT_SUBAGENT_POLICY, allowed: ["pi", "claude-code"] as SubagentHarness[] };
	assert.match(resolveHarness("codex", noCodex, all).note, /isn't allowed/);
	const fixed = { ...DEFAULT_SUBAGENT_POLICY, choice: "claude-code" as const };
	assert.equal(resolveHarness("codex", fixed, all).harness, "claude-code", "a fixed choice wins over the agent's pick");

	assert.match(harnessChoiceText(DEFAULT_SUBAGENT_POLICY, all), /'codex' = .*Best for well-specified code changes/);
	assert.match(harnessChoiceText(fixed, all), /run on Claude Code \(set by the user\)/);
	assert.match(harnessChoiceText(DEFAULT_SUBAGENT_POLICY, new Set(["pi"])), /run on ADE agent/);
});

test("subagent settings are validated and saved", () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-subpolicy-"));
	try {
		const store = new SubagentPolicyStore(dir);
		assert.deepEqual(store.get(), DEFAULT_SUBAGENT_POLICY);
		store.set({ allowed: ["codex"], choice: "agent", piModel: "anthropic/claude-sonnet-5-5", codexModel: "gpt-5.5" });
		const saved = new SubagentPolicyStore(dir).get();
		assert.deepEqual(saved.allowed, ["pi", "codex"], "Pi is always allowed");
		assert.equal(saved.piModel, "anthropic/claude-sonnet-5-5");
		assert.throws(() => store.set({ choice: "claude-code" }), /must be allowed/);
		assert.throws(() => store.set({ piModel: "no-slash" }), /provider\/model/);
		assert.throws(() => store.set({ codexModel: "a b" }), /without spaces/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the main agent (Pi) can run a subagent on Codex and gets its report back", { timeout: 30_000 }, async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "ade-subharness-"));
	const repoDir = mkdtempSync(join(tmpdir(), "ade-subharness-repo-"));
	execFileSync("git", ["init", "-q"], { cwd: repoDir });
	writeFileSync(join(repoDir, "app.ts"), "export const answer = 41;\n");
	const started: Array<{ harness: string; cwd: string; readOnly: boolean; task: string }> = [];
	const stopped: Array<[string, string]> = [];
	const runner: ExternalSubagentRunner = {
		installed: () => new Set(["pi", "codex"]),
		start: input => { started.push(input); },
		message: () => undefined,
		wait: async () => ({ status: "completed", text: "Changed answer to 42 and ran the tests." }),
		stop: (sessionId, conversationId) => { stopped.push([sessionId, conversationId]); return true; },
	};
	setExternalSubagentRunner(runner, () => DEFAULT_SUBAGENT_POLICY);
	const faux = fauxProvider();
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("spawn_subagent", { name: "Fixer", role: "Bug Fixer", task: "Make answer 42", mode: "workspace", harness: "codex" }), { stopReason: "toolUse" }),
		fauxAssistantMessage("The Codex subagent fixed it."),
	]);
	const models = createModels();
	models.setProvider(faux.provider);
	const fixture = { provider: faux.provider.id, defaultModel: faux.getModel().id, availableModels: [{ id: faux.getModel().id, name: "Fixture" }], configured: true, setupMessage: "", models, faux, resolveModel: (id: string) => models.getModel(faux.provider.id, id) };
	const host = new LocalAgentHost({ stateDirectory: stateDir, modelConfigFactory: () => fixture });
	const manager = new WorktreeManager(stateDir);
	host.setWorktreeManager(manager);
	try {
		const taskId = randomUUID();
		await host.createCodingTask({ id: taskId, title: "Harness", repository: repoDir, kind: "checkout" }, manager);
		await host.send("coding", { content: "Fix the answer", model: faux.getModel().id, reasoning: "none" }, taskId);

		assert.equal(started.length, 1);
		assert.equal(started[0].harness, "codex");
		assert.equal(started[0].readOnly, false);
		assert.match(started[0].task, /subagent named "Fixer".*\n\nTask:\nMake answer 42/s);
		const agents = await host.featureAgents(taskId);
		assert.equal(agents.length, 1);
		assert.equal(agents[0].harness, "codex", "the subagent's record says it ran on Codex");
		const timeline = await host.getTimeline(taskId);
		const call = timeline.items.flatMap(item => (item.kind === "assistant" ? item.toolCalls : [])).find(tool => tool.name === "spawn_subagent");
		assert.match(call?.output ?? "", /Changed answer to 42/, "the main agent got the Codex subagent's report");

		// The main agent's stop_subagent tool ends the Codex run too, like the Stop button does.
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("stop_subagent", { subagentId: String(agents[0].id) }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Stopped it."),
		]);
		await host.send("coding", { content: "Stop the fixer", model: faux.getModel().id, reasoning: "none" }, taskId);
		assert.deepEqual(stopped, [[taskId, String(agents[0].id)]]);
	} finally {
		setExternalSubagentRunner(null);
		await host.close();
		manager.close();
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoDir, { recursive: true, force: true });
	}
});
