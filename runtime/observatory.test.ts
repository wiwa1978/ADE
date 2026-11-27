import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Conversation } from "@ade/protocol";
import { openHostDatabase } from "./db/schema.ts";
import {
	categorizeTool,
	evaluateAgentHealth,
	extractCommandProgram,
	extractExitCode,
	IDLE_FOLD_MS,
	isBenignExit,
	Observatory,
	QUIET_MS,
	SLOW_TOOL_MS,
	STALLED_MS,
} from "./observatory.ts";
import type { UsageReport } from "./usage.ts";

test("extractCommandProgram extracts allowlisted program only and strips secrets/args", () => {
	assert.equal(extractCommandProgram("cd app && SECRET_KEY=xyz cargo test --release | tail -n 20"), "cargo");
	assert.equal(extractCommandProgram("bash -lc 'git status --short'"), "git");
	assert.equal(extractCommandProgram("rg --json token src/"), "rg");
	assert.equal(extractCommandProgram("./my-private-script.sh --token=abc"), null);
	assert.equal(extractCommandProgram(""), null);
});

test("categorizeTool and isBenignExit classify tools and grep/rg exit 1", () => {
	assert.equal(categorizeTool("run_command"), "shell");
	assert.equal(categorizeTool("read"), "read");
	assert.equal(categorizeTool("edit"), "edit");
	assert.equal(categorizeTool("grep_search"), "search");
	assert.equal(categorizeTool("spawn_subagent"), "subagent");
	assert.equal(categorizeTool("finish_stage"), "stage");
	assert.equal(categorizeTool("mcp_github_list"), "mcp");
	assert.equal(isBenignExit("rg", 1), true);
	assert.equal(isBenignExit("grep", 1), true);
	assert.equal(isBenignExit("cargo", 1), false);
	assert.equal(isBenignExit("rg", 2), false);
	assert.equal(extractExitCode({ exitCode: 127 }), 127);
	assert.equal(extractExitCode(null, "Process exited with code 2"), 2);
});

test("evaluateAgentHealth distinguishes quiet, stalled, slow-tool, and delegating", () => {
	const now = 1_000_000_000;
	assert.equal(evaluateAgentHealth({ working: false, delegating: false, lastActivityAt: now - STALLED_MS * 2, runningTool: null, now }).health, "ok");
	assert.equal(evaluateAgentHealth({ working: true, delegating: true, lastActivityAt: now - STALLED_MS * 2, runningTool: null, now }).health, "delegating");
	assert.equal(evaluateAgentHealth({ working: true, delegating: false, lastActivityAt: now - QUIET_MS - 1000, runningTool: null, now }).health, "quiet");
	assert.equal(evaluateAgentHealth({ working: true, delegating: false, lastActivityAt: now - STALLED_MS - 1000, runningTool: null, now }).health, "stalled");
	const slow = evaluateAgentHealth({
		working: true,
		delegating: false,
		lastActivityAt: now,
		runningTool: { name: "run_command", program: "npm", category: "shell", startedAt: now - SLOW_TOOL_MS - 5000 },
		now,
	});
	assert.equal(slow.health, "slow-tool");
	assert.equal(slow.slowTool, true);
});

