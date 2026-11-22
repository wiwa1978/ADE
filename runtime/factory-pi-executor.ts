import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
	createRegistry,
	defineExtension,
	Harness,
	ROOT_CONVERSATION_ID,
	UsageDoc,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Models } from "@earendil-works/pi-ai/models";
import type { BlueprintStage, StageVerdict } from "../packages/protocol/index.ts";
import { createWorkspaceTools } from "./coding-tools.ts";
import { createSearchTools } from "./search-tools.ts";
import { createShellTools, type ProcessManager } from "./shell-tools.ts";
import { createBrowserTools, type BrowserManager } from "./browser.ts";
import type { ArtifactManager } from "./artifacts.ts";
import type { ApprovalManager } from "./approvals.ts";
import type { StageExecutorDelegate } from "./factory-runner.ts";

export type HostModelResolver = (preferredProvider?: string) => Promise<{
	provider: string;
	defaultModel: string;
	availableModels: { id: string; name: string }[];
	configured: boolean;
	setupMessage?: string;
	models: Models;
	resolveModel: (modelId: string) => unknown;
}>;

function plainText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: string; text?: string } => Boolean(part && typeof part === "object"))
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text ?? "")
		.join("");
}

/**
 * Parses a structured Goldfish quality-audit verdict from the auditor's response.
 */
export function parseGoldfishVerdict(text: string): StageVerdict {
	const upper = text.toUpperCase();
	const wantsChanges =
		/\bVERDICT\s*:\s*CHANGES_REQUESTED\b/.test(upper) ||
		/\bCHANGES_REQUESTED\b/.test(upper) ||
		/\bBLOCKER\s*:/i.test(text);
	const wantsHuman = /\bVERDICT\s*:\s*ESCALATE_HUMAN\b/.test(upper);

	const findings: NonNullable<StageVerdict["findings"]> = [];
	for (const line of text.split(/\r?\n/)) {
		const m = /^\s*[-*]?\s*(BLOCKER|MAJOR|MINOR)\s*(?:\(([^):]+)(?::(\d+))?\))?\s*:\s*(.+)$/i.exec(line);
		if (m) {
			findings.push({
				severity: m[1].toLowerCase() as "blocker" | "major" | "minor",
				...(m[2] ? { file: m[2].trim() } : {}),
				...(m[3] ? { line: Number(m[3]) } : {}),
				message: m[4].trim(),
			});
		}
	}

	const outcome: StageVerdict["outcome"] = wantsHuman
		? "escalate_human"
		: wantsChanges
			? "changes_requested"
			: "pass";

	const firstLine = text.trim().split(/\r?\n/).find((l) => l.trim()) ?? "Audit completed.";
	return {
		outcome,
		summary: firstLine.slice(0, 300),
		...(findings.length ? { findings } : {}),
	};
}

function buildStageInstructions(stage: BlueprintStage, workspaceRoot: string | null): string {
	if (stage.contextIsolation === "goldfish") {
		return [
			`You are an INDEPENDENT Goldfish Quality Auditor for stage "${stage.name}".`,
			"You have ZERO chat history from the coding agent so you do not inherit its blind spots.",
			workspaceRoot
				? "You have READ-ONLY access to the entire repository via list_files, read, grep_search, and find_files."
				: "Audit the provided diff and specification carefully.",
			"Check for bugs, edge cases, security flaws, architectural regressions, and drift from the requirements.",
			"End your report with an explicit line: `VERDICT: PASS` or `VERDICT: CHANGES_REQUESTED`.",
			"List any concrete findings as `- BLOCKER (file:line): description` or `- MAJOR (file:line): description`.",
		].join("\n");
	}

	const base = [
		`You are executing stage "${stage.name}" (${stage.id}) inside ADE's Software Factory.`,
		stage.personaPrompt ?? "",
		stage.description,
		stage.requiresSandbox && workspaceRoot
			? "You have full workspace editing, search, and shell tools inside the isolated worktree. Make clean, minimal, well-tested changes."
			: workspaceRoot
				? "This is a brain-only planning/triage stage (no VM booted). Use read-only tools to inspect the repository and produce a concise, actionable output."
				: "Produce a concise, actionable output.",
	].filter(Boolean);

	return base.join("\n");
}

