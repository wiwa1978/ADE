import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { configure, defineExtension, defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { arr, bool, obj, opt, str } from "@earendil-works/pi-schema";
import { createWorkspaceTools } from "./coding-tools.ts";
import { createSearchTools } from "./search-tools.ts";
import { createShellTools, type ProcessManager } from "./shell-tools.ts";
import type { RuntimeEventBus } from "./events.ts";
import { resolveBaseCommit, type WorktreeManager } from "./worktrees.ts";
import { externalSubagents, subagentPolicy } from "./subagent-harness.ts";
import { GUARDRAIL_INSTRUCTIONS } from "./guardrails.ts";
import { harnessChoiceText, harnessNames, resolveHarness, type SubagentHarness } from "./subagent-policy.ts";
import { TEAM_INSTRUCTIONS } from "./team-board.ts";

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
	/** Where the subagent runs: Pi (durable, in this session) or an agent CLI. */
	harness?: SubagentHarness;
};

type ModelToolEntry = ToolRegistration;
type ConversationIdParam = Parameters<typeof configure>[1];

type SubagentToolsOptions = {
	sessionId: string;
	workspace: string | null;
	workspaceIdentity: { dev: string; ino: string } | null;
	repository: string | null;
	readTools: readonly ModelToolEntry[];
	workspaceTools: readonly ModelToolEntry[];
	searchTools: readonly ModelToolEntry[];
	shellTools: readonly ModelToolEntry[];
	worktreeManager?: WorktreeManager;
	processes?: ProcessManager;
	events?: RuntimeEventBus;
	onSubagentCreated?: (conversationId: string | number) => void;
	/** The team board tools (tasks, plans, posts, claims), shared with every Pi subagent. */
	teamTools?: readonly ModelToolEntry[];
	/** The independent review of a review stage: which model a fresh readonly reviewer gets, and proof it ran. */
	reviews?: {
		begin(): Promise<{ model: { provider: string; modelId: string } | null; label: string | null; independent: boolean; captainFamily?: string } | null>;
		started(subagentId: string, info: { model: string | null; independent: boolean }): void;
		finished(subagentId: string, status: "completed" | "failed", report: string): void;
	};
	/** EU-only mode: why a model provider or agent CLI may not be used (null when it may). */
	euBlock?: { provider(id: string): string | null; engine(id: string): string | null };
};

function toConvId(raw: string): ConversationIdParam {
	return (/^\d+$/.test(raw) ? Number(raw) : raw) as ConversationIdParam;
}

function extractPlainText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"))
		.map((part) => part.text)
		.join("\n");
}

