import { useCallback, useEffect, useState } from "react"
import { Check, Edit3, Eye, MessageSquarePlus, RefreshCw, Save } from "lucide-react"
import { request } from "../../api"

export function FileViewerPanel({
  sessionId,
  filePath,
  onMentionInChat,
  onSaved,
}: {
  sessionId: string
  filePath: string
  onMentionInChat?: (filePath: string) => void
  onSaved?: () => void
}) {
  const [content, setContent] = useState("")
  const [original, setOriginal] = useState("")
  const [language, setLanguage] = useState("text")
  const [binary, setBinary] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedToast, setSavedToast] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await request<{ path: string; content: string; language: string; binary: boolean }>(
        `/api/workspace/file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(filePath)}`,
      )
      setContent(res.content)
      setOriginal(res.content)
      setLanguage(res.language)
      setBinary(res.binary)
    } catch (err: any) {
      setError(err?.message || "Could not open file.")
    } finally {
      setLoading(false)
    }
  }, [sessionId, filePath])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = content !== original

  const save = useCallback(async () => {
    setSaving(true)
    setError("")
    try {
      await request("/api/workspace/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, path: filePath, content }),
      })
      setOriginal(content)
      setSavedToast(true)
      setTimeout(() => setSavedToast(false), 1800)
      onSaved?.()
    } catch (err: any) {
      setError(err?.message || "Failed to save file.")
    } finally {
      setSaving(false)
    }
  }, [sessionId, filePath, content, onSaved])

  const lines = content.split("\n")

  return (
    <div className="ade-pane-body">
      <div className="ade-pane-toolbar">
        <div className="ade-file-header-meta ade-truncate">
          <code className="ade-mono ade-truncate" title={filePath}>{filePath}</code>
          <span className="ade-pill">{language}</span>
          {dirty ? <span className="ade-pill ade-pill-warn">Unsaved</span> : null}
        </div>
        <div className="ade-toolbar-actions">
          {onMentionInChat ? (
            <button type="button" className="ade-chip-btn" onClick={() => onMentionInChat(filePath)} title="Reference this file in composer">
              <MessageSquarePlus className="size-3.5" /> Ask
            </button>
          ) : null}
          {!binary ? (
            <button type="button" className="ade-chip-btn" onClick={() => setEditing(e => !e)}>
              {editing ? <><Eye className="size-3.5" /> View</> : <><Edit3 className="size-3.5" /> Edit</>}
            </button>
          ) : null}
          {editing ? (
            <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={saving || !dirty} onClick={() => void save()}>
              {savedToast ? <><Check className="size-3.5" /> Saved</> : <><Save className="size-3.5" /> Save</>}
            </button>
          ) : null}
          <button type="button" className="ade-icon-btn" onClick={() => void load()} title="Reload file">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {error ? <div className="ade-banner-error">{error}</div> : null}

      <div className="ade-pane-scroll ade-code-surface">
        {loading ? (
          <div className="ade-pane-note">Loading {filePath}…</div>
        ) : binary ? (
          <div className="ade-pane-note">Binary file cannot be displayed as text.</div>
        ) : editing ? (
          <textarea
            className="ade-code-editor"
            value={content}
            spellCheck={false}
            onChange={e => setContent(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault()
                if (dirty) void save()
              }
            }}
          />
        ) : (
          <table className="ade-code-table">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td className="ade-code-ln">{i + 1}</td>
                  <td className="ade-code-text">{line || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
