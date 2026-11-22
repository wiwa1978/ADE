import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, afterEach, before, beforeEach, test } from "node:test"
import React, { act } from "react"
import type { Root } from "react-dom/client"
import { Window } from "happy-dom"
import { createServer, type ViteDevServer } from "vite"

type ProjectSettingsProps = {
  project: { id: string; name: string; githubUrl: string | null; repository: string | null }
  open: boolean
  githubConnection: { login: string | null } | null
  githubStatusError: string
  onSave: (input: { id: string; name: string; githubUrl: string; repository: string }) => Promise<{ id: string; name: string; githubUrl: string | null; repository: string | null }>
  onClose: () => void
  onOpenSettings: () => void
  onSearchRepositories: (login: string, query: string, page: number, signal?: AbortSignal) => Promise<{ repositories: { fullName: string; private: boolean }[]; nextPage: number | null }>
}

let browser: Window
let server: ViteDevServer | undefined
let createRoot: (container: Element) => Root
let ProjectSettings: React.ComponentType<ProjectSettingsProps>
let container: HTMLElement
let root: Root
let cacheDirectory: string | undefined

before(async () => {
  browser = new Window({ url: "http://127.0.0.1:1420/" })
  Object.assign(globalThis, { window: browser, document: browser.document, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser.navigator })
  const reactDomClient = await import("react-dom/client")
  createRoot = reactDomClient.createRoot
  cacheDirectory = mkdtempSync(join(tmpdir(), "ade-picker-test-"))
  server = await createServer({ cacheDir: cacheDirectory, server: { middlewareMode: true, hmr: false }, appType: "custom", optimizeDeps: { noDiscovery: true } })
  const mod = await server.ssrLoadModule("/ProjectsView.tsx") as { ProjectSettings: React.ComponentType<ProjectSettingsProps> }
  ProjectSettings = mod.ProjectSettings
})

after(async () => {
  await server?.close()
  await browser?.close()
  if (cacheDirectory) rmSync(cacheDirectory, { recursive: true, force: true })
})

beforeEach(() => {
  container = browser.document.createElement("div") as unknown as HTMLElement
  browser.document.body.append(container as never)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function deferred<T = { repositories: { fullName: string; private: boolean }[]; nextPage: number | null }>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

function props(overrides: Partial<ProjectSettingsProps> = {}): ProjectSettingsProps {
  return {
    project: { id: "project", name: "Example", githubUrl: null, repository: null },
    open: true,
    githubConnection: { login: "alice" },
    githubStatusError: "",
    onSave: async input => ({ ...input, githubUrl: input.githubUrl || null, repository: input.repository || null }),
    onClose: () => {},
    onOpenSettings: () => {},
    onSearchRepositories: async () => ({ repositories: [], nextPage: null }),
    ...overrides,
  }
}

async function render(overrides: Partial<ProjectSettingsProps> = {}): Promise<HTMLInputElement> {
  await act(async () => root.render(React.createElement(ProjectSettings, props(overrides))))
  return container.querySelector("#project-github-repo") as HTMLInputElement
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event)
}

function key(input: HTMLInputElement, value: string) {
  const event = new browser.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }) as unknown as KeyboardEvent
  input.dispatchEvent(event)
  return event
}

function options() {
  return [...container.querySelectorAll('[role="option"]')].map(option => option.textContent)
}

