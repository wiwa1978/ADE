import assert from "node:assert/strict";
import { test } from "node:test";
import { MEMORY_PER_AGENT, MEMORY_RESERVE, SubagentScheduler, type HostLoad } from "./scheduler.ts";

const GB = 1024 ** 3;

function setup(maxConcurrent = 0, memory = 8 * GB) {
	let now = 0;
	const load: HostLoad = { availableMemory: memory, load: 0.5, cpus: 2 };
	const started: string[] = [];
	const scheduler = new SubagentScheduler({ settings: () => ({ maxConcurrent }), readLoad: () => load, now: () => now });
	const submit = (key: string, counts = true) => scheduler.submit(key, () => started.push(key), counts);
	return { scheduler, load, started, submit, advance: (ms: number) => { now += ms; } };
}

test("starts as many as memory allows and queues the rest in order", async () => {
	// Room for 2 besides the first: 3.5 GB free = reserve + 2 agents (+ the first, which always starts).
	const t = setup(0, MEMORY_RESERVE + 2 * MEMORY_PER_AGENT + 0.5 * GB);
	const results = ["a", "b", "c", "d"].map(key => t.submit(key));
	// The first always starts; the next two only once their memory is counted against the free memory.
	assert.deepEqual(t.started, ["a", "b"]);
	assert.equal(t.scheduler.position("c"), 1);
	assert.equal(t.scheduler.position("d"), 2);

	// A minute later the started ones have claimed their memory; the reading reflects it.
	t.advance(61_000);
	t.load.availableMemory = MEMORY_RESERVE + 0.5 * GB;
	t.scheduler.pump();
	assert.deepEqual(t.started, ["a", "b"], "no room yet");

	t.load.availableMemory += MEMORY_PER_AGENT;
	t.scheduler.finished("a");
	assert.deepEqual(t.started, ["a", "b", "c"]);
	assert.equal(t.scheduler.position("d"), 1);
	assert.equal(await results[2], true);

	assert.equal(t.scheduler.cancel("d"), true);
	assert.equal(await results[3], false);
	assert.equal(t.scheduler.cancel("d"), false);
});

test("a maximum caps it even with plenty of memory; remote agents don't count", () => {
	const t = setup(2, 64 * GB);
	for (const key of ["a", "b", "c"]) void t.submit(key);
	assert.deepEqual(t.started, ["a", "b"]);
	void t.submit("remote", false);
	assert.deepEqual(t.started, ["a", "b", "remote"]);
	t.scheduler.finished("remote");
	assert.deepEqual(t.started, ["a", "b", "remote"], "finishing an uncounted agent frees nothing");
	t.scheduler.finished("b");
	assert.deepEqual(t.started, ["a", "b", "remote", "c"]);
	t.scheduler.cancelMatching("x");
	assert.equal(t.scheduler.running(), 2);
});

test("always runs at least one, and waits while the CPU is flat out", () => {
	const t = setup(0, 0.1 * GB);
	void t.submit("a");
	void t.submit("b");
	assert.deepEqual(t.started, ["a"]);
	t.load.availableMemory = 32 * GB;
	t.load.load = 5;
	t.advance(61_000);
	t.scheduler.pump();
	assert.deepEqual(t.started, ["a"], "load 5 on 2 CPUs");
	t.load.load = 1;
	t.scheduler.pump();
	assert.deepEqual(t.started, ["a", "b"]);
});

test("without a memory reading, allows a fixed number", () => {
	const t = setup(0, Number.NaN);
	for (const key of ["a", "b", "c", "d", "e"]) void t.submit(key);
	assert.equal(t.started.length, 4);
});
