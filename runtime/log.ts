export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
	timestamp: string;
	level: LogLevel;
	message: string;
	sessionId?: string;
	error?: { name: string; message: string; code?: string; stack?: string };
	context?: Record<string, unknown>;
};

export type LogSink = (entry: LogEntry) => void;

function formatError(err: unknown): LogEntry["error"] | undefined {
	if (err === undefined || err === null) return undefined;
	if (err instanceof Error) {
		const code = (err as { code?: unknown }).code;
		return {
			name: err.name,
			message: err.message,
			...(typeof code === "string" || typeof code === "number" ? { code: String(code) } : {}),
			...(err.stack ? { stack: err.stack } : {}),
		};
	}
	return { name: "Error", message: String(err) };
}

const defaultSink: LogSink = (entry) => {
	// Keep test runs quiet on debug/info unless ADE_LOG_LEVEL is explicitly set
	const envLevel = (process.env.ADE_LOG_LEVEL ?? "").toLowerCase();
	if (entry.level === "debug" && envLevel !== "debug") return;
	if (process.env.NODE_ENV === "test" && !envLevel && entry.level !== "error") return;
	const line = JSON.stringify(entry);
	if (entry.level === "error") {
		console.error(line);
	} else if (entry.level === "warn") {
		console.warn(line);
	} else {
		console.info(line);
	}
};

let activeSink: LogSink = defaultSink;

export function setLogSink(sink: LogSink | null): void {
	activeSink = sink ?? defaultSink;
}

export function log(
	level: LogLevel,
	message: string,
	options?: { error?: unknown; sessionId?: string; context?: Record<string, unknown> },
): void {
	const entry: LogEntry = {
		timestamp: new Date().toISOString(),
		level,
		message,
		...(options?.sessionId ? { sessionId: options.sessionId } : {}),
		...(options?.error !== undefined ? { error: formatError(options.error) } : {}),
		...(options?.context ? { context: options.context } : {}),
	};
	activeSink(entry);
}

export const logger = {
	debug: (message: string, options?: { error?: unknown; sessionId?: string; context?: Record<string, unknown> }) =>
		log("debug", message, options),
	info: (message: string, options?: { error?: unknown; sessionId?: string; context?: Record<string, unknown> }) =>
		log("info", message, options),
	warn: (message: string, options?: { error?: unknown; sessionId?: string; context?: Record<string, unknown> }) =>
		log("warn", message, options),
	error: (message: string, options?: { error?: unknown; sessionId?: string; context?: Record<string, unknown> }) =>
		log("error", message, options),
};

export function isErrorCode(error: unknown, ...codes: string[]): boolean {
	if (!error || typeof error !== "object") return false;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && codes.includes(code);
}
