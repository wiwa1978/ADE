import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, afterEach, before, beforeEach, test } from "node:test"
import React, { act } from "react"
import { Window } from "happy-dom"
import { createServer, type ViteDevServer } from "vite"
import type { Root } from "react-dom/client"
import { BUILTIN_BLUEPRINTS } from "../packages/blueprints/index.ts"
import { BUILTIN_MODEL_PROFILES } from "../packages/captain-core/index.ts"

let browser: Window
let server: ViteDevServer
let createRoot: typeof import("react-dom/client").createRoot
let FactoryView: React.ComponentType<Record<string, unknown>>
let container: HTMLDivElement
let root: Root
let cacheDirectory: string

before(async () => {
  browser = new Window({ url: "http://127.0.0.1:1420/" })
  const globals = globalThis as unknown as Record<string, unknown>
  const win = browser as unknown as Record<string, unknown>
  globals.window = browser
  globals.document = browser.document
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser.navigator })
  for (const name of [
    "DocumentFragment",
    "Element",
    "HTMLFormElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLTextAreaElement",
    "localStorage",
    "MutationObserver",
    "getComputedStyle",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
  ]) {
    globals[name] = win[name]
  }
  globals.matchMedia = browser.matchMedia.bind(browser)
  globals.IS_REACT_ACT_ENVIRONMENT = true
  ;({ createRoot } = await import("react-dom/client"))
  cacheDirectory = mkdtempSync(join(tmpdir(), "ade-factory-ui-test-"))
  server = await createServer({
    cacheDir: cacheDirectory,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
  })
  ;({ FactoryView } = (await server.ssrLoadModule("/src/factory/FactoryView.tsx")) as { FactoryView: React.ComponentType<Record<string, unknown>> })
})

after(async () => {
  await server?.close()
  if (cacheDirectory) rmSync(cacheDirectory, { recursive: true, force: true })
})

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
})

