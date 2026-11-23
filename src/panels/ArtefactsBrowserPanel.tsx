import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FileImage,
  FileText,
  Layers,
  MessageSquareWarning,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react"
import { request } from "../../api"
import { MessageContent } from "../../MessageContent"
import type { SessionArtifact, TimelineItem, WorkspaceGitSummary } from "../../app-types"
import {
  extractToolCallFilePaths,
  formatFileSize,
  getFileExtension,
  getFileFilterBucket,
  getFilePreviewKind,
  type ArtefactFilterBucket,
} from "./file-preview-utils"
import { RichFilePreview } from "./RichFilePreview"

export type ArtefactFileEntry = {
  path: string
  name: string
  ext: string
  size?: number
  modifiedAt?: number
  mimeType?: string
  gitStatus?: string | null
  source?: "project" | "session"
  sessionId?: string
  sessionLabel?: string
}

export type EnrichedSessionArtifact = SessionArtifact & {
  sessionLabel?: string
}

type SelectedItem =
  | { kind: "artifact"; artifact: EnrichedSessionArtifact }
  | { kind: "file"; file: ArtefactFileEntry }

function fileIcon(path: string, mimeType?: string) {
  const kind = getFilePreviewKind(path, mimeType)
  if (kind === "image" || kind === "svg") return <FileImage className="size-3.5 shrink-0 text-[var(--accent)]" />
  if (kind === "code") return <FileCode2 className="size-3.5 shrink-0 opacity-80" />
  return <FileText className="size-3.5 shrink-0 opacity-80" />
}

function splitDirAndName(relPath: string): { dir: string; name: string } {
  const idx = relPath.lastIndexOf("/")
  if (idx === -1) return { dir: "", name: relPath }
  return { dir: relPath.slice(0, idx), name: relPath.slice(idx + 1) }
}

