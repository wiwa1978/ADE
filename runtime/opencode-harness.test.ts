import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { applyEvent, engineArgs, type EngineSession } from "./engines.ts";
import { EuPolicy } from "./eu-policy.ts";
import { copySkillsForCli, cliSkillsDir } from "./cli-capabilities.ts";
import { DEFAULT_SUBAGENT_POLICY, resolveHarness, type SubagentHarness } from "./subagent-policy.ts";

describe("OpenCode harness support", () => {
	it("builds non-interactive JSON args with resume and model flags", () => {
		const fresh = engineArgs("opencode", "fix tests", null, "auto-safe", "mistral/devstral-latest");
		assert.deepEqual(fresh, ["run", "--format", "json", "--model", "mistral/devstral-latest", "--", "fix tests"]);

		const resumed = engineArgs("opencode", "continue", "ses_123", "auto-all", null);
		assert.deepEqual(resumed, ["run", "--format", "json", "--session", "ses_123", "--", "continue"]);
	});

	it("translates OpenCode JSON events into ADE timeline items and usage", () => {
		const state: EngineSession = {
			engine: "opencode",
			externalId: null,
			items: [],
			usage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
			lastStatus: null,
			updatedAt: 0,
		};
		const assistant: Extract<EngineSession["items"][number], { kind: "assistant" }> = { id: "a1", kind: "assistant", thinking: "", text: "", toolCalls: [], createdAt: 1 };

		applyEvent("opencode", state, { assistant }, { type: "reasoning", sessionID: "ses_abc", part: { text: "Checking files" } });
		applyEvent("opencode", state, { assistant }, { type: "tool_use", sessionID: "ses_abc", part: { callID: "c1", tool: "read", state: { status: "running", input: { path: "README.md" } } } });
		applyEvent("opencode", state, { assistant }, { type: "tool_use", sessionID: "ses_abc", part: { callID: "c1", tool: "read", state: { status: "completed", output: "# ADE" } } });
		applyEvent("opencode", state, { assistant }, { type: "text", sessionID: "ses_abc", part: { text: "Done." } });
		applyEvent("opencode", state, { assistant }, { type: "step_finish", sessionID: "ses_abc", part: { tokens: { input: 120, output: 45 }, cost: 0.002 } });

		assert.equal(state.externalId, "ses_abc");
		assert.equal(assistant.thinking, "Checking files");
		assert.equal(assistant.text, "Done.");
		assert.equal(assistant.toolCalls.length, 1);
		assert.equal(assistant.toolCalls[0].status, "done");
		assert.equal(assistant.toolCalls[0].output, "# ADE");
		assert.equal(state.usage.inputTokens, 120);
		assert.equal(state.usage.outputTokens, 45);
		assert.equal(state.usage.totalCost, 0.002);
	});

	it("allows OpenCode under EU-only mode when configured with an EU or local compatible endpoint", () => {
		const dir = mkdtempSync(join(tmpdir(), "ade-eu-opencode-"));
		try {
			const euWithMistral = new EuPolicy(dir, () => "https://api.mistral.ai/v1");
			euWithMistral.set({ euOnly: true });
			assert.equal(euWithMistral.engineRegion("opencode"), "eu");
			assert.equal(euWithMistral.engineBlock("opencode"), null);
			assert.ok(euWithMistral.engineBlock("claude-code"));

			const euWithoutCompat = new EuPolicy(dir, () => "");
			euWithoutCompat.set({ euOnly: true });
			assert.equal(euWithoutCompat.engineRegion("opencode"), "non-eu");
			assert.ok(euWithoutCompat.engineBlock("opencode"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("copies active skills into .opencode/skills and resolves subagent harness", () => {
		const dir = mkdtempSync(join(tmpdir(), "ade-opencode-skills-"));
		try {
			const skillSrc = join(dir, "src-skill");
			const workspace = join(dir, "workspace");
			mkdirSync(skillSrc, { recursive: true });
			mkdirSync(workspace, { recursive: true });
			writeFileSync(join(skillSrc, "SKILL.md"), "# Skill");

			const copied = copySkillsForCli(workspace, "opencode", [{ name: "my-skill", dir: skillSrc }]);
			assert.equal(copied, 1);
			assert.ok(existsSync(join(cliSkillsDir(workspace, "opencode"), "my-skill", "SKILL.md")));

			const installed = new Set<SubagentHarness>(["pi", "opencode"]);
			assert.deepEqual(resolveHarness("opencode", DEFAULT_SUBAGENT_POLICY, installed), { harness: "opencode", note: "" });
			assert.deepEqual(resolveHarness("open-code", DEFAULT_SUBAGENT_POLICY, installed), { harness: "opencode", note: "" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
