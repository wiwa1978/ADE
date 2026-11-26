// External agent engines (roadmap R3): run a session with the user's own Claude Code or Codex CLI
// instead of ADE's built-in Pi agent. Each message starts the CLI in the session's workspace in
// non-interactive JSON mode; follow-ups resume the CLI's own session, so context carries over.
// The CLI's events are translated into ADE's timeline format, so the conversation view, inbox,
// checkpoints, review and pull request tools work the same for every engine.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RuntimeEventBus } from "./events.ts";
import { redact, secretEnv } from "./project-secrets.ts";
import { claudeDenyRules } from "./guardrails.ts";
import { commandInvocation, q, sessionTarget, stopOnTarget } from "./execution-targets.ts";

export type EngineId = "claude-code" | "codex";
export type ApprovalPolicy = "ask" | "auto-safe" | "auto-all";

type ToolCall = { callId: string; name: string; arguments: Record<string, unknown>; status: "running" | "done" | "error"; output: string; isError: boolean };
type Item =
	| { id: string; kind: "user"; content: string; createdAt: number }
	| { id: string; kind: "assistant"; thinking: string; text: string; toolCalls: ToolCall[]; streaming?: boolean; createdAt: number }
	| { id: string; kind: "error"; message: string; createdAt: number };

export type EngineSession = {
	engine: EngineId;
	externalId: string | null;
	items: Item[];
	usage: { inputTokens: number; outputTokens: number; totalCost: number };
	lastStatus: "completed" | "failed" | null;
	updatedAt: number;
	/** Set when this run is a subagent of an ADE session: where it runs, and where its updates go. */
	parent?: { sessionId: string; conversationId: string; cwd?: string } | null;
};

/** How a run ended, for subagents the coordinator waits on. */
export type EngineResult = { status: "completed" | "failed"; text: string };

const ToolCallSchema = z.object({
	callId: z.string(),
	name: z.string(),
	arguments: z.record(z.string(), z.unknown()).default({}),
	status: z.enum(["running", "done", "error"]),
	output: z.string().default(""),
	isError: z.boolean().default(false),
});

const ItemSchema = z.discriminatedUnion("kind", [
	z.object({ id: z.string(), kind: z.literal("user"), content: z.string(), createdAt: z.number() }),
	z.object({
		id: z.string(),
		kind: z.literal("assistant"),
		thinking: z.string().default(""),
		text: z.string().default(""),
		toolCalls: z.array(ToolCallSchema).default([]),
		streaming: z.boolean().optional(),
		createdAt: z.number(),
	}),
	z.object({ id: z.string(), kind: z.literal("error"), message: z.string(), createdAt: z.number() }),
]);

const EngineSessionSchema = z.object({
	engine: z.enum(["claude-code", "codex"]),
	externalId: z.string().nullable().default(null),
	items: z.array(ItemSchema).default([]),
	usage: z.object({
		inputTokens: z.number().finite().default(0),
		outputTokens: z.number().finite().default(0),
		totalCost: z.number().finite().default(0),
	}).default({ inputTokens: 0, outputTokens: 0, totalCost: 0 }),
	lastStatus: z.enum(["completed", "failed"]).nullable().default(null),
	updatedAt: z.number().default(0),
	parent: z.object({
		sessionId: z.string(),
		conversationId: z.string(),
		cwd: z.string().optional(),
	}).nullable().optional(),
});

const MAX_CACHE_ENTRIES = 100;
const SAVE_DEBOUNCE_MS = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asFiniteNumber(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return 0;
}

function stringifyToolContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (isRecord(part) ? (asString(part.text) ?? "") : typeof part === "string" ? part : ""))
			.join("\n");
	}
	if (isRecord(content)) {
		try {
			return JSON.stringify(content);
		} catch {
			return "";
		}
	}
	return content == null ? "" : String(content);
}

export const engineInfo: Record<EngineId, { name: string; command: string; description: string }> = {
	"claude-code": { name: "Claude Code", command: "claude", description: "Anthropic's coding agent, using your Claude Code sign-in." },
	"codex": { name: "Codex", command: "codex", description: "OpenAI's coding agent, using your Codex sign-in." },
};

