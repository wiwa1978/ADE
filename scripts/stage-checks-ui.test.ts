import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer, type ViteDevServer } from "vite"

let server: ViteDevServer | undefined
let StagesPanel: React.ComponentType<Record<string, unknown>>

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: "custom" })
  StagesPanel = (await server.ssrLoadModule("/src/blueprints/StagesPanel.tsx") as { StagesPanel: typeof StagesPanel }).StagesPanel
})
after(async () => { await server?.close() })

const stage = (id: string, name: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, name, description: `${name} stage`, status, attempt: 1, gate: "never", executor: "captain", goldfish: false, artifactPaths: [], summary: null, verdict: null, checks: null, startedAt: null, endedAt: null, ...extra,
})

test("the Stages view shows what ADE's checks found: passes, a failure with its output, and what the project has no command for", () => {
  const checks = {
    source: "package", ok: false, at: 1, missing: ["lint"],
    results: [
      { label: "build", command: "npm run build", status: "passed", exitCode: 0, output: "", ms: 4200 },
      { label: "test", command: "npm test", status: "failed", exitCode: 1, output: "FAIL src/health.test.ts\n  expected status 200, got 404", ms: 9100 },
    ],
  }
  const stages = {
    blueprintId: "speckit", name: "Spec Kit (Greenfield)", history: [],
    summary: { id: "speckit", name: "Spec Kit", status: "running", stage: { id: "verify", name: "Verify & E2E", status: "running", index: 1 }, done: 1, total: 2 },
    stages: [stage("implement", "Implement", "completed"), stage("verify", "Verify & E2E", "running", { checks })],
  }
  const html = renderToStaticMarkup(React.createElement(StagesPanel, { sessionId: "s1", stages, busy: false, locked: false, onChanged: () => undefined }))
  assert.match(html, /ADE&#x27;s checks/)
  assert.match(html, /1 failed/)
  assert.match(html, /ade-stage-check is-passed[\s\S]*build[\s\S]*npm run build/)
  assert.match(html, /ade-stage-check is-failed[\s\S]*test[\s\S]*npm test/)
  assert.match(html, /expected status 200, got 404/, "the failing command's output is shown")
  assert.match(html, /No command in this project for: lint/)
  assert.match(html, /· checks failed/, "the stage card says so too")
  // A stage without a run of checks shows no block.
  const quiet = renderToStaticMarkup(React.createElement(StagesPanel, { sessionId: "s1", stages: { ...stages, summary: { ...stages.summary, stage: { id: "implement", name: "Implement", status: "completed", index: 0 } } }, busy: false, locked: false, onChanged: () => undefined }))
  assert.doesNotMatch(quiet.split("ade-stage-detail")[1] ?? "", /ADE&#x27;s checks/)
})
