import { useEffect, useRef } from "react"
import type { Screen, WorkspaceTab } from "../app-types"
import { isEditableTarget, matchesChord, type CustomKeybinding, type KeybindingMap } from "../keybindings"

export type GlobalKeybindingHandlers = {
  keybindings: KeybindingMap
  customKeybindings: CustomKeybinding[]
  screen: Screen
  selectedProjectId: string | null
  activeSessionId?: string
  resolvedTheme: "light" | "dark"
  onToggleCommandCenter: () => void
  onFocusComposer: () => void
  onOpenAddProject: () => void
  onOpenCreateWorktree: () => void
  onOpenInbox: () => void
  onToggleEnvironmentPalette: () => void
  onToggleSettings: () => void
  onTogglePin: (id: string) => void
  onNewSession: () => void
  onNewChat: () => void
  onToggleTheme: (next: "light" | "dark") => void
  onRunSlashCommand: (cmd: string) => void
  onOpenPanel: (tab: WorkspaceTab) => void
}

/**
 * Registers the global window keydown listener once and reads latest keybindings
 * and callbacks through a ref so renders never tear down or re-attach the listener.
 */
export function useGlobalKeybindings(handlers: GlobalKeybindingHandlers): void {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const current = ref.current
      const { keybindings, customKeybindings } = current
      const editing = isEditableTarget(e.target)
      const hasModifier = e.metaKey || e.ctrlKey || e.altKey

      if (matchesChord(e, keybindings.commandCenter)) {
        e.preventDefault()
        current.onToggleCommandCenter()
        return
      }
      if (matchesChord(e, keybindings.focusComposer)) {
        e.preventDefault()
        current.onFocusComposer()
        return
      }
      if (matchesChord(e, keybindings.addProject)) {
        e.preventDefault()
        current.onOpenAddProject()
        return
      }
      if (!e.shiftKey && !e.altKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        current.onOpenCreateWorktree()
        return
      }
      if (matchesChord(e, keybindings.openInbox)) {
        e.preventDefault()
        current.onOpenInbox()
        return
      }
      if (matchesChord(e, keybindings.switchEnvironment)) {
        e.preventDefault()
        current.onToggleEnvironmentPalette()
        return
      }
      if (matchesChord(e, keybindings.openSettings)) {
        e.preventDefault()
        current.onToggleSettings()
        return
      }
      if (matchesChord(e, keybindings.pinSession)) {
        e.preventDefault()
        if (current.screen === "project" && current.selectedProjectId) {
          current.onTogglePin(`project:${current.selectedProjectId}`)
        } else if (current.activeSessionId) {
          current.onTogglePin(current.activeSessionId)
        }
        return
      }

      // User-defined custom shortcuts
      for (const custom of customKeybindings) {
        if (!custom.chord) continue
        if (editing && !hasModifier) continue
        if (!matchesChord(e, custom.chord)) continue
        e.preventDefault()
        if (custom.action === "new-session") {
          current.onNewSession()
        } else if (custom.action === "new-chat") {
          current.onNewChat()
        } else if (custom.action === "toggle-theme") {
          current.onToggleTheme(current.resolvedTheme === "dark" ? "light" : "dark")
        } else if (custom.action === "slash") {
          const cmd = (custom.arg || "/plan").trim()
          if (cmd) current.onRunSlashCommand(cmd)
        } else if (custom.action.startsWith("panel:")) {
          const kind = custom.action.slice("panel:".length) as WorkspaceTab["kind"]
          const title = kind === "pr" ? "Pull Request" : kind[0].toUpperCase() + kind.slice(1)
          current.onOpenPanel({ id: kind, kind, title })
        }
        return
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
