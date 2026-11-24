import { useCallback, useEffect, useMemo, useState } from "react"
import { request } from "../../../api"
import type { Conversation } from "../../../app-types"
import type { Project } from "../../../ProjectsView"

function readStoredIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function writeStoredIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch (err) {
    // Storage can be unavailable in private mode or quota-exceeded environments.
    console.warn(`[ADE] Could not persist ${key}:`, err instanceof Error ? err.message : String(err))
  }
}

export function useSessionPreferences(params: {
  sessions: Conversation[]
  projects: Project[]
  archiveRemovesWorktree: boolean
  loadSessions: () => Promise<void>
  onLoadProjects: () => Promise<void>
}) {
  const { sessions, projects, archiveRemovesWorktree, loadSessions, onLoadProjects } = params
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => readStoredIds("ade.pinned-ids"))
  const [unreadIds, setUnreadIds] = useState<string[]>(() => readStoredIds("ade.unread-ids"))

  const togglePin = useCallback((id: string) => {
    setPinnedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [id, ...prev]
      writeStoredIds("ade.pinned-ids", next)
      return next
    })
  }, [])

  const toggleUnread = useCallback((id: string) => {
    setUnreadIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      writeStoredIds("ade.unread-ids", next)
      return next
    })
  }, [])

  const clearUnread = useCallback((id: string) => {
    setUnreadIds(prev => {
      if (!prev.includes(id)) return prev
      const next = prev.filter(x => x !== id)
      writeStoredIds("ade.unread-ids", next)
      return next
    })
  }, [])

  const markAllRead = useCallback(() => {
    setUnreadIds([])
    writeStoredIds("ade.unread-ids", [])
  }, [])

  const archivedIds = useMemo(
    () => [
      ...sessions.filter(s => s.archivedAt).map(s => s.id),
      ...projects.filter(p => p.archivedAt).map(p => `project:${p.id}`),
    ],
    [sessions, projects],
  )

  // One-time migration of the old browser-only archive list to the host.
  useEffect(() => {
    const legacy = readStoredIds("ade.archived-ids")
    if (!legacy.length || (!sessions.length && !projects.length)) return
    localStorage.removeItem("ade.archived-ids")
    const targets = legacy.filter(id =>
      id.startsWith("project:")
        ? projects.some(p => `project:${p.id}` === id && !p.archivedAt)
        : sessions.some(s => s.id === id && !s.archivedAt && s.id !== "coding" && s.id !== "personal"),
    )
    if (!targets.length) return
    void Promise.all(
      targets.map(id => {
        const isProject = id.startsWith("project:")
        const targetId = isProject ? id.slice("project:".length) : id
        return request(
          isProject ? `/api/projects/${encodeURIComponent(targetId)}/archive` : `/api/sessions/${encodeURIComponent(targetId)}/archive`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              isProject
                ? { archived: true, removeWorktrees: archiveRemovesWorktree }
                : { archived: true, removeWorktree: archiveRemovesWorktree },
            ),
          },
        ).catch(() => undefined)
      }),
    ).then(() => Promise.all([loadSessions(), onLoadProjects()]))
  }, [sessions, projects, archiveRemovesWorktree, loadSessions, onLoadProjects])

  return {
    pinnedIds,
    unreadIds,
    archivedIds,
    togglePin,
    toggleUnread,
    clearUnread,
    markAllRead,
  }
}
