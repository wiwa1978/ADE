import { useCallback, useEffect, useState } from "react"
import { History, RotateCcw, Save } from "lucide-react"
import { request, requestJson } from "../../api"
import { useI18n } from "../i18n/I18nContext"
import { relativeTime } from "../session-state"
import { confirmRestore, restoreCheckpoint, type CheckpointInfo } from "./checkpoint-actions"

/** Every snapshot of the session's workspace, newest first, with one-click rewind. */
export function CheckpointList({ sessionId, busy, onRestored }: { sessionId: string; busy: boolean; onRestored: () => void }) {
  const { t } = useI18n()
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
      setError(cause instanceof Error ? cause.message : t("pnlx.cp.errLoad"))
    }
  }, [sessionId, t])

  useEffect(() => {
    let cancelled = false
    void request<{ checkpoints: CheckpointInfo[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`)
      .then(result => { if (!cancelled) setItems(result.checkpoints) })
      .catch(cause => {
        if (cancelled) return
        setItems([])
        setError(cause instanceof Error ? cause.message : t("pnlx.cp.errLoad"))
      })
    return () => { cancelled = true }
  }, [sessionId, t])

  const save = async () => {
    setWorking("save")
    setError("")
    try {
      const result = await requestJson<{ unchanged: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints`, "POST")
      setNotice(result.unchanged ? t("pnlx.cp.unchanged") : t("pnlx.cp.saved"))
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("pnlx.cp.errSave"))
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
      setNotice(t("pnlx.cp.rewoundTo", { label: item.label }))
      onRestored()
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("pnlx.cp.errRewind"))
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="ade-checkpoints">
      <div className="ade-checkpoints-head">
        <p className="ade-muted ade-xs">{t("pnlx.cp.intro")}</p>
        <button type="button" className="ade-chip-btn" disabled={Boolean(working)} onClick={() => void save()}><Save className="size-3" /> {t("pnlx.cp.saveNow")}</button>
      </div>
      {error ? <div className="ade-banner-error" role="alert">{error}</div> : null}
      {notice ? <div className="ade-banner-ok" role="status">{notice}</div> : null}
      {items === null ? <p className="ade-muted ade-xs">{t("pnlx.cp.loading")}</p>
        : items.length === 0 ? <div className="ade-pane-empty"><History className="size-6 opacity-40" /><p>{t("pnlx.cp.empty")}</p></div>
        : (
          <ul className="ade-checkpoint-rows">
            {items.map(item => (
              <li key={item.id}>
                <div className="ade-inbox-main">
                  <strong className="ade-truncate" title={item.label}>{item.label}</strong>
                  <small>{relativeTime(item.createdAt)} · {item.filesChanged === 0 ? t("pnlx.cp.sameAsNow") : item.filesChanged === 1 ? t("pnlx.cp.fileDiffers", { count: item.filesChanged }) : t("pnlx.cp.filesDiffer", { count: item.filesChanged })}</small>
                </div>
                <button type="button" className="ade-chip-btn" disabled={busy || Boolean(working) || item.filesChanged === 0} title={busy ? t("pnlx.cp.stopAgentFirst") : undefined} onClick={() => void restore(item)}>
                  <RotateCcw className="size-3" /> {working === item.id ? t("pnlx.cp.rewinding") : t("pnlx.cp.rewind")}
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
