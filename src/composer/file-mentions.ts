import { useEffect, useState } from "react"
import { request } from "../../api"

/** The "@query" being typed right before the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  if (!match) return null
  return { start: caret - match[2].length - 1, query: match[2] }
}

/** Replace the "@query" before the caret with "@path " and return the new text and caret. */
export function insertMention(text: string, caret: number, path: string) {
  const mention = mentionAt(text, caret)
  if (!mention) return { text, caret }
  const inserted = `@${path} `
  return { text: text.slice(0, mention.start) + inserted + text.slice(caret), caret: mention.start + inserted.length }
}

/** Files in the session's workspace matching the @-mention being typed. */
export function useFileMentions(sessionId: string | undefined, query: string | null) {
  const [results, setResults] = useState<{ query: string; files: string[] } | null>(null)
  useEffect(() => {
    if (!sessionId || query === null) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void request<{ files: string[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/files/search?q=${encodeURIComponent(query)}`)
        .then(result => { if (!cancelled) setResults({ query, files: result.files }) })
        .catch(() => { if (!cancelled) setResults({ query, files: [] }) })
    }, 100)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [sessionId, query])
  // Only show results for the query being typed now.
  return query !== null && results ? results.files : []
}
