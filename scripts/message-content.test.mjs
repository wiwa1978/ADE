import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer } from "vite"

let server
let MessageContent

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: "custom" })
  ;({ MessageContent } = await server.ssrLoadModule("/MessageContent.tsx"))
})

after(async () => { await server?.close() })

function render(content) {
  return renderToStaticMarkup(React.createElement(MessageContent, { content }))
}

test("renders and highlights fenced code alongside Markdown", () => {
  const html = render("Example `count`:\n\n```typescript\nfunction sum(a: number) {\n  return a + 1\n}\n```\n\n- Done")
  assert.match(html, /<code>count<\/code>/)
  assert.match(html, /<pre><code class="[^"]*language-typescript/)
  assert.match(html, /class="hljs-keyword">function<\/span>/)
  assert.match(html, /\n  <span class="hljs-keyword">return<\/span>/)
  assert.match(html, /<li>Done<\/li>/)
})

test("unknown languages remain plain code and untrusted markup stays inert", () => {
  const html = render("```unknown-language\n<a>test</a>\n```\n\n<script>alert(1)</script>\n\n![remote](https://example.invalid/x.png)\n\n[bad](javascript:alert(1))")
  assert.match(html, /<pre><code class="[^"]*language-unknown-language">&lt;a&gt;test&lt;\/a&gt;/)
  assert.doesNotMatch(html, /<script|<img|href="javascript:/)
  assert.match(html, /Image: remote/)
})