function buildStagePrompt(params: {
	stage: BlueprintStage;
	taskPrompt: string;
	priorOutputs: { stageId: string; summary: string }[];
	steeringNotes: string[];
	diff: string;
	microSkillsContext?: string;
}): string {
	const sections: string[] = [
		`# Task / Issue\n${params.taskPrompt}`,
	];

	if (params.microSkillsContext) {
		sections.push(params.microSkillsContext);
	}

	if (params.steeringNotes.length && params.stage.contextIsolation !== "goldfish") {
		sections.push(
			`# Human Steering Notes\n${params.steeringNotes.map((n) => `- ${n}`).join("\n")}`,
		);
	}

	if (params.priorOutputs.length) {
		// Goldfish intentionally receives ONLY concrete specs/plans (never coder chat!)
		const relevant =
			params.stage.contextIsolation === "goldfish"
				? params.priorOutputs.filter((o) =>
						["triage", "plan", "spec", "specify", "propose_delta", "draft"].includes(o.stageId),
					)
				: params.priorOutputs.slice(-4);
		if (relevant.length) {
			sections.push(
				`# Prior Stage Artifacts\n${relevant.map((o) => `## ${o.stageId}\n${o.summary}`).join("\n\n")}`,
			);
		}
	}

	if (params.diff.trim() && (params.stage.contextIsolation === "goldfish" || params.stage.id.includes("verify") || params.stage.id.includes("pr"))) {
		sections.push(`# Current Workspace Diff\n\`\`\`diff\n${params.diff.slice(0, 24_000)}\n\`\`\``);
	}

	sections.push(`# Your Objective for Stage "${params.stage.name}"\n${params.stage.description}`);
	return sections.join("\n\n");
}

function workspaceIdentity(dir: string): { dev: string; ino: string } | null {
	try {
		const info = statSync(dir, { bigint: true });
		return { dev: String(info.dev), ino: String(info.ino) };
	} catch {
		return null;
	}
}

/**
 * Wires real `@earendil-works/pi-durable` execution into `LocalFactoryRunner`.
 * - Respects Elephant (persistent Captain DB) vs. Goldfish (fresh zero-history read-only DB)
 * - Enforces stage-scoped tool pruning (Goldfish never receives write/edit/shell tools)
 * - Uses ADE's configured model providers & tracks real token/cost usage from Pi Durable
 */
