import type { WorkspaceTab, WorkspaceTabKind } from "../../app-types.ts"

/** Tabs that need the session's workspace (its files, branch or project). */
const NEEDS_WORKSPACE = new Set<WorkspaceTabKind>(["files", "diff", "run", "pr", "issues", "team", "swarm"])

/**
 * The side panel when you switch sessions: it stays open with the same tabs, now showing the new
 * session. Tabs about one session's own things (a subagent, an opened file) are dropped, and so are
 * workspace tabs when the new session has no workspace. If the open tab is dropped, a related one
 * (Agents for a subagent, Files for a file) or the last remaining tab takes its place.
 */
export function tabsForNextSession(tabs: WorkspaceTab[], activeId: string | null, hasWorkspace: boolean): { tabs: WorkspaceTab[]; activeId: string | null } {
  const keep = (tab: WorkspaceTab) => tab.kind !== "subagent" && tab.kind !== "file" && (hasWorkspace || !NEEDS_WORKSPACE.has(tab.kind))
  // An artefact tab keeps its place but forgets which artefact it showed.
  const next = tabs.filter(keep).map(tab => (tab.kind === "artifact" ? { ...tab, artifactId: undefined } : tab))
  if (activeId && next.some(tab => tab.id === activeId)) return { tabs: next, activeId }
  const was = tabs.find(tab => tab.id === activeId)
  const related = was?.kind === "subagent" ? next.find(tab => tab.kind === "agents") : was?.kind === "file" ? next.find(tab => tab.kind === "files") : undefined
  return { tabs: next, activeId: (related ?? next.at(-1))?.id ?? null }
}
