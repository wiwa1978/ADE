import { useCallback, useState } from "react"

/** A review note the user left on one line of a diff, to send to the agent later. */
export type DiffNote = { id: string; path: string; line: number; side: "new" | "old"; code: string; text: string }

export type DiffLine = {
  text: string
  kind: "meta" | "hunk" | "add" | "del" | "context"
  oldLine: number | null
  newLine: number | null
}

/** Split a unified diff into lines with their old/new line numbers, so a note can point at a real line. */
export function parseDiff(diff: string): DiffLine[] {
  const lines = diff ? diff.replace(/\n$/, "").split("\n") : []
  let oldNo = 0
  let newNo = 0
  return lines.map(text => {
    if (text.startsWith("diff ") || text.startsWith("index ") || text.startsWith("+++") || text.startsWith("---") || text.startsWith("new file") || text.startsWith("deleted file") || text.startsWith("similarity") || text.startsWith("rename ")) {
      return { text, kind: "meta" as const, oldLine: null, newLine: null }
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      return { text, kind: "hunk" as const, oldLine: null, newLine: null }
    }
    if (text.startsWith("+")) return { text, kind: "add" as const, oldLine: null, newLine: newNo++ }
    if (text.startsWith("-")) return { text, kind: "del" as const, oldLine: oldNo++, newLine: null }
    if (text.startsWith("\\")) return { text, kind: "meta" as const, oldLine: null, newLine: null }
    return { text, kind: "context" as const, oldLine: oldNo++, newLine: newNo++ }
  })
}

const storageKey = (sessionId: string) => `ade.diff-notes.${sessionId}`

function readNotes(sessionId: string): DiffNote[] {
  try {
    const raw = localStorage.getItem(storageKey(sessionId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed as DiffNote[] : []
  } catch {
    return []
  }
}

function writeNotes(sessionId: string, notes: DiffNote[]) {
  try {
    if (notes.length) localStorage.setItem(storageKey(sessionId), JSON.stringify(notes))
    else localStorage.removeItem(storageKey(sessionId))
  } catch {
    // Storage may be unavailable; notes then only live until the panel closes.
  }
}

/** Notes per session, kept across reloads until they are sent to the agent or removed. */
export function useDiffNotes(sessionId: string) {
  const [notes, setNotes] = useState<DiffNote[]>(() => readNotes(sessionId))
  const [prevSessionId, setPrevSessionId] = useState(sessionId)
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId)
    setNotes(readNotes(sessionId))
  }
  const update = useCallback((next: (current: DiffNote[]) => DiffNote[]) => {
    setNotes(current => {
      const value = next(current)
      writeNotes(sessionId, value)
      return value
    })
  }, [sessionId])
  const add = useCallback((note: Omit<DiffNote, "id">) => update(current => [...current, { ...note, id: crypto.randomUUID() }]), [update])
  const remove = useCallback((id: string) => update(current => current.filter(note => note.id !== id)), [update])
  const clear = useCallback(() => update(() => []), [update])
  return { notes, add, remove, clear }
}
