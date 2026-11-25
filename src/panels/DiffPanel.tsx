import { useCallback, useEffect, useState } from "react"
import { Check, FileCode2, GitCommit, Minus, Plus, RefreshCw, RotateCcw, Send } from "lucide-react"
import { request, requestJson } from "../api"
import { useConfirm } from "../../components/ui/index.ts"
import { useI18n } from "../i18n/I18nContext"
import { reviewFeedbackPrompt } from "@ade/protocol/agent-prompts.ts"
import { DiffLines } from "./DiffLines"
import { useDiffNotes } from "./diff-notes"
import type { WorkspaceGitSummary } from "../app-types"
import { CheckpointList } from "./CheckpointList"

type BranchFile = { path: string; additions: number; deletions: number; status: "added" | "modified" | "deleted" | "renamed" }

export function DiffPanel({
  sessionId,
  summary,
  onRefresh,
  onOpenFile,
  agentBusy = false,
  initialMode = "working",
  onAskAgent,
}: {
  sessionId: string
  summary: WorkspaceGitSummary
  onRefresh: () => void
  onOpenFile?: (path: string) => void
  /** The agent is working; rewinding is disabled until it stops. */
  agentBusy?: boolean
  initialMode?: "working" | "branch" | "history"
  /** Send the line notes to the session's agent. */
  onAskAgent?: (text: string) => Promise<void>
}) {
  const { t } = useI18n()
  const { confirm } = useConfirm()
  const diffNotes = useDiffNotes(sessionId)
  const [sendingNotes, setSendingNotes] = useState(false)
  const sendNotes = async () => {
    if (!onAskAgent || !diffNotes.notes.length) return
    setSendingNotes(true)
    setError("")
    try {
      await onAskAgent(reviewFeedbackPrompt(diffNotes.notes.map(note => ({ kind: "note", body: note.code ? `${note.text}\n(at: ${note.code})` : note.text, path: note.path, line: note.line }))))
      diffNotes.clear()
      setNotice(t("pnlx.diff.notesSent"))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pnlx.diff.errSendNotes"))
    } finally {
      setSendingNotes(false)
    }
  }
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [showStaged, setShowStaged] = useState(false)
  const [diffText, setDiffText] = useState("")
  const [commitMessage, setCommitMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  // "working" = uncommitted changes (stage/commit); "branch" = everything this session changed since its base commit.
  const [mode, setMode] = useState<"working" | "branch" | "history">(initialMode)
  const [prevInitialMode, setPrevInitialMode] = useState(initialMode)
  if (initialMode !== prevInitialMode) {
    setPrevInitialMode(initialMode)
    setMode(initialMode)
  }
  const [branchFiles, setBranchFiles] = useState<BranchFile[] | null>(null)

  const loadBranchFiles = useCallback(async () => {
    try {
      const res = await request<{ files: BranchFile[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/branch-diff`)
      setBranchFiles(res.files)
    } catch (err) {
      setBranchFiles([])
      setError(err instanceof Error ? err.message : t("pnlx.diff.errLoadBranch"))
    }
  }, [sessionId, t])

  useEffect(() => {
    if (mode !== "branch") return
    let cancelled = false
    void request<{ files: BranchFile[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/branch-diff`)
      .then(res => { if (!cancelled) setBranchFiles(res.files) })
      .catch(err => {
        if (!cancelled) {
          setBranchFiles([])
          setError(err instanceof Error ? err.message : t("pnlx.diff.errLoadBranch"))
        }
      })
    return () => { cancelled = true }
  }, [mode, sessionId, summary, t])

  const activeFile = summary.files.find(f => f.path === selectedPath) ?? summary.files[0] ?? null
  const activeBranchFile = branchFiles?.find(f => f.path === selectedPath) ?? branchFiles?.[0] ?? null
  const activeDiffPath = mode === "branch" ? activeBranchFile?.path : activeFile?.path
  const activeStagedFlag = showStaged && Boolean(activeFile?.staged)

  useEffect(() => {
    if (!activeDiffPath) return
    let cancelled = false
    const url = mode === "branch"
      ? `/api/sessions/${encodeURIComponent(sessionId)}/branch-diff/file?path=${encodeURIComponent(activeDiffPath)}`
      : `/api/workspace/git/diff?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(activeDiffPath)}&staged=${activeStagedFlag ? "true" : "false"}`
    void request<{ diff: string }>(url)
      .then(res => { if (!cancelled) setDiffText(res.diff) })
      .catch(() => { if (!cancelled) setDiffText("") })
    return () => { cancelled = true }
  }, [sessionId, mode, activeDiffPath, activeStagedFlag])

  const displayedDiffText = activeDiffPath ? diffText : ""

  const stage = async (paths: string[]) => {
    setBusy(true)
    setError("")
    try {
      await requestJson("/api/workspace/git/stage", "POST", { sessionId, paths })
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pnlx.diff.errStage"))
    } finally {
      setBusy(false)
    }
  }

  const unstage = async (paths: string[]) => {
    setBusy(true)
    setError("")
    try {
      await requestJson("/api/workspace/git/unstage", "POST", { sessionId, paths })
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pnlx.diff.errUnstage"))
    } finally {
      setBusy(false)
    }
  }

  const discard = async (path: string) => {
    const confirmed = await confirm({
      title: t("pnlx.diff.discardTitle"),
      description: t("pnlx.diff.discardDesc", { path }),
      confirmLabel: t("pnlx.diff.discardConfirm"),
      destructive: true,
    })
    if (!confirmed) return
    setBusy(true)
    setError("")
    try {
      await requestJson("/api/workspace/git/discard", "POST", { sessionId, path })
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pnlx.diff.errDiscard"))
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!commitMessage.trim()) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      // Nothing staged: commit everything, which is what most people expect from a single Commit button.
      if (!summary.files.some(f => f.staged)) {
        await requestJson("/api/workspace/git/stage", "POST", { sessionId, paths: [] })
      }
      const res = await requestJson<{ commit: { hash: string } }>("/api/workspace/git/commit", "POST", { sessionId, message: commitMessage })
      setCommitMessage("")
      setNotice(t("pnlx.diff.committed", { hash: res.commit.hash }))
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pnlx.diff.errCommit"))
    } finally {
      setBusy(false)
    }
  }

  if (!summary.isGitRepo) {
    return (
      <div className="ade-pane-empty">
        <p>{t("pnlx.diff.noGitRepo")}</p>
      </div>
    )
  }

  const stagedCount = summary.files.filter(f => f.staged).length
  const modeToggle = (
    <div className="ade-segmented" role="tablist" aria-label={t("pnlx.diff.ariaScope")}>
      <button type="button" role="tab" aria-selected={mode === "working"} className={mode === "working" ? "is-active" : ""} onClick={() => { setMode("working"); setSelectedPath(null) }}>
        {t("pnlx.diff.tabUncommitted")}{summary.files.length ? ` · ${summary.files.length}` : ""}
      </button>
      <button type="button" role="tab" aria-selected={mode === "branch"} className={mode === "branch" ? "is-active" : ""} onClick={() => { setMode("branch"); setSelectedPath(null) }}>
        {t("pnlx.diff.tabBranch")}{branchFiles?.length ? ` · ${branchFiles.length}` : ""}
      </button>
      <button type="button" role="tab" aria-selected={mode === "history"} className={mode === "history" ? "is-active" : ""} onClick={() => setMode("history")}>
        {t("pnlx.diff.tabHistory")}
      </button>
    </div>
  )

  if (mode === "history") {
    return (
      <div className="ade-pane-body">
        <div className="ade-pane-toolbar">{modeToggle}</div>
        <CheckpointList sessionId={sessionId} busy={agentBusy} onRestored={onRefresh} />
      </div>
    )
  }
  const noteFiles = new Set(diffNotes.notes.map(note => note.path)).size
  const notesBar = onAskAgent && diffNotes.notes.length ? (
    <div className="ade-notes-bar" role="status">
      <span>
        {t("pnlx.diff.notesForAgent", {
          notes: diffNotes.notes.length,
          noteWord: diffNotes.notes.length === 1 ? t("pnlx.diff.noteOne") : t("pnlx.diff.noteMany"),
          files: noteFiles,
          fileWord: noteFiles === 1 ? t("pnlx.diff.fileOne") : t("pnlx.diff.fileMany"),
        })}
      </span>
      <button
        type="button"
        className="ade-chip-btn"
        onClick={() => void confirm({
          title: t("pnlx.diff.clearNotesTitle"),
          description: t("pnlx.diff.clearNotesDesc"),
          confirmLabel: t("pnlx.diff.clearNotesConfirm"),
          destructive: true,
        }).then(ok => { if (ok) diffNotes.clear() })}
      >{t("pnlx.diff.clear")}</button>
      <button
        type="button"
        className="ade-btn ade-btn-primary ade-btn-xs"
        disabled={sendingNotes || agentBusy}
        title={agentBusy ? t("pnlx.diff.sendNotesBusyTitle") : t("pnlx.diff.sendNotesTitle")}
        onClick={() => void sendNotes()}
      >
        <Send className="size-3" /> {sendingNotes ? t("pnlx.diff.sending") : t("pnlx.diff.sendToAgent")}
      </button>
    </div>
  ) : null
  const renderDiff = () => (
    <DiffLines
      diff={displayedDiffText}
      path={activeDiffPath ?? null}
      notes={diffNotes.notes}
      onAddNote={onAskAgent ? diffNotes.add : undefined}
      onRemoveNote={diffNotes.remove}
    />
  )

  if (mode === "branch") {
    return (
      <div className="ade-pane-body">
        <div className="ade-pane-toolbar">
          {modeToggle}
          <div className="ade-toolbar-actions">
            <button type="button" className="ade-icon-btn" onClick={() => void loadBranchFiles()} title={t("pnlx.diff.refreshBranchDiff")} aria-label={t("pnlx.diff.refreshBranchDiff")}>
              <RefreshCw className="size-3.5" />
            </button>
          </div>
        </div>
        {error ? <div className="ade-banner-error">{error}</div> : null}
        {notice ? <div className="ade-banner-ok"><Check className="size-3.5" /> {notice}</div> : null}
        {notesBar}
        {branchFiles === null ? <div className="ade-pane-empty"><p>{t("pnlx.diff.loadingBranch")}</p></div>
          : branchFiles.length === 0 ? <div className="ade-pane-empty"><p>{t("pnlx.diff.noBranchChangesBefore")}<code>{summary.branch || "HEAD"}</code>{t("pnlx.diff.noBranchChangesAfter")}</p></div>
          : (
            <div className="ade-diff-split is-readonly">
              <div className="ade-diff-filelist">
                {branchFiles.map(file => (
                  <div key={file.path} className={`ade-diff-file-row ${activeBranchFile?.path === file.path ? "is-selected" : ""}`} onClick={() => setSelectedPath(file.path)}>
                    <div className="ade-diff-file-main">
                      <span className={`ade-git-badge is-${file.status}`}>{file.status[0].toUpperCase()}</span>
                      <span className="ade-truncate" title={file.path}>{file.path}</span>
                    </div>
                    <div className="ade-diff-file-meta">
                      {file.additions > 0 ? <span className="ade-diff-add">+{file.additions}</span> : null}
                      {file.deletions > 0 ? <span className="ade-diff-del">-{file.deletions}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
              <div className="ade-diff-viewer">
                {activeBranchFile ? <div className="ade-diff-viewer-head"><code className="ade-mono ade-truncate">{activeBranchFile.path}</code></div> : null}
                {renderDiff()}
              </div>
            </div>
          )}
      </div>
    )
  }

  return (
    <div className="ade-pane-body">
      <div className="ade-pane-toolbar">
        {modeToggle}
        <div className="ade-toolbar-actions">
          <button type="button" className="ade-chip-btn" disabled={busy || !summary.files.length} onClick={() => void stage([])}>
            <Plus className="size-3" /> {t("pnlx.diff.stageAll")}
          </button>
          <button type="button" className="ade-icon-btn" onClick={onRefresh} title={t("pnlx.diff.refreshGitStatus")} aria-label={t("pnlx.diff.refreshGitStatus")}>
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {error ? <div className="ade-banner-error">{error}</div> : null}
      {notice ? <div className="ade-banner-ok"><Check className="size-3.5" /> {notice}</div> : null}
      {notesBar}

      {summary.files.length === 0 ? (
        <div className="ade-pane-empty">
          <p>{t("pnlx.diff.cleanBefore")}<code>{summary.branch || "HEAD"}</code>{t("pnlx.diff.cleanAfter")}</p>
        </div>
      ) : (
        <div className="ade-diff-split">
          <div className="ade-diff-filelist">
            {summary.files.map(file => (
              <div
                key={file.path}
                className={`ade-diff-file-row ${activeFile?.path === file.path ? "is-selected" : ""}`}
                onClick={() => setSelectedPath(file.path)}
              >
                <div className="ade-diff-file-main">
                  <span className={`ade-git-badge is-${file.status}`}>
                    {file.status === "untracked" ? "?" : file.status[0].toUpperCase()}
                  </span>
                  <span className="ade-truncate" title={file.path}>{file.path}</span>
                </div>
                <div className="ade-diff-file-meta">
                  {file.staged ? <span className="ade-pill ade-pill-ok">{t("pnlx.diff.stagedBadge")}</span> : null}
                  {file.additions > 0 ? <span className="ade-diff-add">+{file.additions}</span> : null}
                  {file.deletions > 0 ? <span className="ade-diff-del">-{file.deletions}</span> : null}
                  <div className="ade-diff-file-actions" onClick={e => e.stopPropagation()}>
                    {onOpenFile ? (
                      <button type="button" className="ade-icon-btn" onClick={() => onOpenFile(file.path)} title={t("pnlx.diff.openFile")}>
                        <FileCode2 className="size-3" />
                      </button>
                    ) : null}
                    {file.unstaged ? (
                      <button type="button" className="ade-icon-btn" onClick={() => void stage([file.path])} title={t("pnlx.diff.stageFile")}>
                        <Plus className="size-3" />
                      </button>
                    ) : null}
                    {file.staged ? (
                      <button type="button" className="ade-icon-btn" onClick={() => void unstage([file.path])} title={t("pnlx.diff.unstageFile")}>
                        <Minus className="size-3" />
                      </button>
                    ) : null}
                    {file.unstaged && file.status !== "untracked" ? (
                      <button type="button" className="ade-icon-btn" onClick={() => void discard(file.path)} title={t("pnlx.diff.discardChanges")}>
                        <RotateCcw className="size-3" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="ade-diff-viewer">
            {activeFile ? (
              <div className="ade-diff-viewer-head">
                <code className="ade-mono ade-truncate">{activeFile.path}</code>
                {activeFile.staged && activeFile.unstaged ? (
                  <button type="button" className="ade-chip-btn" onClick={() => setShowStaged(s => !s)}>
                    {showStaged ? t("pnlx.diff.showingStaged") : t("pnlx.diff.showingUnstaged")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {renderDiff()}
          </div>

          <div className="ade-commit-bar">
            <input
              type="text"
              className="ade-input-sm flex-1"
              placeholder={stagedCount
                ? t(stagedCount === 1 ? "pnlx.diff.commitStagedOne" : "pnlx.diff.commitStagedMany", { count: stagedCount })
                : t("pnlx.diff.commitAllPlaceholder")}
              aria-label={t("pnlx.diff.commitMessageAria")}
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void commit() }}
            />
            <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={busy || !commitMessage.trim()} onClick={() => void commit()}>
              <GitCommit className="size-3.5" /> {t("pnlx.diff.commit")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
