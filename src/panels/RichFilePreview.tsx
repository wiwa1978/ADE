import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  Check,
  Code2,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  RefreshCw,
  Save,
} from "lucide-react"
import { request, resolveCaptainUrl } from "../../api"
import { MessageContent } from "../../MessageContent"
import {
  formatFileSize,
  getFilePreviewKind,
  getHighlightLanguage,
} from "./file-preview-utils"

type FileApiResponse = {
  path: string
  content: string
  language: string
  size?: number
  binary: boolean
  mimeType?: string
}

export function RichFilePreview({
  sessionId,
  projectId,
  filePath,
  onBack,
  backLabel = "Back",
  onMentionInChat,
  onSaved,
  canEdit,
  toolbarExtra,
}: {
  sessionId?: string
  projectId?: string
  filePath: string
  onBack?: () => void
  backLabel?: string
  onMentionInChat?: (filePath: string) => void
  onSaved?: () => void
  canEdit?: boolean
  toolbarExtra?: ReactNode
}) {
  const scopeQuery = projectId
    ? `projectId=${encodeURIComponent(projectId)}`
    : `sessionId=${encodeURIComponent(sessionId ?? "")}`
  const editable = canEdit ?? Boolean(sessionId)

  const [content, setContent] = useState("")
  const [original, setOriginal] = useState("")
  const [language, setLanguage] = useState("text")
  const [mimeType, setMimeType] = useState<string | undefined>(undefined)
  const [size, setSize] = useState<number | undefined>(undefined)
  const [binary, setBinary] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview")
  const [imageFit, setImageFit] = useState(true)
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedToast, setSavedToast] = useState(false)
  const [copiedToast, setCopiedToast] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [error, setError] = useState("")

  const fileKey = `${scopeQuery}:${filePath}`
  const [prevFileKey, setPrevFileKey] = useState(fileKey)
  if (fileKey !== prevFileKey) {
    setPrevFileKey(fileKey)
    setLoading(true)
    setError("")
    setEditing(false)
    setViewMode("preview")
    setImageDims(null)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    setReloadNonce(n => n + 1)
    try {
      const res = await request<FileApiResponse>(
        `/api/workspace/file?${scopeQuery}&path=${encodeURIComponent(filePath)}`,
      )
      setContent(res.content)
      setOriginal(res.content)
      setLanguage(res.language)
      setMimeType(res.mimeType)
      setSize(res.size)
      setBinary(res.binary)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open file.")
    } finally {
      setLoading(false)
    }
  }, [scopeQuery, filePath])

  useEffect(() => {
    let cancelled = false
    void request<FileApiResponse>(
      `/api/workspace/file?${scopeQuery}&path=${encodeURIComponent(filePath)}`,
    )
      .then(res => {
        if (cancelled) return
        setContent(res.content)
        setOriginal(res.content)
        setLanguage(res.language)
        setMimeType(res.mimeType)
        setSize(res.size)
        setBinary(res.binary)
        setError("")
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Could not open file.")
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [scopeQuery, filePath])

  const dirty = content !== original
  const previewKind = getFilePreviewKind(filePath, mimeType, binary)
  const rawUrl = resolveCaptainUrl(
    `/api/workspace/raw?${scopeQuery}&path=${encodeURIComponent(filePath)}${reloadNonce ? `&v=${reloadNonce}` : ""}`,
  )
  const hasRichPreview = previewKind === "markdown" || previewKind === "svg" || previewKind === "html"
  const highlightLang = getHighlightLanguage(filePath, language)

  const save = useCallback(async () => {
    if (!sessionId) return
    setSaving(true)
    setError("")
    try {
      await request("/api/workspace/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, path: filePath, content }),
      })
      setOriginal(content)
      setReloadNonce(n => n + 1)
      setSavedToast(true)
      setTimeout(() => setSavedToast(false), 1800)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file.")
    } finally {
      setSaving(false)
    }
  }, [sessionId, filePath, content, onSaved])

  const copyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedToast(true)
      setTimeout(() => setCopiedToast(false), 1500)
    } catch {
      // Ignore clipboard failures in restricted contexts.
    }
  }, [content])

  const lines = content.split("\n")

  return (
    <div className="ade-pane-body">
      <div className="ade-pane-toolbar">
        <div className="ade-file-header-meta ade-truncate">
          {onBack ? (
            <button type="button" className="ade-chip-btn" onClick={onBack}>
              <ArrowLeft className="size-3" /> {backLabel}
            </button>
          ) : null}
          <code className="ade-mono ade-truncate" title={filePath}>{filePath}</code>
          <span className="ade-pill">{previewKind === "image" ? (language || "image") : language}</span>
          {size !== undefined ? <span className="ade-muted ade-xs shrink-0">{formatFileSize(size)}</span> : null}
          {dirty ? <span className="ade-pill ade-pill-warn">Unsaved</span> : null}
        </div>
        <div className="ade-toolbar-actions">
          {hasRichPreview && !editing ? (
            <button
              type="button"
              className="ade-chip-btn"
              onClick={() => setViewMode(m => (m === "preview" ? "source" : "preview"))}
              title={viewMode === "preview" ? "View source" : "View rendered preview"}
            >
              {viewMode === "preview" ? <><Code2 className="size-3.5" /> Source</> : <><Eye className="size-3.5" /> Preview</>}
            </button>
          ) : null}
          {previewKind === "image" || (previewKind === "svg" && viewMode === "preview") ? (
            <button
              type="button"
              className="ade-chip-btn"
              onClick={() => setImageFit(f => !f)}
              title={imageFit ? "View at actual size (1:1)" : "Fit image to sidebar"}
            >
              {imageFit ? <><Maximize2 className="size-3" /> 1:1</> : <><Minimize2 className="size-3" /> Fit</>}
            </button>
          ) : null}
          {previewKind === "image" || previewKind === "pdf" || previewKind === "svg" ? (
            <a
              href={rawUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ade-chip-btn"
              title="Open raw file in new tab"
            >
              <ExternalLink className="size-3" /> Raw
            </a>
          ) : null}
          {!binary && !editing ? (
            <button type="button" className="ade-chip-btn" onClick={() => void copyText()} title="Copy file contents">
              {copiedToast ? <><Check className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy</>}
            </button>
          ) : null}
          {onMentionInChat ? (
            <button type="button" className="ade-chip-btn" onClick={() => onMentionInChat(filePath)} title="Reference this file in composer">
              <MessageSquarePlus className="size-3.5" /> Ask
            </button>
          ) : null}
          {editable && !binary ? (
            <button type="button" className="ade-chip-btn" onClick={() => setEditing(e => !e)}>
              {editing ? <><Eye className="size-3.5" /> View</> : <><Edit3 className="size-3.5" /> Edit</>}
            </button>
          ) : null}
          {editing ? (
            <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={saving || !dirty} onClick={() => void save()}>
              {savedToast ? <><Check className="size-3.5" /> Saved</> : <><Save className="size-3.5" /> Save</>}
            </button>
          ) : null}
          {toolbarExtra}
          <button type="button" className="ade-icon-btn" onClick={() => void load()} title="Reload file" aria-label="Reload file">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {error ? <div className="ade-banner-error">{error}</div> : null}

      <div className={`ade-pane-scroll ${previewKind === "image" || (previewKind === "svg" && viewMode === "preview") ? "ade-image-surface" : previewKind === "markdown" && viewMode === "preview" && !editing ? "ade-artifact-body" : "ade-code-surface"}`}>
        {loading ? (
          <div className="ade-pane-note">Loading {filePath}…</div>
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
        ) : previewKind === "image" || (previewKind === "svg" && viewMode === "preview") ? (
          <div className="ade-image-preview-wrap">
            <img
              src={rawUrl}
              alt={filePath}
              className={`ade-image-preview ${imageFit ? "is-fit" : "is-actual"}`}
              onLoad={e => {
                const img = e.currentTarget
                if (img.naturalWidth && img.naturalHeight) {
                  setImageDims({ w: img.naturalWidth, h: img.naturalHeight })
                }
              }}
            />
            {imageDims ? (
              <div className="ade-image-meta">
                {imageDims.w} × {imageDims.h} px{size !== undefined ? ` · ${formatFileSize(size)}` : ""}
              </div>
            ) : null}
          </div>
        ) : previewKind === "pdf" ? (
          <iframe src={rawUrl} title={filePath} className="ade-artifact-html-frame" />
        ) : previewKind === "html" && viewMode === "preview" ? (
          <iframe srcDoc={content} title={filePath} className="ade-artifact-html-frame" sandbox="allow-scripts" />
        ) : previewKind === "markdown" && viewMode === "preview" ? (
          <div className="ade-msg-markdown">
            <MessageContent content={content} />
          </div>
        ) : binary ? (
          <div className="ade-pane-note">
            Binary file ({mimeType || "unknown type"}) cannot be displayed as text.
            {" "}
            <a href={rawUrl} target="_blank" rel="noopener noreferrer" className="underline">Download / open raw</a>
          </div>
        ) : previewKind === "code" && highlightLang && content.length <= 200_000 ? (
          <div className="ade-highlighted-code-wrap">
            <MessageContent content={`\`\`\`${highlightLang}\n${content}\n\`\`\``} />
          </div>
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