function commandAvailable(command: string) {
	try {
		execFileSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** Translate one CLI event (JSON line) into timeline changes. Exported for tests. */
export function applyEvent(engine: EngineId, state: EngineSession, turn: { assistant: Item & { kind: "assistant" } }, event: unknown): void {
	if (!isRecord(event)) return;
	const assistant = turn.assistant;
	const findTool = (id: string) => assistant.toolCalls.find(call => call.callId === id);
	const eventType = asString(event.type);
	if (engine === "claude-code") {
		const sessionId = asString(event.session_id);
		if (sessionId && !state.externalId) state.externalId = sessionId;
		const message = isRecord(event.message) ? event.message : null;
		const blocks = message && Array.isArray(message.content) ? message.content : null;
		if (eventType === "assistant" && blocks) {
			for (const rawBlock of blocks) {
				if (!isRecord(rawBlock)) continue;
				const blockType = asString(rawBlock.type);
				const blockText = asString(rawBlock.text);
				const blockThinking = asString(rawBlock.thinking);
				if (blockType === "text" && blockText) {
					assistant.text += (assistant.text ? "\n\n" : "") + blockText;
				} else if (blockType === "thinking" && blockThinking) {
					assistant.thinking += blockThinking;
				} else if (blockType === "tool_use") {
					assistant.toolCalls.push({
						callId: asString(rawBlock.id) ?? randomUUID(),
						name: asString(rawBlock.name) ?? "tool",
						arguments: isRecord(rawBlock.input) ? rawBlock.input : {},
						status: "running",
						output: "",
						isError: false,
					});
				}
			}
		} else if (eventType === "user" && blocks) {
			for (const rawBlock of blocks) {
				if (!isRecord(rawBlock) || asString(rawBlock.type) !== "tool_result") continue;
				const toolUseId = asString(rawBlock.tool_use_id);
				if (!toolUseId) continue;
				const call = findTool(toolUseId);
				if (!call) continue;
				const content = stringifyToolContent(rawBlock.content);
				call.output = content.slice(0, 20000);
				call.isError = Boolean(rawBlock.is_error);
				call.status = call.isError ? "error" : "done";
			}
		} else if (eventType === "result") {
			if (sessionId) state.externalId = sessionId;
			const usage = isRecord(event.usage) ? event.usage : {};
			state.usage.inputTokens +=
				asFiniteNumber(usage.input_tokens) +
				asFiniteNumber(usage.cache_read_input_tokens) +
				asFiniteNumber(usage.cache_creation_input_tokens);
			state.usage.outputTokens += asFiniteNumber(usage.output_tokens);
			state.usage.totalCost += asFiniteNumber(event.total_cost_usd);
			if (event.is_error === true) state.lastStatus = "failed";
			const resultText = asString(event.result);
			if (!assistant.text && resultText) assistant.text = resultText;
		}
		return;
	}
	// Codex
	const threadId = asString(event.thread_id);
	if (eventType === "thread.started" && threadId) state.externalId = threadId;
	const item = isRecord(event.item) ? event.item : null;
	if ((eventType === "item.started" || eventType === "item.updated" || eventType === "item.completed") && item) {
		const done = eventType === "item.completed";
		const itemType = asString(item.type);
		const itemText = asString(item.text);
		if (itemType === "agent_message" && done && itemText) {
			assistant.text += (assistant.text ? "\n\n" : "") + itemText;
		} else if (itemType === "reasoning" && done && itemText) {
			assistant.thinking += itemText;
		} else if (itemType === "command_execution" || itemType === "file_change" || itemType === "mcp_tool_call" || itemType === "web_search") {
			const itemId = asString(item.id) ?? (typeof item.id === "number" ? String(item.id) : randomUUID());
			let call = findTool(itemId);
			if (!call) {
				const name = itemType === "command_execution"
					? "run_command"
					: itemType === "file_change"
						? "edit_files"
						: itemType === "web_search"
							? "web_search"
							: (asString(item.tool) ?? "mcp_tool");
				const args: Record<string, unknown> = itemType === "command_execution"
					? { command: item.command }
					: itemType === "file_change"
						? { changes: item.changes }
						: itemType === "web_search"
							? { query: item.query }
							: { server: item.server, arguments: item.arguments };
				call = { callId: itemId, name, arguments: args, status: "running", output: "", isError: false };
				assistant.toolCalls.push(call);
			}
			const aggregated = asString(item.aggregated_output);
			if (aggregated !== undefined) call.output = aggregated.slice(-20000);
			if (done) {
				call.isError = item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0);
				call.status = call.isError ? "error" : "done";
			}
		} else if (itemType === "error") {
			const itemMessage = asString(item.message);
			if (itemMessage) {
				// Codex reports warnings (e.g. unsupported config) as error items; only turn.failed is fatal.
				assistant.thinking += `${assistant.thinking ? "\n" : ""}Note: ${itemMessage}`;
			}
		}
	} else if (eventType === "turn.completed" && isRecord(event.usage)) {
		state.usage.inputTokens += asFiniteNumber(event.usage.input_tokens);
		state.usage.outputTokens += asFiniteNumber(event.usage.output_tokens);
	} else if (eventType === "turn.failed" || eventType === "error") {
		state.lastStatus = "failed";
		const errObj = isRecord(event.error) ? event.error : null;
		const message = asString(errObj?.message) ?? asString(event.message);
		if (message) assistant.text += `\n\n${message}`;
	}
}

/**
 * A linked worktree keeps its Git metadata (index, refs, objects) in the main repository's .git,
 * outside the workspace. Sandboxed agents need write access there to stage and commit.
 */
export function gitWritableDirs(cwd: string): string[] {
	try {
		const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8", timeout: 5000, windowsHide: true }).trim();
		// .native expands Windows short names (RUNNER~1) the way git's own paths are written.
		const root = realpathSync.native(cwd);
		const dir = common ? realpathSync.native(common) : "";
		if (dir && dir !== root && !dir.startsWith(`${root}${sep}`)) return [dir];
	} catch {
		// Not a Git checkout: nothing extra to allow.
	}
	return [];
}

export function engineArgs(engine: EngineId, prompt: string, externalId: string | null, policy: ApprovalPolicy, model: string | null, writableDirs: string[] = [], contained = false, mcpConfigPath: string | null = null) {
	if (engine === "claude-code") {
		const mode = policy === "auto-all" ? "bypassPermissions" : policy === "ask" ? "default" : "acceptEdits";
		// ADE's guardrails as deny rules: they hold even in bypassPermissions (Autopilot).
		const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", mode, "--settings", JSON.stringify({ permissions: { deny: claudeDenyRules() } })];
		if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath, "--strict-mcp-config");
		if (externalId) args.push("--resume", externalId);
		if (model) args.push("--model", model);
		args.push("--", prompt);
		return args;
	}
	// In a container, VM or WSL the machine itself is the sandbox, and Codex's own sandbox often
	// can't start there, so it only stays on for read-only ("ask") sessions.
	const sandbox = policy === "auto-all" || (contained && policy !== "ask") ? ["--dangerously-bypass-approvals-and-sandbox"] : ["-s", policy === "ask" ? "read-only" : "workspace-write"];
	const args = ["exec", "--json", "--skip-git-repo-check", ...sandbox];
	if (policy !== "ask" && policy !== "auto-all") for (const dir of writableDirs) args.push("--add-dir", dir);
	if (model) args.push("-m", model);
	if (externalId) args.push("resume", externalId, "--", prompt);
	else args.push("--", prompt);
	return args;
}