test("one field filters progressively loaded public and private repositories and selects with the keyboard", async () => {
  const first = deferred()
  const second = deferred()
  const third = deferred()
  const requests: { login: string; query: string; page: number; signal?: AbortSignal }[] = []
  let saves = 0
  const input = await render({
    onSearchRepositories: (login, query, page, signal) => {
      requests.push({ login, query, page, signal })
      return page === 1 ? first.promise : page === 2 ? second.promise : third.promise
    },
    onSave: async () => { saves++; throw new Error("Unexpected form submission") },
  })

  assert.equal(container.querySelectorAll("#project-github-repo").length, 1)
  assert.equal(input.getAttribute("role"), "combobox")
  assert.equal((container.textContent ?? "").includes("Find a repository"), false)
  await act(async () => input.focus())
  assert.deepEqual(requests.map(({ login, query, page }) => ({ login, query, page })), [{ login: "alice", query: "", page: 1 }])

  await act(async () => {
    first.resolve({
      repositories: [{ fullName: "alice/alpha", private: false }, { fullName: "org/Beta", private: true }],
      nextPage: 2,
    })
    await first.promise
  })
  assert.deepEqual(requests.map(request => request.page), [1, 2])
  await act(async () => setInput(input, "beT"))
  assert.deepEqual(options(), ["org/BetaPrivate"])
  assert.equal(requests.length, 2, "typing filters locally instead of starting another request")

  await act(async () => setInput(input, "gamma"))
  assert.deepEqual(options(), [])
  assert.match(container.textContent ?? "", /Loading repositories/)
  await act(async () => {
    second.resolve({ repositories: [{ fullName: "team/Gamma", private: true }], nextPage: 3 })
    await second.promise
  })
  assert.deepEqual(options(), ["team/GammaPrivate"])

  await act(async () => { key(input, "ArrowDown") })
  assert.equal(input.getAttribute("aria-activedescendant"), container.querySelector('[role="option"]')?.id)
  await act(async () => {
    const enter = key(input, "Enter")
    assert.equal(enter.defaultPrevented, true)
  })
  assert.equal(input.value, "team/Gamma")
  assert.equal(input.getAttribute("aria-expanded"), "false")
  assert.equal(saves, 0)
  assert.equal(requests[2].signal?.aborted, true)
  await act(async () => {
    third.resolve({ repositories: [{ fullName: "team/late", private: false }], nextPage: 4 })
    await third.promise
  })
  assert.deepEqual(requests.map(request => request.page), [1, 2, 3])
  assert.deepEqual(options(), [])
})

test("reopening the picker verifies the CLI account instead of showing cached repositories", async () => {
  let attempts = 0
  const input = await render({
    onSearchRepositories: async () => {
      attempts++
      if (attempts === 1) return { repositories: [{ fullName: "alice/repo", private: true }], nextPage: null }
      throw new Error("The active GitHub CLI account changed.")
    },
  })
  await act(async () => input.focus())
  await act(async () => (container.querySelector('[role="option"]') as HTMLElement).click())
  assert.equal(input.value, "alice/repo")
  await act(async () => input.click())
  assert.equal(attempts, 2)
  assert.deepEqual(options(), [])
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /account changed/)
})

test("switching accounts discards an outstanding response and loads the newly connected account", async () => {
  const oldPage = deferred()
  const newPage = deferred()
  const requests: { login: string; signal?: AbortSignal }[] = []
  const onSearchRepositories: ProjectSettingsProps["onSearchRepositories"] = (login, _query, _page, signal) => {
    requests.push({ login, signal })
    return login === "alice" ? oldPage.promise : newPage.promise
  }
  const input = await render({ onSearchRepositories })
  await act(async () => input.focus())
  await act(async () => root.render(React.createElement(ProjectSettings, props({ githubConnection: { login: "bob" }, onSearchRepositories }))))
  assert.equal(requests[0].signal?.aborted, true)

  const newInput = container.querySelector("#project-github-repo") as HTMLInputElement
  await act(async () => newInput.focus())
  await act(async () => {
    oldPage.resolve({ repositories: [{ fullName: "alice/private", private: true }], nextPage: null })
    newPage.resolve({ repositories: [{ fullName: "bob/public", private: false }], nextPage: null })
    await Promise.all([oldPage.promise, newPage.promise])
  })
  assert.deepEqual(options(), ["bob/publicPublic"])
})

test("an account error is visible and retry reloads repositories", async () => {
  let attempts = 0
  const input = await render({
    onSearchRepositories: async () => {
      attempts++
      if (attempts === 1) throw new Error("The active GitHub CLI account changed.")
      return { repositories: [{ fullName: "alice/repo", private: true }], nextPage: null }
    },
  })
  await act(async () => input.focus())
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /account changed/)
  assert.equal(input.disabled, false)
  const retry = [...container.querySelectorAll("button")].find(button => button.textContent === "Try again") as HTMLButtonElement
  await act(async () => retry.click())
  assert.deepEqual(options(), ["alice/repoPrivate"])
  assert.equal(attempts, 2)
})

test("a repository URL can still be entered and saved without a GitHub connection", async () => {
  let saved: { id: string; name: string; githubUrl: string; repository: string } | undefined
  const input = await render({
    githubConnection: { login: null },
    onSave: async value => {
      saved = value
      return { id: value.id, name: value.name, githubUrl: value.githubUrl, repository: null }
    },
  })
  assert.equal(input.hasAttribute("role"), false)
  await act(async () => setInput(input, "https://github.com/team/manual"))
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event)
  })
  assert.equal(saved?.githubUrl, "https://github.com/team/manual")
  assert.equal(input.value, "team/manual")
})
