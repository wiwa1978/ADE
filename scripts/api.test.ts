import assert from "node:assert/strict"
import { test } from "node:test"
import { request, requestJson } from "../api.ts"

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

test("requestJson sends the body as JSON with the right headers, `{}` without one, and keeps error messages", async () => {
  const seen: Array<{ method?: string; type: string | null; body?: unknown }> = []
  globalThis.fetch = (async (_input: string, init?: RequestInit) => {
    seen.push({ method: init?.method, type: new Headers(init?.headers).get("content-type"), body: init?.body })
    return new Response('{"ok":true}', { status: 200 })
  }) as typeof fetch
  assert.deepEqual(await requestJson("/api/x", "POST", { a: 1 }), { ok: true })
  await requestJson("/api/x", "PUT")
  await requestJson("/api/x", "DELETE", { id: "z" })
  assert.deepEqual(seen, [
    { method: "POST", type: "application/json", body: '{"a":1}' },
    { method: "PUT", type: "application/json", body: "{}" },
    { method: "DELETE", type: "application/json", body: '{"id":"z"}' },
  ])
  fakeFetch([{ status: 409, body: '{"error":"Busy"}' }])
  await assert.rejects(requestJson("/api/x", "POST", {}), /^Error: Busy$/)
})
