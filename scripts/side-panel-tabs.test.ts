import assert from "node:assert/strict"
import { test } from "node:test"
import { tabsForNextSession } from "../src/workspace/side-panel-tabs.ts"
import type { WorkspaceTab } from "../app-types.ts"

const tab = (id: string, kind: WorkspaceTab["kind"], extra: Partial<WorkspaceTab> = {}): WorkspaceTab => ({ id, kind, title: id, ...extra })

test("switching sessions keeps the side panel's tabs open, now about the new session", () => {
  const tabs = [tab("browser", "browser"), tab("files", "files"), tab("team", "team"), tab("agents", "agents"), tab("subagent:a", "subagent", { subagentId: "a" }), tab("file:x", "file", { filePath: "x.ts" }), tab("artifact", "artifact", { artifactId: "old" })]
  const kept = tabsForNextSession(tabs, "team", true)
  assert.deepEqual(kept.tabs.map(entry => entry.id), ["browser", "files", "team", "agents", "artifact"], "a subagent and an opened file belong to the old session")
  assert.equal(kept.activeId, "team", "the open tab stays open")
  assert.equal(kept.tabs.find(entry => entry.kind === "artifact")?.artifactId, undefined)
})

test("when the open tab can't stay, a related one takes its place", () => {
  const tabs = [tab("files", "files"), tab("agents", "agents"), tab("subagent:a", "subagent"), tab("file:x", "file")]
  assert.equal(tabsForNextSession(tabs, "subagent:a", true).activeId, "agents")
  assert.equal(tabsForNextSession(tabs, "file:x", true).activeId, "files")
  assert.equal(tabsForNextSession([tab("subagent:a", "subagent")], "subagent:a", true).activeId, null, "nothing left: the panel closes")
})

test("a session without a workspace (a chat) keeps only what works without one", () => {
  const tabs = [tab("team", "team"), tab("diff", "diff"), tab("browser", "browser"), tab("transcript", "transcript")]
  const kept = tabsForNextSession(tabs, "team", false)
  assert.deepEqual(kept.tabs.map(entry => entry.id), ["browser", "transcript"])
  assert.equal(kept.activeId, "transcript")
})
