import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, afterEach, before, beforeEach, test } from "node:test"
import React, { act } from "react"
import { Window } from "happy-dom"
import { createServer, type ViteDevServer } from "vite"
import type { Root } from "react-dom/client"

let browser: Window
let server: ViteDevServer
let createRoot: typeof import("react-dom/client").createRoot
let App: React.ComponentType
let container: HTMLDivElement
let root: Root
let cacheDirectory: string
let requests: Array<{ url: string; body: Record<string, unknown> | null; method: string }>
let intervals: Map<symbol, { callback: () => void; delay: number }>
let activeEnvironmentId: string
let environments: Array<Record<string, unknown>>
let projectRecords: Array<Record<string, unknown>>
let sessionRecords: Array<Record<string, unknown>>
let subagentRecords: Array<Record<string, unknown>>
let approvalRecords: Array<Record<string, unknown>>
let artifactRecords: Array<Record<string, unknown>>
let mcpRecords: Array<Record<string, unknown>>

before(async () => {
  browser = new Window({ url: "http://127.0.0.1:1420/" })
  const globals = globalThis as unknown as Record<string, unknown>
  const win = browser as unknown as Record<string, unknown>
  globals.window = browser
  globals.document = browser.document
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser.navigator })
  for (const name of ["DocumentFragment", "Element", "HTMLFormElement", "HTMLInputElement", "HTMLTextAreaElement", "localStorage", "MutationObserver", "getComputedStyle", "Event", "CustomEvent", "KeyboardEvent"]) {
    globals[name] = win[name]
  }
  globals.matchMedia = browser.matchMedia.bind(browser)
  globals.IS_REACT_ACT_ENVIRONMENT = true
  ;({ createRoot } = await import("react-dom/client"))
  cacheDirectory = mkdtempSync(join(tmpdir(), "ade-app-test-"))
  server = await createServer({ cacheDir: cacheDirectory, server: { middlewareMode: true, hmr: false }, appType: "custom", optimizeDeps: { noDiscovery: true } })
  ;({ default: App } = (await server.ssrLoadModule("/App.tsx")) as { default: React.ComponentType })
})

after(async () => {
  await server?.close()
  await browser?.close()
  if (cacheDirectory) rmSync(cacheDirectory, { recursive: true, force: true })
})