test("FactoryView renders project-level metadata, live Kanban board, Run Workspace tabs (Subagents, Diff, Terminal, Browser), and Project Settings", async () => {
  const sampleRun = {
    run: {
      runId: "run_ui_1",
      projectId: "proj-1",
      blueprintId: "openspec",
      issueRef: {
        repository: "acme/ade",
        number: 42,
        title: "Add SSO authentication",
        url: "https://github.com/acme/ade/issues/42",
      },
      status: "awaiting_human",
      currentStageIndex: 4,
      stages: BUILTIN_BLUEPRINTS[1].stages.map((s, idx) => ({
        stageId: s.id,
        status: idx < 4 ? "completed" : idx === 4 ? "awaiting_approval" : "pending",
        attempt: idx <= 4 ? 1 : 0,
        sandboxAttached: false,
      })),
      auditLoopbacksUsed: 1,
    },
    blueprint: BUILTIN_BLUEPRINTS[1],
    repoPath: "/tmp/demo-repo",
    worktreePath: "/tmp/demo-worktree",
    githubRepo: "acme/ade",
    baseBranch: "main",
    workBranch: "ade/run_ui_1",
    taskPrompt: "#42: Add SSO authentication",
    modelConfig: {
      profile: "eu-only",
      appDefault: { provider: "bedrock-eu", model: "eu.anthropic.claude-sonnet-4-5" },
      compliance: { euOnlyMode: true },
    },
    sandboxMode: "detached",
    sandboxId: null,
    autoRunning: false,
    pausedByHuman: false,
    humanTakeOver: false,
    diff: "+export const ssoEnabled = true;\n",
    prUrl: null,
    steeringNotes: [],
    subagents: [
      {
        id: "sub_goldfish_1",
        stageId: "review",
        name: "Goldfish Auditor (Goldfish Delta Audit)",
        role: "subagent",
        contextIsolation: "goldfish",
        model: "azure-openai-eu/gpt-5-sweden-central",
        status: "completed",
        startedAt: 1000,
        endedAt: 2000,
        summary: "VERDICT: PASS",
        output: "Verified entire codebase. VERDICT: PASS",
      },
    ],
    pendingEscalations: [
      {
        id: "esc_1",
        runId: "run_ui_1",
        stageId: "archive_and_pr",
        kind: "approve_pr",
        title: "Approve starting \"Archive & Publish PR\"",
        summary: "All tests and Goldfish audit passed.",
        options: [{ id: "approve", label: "Approve & Publish PR", recommended: true }],
        sourceSubagentIds: [],
        status: "pending",
        createdAt: 2000,
      },
    ],
    logs: [{ timestamp: 1000, stageId: "review", level: "info", message: "Goldfish audit passed." }],
    telemetry: {
      actualInputTokens: 4200,
      actualOutputTokens: 900,
      actualUsd: 0.021,
      toolSchemasPruned: 14,
      loopInterventions: 1,
    },
    crossFamilyVerified: true,
    lastError: null,
  }

  globalThis.fetch = (async (url: string | URL) => {
    const path = String(url)
    if (path.includes("/api/factory/capabilities")) {
      return new Response(
        JSON.stringify({
          flavor: "local",
          captainHost: "node-sqlite",
          region: "local",
          blueprints: BUILTIN_BLUEPRINTS.map(({ id, name, bestFor }) => ({ id, name, bestFor })),
          modelProfiles: BUILTIN_MODEL_PROFILES.map(({ id, name, euCompliantByDefault }) => ({
            id,
            name,
            euCompliantByDefault,
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    if (path.includes("/api/factory/blueprints")) {
      return new Response(JSON.stringify({ blueprints: BUILTIN_BLUEPRINTS }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (path.includes("/api/factory/runs")) {
      return new Response(JSON.stringify({ runs: [sampleRun] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch

  const project = {
    id: "proj-1",
    name: "Acme ADE",
    githubUrl: "https://github.com/acme/ade",
    repository: "/tmp/demo-repo",
    blueprintId: "openspec",
    modelProfile: "eu-only",
    euOnlyMode: true,
  }

  const browserState = {
    available: false,
    chromePath: null,
    running: false,
    url: "about:blank",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    agentDriving: false,
    viewport: { width: 1280, height: 800, preset: "desktop" as const },
    lastFrame: null,
    error: null,
  }

  await act(async () => {
    root.render(
      React.createElement(FactoryView, {
        projects: [project],
        selectedProjectId: project.id,
        modelCatalog: [
          {
            id: "anthropic",
            name: "Anthropic",
            configured: true,
            defaultModel: "claude-sonnet-4-5",
            setupMessage: "",
            models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
          },
        ],
        githubLogin: "acme-dev",
        environmentId: "local",
        terminalFontSize: 13,
        terminalScrollback: 1000,
        browserState,
        onSelectProject: () => {},
        onProjectSaved: () => {},
        onBrowserStateChange: () => {},
        onOpenExternal: async () => {},
      }),
    )
    await new Promise(r => setTimeout(r, 30))
  })

  // 1. Project-level context pills and Kanban board render cleanly
  assert.match(container.textContent, /OpenSpec \(Brownfield\)/)
  assert.match(container.textContent, /acme\/ade/)
  assert.match(container.textContent, /#42 Add SSO authentication/)
  assert.match(container.textContent, /Needs Approval \/ PR/)

  // 2. Click Kanban card -> opens Run Workspace with Subagents, Diff, Terminal, Browser tabs
  const card = container.querySelector(".sf-kanban-card")
  assert.ok(card, "Expected Kanban card")
  await act(async () => {
    ;(card as HTMLElement).click()
  })
  assert.match(container.textContent, /Goldfish Auditor/)
  assert.match(container.textContent, /Approve & Continue/)
  assert.match(container.textContent, /Terminal/)
  assert.match(container.textContent, /Browser/)

  // 3. Switch to Diff & Telemetry tab -> shows real diff & actual tokens
  const diffTab = [...container.querySelectorAll("button")].find(b => b.textContent?.includes("Diff & Telemetry"))
  assert.ok(diffTab)
  await act(async () => {
    diffTab.click()
  })
  assert.match(container.textContent, /ssoEnabled = true/)
  assert.match(container.textContent, /\$0\.0210/)

  // 4. Switch to Browser tab -> renders BrowserPanel
  const browserTab = [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === "Browser")
  assert.ok(browserTab)
  await act(async () => {
    browserTab.click()
  })
  assert.match(container.textContent, /localhost:3000/)

  // 5. Open Project Settings modal -> blueprint & GitHub controls live at Project level
  const settingsBtn = [...container.querySelectorAll("button")].find(b => b.textContent?.includes("Project Settings"))
  assert.ok(settingsBtn)
  await act(async () => {
    settingsBtn.click()
  })
  assert.match(container.textContent, /Project Blueprint/)
  assert.match(container.textContent, /Detect Remote/)
  assert.match(container.textContent, /Per-Stage Model Overrides/)
})
