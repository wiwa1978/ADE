// Simple or Full view. Simple (the default) shows the Captain and a one-line sign that subagents are
// working; Full shows every tool and panel. Saved on this device and shared by the whole window.
import { useSyncExternalStore } from "react"

export type ViewMode = "simple" | "full"

const KEY = "ade.view-mode"

function load(): ViewMode {
  try { return localStorage.getItem(KEY) === "full" ? "full" : "simple" } catch { return "simple" }
}

let current: ViewMode = load()
const listeners = new Set<() => void>()

export function setViewMode(mode: ViewMode) {
  if (mode === current) return
  current = mode
  try { localStorage.setItem(KEY, mode) } catch { /* private window: the choice lasts until reload */ }
  for (const listener of listeners) listener()
}

export function useViewMode(): ViewMode {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => current,
    () => "simple",
  )
}

/** Side-panel tabs that stay available in Simple view: they show who is working (the deep dive). */
export const SIMPLE_PANEL_KINDS: ReadonlySet<string> = new Set(["agents", "subagent", "team", "swarm", "progress"])
