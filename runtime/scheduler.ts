// Starts heavy subagents (Claude Code, Codex: each a separate CLI process using about a gigabyte)
// only when this machine has room for them. The main agent may hand out any number of tasks; it
// decides what runs and in what order, the scheduler decides when. Queued subagents start in the
// order they were given as running ones finish and memory frees up.
//
// Subagents that run elsewhere (an SSH host, a Boat.dev VM) don't use this machine's memory and
// start at once. Docker containers and WSL2 do share it, so they're counted.
import { readFileSync } from "node:fs";
import { cpus, freemem, loadavg } from "node:os";

export type SchedulerSettings = {
	/** At most this many heavy subagents at once; 0 = decide from free memory alone. */
	maxConcurrent: number;
};

export type HostLoad = { availableMemory: number; load: number; cpus: number };

/** Roughly what one Claude Code / Codex run needs, plus what the runtime and OS keep free. */
export const MEMORY_PER_AGENT = 1024 ** 3;
export const MEMORY_RESERVE = 768 * 1024 ** 2;
/** Without a memory reading (macOS reports little "free" memory), allow this many. */
export const DEFAULT_MAX = 4;

/** MemAvailable on Linux (what can be used without swapping); null elsewhere. */
export function readHostLoad(): HostLoad {
	let availableMemory = Number.NaN;
	if (process.platform === "linux") {
		try {
			const match = readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)\s+kB/m);
			if (match) availableMemory = Number(match[1]) * 1024;
		} catch {
			availableMemory = freemem();
		}
	}
	return { availableMemory, load: loadavg()[0], cpus: cpus().length || 1 };
}

type Queued = { key: string; start: () => void; resolve: (started: boolean) => void; queuedAt: number };

export class SubagentScheduler {
	#running = new Set<string>();
	#queue: Queued[] = [];
	#settings: () => SchedulerSettings;
	#readLoad: () => HostLoad;
	#onChange: (key: string) => void;
	#timer: ReturnType<typeof setInterval> | null = null;
	/** Memory a just-started agent hasn't claimed yet; not trusted again until it had time to grow. */
	#recentStarts: number[] = [];
	#now: () => number;

	constructor({ settings, readLoad = readHostLoad, onChange = () => undefined, now = Date.now }: { settings: () => SchedulerSettings; readLoad?: () => HostLoad; onChange?: (key: string) => void; now?: () => number }) {
		this.#settings = settings;
		this.#readLoad = readLoad;
		this.#onChange = onChange;
		this.#now = now;
	}

	/** Position in the queue (1 = next), or 0 when it isn't queued. */
	position(key: string) {
		return this.#queue.findIndex(item => item.key === key) + 1;
	}

	running() {
		return this.#running.size;
	}

	queued() {
		return this.#queue.map(item => item.key);
	}

	/**
	 * Run `start` now if there's room, otherwise when there is. Resolves true once it started,
	 * false if it was cancelled while queued. `counts: false` for agents running on other machines.
	 */
	submit(key: string, start: () => void, counts = true): Promise<boolean> {
		if (!counts) {
			start();
			return Promise.resolve(true);
		}
		if (this.#running.has(key)) {
			start();
			return Promise.resolve(true);
		}
		const existing = this.#queue.find(item => item.key === key);
		if (existing) return new Promise(resolve => { const before = existing.resolve; existing.resolve = started => { before(started); resolve(started); }; });
		return new Promise(resolve => {
			this.#queue.push({ key, start, resolve, queuedAt: this.#now() });
			this.pump();
			if (this.position(key)) this.#onChange(key);
		});
	}

	/** A heavy subagent's run ended: make room for the next. */
	finished(key: string) {
		if (this.#running.delete(key)) this.pump();
	}

	/** Remove a queued subagent; true if it was queued. */
	cancel(key: string) {
		const index = this.#queue.findIndex(item => item.key === key);
		if (index < 0) return false;
		const [item] = this.#queue.splice(index, 1);
		item.resolve(false);
		this.#onChange(key);
		for (const other of this.#queue.slice(index)) this.#onChange(other.key);
		return true;
	}

	cancelMatching(prefix: string) {
		for (const item of [...this.#queue]) if (item.key.startsWith(prefix)) this.cancel(item.key);
	}

	/** Whether one more heavy agent fits now. */
	hasRoom() {
		const { maxConcurrent } = this.#settings();
		const running = this.#running.size;
		if (running === 0) return true; // Always make progress.
		if (maxConcurrent > 0 && running >= maxConcurrent) return false;
		const load = this.#readLoad();
		if (!Number.isFinite(load.availableMemory)) return maxConcurrent > 0 || running < DEFAULT_MAX;
		// Agents started in the last minute haven't used their memory yet; count them as if they had.
		const now = this.#now();
		this.#recentStarts = this.#recentStarts.filter(at => now - at < 60_000);
		const unclaimed = this.#recentStarts.length * MEMORY_PER_AGENT;
		if (load.availableMemory - unclaimed - MEMORY_RESERVE < MEMORY_PER_AGENT) return false;
		// A CPU that's already flat out gains nothing from another agent.
		return load.load < load.cpus * 2;
	}

	/** Start queued subagents while there's room. */
	pump() {
		while (this.#queue.length && this.hasRoom()) {
			const item = this.#queue.shift()!;
			this.#running.add(item.key);
			this.#recentStarts.push(this.#now());
			try {
				item.start();
				item.resolve(true);
			} catch {
				this.#running.delete(item.key);
				item.resolve(false);
			}
			this.#onChange(item.key);
			for (const other of this.#queue) this.#onChange(other.key);
		}
	}

	/** Re-check every few seconds: memory frees up without any agent finishing. */
	start() {
		if (this.#timer) return;
		this.#timer = setInterval(() => {
			if (this.#queue.length) this.pump();
		}, 5000);
		this.#timer.unref?.();
	}

	stop() {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}
}
