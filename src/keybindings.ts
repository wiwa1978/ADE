export type KeybindingId =
  | "commandCenter"
  | "focusComposer"
  | "toggleTerminal"
  | "addProject"
  | "pinSession"
  | "switchEnvironment"
  | "openSettings"
  | "openInbox"
  | "sendMessage"
  | "newLine"

export type BuiltinKeybindingSpec = {
  id: KeybindingId
  label: string
  description: string
  defaultChord: string
  category: "Navigation" | "Workspace" | "Composer"
}

export const BUILTIN_KEYBINDINGS: BuiltinKeybindingSpec[] = [
  {
    id: "commandCenter",
    label: "Search sessions, projects, and commands",
    description: "Open the command palette from anywhere.",
    defaultChord: "Mod+K",
    category: "Navigation",
  },
  {
    id: "addProject",
    label: "Create new project",
    description: "Launch the Create Project wizard.",
    defaultChord: "Mod+Shift+N",
    category: "Navigation",
  },
  {
    id: "openInbox",
    label: "Open Inbox",
    description: "Jump to sessions waiting for your attention.",
    defaultChord: "Mod+I",
    category: "Navigation",
  },
  {
    id: "switchEnvironment",
    label: "Switch environment",
    description: "Open the local / remote host switcher.",
    defaultChord: "Mod+E",
    category: "Navigation",
  },
  {
    id: "openSettings",
    label: "Open Settings",
    description: "Jump straight to ADE Settings.",
    defaultChord: "Mod+,",
    category: "Navigation",
  },
  {
    id: "toggleTerminal",
    label: "Toggle terminal drawer",
    description: "Show or hide the bottom terminal in sessions.",
    defaultChord: "Mod+J",
    category: "Workspace",
  },
  {
    id: "pinSession",
    label: "Pin or unpin active session",
    description: "Keep the current session pinned at the top.",
    defaultChord: "Mod+Alt+P",
    category: "Workspace",
  },
  {
    id: "focusComposer",
    label: "Focus the message box",
    description: "Move cursor directly to the chat composer.",
    defaultChord: "Alt+L",
    category: "Composer",
  },
  {
    id: "sendMessage",
    label: "Send message",
    description: "Submit the current prompt in the composer.",
    defaultChord: "Enter",
    category: "Composer",
  },
  {
    id: "newLine",
    label: "New line in a message",
    description: "Insert a line break without sending.",
    defaultChord: "Shift+Enter",
    category: "Composer",
  },
]

export type CustomKeybindingAction =
  | "panel:files"
  | "panel:diff"
  | "panel:browser"
  | "panel:terminal"
  | "panel:pr"
  | "new-session"
  | "new-chat"
  | "toggle-theme"
  | "slash"

export type CustomKeybinding = {
  id: string
  label: string
  action: CustomKeybindingAction
  arg?: string
  chord: string
}

export const CUSTOM_ACTION_OPTIONS: { action: CustomKeybindingAction; label: string; needsArg?: boolean; placeholder?: string }[] = [
  { action: "panel:files", label: "Open Files panel" },
  { action: "panel:diff", label: "Open Diff / Changes panel" },
  { action: "panel:browser", label: "Open Built-in Browser" },
  { action: "panel:terminal", label: "Open Terminal side pane" },
  { action: "panel:pr", label: "Open Pull Request panel" },
  { action: "new-session", label: "Open New session" },
  { action: "new-chat", label: "Start new Coding chat" },
  { action: "toggle-theme", label: "Toggle Light / Dark theme" },
  { action: "slash", label: "Run slash command", needsArg: true, placeholder: "/plan" },
]

export type KeybindingMap = Record<KeybindingId, string>

export const DEFAULT_KEYBINDINGS: KeybindingMap = Object.fromEntries(
  BUILTIN_KEYBINDINGS.map(spec => [spec.id, spec.defaultChord]),
) as KeybindingMap

export function resolveKeybindings(overrides?: Record<string, string>): KeybindingMap {
  const result = { ...DEFAULT_KEYBINDINGS }
  if (!overrides) return result
  for (const spec of BUILTIN_KEYBINDINGS) {
    if (typeof overrides[spec.id] === "string") {
      result[spec.id] = overrides[spec.id]
    }
  }
  return result
}

