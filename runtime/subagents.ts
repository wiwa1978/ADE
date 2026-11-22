import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { configure, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { arr, bool, obj, opt, str } from "@earendil-works/pi-schema";
import { createWorkspaceTools } from "./coding-tools.ts";
import { createSearchTools } from "./search-tools.ts";
import { createShellTools, type ProcessManager } from "./shell-tools.ts";
import type { RuntimeEventBus } from "./events.ts";
import { resolveBaseCommit, type WorktreeManager } from "./worktrees.ts";

export type SubagentMode = "readonly" | "workspace" | "worktree";

export type SubagentRecordMetadata = {
	name: string;
	role?: string;
	task: string;
	mode: SubagentMode;
	background: boolean;
	workspacePath?: string | null;
	branch?: string | null;
	createdAt: number;
};

type SubagentToolsOptions = {
	sessionId: string;
	workspace: string | null;
	workspaceIdentity: { dev: string; ino: string } | null;
	repository: string | null;
	readTools: readonly any[];
	workspaceTools: readonly any[];
	searchTools: readonly any[];
	shellTools: readonly any[];
	worktreeManager?: WorktreeManager;
	processes?: ProcessManager;
	events?: RuntimeEventBus;
	onSubagentCreated?: (conversationId: string | number) => void;
};

function toConvId(raw: string): any {
	return /^\d+$/.test(raw) ? Number(raw) : raw;
}

function extractPlainText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part: any) => part?.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("\n");
}

