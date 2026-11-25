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
import { request, resolveCaptainUrl, requestJson } from "../api"
import { MessageContent } from "../MessageContent"
import { useI18n } from "../i18n/I18nContext"
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
  backLabel,
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
  const { t } = useI18n()
  const resolvedBackLabel = backLabel ?? t("pnlx.files.back")
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
      setError(err instanceof Error ? err.message : t("pnlx.files.errOpenFile"))
    } finally {
      setLoading(false)
    }
  }, [scopeQuery, filePath, t])

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
        setError(err instanceof Error ? err.message : t("pnlx.files.errOpenFile"))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [scopeQuery, filePath, t])

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
      await requestJson("/api/workspace/file", "PUT", { sessionId, path: filePath, content })
      setOriginal(content)
      setReloadNonce(n => n + 1)
      setSavedToast(true)
      setTimeout(() => setSavedToast(false), 1800)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pnlx.files.errSaveFile"))
    } finally {
      setSaving(false)
    }
  }, [sessionId, filePath, content, onSaved, t])

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
              <ArrowLeft className="size-3" /> {resolvedBackLabel}
            </button>
          ) : null}
          <code className="ade-mono ade-truncate" title={filePath}>{filePath}</code>
          <span className="ade-pill">{previewKind === "image" ? (language || t("pnlx.files.imageFallback")) : language}</span>
          {size !== undefined ? <span className="ade-muted ade-xs shrink-0">{formatFileSize(size)}</span> : null}
          {dirty ? <span className="ade-pill ade-pill-warn">{t("pnlx.files.unsaved")}</span> : null}
        </div>
        <div className="ade-toolbar-actions">
          {hasRichPreview && !editing ? (
            <button
              type="button"
              className="ade-chip-btn"
              onClick={() => setViewMode(m => (m === "preview" ? "source" : "preview"))}
              title={viewMode === "preview" ? t("pnlx.files.viewSourceTitle") : t("pnlx.files.viewPreviewTitle")}
            >
              {viewMode === "preview" ? <><Code2 className="size-3.5" /> {t("pnlx.files.source")}</> : <><Eye className="size-3.5" /> {t("pnlx.files.preview")}</>}
            </button>
          ) : null}
          {previewKind === "image" || (previewKind === "svg" && viewMode === "preview") ? (
            <button
              type="button"
              className="ade-chip-btn"
              onClick={() => setImageFit(f => !f)}
              title={imageFit ? t("pnlx.files.actualSizeTitle") : t("pnlx.files.fitSidebarTitle")}
            >
              {imageFit ? <><Maximize2 className="size-3" /> 1:1</> : <><Minimize2 className="size-3" /> {t("pnlx.files.fit")}</>}
            </button>
          ) : null}
          {previewKind === "image" || previewKind === "pdf" || previewKind === "svg" ? (
            <a
              href={rawUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ade-chip-btn"
              title={t("pnlx.files.openRawTitle")}
            >
              <ExternalLink className="size-3" /> {t("pnlx.files.raw")}
            </a>
          ) : null}
          {!binary && !editing ? (
            <button type="button" className="ade-chip-btn" onClick={() => void copyText()} title={t("pnlx.files.copyContentsTitle")}>
              {copiedToast ? <><Check className="size-3.5" /> {t("pnlx.files.copied")}</> : <><Copy className="size-3.5" /> {t("pnlx.files.copy")}</>}
            </button>
          ) : null}
          {onMentionInChat ? (
            <button type="button" className="ade-chip-btn" onClick={() => onMentionInChat(filePath)} title={t("pnlx.files.mentionTitle")}>
              <MessageSquarePlus className="size-3.5" /> {t("pnlx.files.ask")}
            </button>
          ) : null}
          {editable && !binary ? (
            <button type="button" className="ade-chip-btn" onClick={() => setEditing(e => !e)}>
              {editing ? <><Eye className="size-3.5" /> {t("pnlx.files.view")}</> : <><Edit3 className="size-3.5" /> {t("pnlx.files.edit")}</>}
            </button>
          ) : null}
          {editing ? (
            <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={saving || !dirty} onClick={() => void save()}>
              {savedToast ? <><Check className="size-3.5" /> {t("pnlx.files.saved")}</> : <><Save className="size-3.5" /> {t("pnlx.files.save")}</>}
            </button>
          ) : null}
          {toolbarExtra}
          <button type="button" className="ade-icon-btn" onClick={() => void load()} title={t("pnlx.files.reloadFile")} aria-label={t("pnlx.files.reloadFile")}>
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {error ? <div className="ade-banner-error">{error}</div> : null}

      <div className={`ade-pane-scroll ${previewKind === "image" || (previewKind === "svg" && viewMode === "preview") ? "ade-image-surface" : previewKind === "markdown" && viewMode === "preview" && !editing ? "ade-artifact-body" : "ade-code-surface"}`}>
        {loading ? (
          <div className="ade-pane-note">{t("pnlx.files.loadingFile", { path: filePath })}</div>
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
          <iframe
            src={rawUrl}
            title={filePath}
            className="ade-artifact-html-frame"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
          />
        ) : previewKind === "html" && viewMode === "preview" ? (
          <iframe
            srcDoc={content}
            title={filePath}
            className="ade-artifact-html-frame"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
          />
        ) : previewKind === "markdown" && viewMode === "preview" ? (
          <div className="ade-msg-markdown">
            <MessageContent content={content} />
          </div>
        ) : binary ? (
          <div className="ade-pane-note">
            {t("pnlx.files.binaryFile", { mimeType: mimeType || t("pnlx.files.unknownType") })}
            {" "}
            <a href={rawUrl} target="_blank" rel="noopener noreferrer" className="underline">{t("pnlx.files.downloadOpenRaw")}</a>
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
