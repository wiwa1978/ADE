import assert from "node:assert/strict"
import { test } from "node:test"
import { request } from "../api.ts"

function fakeFetch(answers: Array<{ status: number; body: string } | Error>) {
  const calls: string[] = []
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${input}`)
    const next = answers.shift()
    if (!next) throw new Error("no more answers")
    if (next instanceof Error) throw next
    return new Response(next.status === 204 ? null : next.body, { status: next.status })
  }) as typeof fetch
  return calls
}

test("an empty error while the runtime restarts: a read is retried once, then explained", async () => {
  let calls = fakeFetch([{ status: 500, body: "" }, { status: 200, body: '{"ok":1}' }])
  assert.deepEqual(await request("/api/projects"), { ok: 1 })
  assert.equal(calls.length, 2)

  calls = fakeFetch([{ status: 502, body: "" }, { status: 502, body: "" }])
  await assert.rejects(request("/api/projects"), /didn't answer properly \(status 502\)[\s\S]*restarting/)
  assert.equal(calls.length, 2)

  // A change isn't sent twice.
  calls = fakeFetch([{ status: 500, body: "" }])
  await assert.rejects(request("/api/projects", { method: "POST", body: "{}" }), /didn't answer properly/)
  assert.equal(calls.length, 1)
})

test("errors with a message keep it; an empty success is fine", async () => {
  fakeFetch([{ status: 409, body: '{"error":"Busy"}' }])
  await assert.rejects(request("/api/x", { method: "POST" }), /^Error: Busy$/)
  fakeFetch([{ status: 204, body: "" }])
  assert.deepEqual(await request("/api/x", { method: "POST" }), {})
  fakeFetch([new Error("connect ECONNREFUSED"), { status: 200, body: "[]" }])
  assert.deepEqual(await request("/api/y"), [])
})
