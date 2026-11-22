import { useCallback, useEffect, useState } from "react"
import { Check, FileCode2, GitCommit, Minus, Plus, RefreshCw, RotateCcw } from "lucide-react"
import { request } from "../../api"
import type { WorkspaceGitSummary } from "../../app-types"

type BranchFile = { path: string; additions: number; deletions: number; status: "added" | "modified" | "deleted" | "renamed" }

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
  // "working" = uncommitted changes (stage/commit); "branch" = everything this session changed since its base commit.
  const [mode, setMode] = useState<"working" | "branch">("working")
  const [branchFiles, setBranchFiles] = useState<BranchFile[] | null>(null)

  const loadBranchFiles = useCallback(async () => {
    try {
      const res = await request<{ files: BranchFile[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/branch-diff`)
      setBranchFiles(res.files)
    } catch (err) {
      setBranchFiles([])
      setError(err instanceof Error ? err.message : "Could not load the branch diff.")
    }
  }, [sessionId])

  useEffect(() => {
    if (mode === "branch") void loadBranchFiles()
  }, [mode, loadBranchFiles, summary])

  const activeFile = summary.files.find(f => f.path === selectedPath) ?? summary.files[0] ?? null
  const activeBranchFile = branchFiles?.find(f => f.path === selectedPath) ?? branchFiles?.[0] ?? null

  const loadDiff = useCallback(async () => {
    const path = mode === "branch" ? activeBranchFile?.path : activeFile?.path
    if (!path) {
      setDiffText("")
      return
    }
    try {
      const res = await request<{ diff: string }>(mode === "branch"
        ? `/api/sessions/${encodeURIComponent(sessionId)}/branch-diff/file?path=${encodeURIComponent(path)}`
        : `/api/workspace/git/diff?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}&staged=${showStaged && activeFile?.staged ? "true" : "false"}`)
      setDiffText(res.diff)
    } catch {
      setDiffText("")
    }
  }, [sessionId, mode, activeFile, activeBranchFile, showStaged])

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stage")
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unstage")
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to discard changes")
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
        await request("/api/workspace/git/stage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, paths: [] }),
        })
      }
      const res = await request<{ commit: { hash: string } }>("/api/workspace/git/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message: commitMessage }),
      })
      setCommitMessage("")
      setNotice(`Committed ${res.commit.hash}`)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed.")
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

  const diffLines = diffText ? diffText.replace(/\n$/, "").split("\n") : []
  const stagedCount = summary.files.filter(f => f.staged).length
  const modeToggle = (
    <div className="ade-segmented" role="tablist" aria-label="Diff scope">
      <button type="button" role="tab" aria-selected={mode === "working"} className={mode === "working" ? "is-active" : ""} onClick={() => { setMode("working"); setSelectedPath(null) }}>
        Uncommitted{summary.files.length ? ` · ${summary.files.length}` : ""}
      </button>
      <button type="button" role="tab" aria-selected={mode === "branch"} className={mode === "branch" ? "is-active" : ""} onClick={() => { setMode("branch"); setSelectedPath(null) }}>
        All branch changes{branchFiles?.length ? ` · ${branchFiles.length}` : ""}
      </button>
    </div>
  )
  const renderDiff = () => (
    <div className="ade-diff-code">
      {diffLines.length === 0 ? (
        <div className="ade-pane-note">No diff lines to show.</div>
      ) : (
        diffLines.map((line, i) => {
          const cls = line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")
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
  )

  if (mode === "branch") {
    return (
      <div className="ade-pane-body">
        <div className="ade-pane-toolbar">
          {modeToggle}
          <div className="ade-toolbar-actions">
            <button type="button" className="ade-icon-btn" onClick={() => void loadBranchFiles()} title="Refresh branch diff" aria-label="Refresh branch diff">
              <RefreshCw className="size-3.5" />
            </button>
          </div>
        </div>
        {error ? <div className="ade-banner-error">{error}</div> : null}
        {branchFiles === null ? <div className="ade-pane-empty"><p>Loading branch changes…</p></div>
          : branchFiles.length === 0 ? <div className="ade-pane-empty"><p>No changes on <code>{summary.branch || "HEAD"}</code> since the session started.</p></div>
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
            <Plus className="size-3" /> Stage all
          </button>
          <button type="button" className="ade-icon-btn" onClick={onRefresh} title="Refresh Git status" aria-label="Refresh Git status">
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
            {renderDiff()}
          </div>

          <div className="ade-commit-bar">
            <input
              type="text"
              className="ade-input-sm flex-1"
              placeholder={stagedCount ? `Commit ${stagedCount} staged file${stagedCount === 1 ? "" : "s"}…` : "Commit all changes…"}
              aria-label="Commit message"
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void commit() }}
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
