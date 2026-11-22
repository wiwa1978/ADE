import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { defineExtension, defineSignal, hook, ToolTask } from "@earendil-works/pi-durable";
import { bool, obj, opt, str } from "@earendil-works/pi-schema";
import type { RuntimeEventBus } from "./events.ts";

export type ApprovalPolicy = "ask" | "auto-safe" | "auto-all";

export type PendingApproval = {
	id: string;
	sessionId: string;
	taskId: string;
	signalKey: string;
	toolName: string;
	summary: string;
	command?: string;
	arguments: Record<string, unknown>;
	suggestedPrefix?: string;
	createdAt: number;
};

export const ApprovalSignal = defineSignal({
	name: "ade.approval.decision",
	version: 1,
	schema: obj({
		allow: bool(),
		reason: opt(str()),
	}),
});

const SAFE_COMMAND_PREFIXES = [
	"ls",
	"pwd",
	"echo",
	"cat",
	"head",
	"tail",
	"wc",
	"which",
	"env",
	"uname",
	"date",
	"whoami",
	"git status",
	"git diff",
	"git log",
	"git branch",
	"git show",
	"git rev-parse",
	"node --version",
	"node -v",
	"npm --version",
	"npm -v",
	"rg ",
	"find ",
	"grep ",
];

function extractCommandPrefix(command: string): string {
	const trimmed = command.trim();
	const parts = trimmed.split(/\s+/).filter(Boolean);
	if (parts.length === 0) return trimmed;
	if (parts.length >= 2 && ["git", "npm", "npx", "pnpm", "yarn", "cargo", "python", "python3", "node", "gh", "docker"].includes(parts[0])) {
		return `${parts[0]} ${parts[1]}`;
	}
	return parts[0];
}

