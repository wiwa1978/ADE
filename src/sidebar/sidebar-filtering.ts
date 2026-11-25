import type { Conversation } from "../app-types"
import type { Project } from "../ProjectsView"
import type { InboxEntry } from "../session-state"
import type { SidebarPrefs } from "./sidebar-prefs"

export interface SidebarFilterContext {
  prefs: SidebarPrefs
  query: string
  inbox: Record<string, InboxEntry>
  unreadIds: string[]
  pinnedIds: string[]
}

export interface StatusGroup {
  id: string
  label: string
  items: Conversation[]
}

export function sessionMatchesFilter(session: Conversation, ctx: SidebarFilterContext): boolean {
  const entry = ctx.inbox[session.id]
  const isUnread = ctx.unreadIds.includes(session.id) || Boolean(entry?.needsYou)
  if (ctx.prefs.unreadOnly && !isUnread) return false
  if (ctx.prefs.pinnedOnly && !ctx.pinnedIds.includes(session.id)) return false
  if (ctx.query && !session.label.toLowerCase().includes(ctx.query) && !(session.workspace?.branch ?? "").toLowerCase().includes(ctx.query)) {
    return false
  }
  return true
}

export function filterProjects(
  projects: Project[],
  sessionsByProject: Record<string, Conversation[]>,
  ctx: SidebarFilterContext,
): Project[] {
  return projects.filter(project => {
    if (ctx.prefs.projectFilter && project.id !== ctx.prefs.projectFilter) return false
    if (ctx.prefs.pinnedOnly && !ctx.pinnedIds.includes(`project:${project.id}`)) {
      const hasPinnedSession = (sessionsByProject[project.id] ?? []).some(s => ctx.pinnedIds.includes(s.id))
      if (!hasPinnedSession) return false
    }
    if (ctx.prefs.unreadOnly) {
      const hasUnreadSession = (sessionsByProject[project.id] ?? []).some(
        s => ctx.unreadIds.includes(s.id) || Boolean(ctx.inbox[s.id]?.needsYou),
      )
      if (!hasUnreadSession) return false
    }
    if (ctx.query) {
      const matchesName = project.name.toLowerCase().includes(ctx.query)
      const matchesSession = (sessionsByProject[project.id] ?? []).some(s => sessionMatchesFilter(s, ctx))
      if (!matchesName && !matchesSession) return false
    }
    return true
  })
}

export function computeStatusGroups(
  allCodingSessions: Conversation[],
  ctx: SidebarFilterContext,
): StatusGroup[] {
  if (ctx.prefs.groupBy !== "status") return []
  const relevant = allCodingSessions.filter(s => {
    if (ctx.prefs.projectFilter && s.projectId !== ctx.prefs.projectFilter) return false
    return sessionMatchesFilter(s, ctx)
  })
  const buckets: StatusGroup[] = [
    { id: "attention", label: "Needs attention", items: [] },
    { id: "working", label: "Working", items: [] },
    { id: "idle", label: "Idle", items: [] },
  ]
  for (const s of relevant) {
    const entry = ctx.inbox[s.id]
    if (entry?.needsYou) buckets[0].items.push(s)
    else if (s.status === "working" || entry?.state === "working") buckets[1].items.push(s)
    else buckets[2].items.push(s)
  }
  return buckets.filter(b => b.items.length > 0)
}
