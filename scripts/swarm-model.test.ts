import assert from "node:assert/strict"
import { test } from "node:test"
import { buildSwarmModel, type SwarmInput } from "../src/swarm/swarm-model.ts"

const t0 = 2_000_000

test("builds explicit Swarm overview with goal, running tasks, live focus, and threads", () => {
  const input: SwarmInput = {
    sessionLabel: "Audit session",
    leadBusy: true,
    leadItems: [{ id: "u1", kind: "user", content: "Audit ADE", createdAt: t0 }],
    subagents: [
      { id: "s1", parentId: "0", assignmentId: "a1", name: "zod-protocol", role: "protocol", assignment: "Add Zod schemas", status: "running", harness: "pi", model: "gemini", reasoning: "", error: null, messages: [], createdAt: t0 },
      { id: "s2", parentId: "0", assignmentId: "a2", name: "sec-hardener", role: "security", assignment: "Patch RCE and XSS", status: "running", harness: "pi", model: "gemini", reasoning: "", error: null, messages: [], createdAt: t0 },
    ],
    subagentTimelines: {},
    tasks: [],
    team: {
      title: "ADE Audit: Security, Zod & UI Refactor",
      goal: {
        title: "Harden security, Zod types, and modular UI",
        summary: "Patch vulnerabilities, add Zod validation, optimize runtime, and modularize UI.",
        updatedAt: t0,
      },
      threads: [
        { id: "TH1", title: "End-to-end Zod type safety", summary: "Every API boundary validates with Zod.", status: "moving", focus: "Check MobilePairingManager constructor signature", updatedAt: t0 },
        { id: "TH2", title: "Runtime and sandbox security", summary: "Eliminate RCE, SSRF, XSS, symlink, and approval bypasses.", status: "moving", focus: "", updatedAt: t0 },
      ],
      focus: {
        s1: { text: "Check MobilePairingManager constructor signature", at: t0 + 1000 },
        s2: { text: "Audit symlink resolution in workspace tools", at: t0 + 1000 },
      },
      tasks: [
        { id: "T1", title: "Add Zod schemas, fix route bugs, harden tsconfigs", detail: "", owner: "s1", createdBy: "lead", status: "in_progress", dependsOn: [], threadId: "TH1", plan: null, returnedNote: "", result: "", updatedAt: t0 },
        { id: "T2", title: "Patch RCE, SSRF, XSS, symlink, and auth holes", detail: "", owner: "s2", createdBy: "lead", status: "in_progress", dependsOn: [], threadId: "TH2", plan: null, returnedNote: "", result: "", updatedAt: t0 },
      ],
      posts: [
        { seq: 1, at: t0, author: "lead", to: ["all"], kind: "update", text: "Kickoff", re: null },
      ],
      claims: [],
      events: [],
      requirePlans: false,
    },
  }

  const model = buildSwarmModel(input)
  assert.equal(model.title, "ADE Audit: Security, Zod & UI Refactor")
  assert.equal(model.live, true)
  assert.equal(model.goal.title, "Harden security, Zod types, and modular UI")
  assert.equal(model.members.length, 3, "coordinator + 2 workers")
  assert.equal(model.running.length, 2)
  assert.equal(model.running[0].memberHandle, "zod-protocol")
  assert.equal(model.running[0].focus, "Check MobilePairingManager constructor signature")
  assert.equal(model.tasksDone, 0)
  assert.equal(model.tasksTotal, 2)
  assert.equal(model.openThreads, 2)
  assert.equal(model.threads[0].statusLabel, "Moving")
  assert.equal(model.threads[0].done, 0)
  assert.equal(model.threads[0].total, 1)
  assert.equal(model.threads[1].now, "Audit symlink resolution in workspace tools")
  assert.equal(model.boardBadge, 1)
})

test("synthesizes running items and threads from subagents when no explicit swarm overview exists", () => {
  const input: SwarmInput = {
    sessionLabel: "Build split-pane ADE",
    leadBusy: false,
    leadItems: [{ id: "u1", kind: "user", content: "Build split-pane ADE", createdAt: t0 }],
    subagents: [
      { id: "s1", parentId: "0", assignmentId: "a1", name: "Backend Worker", role: "backend", assignment: "Build SSE stream", status: "running", harness: "pi", model: null, reasoning: "", error: null, messages: [], createdAt: t0 },
      { id: "s2", parentId: "0", assignmentId: "a2", name: "UI Reviewer", role: "review", assignment: "Check contrast", status: "completed", harness: "pi", model: null, reasoning: "", error: null, messages: [], createdAt: t0 },
    ],
    subagentTimelines: {
      s1: {
        sessionId: "sess-1",
        conversationId: "s1",
        busy: true,
        items: [],
        liveTools: [{ callId: "c1", name: "run_command", arguments: { command: "npm test" }, status: "running", output: "", isError: false }],
      },
    },
    tasks: [],
    team: null,
  }

  const model = buildSwarmModel(input)
  assert.equal(model.live, true)
  assert.equal(model.running.length, 1)
  assert.equal(model.running[0].memberHandle, "Backend Worker")
  assert.equal(model.running[0].focus, "Running npm test")
  assert.equal(model.tasksDone, 1)
  assert.equal(model.tasksTotal, 2)
  assert.equal(model.openThreads, 1)
  assert.equal(model.threads.length, 2)
  assert.equal(model.threads[0].status, "moving")
  assert.equal(model.threads[1].status, "done")
})
