import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer, type ViteDevServer } from "vite"

let server: ViteDevServer | undefined
let FleetLiveTab: React.ComponentType<Record<string, unknown>>
let TaskTraceTab: React.ComponentType<Record<string, unknown>>

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: "custom" })
  FleetLiveTab = (await server.ssrLoadModule("/src/observatory/FleetLiveTab.tsx") as { FleetLiveTab: typeof FleetLiveTab }).FleetLiveTab
  TaskTraceTab = (await server.ssrLoadModule("/src/observatory/TaskTraceTab.tsx") as { TaskTraceTab: typeof TaskTraceTab }).TaskTraceTab
})
after(async () => { await server?.close() })

test("FleetLiveTab renders KPIs, stall/needs-you badges, and nested subagents", () => {
  const now = 1_700_000_000_000
  const snapshot = {
    at: now,
    windowMin: 30,
    scope: "all",
    kpis: {
      activeAgents: 2,
      needsYou: 1,
      oldestWaitMs: 90_000,
      topNeedsYouTitle: "Fix auth",
      topNeedsYouReason: "Approve stage “Verify”",
      toolsPerMin: 4.2,
      toolsSparkline: [0, 1, 2, 3, 1, 0, 2, 4, 3, 2, 1, 2, 3, 4, 5],
      stalledCount: 1,
      slowToolsCount: 0,
      failedCalls: 1,
      tokensToday: 125_000,
      costToday: 0.42,
    },
    sessions: [
      {
        sessionId: "s1",
        title: "Fix auth",
        projectId: "p1",
        projectName: "ADE",
        engine: "pi",
        provider: "anthropic",
        model: "claude-sonnet-4",
        state: "stage-approval",
        needsYou: true,
        waitingReason: "Approve stage “Verify”",
        waitingSince: now - 90_000,
        health: "stalled",
        healthSince: now - 540_000,
        blueprint: { id: "speckit", name: "Spec Kit", stageId: "verify", stageName: "Verify", stageStatus: "awaiting_approval", done: 2, total: 4 },
        currentTool: null,
        lastActivityAt: now - 540_000,
        startedAt: now - 900_000,
        tokens: { input: 80_000, output: 45_000, cost: 0.42 },
        lane: [{ t: now - 600_000, cat: "shell", failed: true }],
        recentFailures: [{ id: "f1", toolName: "run_command", program: "npm", category: "shell", exitCode: 1, stageId: "verify", at: now - 600_000, durationMs: 12_000 }],
        subagents: [
          {
            id: "sub1",
            name: "Reviewer",
            role: "reviewer",
            harness: "pi",
            model: "gpt-4.1",
            status: "running",
            health: "ok",
            healthSince: null,
            startedAt: now - 120_000,
            endedAt: null,
            lastActivityAt: now - 10_000,
            currentTool: { name: "read", program: null, category: "read", startedAt: now - 5_000, slow: false },
            lane: [],
            recentFailures: [],
          },
        ],
        foldedSubagentsCount: 3,
      },
    ],
  }

  const html = renderToStaticMarkup(
    React.createElement(FleetLiveTab, { snapshot, onOpenSession() {}, onOpenTrace() {} }),
  )
  assert.match(html, /Fix auth/)
  assert.match(html, /Needs you/)
  assert.match(html, /stalled/)
  assert.match(html, /Reviewer/)
  assert.match(html, /3 earlier subagents/)
  assert.match(html, /npm \(exit 1\)/)
})

test("TaskTraceTab renders stage bands, time breakdown, and folded idle gaps", () => {
  const now = 1_700_000_000_000
  const trace = {
    at: now,
    sessionId: "s1",
    title: "Fix auth",
    projectName: "ADE",
    blueprintName: "Spec Kit",
    startedAt: now - 300_000,
    endedAt: now,
    totalMs: 300_000,
    breakdown: { toolsMs: 120_000, modelMs: 100_000, waitingMs: 60_000, delegatingMs: 20_000 },
    stages: [
      { id: "implement", name: "Implement", status: "completed", attempt: 1, gate: "none", goldfish: false, checksOk: true, reviewerModel: "gpt-4.1", reviewerIndependent: true, startedAt: now - 300_000, endedAt: now - 60_000 },
    ],
    spans: [
      { id: "sp1", kind: "tool", label: "cargo", stageId: "implement", category: "shell", program: "cargo", status: "done", exitCode: 0, startedAt: now - 250_000, endedAt: now - 150_000, durationMs: 100_000, live: false },
    ],
    foldedGaps: [{ startedAt: now - 150_000, endedAt: now - 60_000, durationMs: 90_000 }],
  }

  const html = renderToStaticMarkup(
    React.createElement(TaskTraceTab, {
      trace,
      sessions: [{ sessionId: "s1", title: "Fix auth" }],
      selectedSessionId: "s1",
      loading: false,
      onSelectSession() {},
      onOpenSession() {},
    }),
  )
  assert.match(html, /Spec Kit/)
  assert.match(html, /Implement/)
  assert.match(html, /Checks passed/)
  assert.match(html, /gpt-4\.1/)
  assert.match(html, /cargo/)
  assert.match(html, /idle stretch/)
})
