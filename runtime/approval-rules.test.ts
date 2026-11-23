import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ApprovalManager } from "./approvals.ts";
import { RuntimeEventBus } from "./events.ts";

test("deny rules block commands under every policy, including inside compound commands", () => {
	const approvals = new ApprovalManager(new DatabaseSync(":memory:"), new RuntimeEventBus());
	approvals.addRule("run_command", "git push", "deny");
	approvals.addRule("run_command", "npm test", "allow");
	approvals.setPolicy("auto-all");

	assert.equal(approvals.deniedBy("run_command", { command: "git push origin main" }), "git push");
	assert.equal(approvals.deniedBy("run_command", { command: "npm test && git push" }), "git push");
	assert.equal(approvals.deniedBy("run_command", { command: "git pushy" }), null, "a prefix only matches whole words");
	assert.equal(approvals.deniedBy("run_command", { command: "git status" }), null);

	// Allow rules still only skip the prompt; deny rules don't count as allow rules.
	approvals.setPolicy("ask");
	assert.equal(approvals.shouldRequireApproval("s", "run_command", { command: "npm test" }), false);
	assert.equal(approvals.hasAllowRule("run_command", "git push"), false);
	assert.deepEqual(approvals.listRules().map(rule => [rule.prefix, rule.effect]), [["git push", "deny"], ["npm test", "allow"]]);
});