export function detectIsMac(): boolean {
  if (typeof navigator === "undefined") return true
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? navigator.userAgent ?? ""
  return /mac|iphone|ipad|ipod/i.test(platform)
}

const CODE_KEY_MAP: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Space: "Space",
}

const MODIFIER_ONLY_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "OS", "AltGraph"])

function normalizeEventKey(e: KeyboardEvent): string | null {
  if (MODIFIER_ONLY_KEYS.has(e.key)) return null
  if (e.code) {
    if (/^Key([A-Z])$/.test(e.code)) return e.code.slice(3)
    if (/^Digit([0-9])$/.test(e.code)) return e.code.slice(5)
    if (CODE_KEY_MAP[e.code]) return CODE_KEY_MAP[e.code]
  }
  if (e.key === " ") return "Space"
  if (e.key === "Enter") return "Enter"
  if (e.key === "Tab") return "Tab"
  if (e.key === "Escape") return "Escape"
  if (e.key === "Backspace") return "Backspace"
  if (e.key === "Delete") return "Delete"
  if (e.key.startsWith("Arrow")) return e.key
  if (/^F([1-9]|1[0-2])$/i.test(e.key)) return e.key.toUpperCase()
  if (e.key.length === 1) return e.key.toUpperCase()
  return e.key
}

/** Converts a KeyboardEvent into a canonical chord like "Mod+Alt+P" or "Shift+Enter". */
export function eventToChord(e: KeyboardEvent, isMac = detectIsMac()): string | null {
  const mainKey = normalizeEventKey(e)
  if (!mainKey) return null

  const parts: string[] = []
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (mod) parts.push("Mod")
  if (isMac && e.ctrlKey) parts.push("Ctrl")
  if (!isMac && e.metaKey) parts.push("Meta")
  if (e.altKey) parts.push("Alt")
  if (e.shiftKey) parts.push("Shift")
  parts.push(mainKey)
  return parts.join("+")
}

/** Checks whether a KeyboardEvent matches a canonical chord string. */
export function matchesChord(e: KeyboardEvent, chord: string | undefined | null, isMac = detectIsMac()): boolean {
  if (!chord || !chord.trim()) return false
  const actual = eventToChord(e, isMac)
  if (!actual) return false
  return actual.toLowerCase() === chord.trim().toLowerCase()
}

/** Formats a canonical chord for UI display ("⌘K", "⌥⌘P", "⇧↩" on Mac; "Ctrl+K" on Linux/Windows). */
export function formatShortcut(chord: string | undefined | null, isMac = detectIsMac()): string {
  if (!chord || !chord.trim()) return "Not set"
  const tokens = chord.split("+").map(t => t.trim()).filter(Boolean)
  if (tokens.length === 0) return "Not set"

  const mapKey = (k: string): string => {
    const low = k.toLowerCase()
    if (low === "enter") return isMac ? "↩" : "Enter"
    if (low === "backspace") return isMac ? "⌫" : "Backspace"
    if (low === "delete") return isMac ? "⌦" : "Del"
    if (low === "escape") return "Esc"
    if (low === "tab") return isMac ? "⇥" : "Tab"
    if (low === "space") return "Space"
    if (low === "arrowup") return "↑"
    if (low === "arrowdown") return "↓"
    if (low === "arrowleft") return "←"
    if (low === "arrowright") return "→"
    return k.length === 1 ? k.toUpperCase() : k
  }

  if (isMac) {
    const mods: string[] = []
    let key = ""
    for (const token of tokens) {
      const low = token.toLowerCase()
      if (low === "ctrl") mods.push("⌃")
      else if (low === "alt") mods.push("⌥")
      else if (low === "shift") mods.push("⇧")
      else if (low === "mod" || low === "meta") mods.push("⌘")
      else key = mapKey(token)
    }
    // Conventional macOS modifier ordering: ⌃ ⌥ ⇧ ⌘
    const order = ["⌃", "⌥", "⇧", "⌘"]
    mods.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    return `${mods.join("")}${key}`
  }

  return tokens
    .map(token => {
      const low = token.toLowerCase()
      if (low === "mod" || low === "ctrl") return "Ctrl"
      if (low === "alt") return "Alt"
      if (low === "shift") return "Shift"
      if (low === "meta") return "Meta"
      return mapKey(token)
    })
    .join("+")
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}
