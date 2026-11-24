import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer, type ViteDevServer } from "vite"

let server: ViteDevServer | undefined
let CaptainStatusLine: React.ComponentType<Record<string, unknown>>

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: "custom" })
  CaptainStatusLine = (await server.ssrLoadModule("/src/workspace/CaptainStatusLine.tsx") as { CaptainStatusLine: typeof CaptainStatusLine }).CaptainStatusLine
})
after(async () => { await server?.close() })

const sub = (id: string, status: string) => ({ id, name: id, status })
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(CaptainStatusLine, { sessionId: "s1", busy: false, subagents: [], blueprint: null, onOpenAgents() {}, onPause() {}, onTakeOver() {}, ...props }))

test("the Captain line says how many subagents work, with Pause and Take over", () => {
  const html = render({ busy: true, subagents: [sub("a", "running"), sub("b", "waiting"), sub("c", "completed")] })
  assert.match(html, /Captain/)
  assert.match(html, /2 subagents working/)
  assert.match(html, /Pause/)
  assert.match(html, /Take over/)
})

test("one subagent is singular; nothing at all renders when the Captain is idle", () => {
  assert.match(render({ busy: true, subagents: [sub("a", "running")] }), /1 subagent working/)
  assert.equal(render({}), "")
  assert.equal(render({ subagents: [sub("a", "completed")] }), "")
})

test("a stage that waits for you gets its decision right in the session", () => {
  const blueprint = { id: "speckit", name: "Spec Kit", status: "running", done: 1, total: 3, stage: { id: "plan", name: "Plan", status: "awaiting_approval", index: 1 } }
  const html = render({ blueprint })
  assert.match(html, /Plan<\/strong> is waiting for you/)
  assert.match(html, /Approve/)
  assert.match(html, /Request changes/)
})