export function createPiFactoryStageExecutor(deps: {
	stateDirectory: string;
	resolveModelConfig: HostModelResolver;
	processes: ProcessManager;
	browser: BrowserManager;
	artifacts: ArtifactManager;
	approvals: ApprovalManager;
}): StageExecutorDelegate {
	const dbDir = join(deps.stateDirectory, "factory-sessions");
	mkdirSync(dbDir, { recursive: true });

	return async ({ detail, stageId, contextIsolation, sandbox }) => {
		const stage = detail.blueprint.stages.find((s) => s.id === stageId);
		if (!stage) throw new Error(`Stage "${stageId}" not found in blueprint.`);

		const stageState = detail.run.stages.find((s) => s.stageId === stageId);
		const desiredRef = stageState?.resolvedModel?.ref;

		// Resolve a configured provider/model from ADE's model system
		let modelConfig = await deps.resolveModelConfig(desiredRef?.provider).catch(() => null);
		if (!modelConfig || !modelConfig.configured) {
			if (detail.modelConfig.compliance.euOnlyMode) {
				throw new Error(
					`EU-Only Mode is enabled, but provider "${desiredRef?.provider ?? "unknown"}" is not configured in Settings.`,
				);
			}
			modelConfig = await deps.resolveModelConfig(undefined);
		}
		if (!modelConfig.configured) {
			throw new Error(
				modelConfig.setupMessage ||
					"No model provider is configured. Add an API key or sign in to Copilot in Settings.",
			);
		}

		const chosenModelId =
			desiredRef?.model && modelConfig.resolveModel(desiredRef.model)
				? desiredRef.model
				: modelConfig.defaultModel || modelConfig.availableModels[0]?.id;
		if (!chosenModelId) {
			throw new Error(`No available model found for provider "${modelConfig.provider}".`);
		}

		const thinkingLevel = desiredRef?.reasoning ?? "medium";
		const rec = detail.sandboxId ? sandbox.getRecord(detail.sandboxId) : undefined;
		const workspaceRoot =
			rec?.worktreePath && existsSync(rec.worktreePath)
				? rec.worktreePath
				: existsSync(detail.repoPath)
					? detail.repoPath
					: null;
		const identity = workspaceRoot ? workspaceIdentity(workspaceRoot) : null;

		const allowedGroups = new Set(stage.allowedToolGroups);
		const isGoldfish = contextIsolation === "goldfish";
		const canMutate = !isGoldfish && stage.requiresSandbox;

		const registry = createRegistry();
		let prunedCount = 0;

		if (workspaceRoot && identity) {
			const wsExt = createWorkspaceTools(workspaceRoot, identity);
			const wsTools = wsExt.tools ?? [];
			if (canMutate && allowedGroups.has("workspace-edit")) {
				registry.install(wsExt);
			} else if (allowedGroups.has("repo-read") || allowedGroups.has("diff-read") || isGoldfish) {
				// Strictly read-only subset for Brain-only and Goldfish auditor stages
				const readOnlyTools = wsTools.filter((t) => t.name === "read" || t.name === "list_files");
				prunedCount += wsTools.length - readOnlyTools.length;
				registry.install(defineExtension({ name: "ade-workspace-readonly", tools: readOnlyTools }));
			} else {
				prunedCount += wsTools.length;
			}

			const searchExt = createSearchTools(workspaceRoot, identity);
			const searchTools = searchExt.tools ?? [];
			if (allowedGroups.has("search") || allowedGroups.has("repo-read") || isGoldfish) {
				registry.install(searchExt);
			} else {
				prunedCount += searchTools.length;
			}

			if (canMutate && allowedGroups.has("shell")) {
				registry.install(
					createShellTools({
						sessionId: `factory:${detail.run.runId}:${stageId}`,
						workspace: workspaceRoot,
						identity,
						processes: deps.processes,
					}),
				);
			} else {
				prunedCount += 2;
			}
		}

		if (allowedGroups.has("browser")) {
			registry.install(createBrowserTools(deps.browser));
		} else {
			prunedCount += 6;
		}

		if (allowedGroups.has("artifacts")) {
			registry.install(deps.artifacts.createExtension(`factory:${detail.run.runId}`));
		}

		const attempt = stageState?.attempt ?? 1;
		const sqliteName = isGoldfish
			? `factory-${detail.run.runId}-goldfish-${stageId}-${attempt}.sqlite`
			: stage.executor === "captain"
				? `factory-${detail.run.runId}-captain.sqlite`
				: `factory-${detail.run.runId}-worker-${stageId}-${attempt}.sqlite`;

		let harnessRef: Harness | null = null;
		if (canMutate) {
			registry.install(deps.approvals.createExtension(`factory:${detail.run.runId}`, () => harnessRef));
		}

		const instructions = buildStageInstructions(stage, workspaceRoot);
		const prompt = buildStagePrompt({
			stage,
			taskPrompt: detail.taskPrompt,
			priorOutputs: detail.subagents
				.filter((s) => s.status === "completed")
				.map((s) => ({ stageId: s.stageId, summary: s.output || s.summary })),
			steeringNotes: detail.steeringNotes,
			diff: detail.diff,
		});

		const harness = await Harness.open(
			await openNodeSqliteStorage(join(dbDir, sqliteName)),
			{
				models: modelConfig.models,
				registry,
				...(workspaceRoot ? { env: () => new NodeExecutionEnv({ cwd: workspaceRoot }) } : {}),
			},
			context,
		);
		harnessRef = harness;

		try {
			const root = await harness.root(context, {
				agent: {
					model: { provider: modelConfig.provider, modelId: chosenModelId },
					thinkingLevel,
					instructions,
				},
			});
			await root.configure(
				{
					model: { provider: modelConfig.provider, modelId: chosenModelId },
					thinkingLevel,
					instructions,
				},
				context,
			);
			harness.resume();

			const submission = await root.submit(
				{
					type: "input",
					content: prompt,
					requestId: `ade:factory:${detail.run.runId}:${stageId}:${attempt}`,
					whenBusy: "reject",
				},
				context,
			);
			const settled = await submission.wait(context);
			if (settled.status !== "done" || settled.type !== "input") {
				throw new Error(`Stage "${stage.name}" did not complete cleanly (status: ${settled.status}).`);
			}

			const transcript = await root.context(context);
			const lastAssistant = [...transcript.messages]
				.reverse()
				.find((m) => m.role === "assistant");
			const output = plainText(lastAssistant?.content).trim() || `Stage "${stage.name}" finished.`;

			// Read actual token usage from Pi Durable UsageDoc when available
			let inputTokens = 0;
			let outputTokens = 0;
			let usd = 0;
			try {
				const usage = (await harness.snapshot(UsageDoc, ROOT_CONVERSATION_ID, context)) as {
					inputTokens?: unknown;
					input?: unknown;
					outputTokens?: unknown;
					output?: unknown;
					totalCost?: unknown;
					cost?: unknown;
				} | null;
				if (usage) {
					inputTokens = Number(usage.inputTokens ?? usage.input ?? 0) || 0;
					outputTokens = Number(usage.outputTokens ?? usage.output ?? 0) || 0;
					usd = Number(usage.totalCost ?? usage.cost ?? 0) || 0;
				}
			} catch {
				// UsageDoc optional on faux providers
			}

			const verdict = isGoldfish ? parseGoldfishVerdict(output) : undefined;
			const firstLine = output.split(/\r?\n/).find((l) => l.trim()) ?? `Completed ${stage.name}`;

			return {
				summary: firstLine.slice(0, 260),
				output,
				verdict,
				modelUsed: `${modelConfig.provider}/${chosenModelId}`,
				toolSchemasPruned: prunedCount,
				inputTokens,
				outputTokens,
				usd,
			};
		} finally {
			await harness.close(context);
		}
	};
}