test("Observatory liveSnapshot and stage-aware sessionTrace", () => {
	const dir = mkdtempSync(join(tmpdir(), "ade-obs-"));
	try {
		const db = openHostDatabase(dir);
		const obs = new Observatory(db);
		const now = 1_700_000_000_000;

		// Record a normal command, a benign rg exit 1, a real failed npm test, and a slow running tool.
		obs.recordToolStart({ id: "t1", sessionId: "s1", conversationId: "root", stageId: "implement", toolName: "read", startedAt: now - 120_000 });
		obs.recordToolEnd({ id: "t1", isError: false, endedAt: now - 119_700 });
		obs.recordToolStart({ id: "t2", sessionId: "s1", conversationId: "root", stageId: "implement", toolName: "edit", startedAt: now - 119_500 });
		obs.recordToolEnd({ id: "t2", isError: false, endedAt: now - 119_200 });

		obs.recordToolStart({ id: "t3", sessionId: "s1", conversationId: "root", stageId: "verify", toolName: "run_command", command: "rg foo src/", startedAt: now - 90_000 });
		obs.recordToolEnd({ id: "t3", isError: true, exitCode: 1, endedAt: now - 88_000 });

		obs.recordToolStart({ id: "t4", sessionId: "s1", conversationId: "root", stageId: "verify", toolName: "run_command", command: "npm test", startedAt: now - 60_000 });
		obs.recordToolEnd({ id: "t4", isError: true, exitCode: 1, endedAt: now - 40_000 });

		obs.recordToolStart({ id: "t5", sessionId: "s2", conversationId: "root", stageId: null, toolName: "run_command", command: "cargo build", startedAt: now - SLOW_TOOL_MS - 10_000 });

		const sessions: Conversation[] = [
			{
				id: "s1",
				mode: "coding",
				label: "Fix auth",
				projectId: "p1",
				status: "idle",
				createdAt: now - 600_000,
				updatedAt: now - 30_000,
				messages: [{ id: "m1", role: "user", content: "Fix auth", status: "completed", createdAt: now - 600_000 }],
			},
			{
				id: "s2",
				mode: "coding",
				label: "Build index",
				projectId: "p1",
				status: "working",
				createdAt: now - 900_000,
				updatedAt: now - 10_000,
				messages: [{ id: "m2", role: "user", content: "Build index", status: "pending", createdAt: now - 900_000 }],
			},
		];
		const usageReport: UsageReport = {
			month: "2026-11",
			monthTotal: { inputTokens: 1000, outputTokens: 500, cost: 0.12 },
			projects: [],
			sessions: { s1: { inputTokens: 800, outputTokens: 200, cost: 0.08, projectId: "p1", updatedAt: now } },
			days: [{ day: "2026-11-27", totals: { inputTokens: 1000, outputTokens: 500, cost: 0.12 } }],
		};

		const snap = obs.liveSnapshot({
			sessions,
			projects: [{ id: "p1", name: "ADE" }],
			inboxEntries: [
				{ sessionId: "s1", state: "stage-approval", needsYou: true, pendingApprovals: 0, uncommitted: 2, commitsAhead: 1, pullRequest: null, updatedAt: now - 30_000, stage: "Verify" },
				{ sessionId: "s2", state: "working", needsYou: false, pendingApprovals: 0, uncommitted: 0, commitsAhead: 0, pullRequest: null, updatedAt: now - 10_000 },
			],
			pendingApprovals: [],
			usageReport,
			subagentsBySession: {},
			windowMin: 30,
			scope: "all",
			now,
		});

		assert.equal(snap.kpis.activeAgents, 1);
		assert.equal(snap.kpis.needsYou, 1);
		assert.equal(snap.kpis.slowToolsCount, 1);
		// Only npm test (t4) counts as failed; rg exit 1 (t3) is benign.
		assert.equal(snap.kpis.failedCalls, 1);
		assert.equal(snap.kpis.tokensToday, 1500);
		// Needs-you session sorts first.
		assert.equal(snap.sessions[0].sessionId, "s1");
		assert.equal(snap.sessions[1].health, "slow-tool");

		// Trace with overnight gap folding and stage bands
		obs.recordToolStart({ id: "t6", sessionId: "s1", conversationId: "root", stageId: "verify", toolName: "read", startedAt: now + IDLE_FOLD_MS + 10_000 });
		obs.recordToolEnd({ id: "t6", isError: false, endedAt: now + IDLE_FOLD_MS + 15_000 });

		const trace = obs.sessionTrace({
			session: sessions[0],
			projectName: "ADE",
			stagesView: {
				blueprintId: "automated-factory",
				name: "Automated Factory",
				summary: null,
				stages: [
					{ id: "implement", name: "Implement", description: "", status: "completed", attempt: 1, gate: "never", executor: "captain", goldfish: false, artifactPaths: [], summary: null, verdict: null, checks: null, review: null, startedAt: now - 130_000, endedAt: now - 100_000 },
					{ id: "verify", name: "Verify", description: "", status: "completed", attempt: 1, gate: "after", executor: "captain", goldfish: false, artifactPaths: [], summary: null, verdict: null, checks: { source: "package", results: [], missing: [], ok: true, at: now - 35_000 }, review: null, startedAt: now - 100_000, endedAt: now - 20_000 },
				],
				history: [
					{ at: now - 30_000, stageId: "verify", event: "finished" },
					{ at: now - 20_000, stageId: "verify", event: "approved" },
				],
			},
			turns: [{ id: "turn-1", status: "completed", createdAt: now - 125_000, updatedAt: now - 35_000, model: "claude-sonnet-4" }],
			subagents: [{ id: "sub-1", name: "Reviewer", role: "reviewer", harness: "pi", model: "gpt-4.1", status: "completed", createdAt: now - 85_000, updatedAt: now - 70_000 }],
			pendingApprovals: [],
			now: now + IDLE_FOLD_MS + 20_000,
		});

		assert.equal(trace.stages.length, 2);
		assert.equal(trace.stages[1].checksOk, true);
		// Consecutive sub-second calls t1+t2 folded into one span.
		assert.ok(trace.spans.some(s => s.foldedCount === 2));
		// Overnight gap folded.
		assert.equal(trace.foldedGaps.length, 1);
		assert.ok(trace.breakdown.toolsMs > 0);
		assert.ok(trace.breakdown.waitingMs > 0);
		assert.ok(trace.breakdown.delegatingMs === 15_000);
		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