function isSafeReadOnlyCommand(command: string): boolean {
	const trimmed = command.trim();
	// Reject pipes, redirects, command substitution, chaining that could execute arbitrary writes
	if (/[;&|`$<>]/.test(trimmed)) return false;
	return SAFE_COMMAND_PREFIXES.some(prefix =>
		trimmed === prefix.trim() || trimmed.startsWith(prefix.endsWith(" ") ? prefix : `${prefix} `),
	);
}

export class ApprovalManager {
	#db: DatabaseSync;
	#events: RuntimeEventBus;
	#pending = new Map<string, PendingApproval & { harness: any }>();
	#policy: ApprovalPolicy = "auto-safe";
	#sessionPolicies = new Map<string, ApprovalPolicy>();

	constructor(db: DatabaseSync, events: RuntimeEventBus) {
		this.#db = db;
		this.#events = events;
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS approval_rules (
				id TEXT PRIMARY KEY,
				toolName TEXT NOT NULL,
				prefix TEXT NOT NULL,
				createdAt INTEGER NOT NULL,
				UNIQUE(toolName, prefix)
			);
			CREATE TABLE IF NOT EXISTS approval_settings (
				id INTEGER PRIMARY KEY CHECK(id=1),
				policy TEXT NOT NULL
			);
		`);
		const row = this.#db.prepare("SELECT policy FROM approval_settings WHERE id=1").get() as { policy?: string } | undefined;
		if (row?.policy && ["ask", "auto-safe", "auto-all"].includes(row.policy)) {
			this.#policy = row.policy as ApprovalPolicy;
		}
	}

	policy(sessionId?: string): ApprovalPolicy {
		if (sessionId && this.#sessionPolicies.has(sessionId)) {
			return this.#sessionPolicies.get(sessionId)!;
		}
		return this.#policy;
	}

	setPolicy(policy: ApprovalPolicy, sessionId?: string): void {
		if (!["ask", "auto-safe", "auto-all"].includes(policy)) {
			throw Object.assign(new Error("Approval policy must be ask, auto-safe, or auto-all."), { statusCode: 400 });
		}
		if (sessionId) {
			this.#sessionPolicies.set(sessionId, policy);
		} else {
			this.#policy = policy;
			this.#db.prepare("INSERT INTO approval_settings (id, policy) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET policy=excluded.policy").run(policy);
		}
	}

	listRules(): { id: string; toolName: string; prefix: string; createdAt: number }[] {
		return this.#db.prepare("SELECT id, toolName, prefix, createdAt FROM approval_rules ORDER BY createdAt DESC").all() as any;
	}

	addRule(toolName: string, prefix: string): void {
		const clean = prefix.trim();
		if (!clean) return;
		this.#db.prepare("INSERT OR IGNORE INTO approval_rules (id, toolName, prefix, createdAt) VALUES (?, ?, ?, ?)")
			.run(randomUUID(), toolName, clean, Date.now());
	}

	removeRule(id: string): void {
		this.#db.prepare("DELETE FROM approval_rules WHERE id=?").run(id);
	}

	hasAllowRule(toolName: string, command?: string): boolean {
		const rules = this.#db.prepare("SELECT prefix FROM approval_rules WHERE toolName=?").all(toolName) as { prefix: string }[];
		if (!rules.length) return false;
		if (!command) return rules.some(r => r.prefix === "*");
		const trimmed = command.trim();
		return rules.some(r => r.prefix === "*" || trimmed === r.prefix || trimmed.startsWith(`${r.prefix} `));
	}

	listPending(sessionId?: string): PendingApproval[] {
		const items = [...this.#pending.values()].map(({ harness: _h, ...rest }) => rest);
		return sessionId ? items.filter(item => item.sessionId === sessionId) : items;
	}

	shouldRequireApproval(sessionId: string, toolName: string, args: Record<string, unknown>): boolean {
		const currentPolicy = this.policy(sessionId);
		if (currentPolicy === "auto-all") return false;
		if (toolName === "run_command") {
			const command = typeof args?.command === "string" ? args.command : "";
			if (this.hasAllowRule("run_command", command)) return false;
			if (currentPolicy === "auto-safe" && isSafeReadOnlyCommand(command)) return false;
			return true;
		}
		if (toolName.startsWith("mcp_")) {
			if (this.hasAllowRule(toolName, "*")) return false;
			return currentPolicy === "ask";
		}
		return false;
	}

	createExtension(sessionId: string, getHarness: () => any) {
		return defineExtension({
			name: "ade-approvals",
			hooks: [
				hook(ToolTask, {
					beforeTool: async (call: any, api: any, ctx: any) => {
						const args = (call.arguments ?? {}) as Record<string, unknown>;
						if (!this.shouldRequireApproval(sessionId, call.name, args)) {
							return undefined;
						}
						const key = createHash("sha256")
							.update(JSON.stringify({ taskId: api.taskId, name: call.name, args }))
							.digest("hex")
							.slice(0, 20);
						const state = await api.readSignal(ApprovalSignal, key, ctx);
						if (state !== undefined) {
							if ("expired" in state) return { block: "Approval request expired." };
							return state.value.allow
								? undefined
								: { block: state.value.reason || "Denied by user." };
						}
						const id = `${api.taskId}:${key}`;
						const command = typeof args.command === "string" ? args.command : undefined;
						const suggestedPrefix = command ? extractCommandPrefix(command) : "*";
						const summary = command
							? `Run command: ${command}`
							: `Run tool ${call.name}`;
						const entry: PendingApproval & { harness: any } = {
							id,
							sessionId,
							taskId: api.taskId,
							signalKey: key,
							toolName: call.name,
							summary,
							command,
							arguments: args,
							suggestedPrefix,
							createdAt: Date.now(),
							harness: getHarness(),
						};
						this.#pending.set(id, entry);
						const { harness: _h, ...publicEntry } = entry;
						this.#events.emit("approval.requested", publicEntry, sessionId);
						const until = await api.memo(`ade.approval.until.${key}`, api.now() + 24 * 60 * 60 * 1000, ctx);
						return { sleep: { signals: [ApprovalSignal.key(key)], until } };
					},
				}),
			],
		});
	}

	async resolve(id: string, decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }): Promise<PendingApproval> {
		const pending = this.#pending.get(id);
		if (!pending) {
			throw Object.assign(new Error("Approval request not found or already resolved."), { statusCode: 404 });
		}
		if (decision.allow && decision.alwaysAllow) {
			this.addRule(pending.toolName, decision.prefix || pending.suggestedPrefix || "*");
		}
		this.#pending.delete(id);
		const { harness, ...publicEntry } = pending;
		if (harness) {
			await harness.signal(
				pending.taskId,
				ApprovalSignal,
				pending.signalKey,
				{ allow: Boolean(decision.allow), ...(decision.reason ? { reason: decision.reason } : {}) },
				context,
			);
		}
		this.#events.emit("approval.resolved", { ...publicEntry, allow: Boolean(decision.allow), reason: decision.reason }, pending.sessionId);
		return publicEntry;
	}

	clearSession(sessionId: string): void {
		for (const [id, item] of this.#pending) {
			if (item.sessionId === sessionId) this.#pending.delete(id);
		}
	}
}
