import { useCallback, useEffect, useState } from "react"
import { Check, FileCode2, GitBranch, GitCommit, Minus, Plus, RefreshCw, RotateCcw } from "lucide-react"
import { request } from "../../api"
import type { WorkspaceGitSummary } from "../../app-types"

export function DiffPanel({
  sessionId,
  summary,
  onRefresh,
  onOpenFile,
}: {
  sessionId: string
  summary: WorkspaceGitSummary
  onRefresh: () => void
  onOpenFile?: (path: string) => void
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [showStaged, setShowStaged] = useState(false)
  const [diffText, setDiffText] = useState("")
  const [commitMessage, setCommitMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const activeFile = summary.files.find(f => f.path === selectedPath) ?? summary.files[0] ?? null

  const loadDiff = useCallback(async () => {
    if (!activeFile) {
      setDiffText("")
      return
    }
    try {
      const res = await request<{ diff: string }>(
        `/api/workspace/git/diff?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(activeFile.path)}&staged=${showStaged && activeFile.staged ? "true" : "false"}`,
      )
      setDiffText(res.diff)
    } catch {
      setDiffText("")
    }
  }, [sessionId, activeFile, showStaged])

  useEffect(() => {
    void loadDiff()
  }, [loadDiff])

  const stage = async (paths: string[]) => {
    setBusy(true)
    setError("")
    try {
      await request("/api/workspace/git/stage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, paths }),
      })
      onRefresh()
    } catch (err: any) {
      setError(err?.message || "Failed to stage")
    } finally {
      setBusy(false)
    }
  }

  const unstage = async (paths: string[]) => {
    setBusy(true)
    setError("")
    try {
      await request("/api/workspace/git/unstage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, paths }),
      })
      onRefresh()
    } catch (err: any) {
      setError(err?.message || "Failed to unstage")
    } finally {
      setBusy(false)
    }
  }

  const discard = async (path: string) => {
    if (!confirm(`Discard unstaged changes in ${path}?`)) return
    setBusy(true)
    setError("")
    try {
      await request("/api/workspace/git/discard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, path }),
      })
      onRefresh()
    } catch (err: any) {
      setError(err?.message || "Failed to discard changes")
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
      const res = await request<{ commit: { hash: string } }>("/api/workspace/git/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message: commitMessage }),
      })
      setCommitMessage("")
      setNotice(`Committed ${res.commit.hash}`)
      onRefresh()
    } catch (err: any) {
      setError(err?.message || "Commit failed (stage files first).")
    } finally {
      setBusy(false)
    }
  }

  if (!summary.isGitRepo) {
    return (
      <div className="ade-pane-empty">
        <p>No Git repository is attached to this session.</p>
      </div>
    )
  }

  const diffLines = diffText ? diffText.split("\n") : []

  return (
    <div className="ade-pane-body">
      <div className="ade-pane-toolbar">
        <div className="ade-diff-header-meta">
          <span className="ade-pill ade-mono"><GitBranch className="size-3" /> {summary.branch || "HEAD"}</span>
          <span className="ade-diff-add">+{summary.additions}</span>
          <span className="ade-diff-del">-{summary.deletions}</span>
          <span className="ade-muted ade-xs">{summary.files.length} changed</span>
        </div>
        <div className="ade-toolbar-actions">
          <button type="button" className="ade-chip-btn" disabled={busy || !summary.files.length} onClick={() => void stage([])}>
            <Plus className="size-3" /> Stage all
          </button>
          <button type="button" className="ade-icon-btn" onClick={onRefresh} title="Refresh Git status">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {error ? <div className="ade-banner-error">{error}</div> : null}
      {notice ? <div className="ade-banner-ok"><Check className="size-3.5" /> {notice}</div> : null}

      {summary.files.length === 0 ? (
        <div className="ade-pane-empty">
          <p>Working tree is clean on <code>{summary.branch || "HEAD"}</code>.</p>
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
                  {file.staged ? <span className="ade-pill ade-pill-ok">staged</span> : null}
                  {file.additions > 0 ? <span className="ade-diff-add">+{file.additions}</span> : null}
                  {file.deletions > 0 ? <span className="ade-diff-del">-{file.deletions}</span> : null}
                  <div className="ade-diff-file-actions" onClick={e => e.stopPropagation()}>
                    {onOpenFile ? (
                      <button type="button" className="ade-icon-btn" onClick={() => onOpenFile(file.path)} title="Open file">
                        <FileCode2 className="size-3" />
                      </button>
                    ) : null}
                    {file.unstaged ? (
                      <button type="button" className="ade-icon-btn" onClick={() => void stage([file.path])} title="Stage file">
                        <Plus className="size-3" />
                      </button>
                    ) : null}
                    {file.staged ? (
                      <button type="button" className="ade-icon-btn" onClick={() => void unstage([file.path])} title="Unstage file">
                        <Minus className="size-3" />
                      </button>
                    ) : null}
                    {file.unstaged && file.status !== "untracked" ? (
                      <button type="button" className="ade-icon-btn" onClick={() => void discard(file.path)} title="Discard unstaged changes">
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
                    {showStaged ? "Showing staged" : "Showing unstaged"}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="ade-diff-code">
              {diffLines.length === 0 ? (
                <div className="ade-pane-note">No diff lines to show.</div>
              ) : (
                diffLines.map((line, i) => {
                  const cls = line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")
                    ? "is-meta"
                    : line.startsWith("@@")
                      ? "is-hunk"
                      : line.startsWith("+")
                        ? "is-add"
                        : line.startsWith("-")
                          ? "is-del"
                          : ""
                  return <div key={i} className={`ade-diff-line ${cls}`}>{line || " "}</div>
                })
              )}
            </div>
          </div>

          <div className="ade-commit-bar">
            <input
              type="text"
              className="ade-input-sm flex-1"
              placeholder="Commit staged changes…"
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commit() }}
            />
            <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={busy || !commitMessage.trim()} onClick={() => void commit()}>
              <GitCommit className="size-3.5" /> Commit
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