function lastText(state: EngineSession | null | undefined) {
	for (const item of [...(state?.items ?? [])].reverse()) {
		if (item.kind === "assistant" && item.text.trim()) return item.text.trim();
		if (item.kind === "error") return item.message;
	}
	return "";
}

export class EngineManager {
	#dir: string;
	#events?: RuntimeEventBus;
	#running = new Map<string, ChildProcess>();
	#waiters = new Map<string, Array<(result: EngineResult) => void>>();
	#cwd = new Map<string, string>();
	#cache = new Map<string, EngineSession>();
	#saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	#saveQueues = new Map<string, Promise<void>>();
	#available: Record<EngineId, boolean> | null = null;
	#environment: NodeJS.ProcessEnv;

	#guard: ((engine: string, sessionId?: string) => string | null) | null = null;

	/** EU-only mode: why an engine may not be used (null when it may). */
	setGuard(guard: (engine: string, sessionId?: string) => string | null) {
		this.#guard = guard;
	}

	constructor({ stateDirectory, events, environment = process.env }: { stateDirectory: string; events?: RuntimeEventBus; environment?: NodeJS.ProcessEnv }) {
		this.#dir = join(stateDirectory, "engine-sessions");
		mkdirSync(this.#dir, { recursive: true });
		this.#events = events;
		this.#environment = environment;
	}

	available(): { id: "pi" | EngineId; name: string; description: string; available: boolean }[] {
		this.#available ??= { "claude-code": commandAvailable("claude"), "codex": commandAvailable("codex") };
		return [
			{ id: "pi", name: "ADE agent", description: "Built-in agent (Pi Durable) with your model provider, subagents, browser tools and approvals.", available: true },
			...(Object.keys(engineInfo) as EngineId[]).map(id => ({ id, name: engineInfo[id].name, description: engineInfo[id].description, available: this.#available![id] })),
		];
	}

	#path(sessionId: string) {
		if (!/^[\w-]+$/.test(sessionId)) throw Object.assign(new Error("Invalid session id."), { statusCode: 400 });
		return join(this.#dir, `${sessionId}.json`);
	}

	#cacheTouch(sessionId: string, value: EngineSession): EngineSession {
		this.#cache.delete(sessionId);
		this.#cache.set(sessionId, value);
		while (this.#cache.size > MAX_CACHE_ENTRIES) {
			let evicted = false;
			for (const oldestKey of this.#cache.keys()) {
				if (!this.#running.has(oldestKey)) {
					this.#cache.delete(oldestKey);
					evicted = true;
					break;
				}
			}
			if (!evicted) break;
		}
		return value;
	}

	get(sessionId: string): EngineSession | null {
		const cached = this.#cache.get(sessionId);
		if (cached) return this.#cacheTouch(sessionId, cached);
		try {
			const parsed = EngineSessionSchema.safeParse(JSON.parse(readFileSync(this.#path(sessionId), "utf8")));
			if (!parsed.success) return null;
			return this.#cacheTouch(sessionId, parsed.data);
		} catch {
			return null;
		}
	}

	#saveSync(sessionId: string, state: EngineSession) {
		state.updatedAt = Date.now();
		this.#cacheTouch(sessionId, state);
		const path = this.#path(sessionId);
		const temp = `${path}.${randomUUID()}.tmp`;
		writeFileSync(temp, JSON.stringify(state));
		renameSync(temp, path);
	}

	#persistAsync(sessionId: string, state: EngineSession) {
		state.updatedAt = Date.now();
		this.#cacheTouch(sessionId, state);
		const path = this.#path(sessionId);
		const payload = JSON.stringify(state);
		const prev = this.#saveQueues.get(sessionId) ?? Promise.resolve();
		const next = prev
			.catch(() => undefined)
			.then(async () => {
				const temp = `${path}.${randomUUID()}.tmp`;
				await writeFile(temp, payload, "utf8");
				await rename(temp, path);
			})
			.catch(() => undefined)
			.finally(() => {
				if (this.#saveQueues.get(sessionId) === next) this.#saveQueues.delete(sessionId);
			});
		this.#saveQueues.set(sessionId, next);
	}

	#scheduleSave(sessionId: string, state: EngineSession, immediate = false) {
		state.updatedAt = Date.now();
		this.#cacheTouch(sessionId, state);
		const existingTimer = this.#saveTimers.get(sessionId);
		if (immediate) {
			if (existingTimer) {
				clearTimeout(existingTimer);
				this.#saveTimers.delete(sessionId);
			}
			this.#persistAsync(sessionId, state);
			return;
		}
		if (existingTimer) return;
		const timer = setTimeout(() => {
			this.#saveTimers.delete(sessionId);
			this.#persistAsync(sessionId, state);
		}, SAVE_DEBOUNCE_MS);
		timer.unref?.();
		this.#saveTimers.set(sessionId, timer);
	}

	/** Choose the engine for a session (only before its first message). */
	setEngine(sessionId: string, engine: unknown, parent: EngineSession["parent"] = null) {
		if (engine === "pi") return null;
		if (engine !== "claude-code" && engine !== "codex") throw Object.assign(new Error("Unknown engine."), { statusCode: 400 });
		const blocked = this.#guard?.(engine, parent?.sessionId ?? sessionId);
		if (blocked) throw Object.assign(new Error(blocked), { statusCode: 403 });
		const existing = this.get(sessionId);
		if (existing?.items.length) {
			if (existing.parent && existing.engine === engine) return existing;
			throw Object.assign(new Error("The engine can't change after the conversation has started."), { statusCode: 409 });
		}
		const state: EngineSession = { engine, externalId: null, items: [], usage: { inputTokens: 0, outputTokens: 0, totalCost: 0 }, lastStatus: null, updatedAt: Date.now(), parent };
		this.#saveSync(sessionId, state);
		return state;
	}

	isWorking(sessionId: string) {
		return this.#running.has(sessionId);
	}

	snapshot(sessionId: string) {
		const state = this.get(sessionId);
		return {
			sessionId,
			conversationId: "0",
			busy: this.isWorking(sessionId),
			items: state?.items ?? [],
			liveTools: [],
			runFailure: null,
			usage: state ? state.usage : null,
			engine: state?.engine ?? null,
		};
	}

	#emit(sessionId: string) {
		const parent = this.get(sessionId)?.parent;
		if (parent) {
			// A subagent's updates belong to its ADE session, as that session's subagent conversation.
			this.#events?.emit("timeline.update", { ...this.snapshot(sessionId), sessionId: parent.sessionId, conversationId: parent.conversationId, isSubagent: true }, parent.sessionId);
			this.#events?.emit("subagents.update", { sessionId: parent.sessionId, subagentId: parent.conversationId, busy: this.isWorking(sessionId) }, parent.sessionId);
			return;
		}
		this.#events?.emit("timeline.update", this.snapshot(sessionId), sessionId);
	}

	/** Resolves when the current (or next) run for this key ends, with the agent's final text. */
	waitFor(sessionId: string): Promise<EngineResult> {
		if (!this.isWorking(sessionId)) {
			const state = this.get(sessionId);
			return Promise.resolve({ status: state?.lastStatus === "failed" ? "failed" : "completed", text: lastText(state) });
		}
		return new Promise(resolveWait => {
			const list = this.#waiters.get(sessionId) ?? [];
			list.push(resolveWait);
			this.#waiters.set(sessionId, list);
		});
	}

	send(sessionId: string, cwd: string, prompt: string, policy: ApprovalPolicy, model: string | null = null, mcpConfigPath: string | null = null) {
		const state = this.get(sessionId);
		if (!state) throw Object.assign(new Error("This session doesn't use an external engine."), { statusCode: 400 });
		if (this.#running.has(sessionId)) throw Object.assign(new Error("The agent is still working. Wait, or stop it first."), { statusCode: 409 });
		const blocked = this.#guard?.(state.engine, state.parent?.sessionId ?? sessionId);
		if (blocked) throw Object.assign(new Error(blocked), { statusCode: 403 });
		const content = prompt.trim();
		if (!content || content.length > 20000) throw Object.assign(new Error("Enter a message between 1 and 20000 characters."), { statusCode: 400 });
		const now = Date.now();
		state.items.push({ id: randomUUID(), kind: "user", content, createdAt: now });
		const assistant: Item & { kind: "assistant" } = { id: randomUUID(), kind: "assistant", thinking: "", text: "", toolCalls: [], streaming: true, createdAt: now };
		state.items.push(assistant);
		state.lastStatus = null;
		this.#saveSync(sessionId, state);
		const command = engineInfo[state.engine].command;
		const secrets = secretEnv(cwd);
		// A subagent runs where its ADE session runs.
		const targetSession = state.parent?.sessionId ?? sessionId;
		const target = sessionTarget(targetSession);
		const args = engineArgs(state.engine, content, state.externalId, policy, model, target === "local" ? gitWritableDirs(cwd) : [], target !== "local", mcpConfigPath);
		const env: Record<string, string> = { ...secrets, NO_COLOR: "1", IS_SANDBOX: "1" };
		// Sessions that run in Docker, WSL2, on an SSH host or a Boat.dev VM run the agent CLI there.
		// It's installed with npm on first use if missing; it signs in with ANTHROPIC_API_KEY /
		// CLAUDE_CODE_OAUTH_TOKEN / OPENAI_API_KEY (as project secrets) or its own sign-in on that machine.
		let remote: ReturnType<typeof commandInvocation> = null;
		if (target !== "local") {
			const pkg = state.engine === "claude-code" ? "@anthropic-ai/claude-code" : "@openai/codex";
			const install = `command -v ${command} >/dev/null 2>&1 || npm install -g ${pkg} >/dev/null 2>&1 || { echo "ADE: ${engineInfo[state.engine].name} isn't installed on this machine and couldn't be installed with npm (npm install -g ${pkg})." >&2; exit 127; }`;
			const signIn = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"].filter(name => this.#environment[name] || secrets[name]);
			for (const name of signIn) if (!env[name] && this.#environment[name]) env[name] = String(this.#environment[name]);
			remote = commandInvocation(targetSession, cwd, `${install}; ${command} ${args.map(q).join(" ")}`, [...Object.keys(secrets), ...signIn, "NO_COLOR", "IS_SANDBOX"], { pidFile: this.#pidFile(sessionId) });
		}
		const child = spawn(remote?.file ?? command, remote?.args ?? args, {
			cwd,
			env: { ...this.#environment, ...env, ...remote?.env },
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		this.#running.set(sessionId, child);
		this.#cwd.set(sessionId, cwd);
		this.#events?.emit("sessions.changed", { id: sessionId });
		let buffer = "";
		let stderr = "";
		let lastEmit = 0;
		const flush = (force = false) => {
			if (!force && Date.now() - lastEmit < 250) return;
			lastEmit = Date.now();
			this.#scheduleSave(sessionId, state, force);
			this.#emit(sessionId);
		};
		child.stdout?.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			let newline: number;
			while ((newline = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (!line.startsWith("{")) continue;
				try {
					// Keep project secrets out of the stored transcript.
					applyEvent(state.engine, state, { assistant }, JSON.parse(redact(line, secrets)));
				} catch {
					// Ignore lines that aren't events.
				}
			}
			flush();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = redact(stderr + chunk.toString("utf8"), secrets).slice(-4000);
		});
		child.on("error", error => {
			stderr = redact(`${stderr}\n${error.message}`, secrets).slice(-4000);
		});
		child.on("close", code => {
			this.#running.delete(sessionId);
			this.#cwd.delete(sessionId);
			assistant.streaming = false;
			for (const call of assistant.toolCalls) if (call.status === "running") call.status = code === 0 ? "done" : "error";
			const safeStderr = redact(stderr, secrets).trim();
			if (code !== 0 && code !== null && state.lastStatus !== "failed") state.lastStatus = "failed";
			if (state.lastStatus === "failed" || (code !== 0 && code !== null)) {
				state.items.push({ id: randomUUID(), kind: "error", message: `${engineInfo[state.engine].name} stopped with an error.${safeStderr ? ` ${safeStderr.split("\n").slice(-3).join(" ")}` : ""}`, createdAt: Date.now() });
			} else if (code === null) {
				state.items.push({ id: randomUUID(), kind: "error", message: "Stopped.", createdAt: Date.now() });
				state.lastStatus = "failed";
			} else {
				state.lastStatus = "completed";
			}
			if (!assistant.text && !assistant.toolCalls.length) state.items = state.items.filter(item => item !== assistant);
			flush(true);
			this.#events?.emit("sessions.changed", { id: sessionId });
			const waiters = this.#waiters.get(sessionId) ?? [];
			this.#waiters.delete(sessionId);
			for (const resolveWait of waiters) resolveWait({ status: state.lastStatus === "failed" ? "failed" : "completed", text: lastText(state) });
		});
		return this.snapshot(sessionId);
	}

	abort(sessionId: string) {
		const child = this.#running.get(sessionId);
		if (!child) return { ok: false };
		child.kill("SIGTERM");
		// On another machine, end the agent there too (killing the local client alone doesn't).
		const targetSession = this.get(sessionId)?.parent?.sessionId ?? sessionId;
		if (sessionTarget(targetSession) !== "local") stopOnTarget(targetSession, this.#pidFile(sessionId), this.#cwd.get(sessionId) ?? "");
		return { ok: true };
	}

	#pidFile(sessionId: string) {
		return `/tmp/ade-engine-${sessionId.replace(/[^a-zA-Z0-9-]/g, "").slice(-60)}.pid`;
	}

	/** Stop every run whose key starts with this prefix (a session's subagents). */
	abortMatching(prefix: string) {
		for (const id of [...this.#running.keys()]) if (id.startsWith(prefix)) this.abort(id);
	}

	abortAll() {
		for (const id of [...this.#running.keys()]) this.abort(id);
		for (const timer of this.#saveTimers.values()) clearTimeout(timer);
		this.#saveTimers.clear();
	}
}