beforeEach(() => {
  requests = []
  intervals = new Map()
  activeEnvironmentId = "local"
  environments = [{ id: "local", name: "This computer", kind: "local", status: "connected", active: true }]
  projectRecords = []
  sessionRecords = [
    {
      id: "task-1",
      mode: "coding",
      label: "Build split-pane ADE",
      status: "idle",
      workspace: { kind: "worktree", path: "/tmp/demo-repo", repository: "/tmp/demo-repo", branch: "ade/task-1", status: "ready", message: null },
      messages: [],
    },
    { id: "coding", mode: "coding", label: "Coding lead", status: "idle", messages: [] },
    { id: "personal", mode: "personal", label: "Personal agent", status: "idle", messages: [] },
  ]
  subagentRecords = [
    {
      id: "sub-1",
      parentId: "0",
      assignmentId: "asgn-1",
      name: "Backend Worker",
      role: "API Builder",
      mode: "worktree",
      branch: "ade/sub-1",
      background: true,
      assignment: "Build SSE stream and approval signals",
      status: "running",
      model: "fixture",
      reasoning: "medium",
      error: null,
      liveTools: [{ callId: "c1", name: "run_command", arguments: { command: "npm test" }, status: "running", output: "running tests...", isError: false }],
      timeline: [{ id: "e1", kind: "user", content: "Build SSE stream and approval signals", createdAt: Date.now() }],
      messages: [{ id: "m1", role: "user", content: "Build SSE stream and approval signals" }],
    },
    {
      id: "sub-2",
      parentId: "0",
      assignmentId: "asgn-2",
      name: "UI Reviewer",
      role: "Code Reviewer",
      mode: "readonly",
      background: false,
      assignment: "Audit Paseo split-pane styling",
      status: "completed",
      model: "fixture",
      reasoning: "low",
      error: null,
      liveTools: [],
      timeline: [{ id: "e2", kind: "assistant", thinking: "", text: "Styling looks clean.", toolCalls: [], createdAt: Date.now() }],
      messages: [{ id: "m2", role: "assistant", content: "Styling looks clean." }],
    },
  ]
  approvalRecords = [
    {
      id: "appr-1",
      sessionId: "task-1",
      taskId: "t1",
      signalKey: "sig-1",
      toolName: "run_command",
      summary: "Run command: npm run build",
      command: "npm run build",
      arguments: { command: "npm run build" },
      suggestedPrefix: "npm run",
      createdAt: Date.now(),
    },
  ]
  artifactRecords = [
    {
      id: "art-1",
      sessionId: "task-1",
      title: "Implementation Plan",
      kind: "plan",
      content: "# Plan\n- Build split panes\n- Add Chrome CDP browser",
      status: "awaiting_approval",
      feedback: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]
  mcpRecords = []

  browser.localStorage.clear()
  // Start on the session view (the app's first-run default is the Inbox).
  browser.localStorage.setItem("ade.last-view", JSON.stringify({ screen: "work", activeSessionId: "coding" }))
  ;(browser as unknown as Record<string, unknown>).setInterval = (callback: () => void, delay: number) => {
    const id = Symbol("interval")
    intervals.set(id, { callback, delay })
    return id
  }
  ;(browser as unknown as Record<string, unknown>).clearInterval = (id: symbol) => intervals.delete(id)
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null
    const method = init?.method ?? "GET"
    requests.push({ url, body, method })
    let payload: Record<string, unknown> = {}
    if (url.startsWith("/api/health")) {
      payload = {
        online: true, harness: "Pi Durable", provider: "openai",
        configured: true, defaultModel: "fixture", models: [{ id: "fixture", name: "Fixture model" }],
        providers: [{ id: "openai", name: "OpenAI" }], copilotSignedIn: false, message: "",
      }
    } else if (url === "/api/models/catalog") {
      payload = {
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            configured: true,
            defaultModel: "claude-sonnet-4",
            setupMessage: "",
            models: [
              { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
              { id: "claude-haiku-4", name: "Claude Haiku 4" },
            ],
          },
          {
            id: "openai",
            name: "OpenAI",
            configured: true,
            defaultModel: "fixture",
            setupMessage: "",
            models: [{ id: "fixture", name: "Fixture model" }],
          },
          {
            id: "github-copilot",
            name: "GitHub Copilot",
            configured: true,
            defaultModel: "gemini-4-pro",
            setupMessage: "",
            models: [
              { id: "gemini-4-pro", name: "Gemini 4 Pro" },
              { id: "claude-sonnet-copilot", name: "Claude Sonnet 4.5" },
            ],
          },
        ],
      }
    } else if (url === "/api/sessions") {
      payload = { sessions: sessionRecords }
    } else if (url === "/api/projects" && method === "GET") {
      payload = { projects: projectRecords }
    } else if (url === "/api/projects" && method === "POST") {
      const project = { id: body?.id, name: body?.name, githubUrl: body?.githubUrl || null, repository: body?.repository || null }
      projectRecords.push(project)
      payload = { project }
    } else if (url.startsWith("/api/projects/") && url.endsWith("/scripts")) {
      const empty = { setup: "", run: "", copy: [], check: "", checkAutoFix: false }
      payload = { saved: empty, repository: null, effective: { ...empty, source: {} } }
    } else if (url.startsWith("/api/projects/") && url.endsWith("/secrets")) {
      payload = { secrets: [] }
    } else if (url.startsWith("/api/projects/") && url.endsWith("/run-on")) {
      payload = { target: "local", image: "node:22-bookworm", sshHost: "" }
    } else if (url === "/api/environments" && method === "GET") {
      payload = { activeId: activeEnvironmentId, environments }
    } else if (url.startsWith("/api/sessions/") && url.endsWith("/timeline")) {
      payload = {
        sessionId: "task-1",
        conversationId: "0",
        busy: false,
        items: [
          { id: "u1", kind: "user", content: "Build the split-pane ADE", createdAt: Date.now() },
          { id: "a1", kind: "assistant", thinking: "Planning the architecture", text: "Server running at http://localhost:1420", toolCalls: [], createdAt: Date.now() },
        ],
        liveTools: [],
      }
    } else if (url.includes("/agents")) {
      payload = { agents: subagentRecords }
    } else if (url.startsWith("/api/approvals") && method === "GET") {
      payload = { pending: approvalRecords, policy: "auto-safe", rules: [] }
    } else if (url.includes("/approvals/") && url.endsWith("/resolve")) {
      approvalRecords = []
      payload = { resolved: { id: "appr-1" } }
    } else if (url.startsWith("/api/processes")) {
      payload = { processes: [] }
    } else if (url.startsWith("/api/workspace/git")) {
      payload = { isGitRepo: true, branch: "ade/task-1", ahead: 0, behind: 0, additions: 42, deletions: 7, files: [{ path: "App.tsx", status: "modified", staged: false, unstaged: true, additions: 42, deletions: 7 }] }
    } else if (url.includes("/artifacts") && method === "GET") {
      payload = { artifacts: artifactRecords }
    } else if (url.includes("/artifacts/") && url.endsWith("/review")) {
      artifactRecords = artifactRecords.map(a => ({ ...a, status: body?.decision }))
      payload = { artifact: artifactRecords[0] }
    } else if (url.includes("/tasks")) {
      payload = { tasks: [{ id: "1", title: "Split panes", status: "done" }, { id: "2", title: "Browser pane", status: "in_progress" }] }
    } else if (url.startsWith("/api/skills")) {
      payload = {
        skills: [{ name: "demo-skill", description: "Demo", path: "/tmp/SKILL.md", scope: "workspace" }],
        rules: [],
        commands: [
          { name: "plan", description: "Write an Implementation Plan artifact", prompt: "Create plan", scope: "builtin" },
          { name: "compact", description: "Compact conversation", prompt: "__ADE_COMPACT__", scope: "builtin" },
        ],
      }
    } else if (url === "/api/browser/status") {
      payload = { available: true, chromePath: "/Applications/Google Chrome.app", running: false, url: "about:blank", title: "New Tab", loading: false, canGoBack: false, canGoForward: false, agentDriving: false, viewport: { width: 1280, height: 800, preset: "desktop" }, lastFrame: null, error: null }
    } else if (url === "/api/browser/open-external") {
      payload = { url: body?.url, launched: true }
    } else if (url === "/api/mcp" && method === "GET") {
      payload = { servers: mcpRecords }
    } else if (url === "/api/mcp" && method === "POST") {
      const serverItem = { id: "mcp-1", ...(body ?? {}), status: "disconnected", error: null, tools: [] }
      mcpRecords.push(serverItem)
      payload = { server: serverItem }
    } else if (url === "/api/provider-tools") {
      payload = { providers: [] }
    } else if (url === "/api/model-credentials") {
      payload = { credentials: [] }
    } else if (url === "/api/github/connection" || url === "/api/github/auto-connect") {
      payload = { login: null }
    } else if (url === "/api/worktree-operations") {
      payload = { operations: [] }
    }
    return { ok: true, json: async () => payload } as Response
  }) as typeof fetch
  const rawContainer = browser.document.createElement("div")
  browser.document.body.append(rawContainer)
  container = rawContainer as unknown as HTMLDivElement
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  assert.equal(intervals.size, 0, "all polling intervals are cleaned up")
  container.remove()
})