export function createSubagentTools(opts: SubagentToolsOptions) {
	const backgroundPromises = new Map<string, Promise<{ status: string; report: string }>>();
	const installedHarnesses = () => externalSubagents()?.installed(opts.sessionId) ?? new Set<SubagentHarness>(["pi"]);

	/** The harness a subagent was started on (from its saved assignment entry). */
	const harnessOf = (entries: { items: ReadonlyArray<{ kind?: string; data?: unknown }> }): SubagentHarness => {
		const meta = entries.items.find(entry => entry.kind === "ade.assignment")?.data as SubagentRecordMetadata | undefined;
		return meta?.harness ?? "pi";
	};

	const buildInstructions = (role: string, mode: SubagentMode, workspacePath: string | null, includeTeam = true) => {
		const capabilityText =
			mode === "readonly"
				? "You are a read-only subagent. You can inspect and search files, but you cannot edit files or run commands."
				: mode === "worktree"
					? `You are a workspace subagent with full file, search, and shell access in your own isolated Git worktree (${workspacePath ?? "assigned worktree"}). Make clean, focused changes and verify them.`
					: `You are a workspace subagent with full file, search, and shell access in the shared workspace (${workspacePath ?? "assigned workspace"}). Make clean, focused changes and verify them.`;
		const teamText = includeTeam && opts.teamTools?.length ? ` ${TEAM_INSTRUCTIONS} Take tasks that fit your role from the board, ask on the team board instead of guessing, and mark your tasks done when they are.` : "";
		return `You are "${role}", a focused subagent working for the session lead in ADE. ${capabilityText} Complete your assigned task thoroughly and return a clear, concise report of findings or changes made.${teamText}`;
	};

	const selectModelTools = async (mode: SubagentMode, subId: string, includeTeam = true): Promise<{ tools: ModelToolEntry[]; workspacePath: string | null; branch: string | null }> => {
		if (mode === "readonly" || !opts.workspace || !opts.workspaceIdentity) {
			return {
				tools: [...opts.readTools, ...opts.searchTools, ...(includeTeam ? (opts.teamTools ?? []) : [])],
				workspacePath: opts.workspace,
				branch: null,
			};
		}
		if (mode === "worktree" && opts.worktreeManager && opts.repository) {
			const branch = `ade/sub-${subId.slice(0, 8)}`;
			// Start from the session's current commit, so the subagent builds on the session's work so far.
			const base = await resolveBaseCommit(opts.workspace ?? opts.repository, "HEAD");
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
				tools: [...(wtFiles.tools ?? []), ...(wtSearch.tools ?? []), ...(wtShell?.tools ?? []), ...(opts.teamTools ?? [])],
				workspacePath: op.target,
				branch,
			};
		}
		return {
			tools: [...opts.workspaceTools, ...opts.searchTools, ...opts.shellTools, ...(opts.teamTools ?? [])],
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
			const text = entry?.model?.filter((m) => m.role === "assistant")
				.map((m) => extractPlainText(m.content)).join("\n");
			if (!text?.trim()) throw new Error("The subagent completed without a text report.");
			return { output: [{ type: "text", text }], details: { conversationId: id, name: args.name.trim(), mode: "readonly" } };
		},
	});

	const spawnSubagentTool = defineTool({
		name: "spawn_subagent",
		description: "Spawn a new subagent (1 or more per session) with its own conversation and live UI pane. Set background=true to run concurrently while you continue working or spawn multiple parallel subagents. Modes: 'readonly' (inspect/search only), 'workspace' (edit/run in current workspace), or 'worktree' (edit/run in a dedicated isolated Git worktree)." + harnessChoiceText(subagentPolicy(), installedHarnesses()),
		parameters: obj({
			harness: opt(str({ description: "Which agent runs this subagent: 'pi', 'claude-code' or 'codex' (see the tool description)." })),
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

			// A review stage's reviewer: ADE picks its model (another family when it can) and keeps the proof it ran.
			const review = mode === "readonly" ? await opts.reviews?.begin().catch(() => null) ?? null : null;
			const includeTeam = !review;
			const subUuid = randomUUID();
			const selected = await selectModelTools(mode, subUuid, includeTeam);
			// Pick the harness: the user's fixed choice, else the main agent's pick when it's usable.
			const policy = subagentPolicy();
			let { harness, note } = resolveHarness(args.harness, policy, installedHarnesses());
			const external = externalSubagents();
			const cwd = selected.workspacePath ?? opts.workspace;
			if (review?.model && harness !== "pi" && policy.choice === "agent") {
				note = `Independent review runs on Pi (${review.label ?? review.model.provider}) to use a separate model family.`;
				harness = "pi";
			}
			if (harness !== "pi" && (!external || !cwd)) {
				note = `${harnessNames[harness]} needs a workspace, so this subagent runs on Pi.`;
				harness = "pi";
			}
			const euEngine = harness !== "pi" ? opts.euBlock?.engine(harness) : null;
			if (euEngine) {
				note = `${euEngine} This subagent runs on Pi.`;
				harness = "pi";
			}
			const [piProvider, ...piModelParts] = policy.piModel.split("/");
			const wanted = review?.model ?? (policy.piModel ? { provider: piProvider, modelId: piModelParts.join("/") } : null);
			// EU-only mode: a subagent model outside the EU is dropped; the subagent uses the session's own model.
			const subModel = harness === "pi" && wanted && !opts.euBlock?.provider(wanted.provider) ? wanted : null;

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
					instructions: buildInstructions(role || name, mode, selected.workspacePath, includeTeam),
					// Pi subagents can use another model than the main agent (Settings → Subagents).
					...(subModel ? { model: subModel } : {}),
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
					harness,
				};
				await tx.appendEntry(child.id, { kind: "ade.assignment", data: meta });
				return child.id;
			}, ctx);

			opts.onSubagentCreated?.(id);
			if (review) {
				let reviewModel = review.label;
				let reviewIndependent = review.independent;
				if (harness !== "pi") {
					const cliFamily = harness === "claude-code" ? "anthropic" : harness === "codex" ? "openai" : "other";
					reviewModel = harnessNames[harness];
					reviewIndependent = Boolean(review.captainFamily && cliFamily !== "other" && cliFamily !== review.captainFamily);
				} else if (!subModel) {
					reviewModel = null;
					reviewIndependent = false;
				}
				opts.reviews?.started(String(id), { model: reviewModel, independent: reviewIndependent });
			}
			const done = <T extends { status: string; report: string }>(result: T): T => {
				if (review) opts.reviews?.finished(String(id), result.status === "completed" ? "completed" : "failed", result.report);
				return result;
			};
			await api.details({
				conversationId: id,
				name,
				role,
				mode,
				background,
				branch: selected.branch,
				harness,
			}, ctx);

			const harnessLine = `\n- harness: ${harnessNames[harness]}${note ? ` (${note})` : ""}`;
			if (harness !== "pi" && external && cwd) {
				// Claude Code / Codex do the work; the subagent's conversation here is the durable record.
				// After a restart this tool runs again and the runner resumes the same run.
				external.start({
					sessionId: opts.sessionId,
					conversationId: String(id),
					harness,
					cwd,
					readOnly: mode === "readonly",
					task: `You are a subagent named "${name}" (${role}) working for a coordinating agent. ${mode === "readonly" ? "Only read and investigate; don't change files." : "Make the changes in this folder and verify them."}\n\nTask:\n${taskText}\n\n${GUARDRAIL_INSTRUCTIONS}\n\nEnd with a short report: what you did, what you found, and anything left to do.`,
				});
				const report = () => external.wait(opts.sessionId, String(id)).then(result => ({ status: result.status, report: result.text || `(${harnessNames[harness]} finished without a text report)` })).then(done);
				if (background) {
					backgroundPromises.set(String(id), report().finally(() => opts.events?.emit("subagents.update", { sessionId: opts.sessionId, subagentId: String(id) }, opts.sessionId)));
					return {
						output: [{ type: "text", text: `Background subagent spawned.\n- subagentId: ${String(id)}\n- name: ${name}\n- mode: ${mode}${harnessLine}${selected.branch ? `\n- branch: ${selected.branch}` : ""}\nUse wait_subagent, message_subagent, or list_subagents to track or coordinate with it.` }],
						details: { conversationId: String(id), name, role, mode, background: true, branch: selected.branch, harness },
					};
				}
				const result = await report();
				return {
					isError: result.status !== "completed",
					output: [{ type: "text", text: `${result.report}${note ? `\n\n(${note})` : ""}` }],
					details: { conversationId: String(id), name, role, mode, background: false, branch: selected.branch, harness },
				};
			}

			const child = await api.conversation(id, ctx);
			if (!child) throw new Error("The created subagent conversation is unavailable.");

			const reqId = `ade-subagent:${api.taskId}:${id}`;
			const submission = await child.submit({ type: "input", content: taskText, requestId: reqId }, ctx);

			const awaitReport = () => awaitReportRaw().then(done);
			const awaitReportRaw = async (): Promise<{ status: string; report: string }> => {
				const settled = await submission.wait(context);
				if (settled.status !== "done") {
					return { status: "failed", report: `Subagent "${name}" ended without a report: ${settled.reason}` };
				}
				const entry = settled.answer ? await api.commit(tx => tx.entry(settled.answer!), context) : undefined;
				const text = entry?.model?.filter((m) => m.role === "assistant")
					.map((m) => extractPlainText(m.content)).join("\n").trim() ?? "";
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
						text: `Background subagent spawned.\n- subagentId: ${String(id)}\n- name: ${name}\n- mode: ${mode}${harnessLine}${selected.branch ? `\n- branch: ${selected.branch}` : ""}\nUse wait_subagent, message_subagent, or list_subagents to track or coordinate with it.`,
					}],
					details: { conversationId: String(id), name, role, mode, background: true, branch: selected.branch, harness },
				};
			}

			const result = await awaitReport();
			return {
				isError: result.status !== "completed",
				output: [{ type: "text", text: result.report }],
				details: { conversationId: String(id), name, role, mode, background: false, branch: selected.branch, harness },
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
			const external = externalSubagents();
			if (external && harnessOf(await api.commit(tx => tx.scanEntries({ conversationId: toConvId(args.subagentId), order: "ascending" }, 20), ctx)) !== "pi") {
				// Claude Code / Codex: a follow-up continues the same CLI session.
				external.message(opts.sessionId, String(args.subagentId), args.message);
				backgroundPromises.set(String(args.subagentId), external.wait(opts.sessionId, String(args.subagentId)).then(result => ({ status: result.status, report: result.text || "(no text)" })));
				return { output: [{ type: "text", text: `Delivered follow-up to subagent ${args.subagentId}.` }], details: { conversationId: String(args.subagentId), mode: "followUp" } };
			}
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
				const text = entry?.model?.filter((m) => m.role === "assistant")
					.map((m) => extractPlainText(m.content)).join("\n").trim() ?? "";
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
				const external = externalSubagents();
				if (external && harnessOf(await api.commit(tx => tx.scanEntries({ conversationId: convId, order: "ascending" }, 20), ctx)) !== "pi") {
					const res = await external.wait(opts.sessionId, String(subId));
					reports.push(`### Subagent ${subId} (${res.status})\n${res.text || "(no report yet)"}`);
					continue;
				}
				const entries = await api.commit(tx => tx.scanEntries({ conversationId: convId, order: "descending" }, 40), ctx);
				const lastAssistant = entries.items.find((e) => e?.model?.[0]?.role === "assistant");
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
				const meta = entries.items.find((e) => e.kind === "ade.assignment")?.data as SubagentRecordMetadata | undefined;
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
			// A subagent on Claude Code or Codex is a CLI run (or waiting in the queue): end that too.
			const endedExternal = externalSubagents()?.stop(opts.sessionId, String(args.subagentId)) ?? false;
			const child = await api.conversation(toConvId(args.subagentId), ctx);
			if (!child && !endedExternal) throw new Error(`Subagent ${args.subagentId} not found.`);
			if (child) await child.abort(ctx);
			opts.events?.emit("subagents.update", { sessionId: opts.sessionId, subagentId: String(args.subagentId) }, opts.sessionId);
			return { output: [{ type: "text", text: `Stopped subagent ${args.subagentId}.` }] };
		},
	});

	return defineExtension({
		name: "ade-delegation",
		tools: [delegateTool, spawnSubagentTool, messageSubagentTool, waitSubagentTool, listSubagentsTool, stopSubagentTool],
	});
}
