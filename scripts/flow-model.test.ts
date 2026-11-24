import assert from "node:assert/strict"
import { test } from "node:test"
import { buildEvents, linksOf, partsOf, summarizePart, type RunInput } from "../src/flow/run-model.ts"

const t0 = 1_000_000
const input: RunInput = {
  leadItems: [
    { id: "u1", kind: "user", content: "Add dark mode to settings", createdAt: t0 },
    { id: "a1", kind: "assistant", thinking: "", text: "", createdAt: t0 + 1000, toolCalls: [
      { callId: "c1", name: "spawn_subagent", arguments: { name: "api", task: "Add the theme setting to the API" }, status: "done", output: "", isError: false, details: { conversationId: "s1" } },
      { callId: "c2", name: "spawn_subagent", arguments: { name: "ui", task: "Build the toggle" }, status: "done", output: "", isError: false, details: { conversationId: "s2" } },
      { callId: "c3", name: "update_tasks", arguments: { items: [{ status: "done" }, { status: "in_progress" }] }, status: "done", output: "", isError: false },
    ] },
    { id: "a2", kind: "assistant", thinking: "", text: "Both parts are in; dark mode works.", createdAt: t0 + 9000, toolCalls: [{ callId: "c4", name: "wait_subagent", arguments: {}, status: "done", output: "", isError: false }] },
  ],
  subagents: [
    { id: "s1", parentId: "0", assignmentId: "x", name: "api", assignment: "", status: "completed", model: null, reasoning: "", error: null, messages: [], createdAt: t0 + 1000 },
    { id: "s2", parentId: "0", assignmentId: "y", name: "ui", assignment: "", status: "running", model: null, reasoning: "", error: null, messages: [], createdAt: t0 + 1000 },
  ],
  subagentItems: {
    s1: [{ id: "b1", kind: "assistant", thinking: "", text: "Added theme to preferences.", createdAt: t0 + 5000, toolCalls: [{ callId: "d1", name: "edit", arguments: { path: "api/prefs.ts" }, status: "done", output: "", isError: false }] }],
    s2: [{ id: "b2", kind: "assistant", thinking: "", text: "", createdAt: t0 + 6000, toolCalls: [{ callId: "d2", name: "write", arguments: { path: "ui/Toggle.tsx" }, status: "done", output: "", isError: false }] }],
  },
  tasks: [{ id: "1", title: "API", status: "done" }, { id: "2", title: "UI", status: "in_progress" }],
  stageHistory: [{ at: t0 + 2000, stageId: "specify", stageName: "Specify", event: "approved" }],
  blueprintName: "Spec Kit",
}

test("flows come from the timelines: the brief, handouts, edits, reports and the answer", () => {
  const events = buildEvents(input)
  const line = events.map(event => `${event.part}:${event.direction}:${event.from}->${event.to.join(",")}`)
  assert.ok(line.includes("brief:in:user->"))
  assert.ok(line.includes("brief:out:brief->lead"))
  assert.ok(line.includes("handouts:in:lead->"))
  assert.ok(line.includes("handouts:out:handouts->s1"))
  assert.ok(line.includes("handouts:out:handouts->s2"))
  assert.ok(line.includes("changes:in:s1->"))
  assert.ok(line.includes("changes:in:s2->"))
  assert.ok(line.includes("reports:in:s1->lead"), "the finished subagent reported")
  assert.ok(!line.includes("reports:in:s2->lead"), "the running one hasn't yet")
  assert.ok(line.includes("reports:out:reports->lead"))
  assert.ok(line.includes("stages:in:user->"))
  assert.ok(line.includes("summary:out:summary->user"))
  assert.deepEqual(events.map(event => event.at), [...events.map(event => event.at)].sort((a, b) => a - b), "oldest first")
})

test("each part says where it stands, and lines are live for 30 seconds", () => {
  const events = buildEvents(input)
  assert.deepEqual(partsOf(input), ["brief", "handouts", "stages", "tasks", "changes", "reports", "summary"])
  assert.deepEqual(partsOf({ ...input, subagents: [], tasks: [], stageHistory: [], blueprintName: null }), ["brief", "changes", "summary"])
  assert.equal(summarizePart("tasks", input, events).headline, "1 in progress · 1 done")
  assert.equal(summarizePart("handouts", input, events).headline, "2 subagents · 1 working")
  assert.equal(summarizePart("changes", input, events).headline, "2 files · by 2 agents")
  assert.equal(summarizePart("reports", input, events).headline, "1 of 2 reported")
  const links = linksOf(events, new Set(["user", "lead", "s1", "s2"]), t0 + 20_000)
  assert.ok(links.find(link => link.party === "s1" && link.part === "changes")?.live)
  assert.ok(!linksOf(events, new Set(["lead"]), t0 + 120_000).some(link => link.live))
})

test("the team board's own events become parts and lines: plans, posts, claims", () => {
  const team = {
    tasks: [{ id: "T1", title: "API", detail: "", owner: "s1", createdBy: "lead", status: "in_progress" as const, dependsOn: [], plan: { text: "p", status: "waiting" as const, note: "", at: t0 }, returnedNote: "", result: "", updatedAt: t0 }],
    posts: [{ seq: 1, at: t0, author: "s1", to: ["lead"], kind: "question" as const, text: "Per user?", re: null }],
    claims: [{ agent: "s1", path: "api/", at: t0 }],
    events: [
      { seq: 1, at: t0 + 100, part: "plans" as const, action: "submit", direction: "in" as const, from: "s1", to: [], subject: "T1", text: "plan for T1", count: 1 },
      { seq: 2, at: t0 + 200, part: "board" as const, action: "post", direction: "in" as const, from: "s1", to: ["lead"], subject: "#1", text: "question: Per user?", count: 1 },
      { seq: 3, at: t0 + 300, part: "claims" as const, action: "conflict", direction: "out" as const, from: "claims", to: ["s2"], subject: "api/x.ts", text: "ui was refused api/x.ts", count: 1 },
    ],
    requirePlans: true,
  }
  const withTeam = { ...input, team }
  const parts = partsOf(withTeam)
  for (const part of ["plans", "board", "claims"] as const) assert.ok(parts.includes(part), part)
  const events = buildEvents(withTeam)
  assert.equal(summarizePart("plans", withTeam, events).headline, "1 waiting · 0 approved · 0 sent back")
  assert.equal(summarizePart("board", withTeam, events).headline, "1 post · 1 question")
  assert.equal(summarizePart("claims", withTeam, events).headline, "1 path held · 1 refused")
  assert.equal(summarizePart("tasks", withTeam, events).headline, "1 in progress · 0 done", "the shared board wins over the checklist")
  const links = linksOf(events, new Set(["lead", "s1", "s2"]), t0 + 1000)
  assert.ok(links.some(link => link.party === "s2" && link.part === "claims" && link.direction === "out"))
})