function findButton(matcher: string | RegExp) {
  const result = [...container.querySelectorAll("button")].find(item => {
    const label = item.getAttribute("aria-label") || ""
    const text = item.textContent?.trim() || ""
    return typeof matcher === "string"
      ? label === matcher || text === matcher || text.includes(matcher)
      : matcher.test(label) || matcher.test(text)
  })
  assert.ok(result, `Missing button matching: ${matcher}`)
  return result
}

async function click(matcher: string | RegExp) {
  await act(async () => { findButton(matcher).click() })
}

function setInput(input: Element, value: string) {
  const prototype = input instanceof (browser.HTMLTextAreaElement as unknown as typeof HTMLTextAreaElement)
    ? browser.HTMLTextAreaElement.prototype
    : browser.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  assert.ok(setter, "Missing value setter on input prototype")
  setter.call(input, value)
  input.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event)
}

test("renders Paseo split-pane workspace with live multi-subagent tracks, side-by-side subagent pane, and approvals", async () => {
  await act(async () => root.render(React.createElement(App)))

  // Select the worktree coding session in the sidebar
  const taskRow = [...container.querySelectorAll('[role="button"]')].find(el => el.textContent?.includes("Build split-pane ADE"))
  assert.ok(taskRow, "Missing Build split-pane ADE session in sidebar")
  await act(async () => { (taskRow as HTMLElement).click() })

  // Verify ambient tracks show running subagents, git diff stats, tasks, and pending artifact
  assert.match(container.textContent ?? "", /1 running · 2 subagents/)
  assert.match(container.textContent ?? "", /\+42/)
  assert.match(container.textContent ?? "", /1\/2 tasks/)
  assert.match(container.textContent ?? "", /Review: Implementation Plan/)

  // Verify approval card is visible and Allow once resolves it
  assert.match(container.textContent ?? "", /Approval required/)
  assert.match(container.textContent ?? "", /npm run build/)
  await click("Allow once")
  assert.ok(requests.some(r => r.url.includes("/api/approvals/appr-1/resolve") && r.body?.allow === true))

  // Expand live subagents strip and inspect subagent beside the lead
  await click(/1 running · 2 subagents/)
  assert.match(container.textContent ?? "", /Backend Worker/)
  assert.match(container.textContent ?? "", /UI Reviewer/)
  await click("Inspect beside")
  assert.match(container.textContent ?? "", /Assignment:/)
  assert.match(container.textContent ?? "", /Build SSE stream and approval signals/)
})

