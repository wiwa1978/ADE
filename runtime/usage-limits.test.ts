import assert from "node:assert/strict";
import { test } from "node:test";
import { isUsageLimit, MAX_TRIES, resetDelayMs, UsageLimitWaiter, type FallbackModel, type UsageWait } from "./usage-limits.ts";

test("recognises usage and rate limits, but not billing or sign-in problems", () => {
	for (const text of [
		"Claude AI usage limit reached|1767225600",
		"5-hour limit reached ∙ resets 3am",
		'Turn ended without an answer: model_error ({"status":429,"error":{"type":"rate_limit_error"}})',
		"You've hit your usage limit. Try again in 2 hours 14 minutes.",
		"Overloaded",
		"insufficient_quota: You exceeded your current quota",
	]) assert.equal(isUsageLimit(text), true, text);
	for (const text of ["Your credit balance is too low to access the Anthropic API.", "401 Unauthorized: invalid api key", "Command failed: npm test", ""]) {
		assert.equal(isUsageLimit(text), false, text);
	}
});

test("reads when the limit resets", () => {
	const now = new Date(2026, 10, 23, 22, 0, 0).getTime();
	assert.equal(resetDelayMs("Claude AI usage limit reached|1767225600", 1767225600_000 - 60_000), 60_000);
	assert.equal(resetDelayMs("Try again in 5m30s.", now), 330_000);
	assert.equal(resetDelayMs("Please retry after 120 seconds", now), 120_000);
	assert.equal(resetDelayMs("Try again in 2 hours 14 minutes.", now), (2 * 60 + 14) * 60_000);
	assert.equal(resetDelayMs("5-hour limit reached ∙ resets 3am", now), 5 * 3_600_000, "3am tomorrow");
	assert.equal(resetDelayMs("limit resets at 23:30", now), 90 * 60_000);
	assert.equal(resetDelayMs(`resets at ${new Date(now + 600_000).toISOString()}`, now), 600_000);
	assert.equal(resetDelayMs("Overloaded", now), null);
});

function setup(fallback: FallbackModel | null = null) {
	let now = 0;
	const resumed: Array<[string, FallbackModel | null]> = [];
	const notes: Array<UsageWait | null> = [];
	const waiter = new UsageLimitWaiter({ fallback: () => fallback, resume: (id, model) => resumed.push([id, model]), notify: (_id, wait) => notes.push(wait), now: () => now });
	return { waiter, resumed, notes, setNow: (value: number) => { now = value; } };
}

test("without a fallback, waits for the stated reset and continues on the same model", t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { waiter, resumed } = setup();
	const model = { provider: "anthropic", model: "claude-opus-5-5" };
	assert.equal(waiter.failed("s1", "Command failed", model), false, "other failures are left alone");
	assert.equal(waiter.failed("s1", "Rate limited. Try again in 10 minutes.", model), true);
	assert.equal(waiter.waiting("s1")?.until, 11 * 60_000, "a minute after the reset");
	t.mock.timers.tick(10 * 60_000);
	assert.deepEqual(resumed, []);
	t.mock.timers.tick(60_000);
	assert.deepEqual(resumed, [["s1", model]]);

	// No reset time given: back off 5, 15, 30, 60 minutes.
	waiter.failed("s2", "Overloaded", model);
	assert.equal(waiter.waiting("s2")?.until, 5 * 60_000);
	waiter.failed("s2", "Overloaded", model);
	assert.equal(waiter.waiting("s2")?.until, 15 * 60_000);
	waiter.cancel("s2");
	assert.equal(waiter.waiting("s2"), null);
	t.mock.timers.tick(60 * 60_000);
	assert.equal(resumed.length, 1, "a cancelled wait doesn't continue");
});

test("with a fallback model, continues on it at once; gives up after many tries", () => {
	const fallback = { provider: "openai", model: "gpt-5" };
	const { waiter, resumed, notes } = setup(fallback);
	waiter.failed("s1", "usage limit reached", { provider: "anthropic", model: "claude-opus-5-5" });
	assert.deepEqual(resumed, [["s1", fallback]]);
	assert.equal(waiter.waiting("s1")?.fallback, "openai/gpt-5");
	// The fallback hits a limit too: now wait.
	waiter.failed("s1", "429 Too Many Requests", fallback);
	assert.equal(resumed.length, 1);
	assert.ok(waiter.waiting("s1")!.until > 0);
	waiter.succeeded("s1");
	assert.equal(waiter.waiting("s1"), null);

	for (let i = 0; i < MAX_TRIES; i++) waiter.failed("s3", "429", fallback);
	assert.ok(waiter.waiting("s3"));
	waiter.failed("s3", "429", fallback);
	assert.equal(waiter.waiting("s3"), null);
	assert.equal(notes.at(-1), null);
	waiter.stop();
});