export function createSubagentTools(opts: SubagentToolsOptions) {
	const backgroundPromises = new Map<string, Promise<{ status: string; report: string }>>();

	const buildInstructions = (role: string, mode: SubagentMode, workspacePath: string | null) => {
		const capabilityText =
			mode === "readonly"
				? "You are a read-only subagent. You can inspect and search files, but you cannot edit files or run commands."
				: mode === "worktree"
					? `You are a workspace subagent with full file, search, and shell access in your own isolated Git worktree (${workspacePath ?? "assigned worktree"}). Make clean, focused changes and verify them.`
					: `You are a workspace subagent with full file, search, and shell access in the shared workspace (${workspacePath ?? "assigned workspace"}). Make clean, focused changes and verify them.`;
		return `You are "${role}", a focused subagent working for the session lead in ADE. ${capabilityText} Complete your assigned task thoroughly and return a clear, concise report of findings or changes made.`;
	};

	const selectModelTools = async (mode: SubagentMode, subId: string): Promise<{ tools: any[]; workspacePath: string | null; branch: string | null }> => {
		if (mode === "readonly" || !opts.workspace || !opts.workspaceIdentity) {
			return {
				tools: [...opts.readTools, ...opts.searchTools],
				workspacePath: opts.workspace,
				branch: null,
			};
		}
		if (mode === "worktree" && opts.worktreeManager && opts.repository) {
			const branch = `ade/sub-${subId.slice(0, 8)}`;
			const base = await resolveBaseCommit(opts.repository, "HEAD");
			const op = await opts.worktreeManager.create({
				id: subId,
				repository: opts.repository,
				branch,
				base,
			});
			if (op.status !== "completed" || !op.target) {
				throw new Error(`Could not create subagent worktree: ${op.message}`);
			}
			const info = statSync(op.target, { bigint: true });
			const identity = { dev: String(info.dev), ino: String(info.ino) };
			const wtFiles = createWorkspaceTools(op.target, identity);
			const wtSearch = createSearchTools(op.target, identity);
			const wtShell = opts.processes
				? createShellTools({ sessionId: opts.sessionId, workspace: op.target, identity, processes: opts.processes })
				: null;
			return {
				tools: [...(wtFiles.tools ?? []), ...(wtSearch.tools ?? []), ...(wtShell?.tools ?? [])],
				workspacePath: op.target,
				branch,
			};
		}
		return {
			tools: [...opts.workspaceTools, ...opts.searchTools, ...opts.shellTools],
			workspacePath: opts.workspace,
			branch: null,
		};
	};

	// Backward-compatible `delegate` tool (used by existing tests & simple read-only delegations)
	const delegateTool = defineTool({
		name: "delegate",
		description: "Delegate a bounded, independent read-only analysis to a subagent in this workspace. Returns its report.",
		parameters: obj({ name: str(), task: str() }),
		replay: "safe",
		async execute(args, api, ctx) {
			if (!args.name.trim() || args.name.length > 100 || !args.task.trim() || args.task.length > 8000) {
				throw new Error("Provide a short subagent name and an assignment between 1 and 8000 characters.");
			}
			const id = await api.commit(async tx => {
				const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
				if (existing) return existing.id;
				const child = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
				await configure(tx, child.id, {
					modelTools: [...opts.readTools, ...opts.searchTools],
					maxTurns: 12,
					instructions: buildInstructions(args.name.trim(), "readonly", opts.workspace),
				});
				const meta: SubagentRecordMetadata = {
					name: args.name.trim(),
					role: "Analyst",
					task: args.task,
					mode: "readonly",
					background: false,
					workspacePath: opts.workspace,
					branch: null,
					createdAt: Date.now(),
				};
				await tx.appendEntry(child.id, { kind: "ade.assignment", data: meta });
				return child.id;
			}, ctx);
			opts.onSubagentCreated?.(id);
			await api.details({ conversationId: id, name: args.name.trim(), mode: "readonly", background: false }, ctx);
			const child = await api.conversation(id, ctx);
			if (!child) throw new Error("The saved subagent conversation is unavailable.");
			const submission = await child.submit({ type: "input", content: args.task, requestId: `ade-delegate:${api.taskId}` }, ctx);
			const settled = await submission.wait(ctx);
			if (settled.status !== "done") {
				return { isError: true, output: [{ type: "text", text: `Subagent did not complete: ${settled.reason}` }] };
			}
			const entry = settled.answer ? await api.commit(tx => tx.entry(settled.answer!), ctx) : undefined;
			const text = entry?.model?.filter((m: any) => m.role === "assistant")
				.map((m: any) => extractPlainText(m.content)).join("\n");
			if (!text?.trim()) throw new Error("The subagent completed without a text report.");
			return { output: [{ type: "text", text }], details: { conversationId: id, name: args.name.trim(), mode: "readonly" } };
		},
	});

	const spawnSubagentTool = defineTool({
		name: "spawn_subagent",
		description: "Spawn a new subagent (1 or more per session) with its own conversation and live UI pane. Set background=true to run concurrently while you continue working or spawn multiple parallel subagents. Modes: 'readonly' (inspect/search only), 'workspace' (edit/run in current workspace), or 'worktree' (edit/run in a dedicated isolated Git worktree).",
		parameters: obj({
			name: str({ description: "Short descriptive name (e.g. 'Backend API', 'Test Runner', 'UI Reviewer')" }),
			role: opt(str({ description: "2-5 word role title (e.g. 'Codebase Researcher', 'Frontend Builder')" })),
			task: str({ description: "Clear, actionable assignment for the subagent" }),
			mode: opt(str({ description: "One of: readonly (default), workspace, worktree" })),
			background: opt(bool({ description: "Run concurrently in background and return subagentId immediately (default false)" })),
		}),
		replay: "safe",
		async execute(args, api, ctx) {
			const name = args.name.trim();
			const role = (args.role ?? "Subagent").trim();
			const taskText = args.task.trim();
			const mode = (["readonly", "workspace", "worktree"].includes(args.mode ?? "") ? args.mode : "readonly") as SubagentMode;
			const background = Boolean(args.background);

			if (!name || name.length > 100 || !taskText || taskText.length > 12_000) {
				throw new Error("Provide a subagent name (<=100 chars) and task (<=12000 chars).");
			}

			const subUuid = randomUUID();
			const selected = await selectModelTools(mode, subUuid);

			const id = await api.commit(async tx => {
				if (!background) {
					const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
					if (existing) return existing.id;
				}
				const child = await tx.createConversation({
					ownership: background
						? { kind: "ownerless" }
						: { kind: "task", taskId: api.taskId },
				});
				await configure(tx, child.id, {
					modelTools: selected.tools,
					maxTurns: 24,
					instructions: buildInstructions(role || name, mode, selected.workspacePath),
				});
				const meta: SubagentRecordMetadata = {
					name,
					role,
					task: taskText,
					mode,
					background,
					workspacePath: selected.workspacePath,
					branch: selected.branch,
					createdAt: Date.now(),
				};
				await tx.appendEntry(child.id, { kind: "ade.assignment", data: meta });
				return child.id;
			}, ctx);

			opts.onSubagentCreated?.(id);
			await api.details({
				conversationId: id,
				name,
				role,
				mode,
				background,
				branch: selected.branch,
			}, ctx);

			const child = await api.conversation(id, ctx);
			if (!child) throw new Error("The created subagent conversation is unavailable.");

			const reqId = `ade-subagent:${api.taskId}:${id}`;
			const submission = await child.submit({ type: "input", content: taskText, requestId: reqId }, ctx);

			const awaitReport = async (): Promise<{ status: string; report: string }> => {
				const settled = await submission.wait(context);
				if (settled.status !== "done") {
					return { status: "failed", report: `Subagent "${name}" ended without a report: ${settled.reason}` };
				}
				const entry = settled.answer ? await api.commit(tx => tx.entry(settled.answer!), context) : undefined;
				const text = entry?.model?.filter((m: any) => m.role === "assistant")
					.map((m: any) => extractPlainText(m.content)).join("\n").trim() ?? "";
				return { status: "completed", report: text || "(completed without text output)" };
			};

			if (background) {
				const promise = awaitReport().finally(() => {
					opts.events?.emit("subagents.update", { sessionId: opts.sessionId, subagentId: String(id) }, opts.sessionId);
				});
				backgroundPromises.set(String(id), promise);
				opts.events?.emit("subagents.update", { sessionId: opts.sessionId, subagentId: String(id) }, opts.sessionId);
				return {
					output: [{
						type: "text",
						text: `Background subagent spawned.\n- subagentId: ${String(id)}\n- name: ${name}\n- mode: ${mode}${selected.branch ? `\n- branch: ${selected.branch}` : ""}\nUse wait_subagent, message_subagent, or list_subagents to track or coordinate with it.`,
					}],
					details: { conversationId: String(id), name, role, mode, background: true, branch: selected.branch },
				};
			}

			const result = await awaitReport();
			return {
				isError: result.status !== "completed",
				output: [{ type: "text", text: result.report }],
				details: { conversationId: String(id), name, role, mode, background: false, branch: selected.branch },
			};
		},
	});

	const messageSubagentTool = defineTool({
		name: "message_subagent",
		description: "Send a follow-up message or mid-turn steer to an existing subagent in this session.",
		parameters: obj({
			subagentId: str({ description: "Conversation ID of the subagent" }),
			message: str({ description: "Instruction or feedback to deliver" }),
			mode: opt(str({ description: "'follow-up' (default) or 'steer' (interrupts after current tool round)" })),
		}),
		replay: "unsafe",
		async execute(args, api, ctx) {
			const child = await api.conversation(toConvId(args.subagentId), ctx);
			if (!child) throw new Error(`Subagent ${args.subagentId} not found.`);
			const whenBusy = args.mode === "steer" ? "steer" : "followUp";
			const submission = await child.submit({
				type: "input",
				content: args.message,
				whenBusy,
			}, ctx);
			const promise = (async () => {
				const settled = await submission.wait(context);
				if (settled.status !== "done") return { status: "failed", report: `Ended: ${settled.reason}` };
				const entry = settled.answer ? await api.commit(tx => tx.entry(settled.answer!), context) : undefined;
				const text = entry?.model?.filter((m: any) => m.role === "assistant")
					.map((m: any) => extractPlainText(m.content)).join("\n").trim() ?? "";
				return { status: "completed", report: text || "(no text)" };
			})();
			backgroundPromises.set(String(args.subagentId), promise);
			opts.events?.emit("subagents.update", { sessionId: opts.sessionId, subagentId: String(args.subagentId) }, opts.sessionId);
			return {
				output: [{ type: "text", text: `Delivered ${whenBusy} message to subagent ${args.subagentId}.` }],
				details: { conversationId: String(args.subagentId), mode: whenBusy },
			};
		},
	});

	const waitSubagentTool = defineTool({
		name: "wait_subagent",
		description: "Wait for one or more background subagents to finish their current run and return their reports.",
		parameters: obj({
			subagentIds: arr(str(), { description: "List of subagent IDs to wait for" }),
		}),
		replay: "safe",
		async execute(args, api, ctx) {
			const reports: string[] = [];
			for (const subId of args.subagentIds) {
				const pending = backgroundPromises.get(String(subId));
				if (pending) {
					const res = await pending;
					reports.push(`### Subagent ${subId} (${res.status})\n${res.report}`);
					continue;
				}
				const convId = toConvId(subId);
				const entries = await api.commit(tx => tx.scanEntries({ conversationId: convId, order: "descending" }, 40), ctx);
				const lastAssistant = entries.items.find((e: any) => e?.model?.[0]?.role === "assistant");
				const text = lastAssistant ? extractPlainText(lastAssistant.model?.[0]?.content).trim() : "";
				reports.push(`### Subagent ${subId}\n${text || "(no report yet)"}`);
			}
			return { output: [{ type: "text", text: reports.join("\n\n") || "No subagents specified." }] };
		},
	});

	const listSubagentsTool = defineTool({
		name: "list_subagents",
		description: "List all subagents created in this session along with their IDs, names, modes, and status.",
		parameters: obj({}),
		replay: "safe",
		async execute(_args, api, ctx) {
			const page = await api.commit(tx => tx.scanConversations({}, 100), ctx);
			const rows: string[] = [];
			for (const record of page.items) {
				if (record.id === api.conversationId) continue;
				const entries = await api.commit(tx => tx.scanEntries({ conversationId: record.id, order: "ascending" }, 20), ctx);
				const meta = entries.items.find((e: any) => e.kind === "ade.assignment")?.data as SubagentRecordMetadata | undefined;
				if (!meta) continue;
				rows.push(`- ${String(record.id)} | ${meta.name} (${meta.role ?? "Subagent"}, ${meta.mode}${meta.branch ? `, branch:${meta.branch}` : ""}) | task: ${meta.task.slice(0, 120)}`);
			}
			return { output: [{ type: "text", text: rows.length ? rows.join("\n") : "No subagents in this session yet." }] };
		},
	});

	const stopSubagentTool = defineTool({
		name: "stop_subagent",
		description: "Abort a currently running subagent in this session.",
		parameters: obj({
			subagentId: str({ description: "Conversation ID of the subagent to stop" }),
		}),
		replay: "safe",
		async execute(args, api, ctx) {
			const child = await api.conversation(toConvId(args.subagentId), ctx);
			if (!child) throw new Error(`Subagent ${args.subagentId} not found.`);
			await child.abort(ctx);
			opts.events?.emit("subagents.update", { sessionId: opts.sessionId, subagentId: String(args.subagentId) }, opts.sessionId);
			return { output: [{ type: "text", text: `Aborted subagent ${args.subagentId}.` }] };
		},
	});

	return defineExtension({
		name: "ade-delegation",
		tools: [delegateTool, spawnSubagentTool, messageSubagentTool, waitSubagentTool, listSubagentsTool, stopSubagentTool],
	});
}
