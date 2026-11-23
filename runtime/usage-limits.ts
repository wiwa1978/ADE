// When a model provider says "usage limit reached" or "rate limited", unattended work shouldn't just
// fail and sit there until morning. ADE waits until the limit resets (from the provider's message
// when it says when, otherwise with growing pauses) and then tells the agent to continue, or, when
// a fallback model is set in Settings, continues straight away on that model.

/** Messages that mean "try again later", from Anthropic, OpenAI, Claude Code, Codex and others. */
const LIMIT_PATTERN = /usage limit|rate[ _-]?limit|too many requests|\b429\b|quota (?:exceeded|reached)|insufficient_quota|limit (?:reached|exceeded)|overloaded|\b529\b|resets? (?:at|in)\b|try again (?:in|later|at)/i;
/** Limits that waiting doesn't fix. */
const NOT_A_WAIT = /credit balance is too low|billing|payment required|\b402\b|invalid api key|unauthori[sz]ed/i;

export function isUsageLimit(text: string | null | undefined) {
	if (!text) return false;
	return LIMIT_PATTERN.test(text) && !NOT_A_WAIT.test(text);
}

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };
const DURATION = String.raw`(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])`;

/**
 * How long until the limit resets, if the message says. Understands "try again in 5m30s",
 * "retry after 120 seconds", "resets in 2 hours", "resets 3am" / "resets at 15:00" (local time),
 * Claude Code's "usage limit reached|1767225600", and ISO timestamps.
 */
export function resetDelayMs(text: string, now = Date.now()): number | null {
	const epoch = text.match(/limit reached\|(\d{10,13})/i);
	if (epoch) {
		const at = Number(epoch[1]) * (epoch[1].length === 10 ? 1000 : 1);
		return at > now ? at - now : null;
	}
	const relative = text.match(new RegExp(String.raw`(?:in|after)\s+((?:${DURATION}[\s,]*(?:and\s+)?)+)`, "i"));
	if (relative) {
		let total = 0;
		for (const part of relative[1].matchAll(new RegExp(DURATION, "gi"))) total += Number(part[1]) * (UNIT_MS[part[2][0].toLowerCase()] ?? 0);
		if (total > 0) return total;
	}
	const iso = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/);
	if (iso) {
		const at = Date.parse(iso[0]);
		if (Number.isFinite(at) && at > now) return at - now;
	}
	const clock = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
	if (clock && (clock[2] || clock[3])) {
		let hours = Number(clock[1]) % (clock[3] ? 12 : 24);
		if (clock[3]?.toLowerCase() === "pm") hours += 12;
		const at = new Date(now);
		at.setHours(hours, Number(clock[2] ?? 0), 0, 0);
		if (at.getTime() <= now) at.setDate(at.getDate() + 1);
		return at.getTime() - now;
	}
	return null;
}

/** Without a reset time: 5, 15, 30, then every 60 minutes. */
const BACKOFF_MINUTES = [5, 15, 30, 60];
/** A little slack after the stated reset, so the first try isn't a moment too early. */
const AFTER_RESET_MS = 60_000;
/** Give up after this many tries in a row (about half a day without a stated reset). */
export const MAX_TRIES = 14;

export type UsageWait = {
	/** When ADE will continue. */
	until: number;
	reason: string;
	tries: number;
	/** Set when ADE continued on the fallback model instead of waiting. */
	fallback?: string;
};

export type FallbackModel = { provider: string; model: string };

export type UsageLimitDeps = {
	fallback: () => FallbackModel | null;
	/** Continue the session: on the given model, or on the one it was using. */
	resume: (sessionId: string, model: FallbackModel | null) => void;
	notify: (sessionId: string, wait: UsageWait | null, message: string) => void;
	now?: () => number;
};

export class UsageLimitWaiter {
	#deps: UsageLimitDeps;
	#waits = new Map<string, UsageWait>();
	#timers = new Map<string, ReturnType<typeof setTimeout>>();
	#tries = new Map<string, number>();

	constructor(deps: UsageLimitDeps) {
		this.#deps = deps;
	}

	#now() {
		return this.#deps.now?.() ?? Date.now();
	}

	/** Why and until when a session is waiting for a usage limit, if it is. */
	waiting(sessionId: string) {
		return this.#waits.get(sessionId) ?? null;
	}

	/** Waits whose key starts with the prefix (a session's subagents: "sub-<sessionId>-"). */
	waitingWith(prefix: string) {
		return [...this.#waits].filter(([key]) => key.startsWith(prefix)).map(([key, wait]) => ({ key, ...wait }));
	}

	/**
	 * A session's run failed. If it was a usage limit, continue on the fallback model or wait for the
	 * reset; returns true when ADE took care of it.
	 */
	failed(sessionId: string, message: string, currentModel: FallbackModel | null, options: { fallback?: boolean } = {}) {
		if (!isUsageLimit(message)) return false;
		const tries = (this.#tries.get(sessionId) ?? 0) + 1;
		this.#tries.set(sessionId, tries);
		this.#clearTimer(sessionId);
		if (tries > MAX_TRIES) {
			this.#waits.delete(sessionId);
			this.#deps.notify(sessionId, null, `Gave up after ${MAX_TRIES} tries: the usage limit didn't reset. Continue the session yourself when it has.`);
			return true;
		}
		const fallback = options.fallback === false ? null : this.#deps.fallback();
		const onFallback = Boolean(fallback && currentModel && fallback.provider === currentModel.provider && fallback.model === currentModel.model);
		if (fallback && !onFallback) {
			const wait: UsageWait = { until: this.#now(), reason: firstLine(message), tries, fallback: `${fallback.provider}/${fallback.model}` };
			this.#waits.set(sessionId, wait);
			this.#deps.notify(sessionId, wait, `Usage limit reached; continuing on the fallback model ${fallback.model}.`);
			this.#deps.resume(sessionId, fallback);
			return true;
		}
		const stated = resetDelayMs(message, this.#now());
		const delay = stated !== null ? stated + AFTER_RESET_MS : BACKOFF_MINUTES[Math.min(tries - 1, BACKOFF_MINUTES.length - 1)] * 60_000;
		const wait: UsageWait = { until: this.#now() + delay, reason: firstLine(message), tries };
		this.#waits.set(sessionId, wait);
		this.#deps.notify(sessionId, wait, `Usage limit reached; ADE continues at ${new Date(wait.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`);
		const timer = setTimeout(() => {
			this.#timers.delete(sessionId);
			this.#deps.resume(sessionId, currentModel);
		}, delay);
		timer.unref?.();
		this.#timers.set(sessionId, timer);
		return true;
	}

	/** A run finished without hitting the limit (or the user took over): reset the count. */
	succeeded(sessionId: string) {
		this.#tries.delete(sessionId);
		this.cancel(sessionId);
	}

	/** Stop waiting, e.g. the user sent a message or stopped the session. */
	cancel(sessionId: string) {
		this.#clearTimer(sessionId);
		if (this.#waits.delete(sessionId)) this.#deps.notify(sessionId, null, "");
	}

	#clearTimer(sessionId: string) {
		const timer = this.#timers.get(sessionId);
		if (timer) clearTimeout(timer);
		this.#timers.delete(sessionId);
	}

	stop() {
		for (const timer of this.#timers.values()) clearTimeout(timer);
		this.#timers.clear();
	}
}

function firstLine(text: string) {
	return text.trim().split("\n")[0].slice(0, 300);
}

export const CONTINUE_PROMPT = "The usage limit has reset. Continue the task where you left off.";
