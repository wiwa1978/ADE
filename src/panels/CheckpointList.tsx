import { useCallback, useEffect, useState } from "react"
import { History, RotateCcw, Save } from "lucide-react"
import { request } from "../../api"
import { relativeTime } from "../session-state"
import { confirmRestore, restoreCheckpoint, type CheckpointInfo } from "./checkpoint-actions"

/** Every snapshot of the session's workspace, newest first, with one-click rewind. */
export function CheckpointList({ sessionId, busy, onRestored }: { sessionId: string; busy: boolean; onRestored: () => void }) {
  const [items, setItems] = useState<CheckpointInfo[] | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    try {
      const result = await request<{ checkpoints: CheckpointInfo[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`)
      setItems(result.checkpoints)
    } catch (cause) {
      setItems([])
      setError(cause instanceof Error ? cause.message : "Could not load the history.")
    }
  }, [sessionId])

  useEffect(() => {
    let cancelled = false
    void request<{ checkpoints: CheckpointInfo[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`)
      .then(result => { if (!cancelled) setItems(result.checkpoints) })
      .catch(cause => {
        if (cancelled) return
        setItems([])
        setError(cause instanceof Error ? cause.message : "Could not load the history.")
      })
    return () => { cancelled = true }
  }, [sessionId])

  const save = async () => {
    setWorking("save")
    setError("")
    try {
      const result = await request<{ unchanged: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      setNotice(result.unchanged ? "Nothing changed since the last checkpoint." : "Checkpoint saved.")
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save a checkpoint.")
    } finally {
      setWorking(null)
    }
  }

  const restore = async (item: CheckpointInfo) => {
    if (!confirmRestore(item)) return
    setWorking(item.id)
    setError("")
    try {
      await restoreCheckpoint(sessionId, item)
      setNotice(`Rewound to "${item.label}".`)
      onRestored()
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rewind.")
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="ade-checkpoints">
      <div className="ade-checkpoints-head">
        <p className="ade-muted ade-xs">ADE saves the workspace before each message you send. Rewind puts every file (and commits) back to that moment.</p>
        <button type="button" className="ade-chip-btn" disabled={Boolean(working)} onClick={() => void save()}><Save className="size-3" /> Save now</button>
      </div>
      {error ? <div className="ade-banner-error" role="alert">{error}</div> : null}
      {notice ? <div className="ade-banner-ok" role="status">{notice}</div> : null}
      {items === null ? <p className="ade-muted ade-xs">Loading history…</p>
        : items.length === 0 ? <div className="ade-pane-empty"><History className="size-6 opacity-40" /><p>No checkpoints yet. One is saved each time you send the agent a message.</p></div>
        : (
          <ul className="ade-checkpoint-rows">
            {items.map(item => (
              <li key={item.id}>
                <div className="ade-inbox-main">
                  <strong className="ade-truncate" title={item.label}>{item.label}</strong>
                  <small>{relativeTime(item.createdAt)} · {item.filesChanged === 0 ? "same as now" : `${item.filesChanged} file${item.filesChanged === 1 ? "" : "s"} differ from now`}</small>
                </div>
                <button type="button" className="ade-chip-btn" disabled={busy || Boolean(working) || item.filesChanged === 0} title={busy ? "Stop the agent first" : undefined} onClick={() => void restore(item)}>
                  <RotateCcw className="size-3" /> {working === item.id ? "Rewinding…" : "Rewind"}
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
