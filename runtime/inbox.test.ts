import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveState } from "./inbox.ts";

const base = { working: false, pendingApprovals: 0, lastTurnStatus: null, uncommitted: 0, commitsAhead: 0, pullRequest: null, seen: false };
const pr = (state: "OPEN" | "MERGED" | "CLOSED", checksSummary: "none" | "pending" | "success" | "failure" = "success", reviewDecision: string | null = null) =>
	({ number: 7, url: "https://github.com/o/r/pull/7", state, isDraft: false, checksSummary, reviewDecision });

test("approvals beat everything, then work in progress", () => {
	assert.deepEqual(deriveState({ ...base, working: true, pendingApprovals: 1 }), { state: "needs-approval", needsYou: true });
	assert.deepEqual(deriveState({ ...base, working: true, uncommitted: 3 }), { state: "working", needsYou: false });
});

test("pull request states drive the session once a PR exists", () => {
	assert.equal(deriveState({ ...base, pullRequest: pr("OPEN", "failure") }).state, "checks-failing");
	assert.equal(deriveState({ ...base, pullRequest: pr("OPEN", "failure") }).needsYou, true);
	assert.deepEqual(deriveState({ ...base, pullRequest: pr("OPEN") }), { state: "pr-open", needsYou: false });
	assert.equal(deriveState({ ...base, pullRequest: pr("OPEN", "success", "CHANGES_REQUESTED") }).needsYou, true);
	assert.deepEqual(deriveState({ ...base, uncommitted: 2, pullRequest: pr("MERGED") }), { state: "merged", needsYou: false });
});

test("changes and replies need you until the session has been seen", () => {
	assert.deepEqual(deriveState({ ...base, uncommitted: 1 }), { state: "ready-to-review", needsYou: true });
	assert.deepEqual(deriveState({ ...base, commitsAhead: 1, seen: true }), { state: "ready-to-review", needsYou: false });
	assert.deepEqual(deriveState({ ...base, lastTurnStatus: "completed" }), { state: "replied", needsYou: true });
	assert.deepEqual(deriveState({ ...base, lastTurnStatus: "failed", seen: true }), { state: "failed", needsYou: false });
	assert.deepEqual(deriveState(base), { state: "idle", needsYou: false });
});
