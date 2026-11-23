export type SidebarPrefs = {
  unreadOnly: boolean
  pinnedOnly: boolean
  hideChats: boolean
  projectFilter: string | null
  groupBy: "project" | "status"
  compact: boolean
  showSearch: boolean
}

export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = {
  unreadOnly: false,
  pinnedOnly: false,
  hideChats: false,
  projectFilter: null,
  groupBy: "project",
  compact: false,
  showSearch: false,
}

const PREFS_KEY = "ade.sidebar-prefs-v1"

export function loadSidebarPrefs(): SidebarPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_SIDEBAR_PREFS
    const parsed = JSON.parse(raw) as Partial<SidebarPrefs>
    return {
      unreadOnly: Boolean(parsed.unreadOnly),
      pinnedOnly: Boolean(parsed.pinnedOnly),
      hideChats: Boolean(parsed.hideChats),
      projectFilter: typeof parsed.projectFilter === "string" ? parsed.projectFilter : null,
      groupBy: parsed.groupBy === "status" ? "status" : "project",
      compact: Boolean(parsed.compact),
      showSearch: Boolean(parsed.showSearch),
    }
  } catch {
    return DEFAULT_SIDEBAR_PREFS
  }
}

export function saveSidebarPrefs(prefs: SidebarPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Ignore storage quota errors.
  }
}
