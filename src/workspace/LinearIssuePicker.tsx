import { useEffect, useState } from "react"
import { Link2, X } from "lucide-react"
import { request } from "../../api"

export type LinearIssue = { id: string; identifier: string; title: string; description: string; url: string; state: string; team: string }

/** "Import Linear issue" for New session; only shown when Linear is connected in Settings → Integrations. */
export function LinearIssuePicker({ selected, onPick, onClear }: { selected: LinearIssue | null; onPick: (issue: LinearIssue) => void; onClear: () => void }) {
  const [connected, setConnected] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [issues, setIssues] = useState<LinearIssue[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    void request<{ linear: { configured: boolean } }>("/api/integrations")
      .then(result => { if (!cancelled) setConnected(result.linear.configured) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void request<{ issues: LinearIssue[] }>(`/api/integrations/linear/issues?q=${encodeURIComponent(query)}`)
        .then(result => { if (!cancelled) { setIssues(result.issues); setError("") } })
        .catch(err => { if (!cancelled) { setIssues([]); setError(err instanceof Error ? err.message : "Could not load Linear issues.") } })
    }, query ? 250 : 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, query])

  if (!connected) return null
  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--primary)/0.45)] bg-[rgb(var(--primary)/0.1)] text-xs">
        <span className="truncate"><strong className="font-mono">{selected.identifier}</strong> {selected.title}</span>
        <button type="button" className="sf-btn-ghost !h-6 !px-1.5" aria-label="Remove Linear issue" onClick={onClear}><X className="size-3.5" /></button>
      </div>
    )
  }
  if (!open) {
    return <div><button type="button" className="sf-btn-secondary" onClick={() => setOpen(true)}><Link2 className="size-3.5" /> Import Linear issue</button></div>
  }
  return (
    <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3 flex flex-col gap-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Linear issues {query ? "" : "assigned to you"}</span>
        <button type="button" className="sf-btn-ghost !h-6 !px-1.5" aria-label="Close" onClick={() => setOpen(false)}><X className="size-3.5" /></button>
      </div>
      <input className="sf-field !h-8" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Linear" aria-label="Search Linear issues" autoFocus />
      {error ? <div className="text-rose-400">{error}</div> : null}
      {issues === null ? <div className="opacity-65 py-2">Loading…</div> : !issues.length ? <div className="opacity-65 py-2">No open issues.</div> : (
        <div className="max-h-44 overflow-y-auto divide-y divide-[rgb(var(--border)/0.5)] rounded-lg border border-[rgb(var(--border)/0.7)] bg-[rgb(var(--background))]">
          {issues.map(issue => (
            <button key={issue.id} type="button" className="w-full px-3 py-2 text-left hover:bg-[rgb(var(--surface-raised))] flex items-center gap-2" onClick={() => { onPick(issue); setOpen(false) }}>
              <span className="font-mono opacity-60">{issue.identifier}</span>
              <span className="truncate flex-1">{issue.title}</span>
              <span className="opacity-50">{issue.state}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
