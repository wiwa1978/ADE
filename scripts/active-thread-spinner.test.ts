import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer, type ViteDevServer } from "vite"
import type { Conversation } from "../app-types.ts"

type SidebarProps = Record<string, unknown>

let server: ViteDevServer | undefined
let Sidebar: React.ComponentType<SidebarProps>
let ActiveThreadSpinner: React.ComponentType<{ size?: number; className?: string; title?: string; decorative?: boolean }>

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: "custom" })
  const sidebarMod = await server.ssrLoadModule("/src/sidebar/Sidebar.tsx") as { Sidebar: React.ComponentType<SidebarProps> }
  const spinnerMod = await server.ssrLoadModule("/src/sidebar/ActiveThreadSpinner.tsx") as { ActiveThreadSpinner: typeof ActiveThreadSpinner }
  Sidebar = sidebarMod.Sidebar
  ActiveThreadSpinner = spinnerMod.ActiveThreadSpinner
})

after(async () => { await server?.close() })

const noop = () => {}

function makeSession(overrides: Partial<Conversation> & { id: string; label: string }): Conversation {
  return {
    mode: "coding",
    status: "idle",
    messages: [],
    ...overrides,
  } as Conversation
}

function makeProject(id: string, name: string) {
  return {
    id,
    name,
    path: `/tmp/${id}`,
  }
}

function makeProps(overrides: SidebarProps = {}): SidebarProps {
  return {
    width: 260,
    selection: { kind: "inbox" },
    projects: [],
    sessionsByProject: {},
    ungroupedSessions: [],
    chats: [],
    archivedProjects: [],
    archivedSessions: [],
    inbox: {},
    inboxCount: 0,
    expandedProjects: [],
    pinnedIds: [],
    unreadIds: [],
    archivedExpanded: false,
    renamingId: null,
    renameText: "",
    environmentName: "Local",
    runtimeOnline: true,
    live: true,
    onCollapse: noop,
    onNewSession: noop,
    onSearch: noop,
    onOpenInbox: noop,
    onAddProject: noop,
    onOpenProject: noop,
    onToggleProject: noop,
    onOpenSession: noop,
    onNewChat: noop,
    onContextMenu: noop,
    onRenameChange: noop,
    onRenameSubmit: noop,
    onRenameCancel: noop,
    onToggleArchived: noop,
    onRestore: noop,
    onOpenSettings: noop,
    onOpenEnvironments: noop,
    ...overrides,
  }
}

test("ActiveThreadSpinner renders orbital SVG arcs and respects decorative mode", () => {
  const accessible = renderToStaticMarkup(React.createElement(ActiveThreadSpinner, { title: "Working" }))
  assert.match(accessible, /class="ade-thread-spinner"/)
  assert.match(accessible, /role="img"/)
  assert.match(accessible, /aria-label="Working"/)
  assert.match(accessible, /class="ade-thread-spinner-svg"/)
  assert.match(accessible, /class="ade-thread-spinner-core"/)

  const decorative = renderToStaticMarkup(React.createElement(ActiveThreadSpinner, { decorative: true }))
  assert.match(decorative, /aria-hidden="true"/)
  assert.doesNotMatch(decorative, /role="img"/)
})

test("Sidebar renders spinning icon on active sessions, active chats, and collapsed working projects", () => {
  const activeProj = makeProject("p1", "Active Repo")
  const collapsedProj = makeProject("p2", "Collapsed Repo")
  const workingSession = makeSession({ id: "s-work", label: "Active Session", projectId: "p1", status: "working" })
  const idleSession = makeSession({ id: "s-idle", label: "Idle Session", projectId: "p1", status: "idle" })
  const collapsedWorking = makeSession({ id: "s-col", label: "Hidden Working", projectId: "p2", status: "working" })
  const workingChat = makeSession({ id: "c-work", label: "Active Chat", status: "working", chatThread: true })
  const idleChat = makeSession({ id: "c-idle", label: "Idle Chat", status: "idle", chatThread: true })

  const html = renderToStaticMarkup(React.createElement(Sidebar, makeProps({
    projects: [activeProj, collapsedProj],
    expandedProjects: ["p1"],
    sessionsByProject: {
      p1: [workingSession, idleSession],
      p2: [collapsedWorking],
    },
    chats: [workingChat, idleChat],
  })))

  // Expect exactly 3 spinners: Active Session, Collapsed Repo, and Active Chat (not Idle Session or Idle Chat).
  const spinnerMatches = html.match(/class="ade-thread-spinner /g) ?? []
  assert.equal(spinnerMatches.length, 3)
  assert.match(html, /Active Session[\s\S]*?ade-thread-spinner[\s\S]*?Idle Session/)
  assert.match(html, /Collapsed Repo[\s\S]*?ade-thread-spinner[\s\S]*?1 working/)
  assert.match(html, /Active Chat[\s\S]*?ade-thread-spinner[\s\S]*?Idle Chat/)
})

test("Sidebar prioritizes needs-approval over working spinner", () => {
  const proj = makeProject("p1", "Repo")
  const waitingSession = makeSession({ id: "s-wait", label: "Approval Needed", projectId: "p1", status: "working" })

  const html = renderToStaticMarkup(React.createElement(Sidebar, makeProps({
    projects: [proj],
    expandedProjects: ["p1"],
    sessionsByProject: { p1: [waitingSession] },
    inbox: {
      "s-wait": {
        sessionId: "s-wait",
        state: "needs-approval",
        needsYou: true,
        pendingApprovals: 1,
        uncommitted: 0,
        commitsAhead: 0,
        pullRequest: null,
        updatedAt: Date.now(),
      },
    },
  })))

  assert.doesNotMatch(html, /ade-thread-spinner/)
  assert.match(html, /Needs approval/)
})