export function ArtefactsBrowserPanel({
  scope,
  sessionId,
  projectId,
  workspacePath,
  artifacts: liveArtifacts = [],
  activeArtifactId,
  gitSummary,
  timelineItems = [],
  onSelectArtifact,
  onReview,
  onOpenFileTab,
  onMentionInChat,
  onSaved,
  onOpenSession,
}: {
  scope: "session" | "project"
  sessionId?: string
  projectId?: string
  workspacePath?: string | null
  artifacts?: SessionArtifact[]
  activeArtifactId?: string
  gitSummary?: WorkspaceGitSummary
  timelineItems?: TimelineItem[]
  onSelectArtifact?: (id: string | undefined) => void
  onReview?: (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => Promise<void>
  onOpenFileTab?: (filePath: string) => void
  onMentionInChat?: (filePath: string) => void
  onSaved?: () => void
  onOpenSession?: (sessionId: string) => void
}) {
  const [fetchedArtifacts, setFetchedArtifacts] = useState<EnrichedSessionArtifact[]>([])
  const [fetchedFiles, setFetchedFiles] = useState<ArtefactFileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [bucket, setBucket] = useState<ArtefactFilterBucket>("all")
  const [selectedFile, setSelectedFile] = useState<ArtefactFileEntry | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | undefined>(activeArtifactId)
  const [feedback, setFeedback] = useState("")
  const [showFeedback, setShowFeedback] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)

  const scopeKey = scope === "project" ? `project:${projectId ?? ""}` : `session:${sessionId ?? ""}`
  const [prevScopeKey, setPrevScopeKey] = useState(scopeKey)
  if (scopeKey !== prevScopeKey) {
    setPrevScopeKey(scopeKey)
    setSelectedFile(null)
    setSelectedArtifactId(activeArtifactId)
    setQuery("")
    setBucket("all")
    setLoading(true)
    setError("")
  }

  const [prevActiveId, setPrevActiveId] = useState(activeArtifactId)
  if (activeArtifactId !== prevActiveId) {
    setPrevActiveId(activeArtifactId)
    if (activeArtifactId) {
      setSelectedFile(null)
      setSelectedArtifactId(activeArtifactId)
    } else {
      setSelectedArtifactId(undefined)
    }
  }

  const endpoint = scope === "project"
    ? (projectId ? `/api/projects/${encodeURIComponent(projectId)}/artifacts` : null)
    : (sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}/artifacts` : null)

  const load = useCallback(async () => {
    if (!endpoint) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await request<{ artifacts?: EnrichedSessionArtifact[]; files?: ArtefactFileEntry[] }>(endpoint)
      setFetchedArtifacts(Array.isArray(res.artifacts) ? res.artifacts : [])
      setFetchedFiles(Array.isArray(res.files) ? res.files : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load artefacts.")
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    let cancelled = false
    if (!endpoint) return
    void request<{ artifacts?: EnrichedSessionArtifact[]; files?: ArtefactFileEntry[] }>(endpoint)
      .then(res => {
        if (cancelled) return
        setFetchedArtifacts(Array.isArray(res.artifacts) ? res.artifacts : [])
        setFetchedFiles(Array.isArray(res.files) ? res.files : [])
        setError("")
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Could not load artefacts.")
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [endpoint])

  // Merge live session artifacts (from SSE) with fetched artifacts.
  const allArtifacts = useMemo<EnrichedSessionArtifact[]>(() => {
    const byId = new Map<string, EnrichedSessionArtifact>()
    for (const a of fetchedArtifacts) byId.set(a.id, a)
    for (const a of liveArtifacts) {
      const prev = byId.get(a.id)
      byId.set(a.id, prev ? { ...prev, ...a } : a)
    }
    return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [fetchedArtifacts, liveArtifacts])

  // Merge fetched workspace files with live git changes & tool-call files in session scope.
  const allFiles = useMemo<ArtefactFileEntry[]>(() => {
    const byKey = new Map<string, ArtefactFileEntry>()
    const keyOf = (f: ArtefactFileEntry) => `${f.sessionId ?? ""}:${f.path}`

    for (const f of fetchedFiles) {
      byKey.set(keyOf(f), f)
    }

    if (scope === "session") {
      if (gitSummary?.files) {
        for (const gf of gitSummary.files) {
          if (gf.status === "deleted") continue
          const k = `:${gf.path}`
          const existing = byKey.get(k)
          const { name } = splitDirAndName(gf.path)
          byKey.set(k, {
            path: gf.path,
            name,
            ext: getFileExtension(gf.path),
            ...existing,
            gitStatus: gf.status,
          })
        }
      }
      for (const item of timelineItems) {
        if (item.kind !== "assistant") continue
        for (const tc of item.toolCalls) {
          for (const fp of extractToolCallFilePaths(tc, workspacePath)) {
            const k = `:${fp}`
            if (!byKey.has(k)) {
              const { name } = splitDirAndName(fp)
              byKey.set(k, {
                path: fp,
                name,
                ext: getFileExtension(fp),
                gitStatus: "created",
              })
            }
          }
        }
      }
    }

    return [...byKey.values()].sort((a, b) => {
      const aChanged = a.gitStatus ? 1 : 0
      const bChanged = b.gitStatus ? 1 : 0
      if (aChanged !== bChanged) return bChanged - aChanged
      return (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) || a.path.localeCompare(b.path)
    })
  }, [fetchedFiles, scope, gitSummary, timelineItems, workspacePath])

  const selectedArtifact = useMemo(
    () => (selectedArtifactId ? allArtifacts.find(a => a.id === selectedArtifactId) ?? null : null),
    [allArtifacts, selectedArtifactId],
  )

  const selected: SelectedItem | null = selectedFile
    ? { kind: "file", file: selectedFile }
    : selectedArtifact
      ? { kind: "artifact", artifact: selectedArtifact }
      : null

  const counts = useMemo(() => {
    const c = { all: allArtifacts.length + allFiles.length, plans: allArtifacts.length, docs: 0, code: 0, images: 0 }
    for (const f of allFiles) {
      c[getFileFilterBucket(f.path, f.mimeType)]++
    }
    return c
  }, [allArtifacts.length, allFiles])

  const q = query.trim().toLowerCase()
  const filteredArtifacts = useMemo(() => {
    if (bucket !== "all" && bucket !== "plans") return []
    if (!q) return allArtifacts
    return allArtifacts.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.sessionLabel?.toLowerCase().includes(q) ?? false) ||
      a.kind.toLowerCase().includes(q),
    )
  }, [allArtifacts, bucket, q])

  const filteredFiles = useMemo(() => {
    if (bucket === "plans") return []
    return allFiles.filter(f => {
      if (bucket !== "all" && getFileFilterBucket(f.path, f.mimeType) !== bucket) return false
      if (!q) return true
      return (
        f.path.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q) ||
        f.ext.toLowerCase().includes(q) ||
        (f.sessionLabel?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [allFiles, bucket, q])

  const handleReview = async (artifact: EnrichedSessionArtifact, decision: "approved" | "changes_requested") => {
    if (!onReview) return
    setReviewBusy(true)
    try {
      await onReview(artifact, decision, decision === "changes_requested" ? feedback : undefined)
      setFeedback("")
      setShowFeedback(false)
    } finally {
      setReviewBusy(false)
    }
  }

  // --- Previewing a workspace file artefact ---
  if (selected?.kind === "file") {
    const file = selected.file
    const fileSessionId = scope === "session" ? sessionId : file.sessionId
    const fileProjectId = fileSessionId ? undefined : projectId
    return (
      <RichFilePreview
        sessionId={fileSessionId}
        projectId={fileProjectId}
        filePath={file.path}
        onBack={() => setSelectedFile(null)}
        backLabel="All artefacts"
        onMentionInChat={scope === "session" ? onMentionInChat : undefined}
        onSaved={onSaved}
        canEdit={Boolean(fileSessionId)}
        toolbarExtra={
          scope === "session" && onOpenFileTab ? (
            <button
              type="button"
              className="ade-chip-btn"
              onClick={() => onOpenFileTab(file.path)}
              title="Open in its own tab"
            >
              <ExternalLink className="size-3" /> Tab
            </button>
          ) : null
        }
      />
    )
  }

  // --- Previewing a structured session artifact (plan / walkthrough / markdown / HTML) ---
  if (selected?.kind === "artifact") {
    const current = selected.artifact
    return (
      <div className="ade-pane-body">
        <div className="ade-pane-toolbar">
          <div className="ade-artifact-tabs">
            <button
              type="button"
              className="ade-chip-btn"
              onClick={() => {
                setSelectedArtifactId(undefined)
                onSelectArtifact?.(undefined)
              }}
              title="Show all artefacts"
            >
              <ArrowLeft className="size-3" /> All artefacts
            </button>
            {allArtifacts.map(a => (
              <button
                key={a.id}
                type="button"
                className={`ade-chip-btn ${a.id === current.id ? "is-active" : ""}`}
                onClick={() => {
                  setSelectedArtifactId(a.id)
                  onSelectArtifact?.(a.id)
                }}
              >
                <FileText className="size-3" />
                <span>{a.title}</span>
                {a.status === "awaiting_approval" ? <span className="ade-dot ade-dot-waiting" /> : null}
                {a.status === "approved" ? <CheckCircle2 className="size-3 text-[var(--ok)]" /> : null}
              </button>
            ))}
          </div>
          <div className="ade-toolbar-actions">
            {scope === "project" && onOpenSession && current.sessionId ? (
              <button type="button" className="ade-chip-btn" onClick={() => onOpenSession(current.sessionId)}>
                Open session
              </button>
            ) : null}
            <span className={`ade-pill ${current.status === "approved" ? "ade-pill-ok" : current.status === "awaiting_approval" ? "ade-pill-warn" : ""}`}>
              {current.status.replace("_", " ")}
            </span>
          </div>
        </div>

        <div className="ade-pane-scroll ade-artifact-body">
          {current.kind === "html" ? (
            <iframe
              srcDoc={current.content}
              title={current.title}
              className="ade-artifact-html-frame"
              sandbox="allow-scripts"
            />
          ) : (
            <div className="ade-msg-markdown">
              <MessageContent
                content={current.content}
                onOpenFile={p => setSelectedFile({ path: p, name: p.split("/").pop() || p, ext: getFileExtension(p) })}
                workspacePath={workspacePath}
              />
            </div>
          )}
        </div>

        {onReview && (current.status === "awaiting_approval" || current.kind === "plan") ? (
          <div className="ade-artifact-footer">
            {showFeedback ? (
              <div className="ade-artifact-feedback-row">
                <input
                  type="text"
                  className="ade-input-sm flex-1"
                  placeholder="Describe requested changes…"
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void handleReview(current, "changes_requested") }}
                />
                <button type="button" className="ade-btn ade-btn-xs" disabled={reviewBusy} onClick={() => setShowFeedback(false)}>Cancel</button>
                <button type="button" className="ade-btn ade-btn-danger ade-btn-xs" disabled={reviewBusy || !feedback.trim()} onClick={() => void handleReview(current, "changes_requested")}>
                  Send feedback
                </button>
              </div>
            ) : (
              <div className="ade-artifact-actions">
                <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={reviewBusy} onClick={() => void handleReview(current, "approved")}>
                  <Check className="size-3.5" /> Approve &amp; Proceed
                </button>
                <button type="button" className="ade-btn ade-btn-xs" disabled={reviewBusy} onClick={() => setShowFeedback(true)}>
                  <MessageSquareWarning className="size-3.5" /> Request changes
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    )
  }

  // --- List view: all artefacts for session or project ---
  const filterTabs: Array<{ id: ArtefactFilterBucket; label: string; count: number }> = [
    { id: "all", label: "All", count: counts.all },
    ...(counts.plans > 0 ? [{ id: "plans" as const, label: "Plans", count: counts.plans }] : []),
    { id: "docs", label: "Docs", count: counts.docs },
    { id: "code", label: "Code", count: counts.code },
    { id: "images", label: "Images", count: counts.images },
  ]

  const isEmpty = !loading && filteredArtifacts.length === 0 && filteredFiles.length === 0

  return (
    <div className="ade-pane-body">
      <div className="ade-pane-toolbar">
        <div className="ade-search-box flex-1">
          <Search className="size-3.5 opacity-60" />
          <input
            type="text"
            placeholder={scope === "project" ? "Filter project artefacts…" : "Filter session artefacts…"}
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label={scope === "project" ? "Filter project artefacts" : "Filter session artefacts"}
          />
        </div>
        <button type="button" className="ade-icon-btn" onClick={() => void load()} title="Refresh artefacts" aria-label="Refresh artefacts">
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <div className="ade-artefacts-filters" role="tablist" aria-label="Artefact type filter">
        {filterTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={bucket === tab.id}
            className={`ade-chip-btn ${bucket === tab.id ? "is-active" : ""}`}
            onClick={() => setBucket(tab.id)}
          >
            <span>{tab.label}</span>
            <span className="ade-count-badge">{tab.count}</span>
          </button>
        ))}
      </div>

      {error ? <div className="ade-banner-error">{error}</div> : null}

      <div className="ade-pane-scroll ade-artefacts-list-scroll">
        {loading && allArtifacts.length === 0 && allFiles.length === 0 ? (
          <div className="ade-pane-note">Loading artefacts…</div>
        ) : isEmpty ? (
          <div className="ade-pane-empty">
            <Layers className="size-7 opacity-40" />
            <p>{query || bucket !== "all" ? "No artefacts match this filter." : scope === "project" ? "No project artefacts yet." : "No artefacts yet in this session."}</p>
            <p className="ade-muted ade-xs">
              {scope === "project"
                ? "Files created in this project (.txt, .py, .md, .jpg, etc.) and plans from its sessions will appear here."
                : "Files created by the agent (.txt, .py, .md, .jpg, etc.) or plans from /plan will appear here."}
            </p>
          </div>
        ) : (
          <div className="ade-artefacts-list">
            {filteredArtifacts.length > 0 ? (
              <div className="ade-artefacts-group">
                <div className="ade-artefacts-group-label">Plans &amp; Reports ({filteredArtifacts.length})</div>
                {filteredArtifacts.map(art => (
                  <button
                    key={art.id}
                    type="button"
                    className="ade-artefact-row"
                    onClick={() => {
                      setSelectedArtifactId(art.id)
                      onSelectArtifact?.(art.id)
                    }}
                  >
                    <Sparkles className="size-3.5 shrink-0 text-[var(--accent)]" />
                    <div className="ade-artefact-row-main">
                      <span className="ade-artefact-row-name ade-truncate">{art.title}</span>
                      <span className="ade-artefact-row-meta ade-truncate">
                        {art.sessionLabel ? `${art.sessionLabel} · ` : ""}{art.kind}
                      </span>
                    </div>
                    <span className={`ade-pill ${art.status === "approved" ? "ade-pill-ok" : art.status === "awaiting_approval" ? "ade-pill-warn" : ""}`}>
                      {art.status.replace("_", " ")}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {filteredFiles.length > 0 ? (
              <div className="ade-artefacts-group">
                <div className="ade-artefacts-group-label">Files ({filteredFiles.length})</div>
                {filteredFiles.map(file => {
                  const { dir, name } = splitDirAndName(file.path)
                  const extLabel = file.ext ? file.ext.toUpperCase() : "FILE"
                  return (
                    <button
                      key={`${file.sessionId ?? "repo"}:${file.path}`}
                      type="button"
                      className="ade-artefact-row"
                      onClick={() => setSelectedFile(file)}
                      title={file.path}
                    >
                      {fileIcon(file.path, file.mimeType)}
                      <div className="ade-artefact-row-main">
                        <span className="ade-artefact-row-name ade-truncate">{name}</span>
                        <span className="ade-artefact-row-meta ade-truncate">
                          {file.sessionLabel ? `${file.sessionLabel} · ` : ""}
                          {dir || "."}
                          {file.size !== undefined ? ` · ${formatFileSize(file.size)}` : ""}
                        </span>
                      </div>
                      <div className="ade-artefact-row-badges">
                        {file.gitStatus ? (
                          <span className={`ade-pill ${file.gitStatus === "untracked" || file.gitStatus === "added" || file.gitStatus === "created" ? "ade-pill-ok" : "ade-pill-warn"}`}>
                            {file.gitStatus === "untracked" ? "new" : file.gitStatus}
                          </span>
                        ) : null}
                        <span className="ade-pill ade-mono">{extLabel}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
