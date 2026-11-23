// The open session's tools (Stages, Files, Changes, Pull request, Issues, Terminal, Browser, …),
// published by the session view and shown as icons in the activity bar on the far left.
import { useSyncExternalStore } from "react"
import type { SidePanelItem } from "../workspace/SidePanelMenu"

let current: SidePanelItem[] = []
const listeners = new Set<() => void>()

export function publishSessionTools(items: SidePanelItem[]) {
  current = items
  for (const listener of listeners) listener()
}

export function useSessionTools() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => current,
  )
}