test("opens Built-in Browser pane and triggers external system browser launch", async () => {
  await act(async () => root.render(React.createElement(App)))
  await click("Browser")
  assert.match(container.textContent ?? "", /Built-in Interactive Browser/)
  await click("External")
  assert.ok(requests.some(r => r.url === "/api/browser/open-external" && r.method === "POST"))
})

test("opens Artifact pane and approves Implementation Plan", async () => {
  await act(async () => root.render(React.createElement(App)))
  await click(/Review: Implementation Plan/)
  assert.match(container.textContent ?? "", /Approve & Proceed/)
  await click(/Approve & Proceed/)
  assert.ok(requests.some(r => r.url.includes("/api/artifacts/art-1/review") && r.body?.decision === "approved"))
})

test("composer slash command autocomplete and Settings MCP + appearance persist", async () => {
  await act(async () => root.render(React.createElement(App)))
  const textarea = container.querySelector(".ade-composer-textarea")
  assert.ok(textarea)
  await act(async () => setInput(textarea, "/pl"))
  assert.match(container.textContent ?? "", /Write an Implementation Plan artifact/)

  // Open Settings
  await click("Settings")
  await click("Appearance")
  await click("Light")
  assert.equal(browser.document.documentElement.dataset.theme, "light")
  await click("Agents & permissions")
  assert.match(container.textContent ?? "", /MCP Servers/)
  assert.match(container.textContent ?? "", /Command Approvals/)
})

test("3-column ModelPicker searches models across providers, switches thinking level, and changes access mode", async () => {
  await act(async () => root.render(React.createElement(App)))

  await click("Model")
  assert.match(container.textContent ?? "", /Thinking/)
  assert.match(container.textContent ?? "", /Extra High/)
  assert.match(container.textContent ?? "", /Max/)
  assert.match(container.textContent ?? "", /⌘1/)

  // Select Extra High thinking
  await click("Extra High")
  assert.equal((JSON.parse(browser.localStorage.getItem("ade-settings-v1") ?? "{}") as { reasoning?: string }).reasoning, "xhigh")

  // Search across providers for Claude Sonnet
  const searchInput = container.querySelector(".ade-mp-search-input")
  assert.ok(searchInput)
  await act(async () => setInput(searchInput, "Claude Sonnet"))
  assert.match(container.textContent ?? "", /Claude Sonnet 4/)

  // Click Claude Sonnet 4 to switch provider + model
  const row = [...container.querySelectorAll(".ade-mp-row")].find(el => el.textContent?.includes("Claude Sonnet 4"))
  assert.ok(row)
  await act(async () => { (row as HTMLElement).click() })
  const saved = JSON.parse(browser.localStorage.getItem("ade-settings-v1") ?? "{}") as { provider?: string; model?: string }
  assert.equal(saved.provider, "anthropic")
  assert.equal(saved.model, "claude-sonnet-4")
})

test("Appearance searchable FontPicker filters Google Fonts, loads stylesheet, and persists selection", async () => {
  await act(async () => root.render(React.createElement(App)))

  await click("Settings")
  await click("Appearance")

  const trigger = container.querySelector('button[aria-label="Interface font"]')
  assert.ok(trigger, "Missing Interface font picker trigger")
  await act(async () => { (trigger as HTMLElement).click() })

  const searchInput = container.querySelector(".st-fp-search-input")
  assert.ok(searchInput, "Missing FontPicker search input")
  await act(async () => setInput(searchInput, "Geist"))
  assert.match(container.textContent ?? "", /Geist/)

  const geistOption = [...container.querySelectorAll(".st-fp-item")].find(el => el.textContent?.includes("Geist"))
  assert.ok(geistOption, "Missing Geist option")
  await act(async () => { (geistOption as HTMLElement).click() })

  assert.ok(browser.document.head.querySelector('link[href*="fonts.googleapis.com"][href*="Geist"]'), "Expected Google Fonts link for Geist")

  await click("Apply")
  const saved = JSON.parse(browser.localStorage.getItem("ade-settings-v1") ?? "{}") as { interfaceFont?: string }
  assert.match(saved.interfaceFont ?? "", /Geist/)
})

test("Create Project wizard steps through Environments -> Sources and Skip creates an empty project with right-side settings open", async () => {
  await act(async () => root.render(React.createElement(App)))

  const addProjectBtn = container.querySelector('button[aria-label="Add project"]')
  assert.ok(addProjectBtn, "Expected Add project icon button next to sidebar search box")
  await act(async () => { (addProjectBtn as HTMLElement).click() })

  const dialog = container.querySelector('[role="dialog"][aria-label="Create Project"]')
  assert.ok(dialog, "Expected Create Project wizard dialog")
  assert.match(dialog.textContent ?? "", /Environments/)
  assert.match(dialog.textContent ?? "", /This computer/)

  // Step 1 -> Step 2 (Sources)
  const envOption = [...dialog.querySelectorAll('[role="option"]')].find(el => el.textContent?.includes("This computer"))
  assert.ok(envOption, "Expected This computer environment option")
  await act(async () => { (envOption as HTMLElement).click() })
  assert.match(dialog.textContent ?? "", /Sources/)
  assert.match(dialog.textContent ?? "", /Local folder/)
  assert.match(dialog.textContent ?? "", /Git URL/)
  assert.match(dialog.textContent ?? "", /GitHub repository/)

  // Click Skip -> creates empty project and opens right-side Project settings
  const skipBtn = [...dialog.querySelectorAll("button")].find(el => el.textContent?.trim() === "Skip")
  assert.ok(skipBtn, "Expected Skip button in wizard footer")
  await act(async () => { (skipBtn as HTMLElement).click() })

  const createReq = requests.find(r => r.url === "/api/projects" && r.method === "POST")
  assert.ok(createReq, "Expected POST /api/projects request from Skip")
  assert.equal(createReq.body?.repository, "")
  assert.equal(createReq.body?.githubUrl, "")

  const rightSettings = container.querySelector("#project-settings")
  assert.ok(rightSettings, "Expected right-side Project settings panel")
  assert.equal(rightSettings.hasAttribute("hidden"), false, "Expected right-side Project settings to be open after Skip")
})

test("Keybindings editor rebinds built-in shortcuts, reflects them in the UI, and creates custom shortcuts", async () => {
  await act(async () => root.render(React.createElement(App)))

  await click("Settings")
  // Rebind Search shortcut from Mod+K to Mod+P
  const rebindBtn = container.querySelector('button[aria-label="Change shortcut for Search sessions, projects, and commands"]')
  assert.ok(rebindBtn, "Expected rebind button for Search shortcut")
  await act(async () => { (rebindBtn as HTMLElement).click() })
  assert.match(rebindBtn.textContent ?? "", /Press keys…/)

  const isMac = /mac/i.test(browser.navigator.platform ?? "")
  const mod = isMac ? { metaKey: true } : { ctrlKey: true }

  await act(async () => {
    browser.window.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "p", code: "KeyP", ...mod, bubbles: true }))
  })

  // Persisted and reflected in Settings
  const savedAfterRebind = JSON.parse(browser.localStorage.getItem("ade-settings-v1") ?? "{}") as { keybindings?: Record<string, string> }
  assert.equal(savedAfterRebind.keybindings?.commandCenter, "Mod+P")

  // Add a custom shortcut
  await click("Add shortcut")
  const recordCustom = container.querySelector('button[aria-label="Record custom shortcut"]')
  assert.ok(recordCustom, "Expected custom shortcut record button")
  await act(async () => { (recordCustom as HTMLElement).click() })
  await act(async () => {
    browser.window.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "d", code: "KeyD", ...mod, shiftKey: true, bubbles: true }))
  })
  const addBtn = [...container.querySelectorAll("button")].find(el => el.textContent?.trim() === "Add")
  assert.ok(addBtn, "Expected Add button for custom shortcut")
  await act(async () => { (addBtn as HTMLElement).click() })

  const savedWithCustom = JSON.parse(browser.localStorage.getItem("ade-settings-v1") ?? "{}") as { customKeybindings?: { chord: string; action: string }[] }
  assert.equal(savedWithCustom.customKeybindings?.length, 1)
  assert.equal(savedWithCustom.customKeybindings?.[0]?.chord, "Mod+Shift+D")

  // Go back to app and verify sidebar Search badge reflects the rebound shortcut (⌘P or Ctrl+P)
  await click("Back to app")
  const searchBox = container.querySelector(".ade-sidebar-search-box")
  assert.ok(searchBox, "Expected sidebar search box")
  assert.match(searchBox.textContent ?? "", /P/)
})
