import { useEffect, useState } from "react"
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react"
import { request } from "../../api"
import type { WorkspaceEntry } from "../../app-types"

function joinRelativePath(root: string, rel: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, "")
  const cleanRel = rel.replace(/^[./\\]+/, "")
  if (!cleanRel || cleanRel === ".") return cleanRoot
  return `${cleanRoot}/${cleanRel}`
}

async function openPathInEditor(app: "vscode" | "cursor", targetPath: string): Promise<void> {
  await request("/api/system/open-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app, path: targetPath }),
  })
}

function DirectoryBranch({
  queryParam,
  workspacePath,
  path,
  depth,
  filter,
  onOpenFile,
  onOpenExternal,
}: {
  queryParam: string
  workspacePath: string
  path: string
  depth: number
  filter: string
  onOpenFile: (filePath: string) => void
  onOpenExternal: (app: "vscode" | "cursor", absPath: string) => void
}) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    void request<{ entries: WorkspaceEntry[] }>(
      `/api/workspace/tree?${queryParam}&path=${encodeURIComponent(path)}`,
    )
      .then(res => {
        if (!cancelled) {
          setEntries(res.entries)
          setError("")
        }
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load directory")
      })
    return () => { cancelled = true }
  }, [queryParam, path])

  if (error) return <div className="ade-pane-note">{error}</div>
  if (!entries) return <div className="ade-pane-note">Loading…</div>

  const visible = filter.trim()
    ? entries.filter(e => e.kind === "directory" || e.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : entries

  if (visible.length === 0 && depth === 0) {
    return <div className="ade-pane-note">{filter.trim() ? `No files match “${filter}”.` : "This folder is empty."}</div>
  }

  return (
    <div className="ade-tree-list">
      {visible.map(entry => {
        const isOpen = Boolean(expanded[entry.path])
        const absPath = joinRelativePath(workspacePath, entry.path)
        return (
          <div key={entry.path}>
            <div className="ade-tree-item-wrap">
              <button
                type="button"
                className="ade-tree-row"
                style={{ paddingLeft: `${10 + depth * 14}px` }}
                onClick={() => {
                  if (entry.kind === "directory") {
                    setExpanded(prev => ({ ...prev, [entry.path]: !prev[entry.path] }))
                  } else {
                    onOpenFile(entry.path)
                  }
                }}
              >
                {entry.kind === "directory" ? (
                  <>
                    {isOpen ? <ChevronDown className="size-3.5 shrink-0 opacity-60" /> : <ChevronRight className="size-3.5 shrink-0 opacity-60" />}
                    {isOpen ? <FolderOpen className="size-3.5 shrink-0 text-[var(--accent)]" /> : <Folder className="size-3.5 shrink-0 opacity-75" />}
                  </>
                ) : (
                  <>
                    <span className="size-3.5 shrink-0" />
                    <FileCode2 className="size-3.5 shrink-0 opacity-70" />
                  </>
                )}
                <span className="ade-truncate flex-1">{entry.name}</span>
              </button>
              <div className="ade-tree-row-actions">
                <button
                  type="button"
                  className="ade-tree-action-btn"
                  title={`Open ${entry.name} in VS Code`}
                  aria-label={`Open ${entry.name} in VS Code`}
                  onClick={e => { e.stopPropagation(); onOpenExternal("vscode", absPath) }}
                >
                  VS
                </button>
                <button
                  type="button"
                  className="ade-tree-action-btn"
                  title={`Open ${entry.name} in Cursor`}
                  aria-label={`Open ${entry.name} in Cursor`}
                  onClick={e => { e.stopPropagation(); onOpenExternal("cursor", absPath) }}
                >
                  Cu
                </button>
              </div>
            </div>
            {entry.kind === "directory" && isOpen ? (
              <DirectoryBranch
                queryParam={queryParam}
                workspacePath={workspacePath}
                path={entry.path}
                depth={depth + 1}
                filter={filter}
                onOpenFile={onOpenFile}
                onOpenExternal={onOpenExternal}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function FilesPanel({
  sessionId,
  projectId,
  workspacePath,
  onOpenFile,
  onOpenSettings,
}: {
  sessionId?: string
  projectId?: string
  workspacePath: string | null
  onOpenFile?: (path: string) => void
  onOpenSettings?: () => void
}) {
  const [filter, setFilter] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const [openError, setOpenError] = useState("")
  const [openingApp, setOpeningApp] = useState<"vscode" | "cursor" | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<{ path: string; content: string; error: string } | null>(null)

  const queryParam = projectId
    ? `projectId=${encodeURIComponent(projectId)}`
    : `sessionId=${encodeURIComponent(sessionId ?? "")}`
  const scopeKey = projectId ? `project:${projectId}` : `session:${sessionId ?? ""}`

  useEffect(() => {
    if (!previewPath || !workspacePath) return
    let cancelled = false
    const target = previewPath
    void request<{ content: string }>(
      `/api/workspace/file?${queryParam}&path=${encodeURIComponent(target)}`,
    )
      .then(res => {
        if (!cancelled) setPreviewResult({ path: target, content: res.content, error: "" })
      })
      .catch(err => {
        if (!cancelled) {
          setPreviewResult({ path: target, content: "", error: err instanceof Error ? err.message : "Could not read file." })
        }
      })
    return () => { cancelled = true }
  }, [previewPath, queryParam, workspacePath])

  const previewLoading = Boolean(previewPath && previewResult?.path !== previewPath)
  const previewError = previewResult?.path === previewPath ? previewResult.error : ""
  const previewContent = previewResult?.path === previewPath ? previewResult.content : ""

  async function handleOpenIn(app: "vscode" | "cursor", absPath: string) {
    setOpenError("")
    setOpeningApp(app)
    try {
      await openPathInEditor(app, absPath)
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : `Could not open in ${app === "vscode" ? "VS Code" : "Cursor"}.`)
    } finally {
      setOpeningApp(null)
    }
  }

  if (!workspacePath) {
    return (
      <div className="ade-pane-empty">
        <p>{projectId ? "No local folder linked to this project yet." : "This session has no bound local workspace."}</p>
        {onOpenSettings ? (
          <button type="button" className="sf-btn-secondary !h-8 mt-2" onClick={onOpenSettings}>
            <Settings2 className="size-3.5" /> Configure folder
          </button>
        ) : null}
      </div>
    )
  }

  if (previewPath) {
    const absFile = joinRelativePath(workspacePath, previewPath)
    return (
      <div className="ade-pane-body">
        <div className="ade-pane-toolbar">
          <button type="button" className="sf-btn-ghost !h-7 !px-2 !text-[12px]" onClick={() => setPreviewPath(null)}>
            <ArrowLeft className="size-3.5" /> Files
          </button>
          <span className="ade-truncate flex-1 font-mono text-[11.5px] opacity-75" title={previewPath}>
            {previewPath}
          </span>
          <button
            type="button"
            className="ade-editor-pill"
            disabled={openingApp !== null}
            onClick={() => void handleOpenIn("vscode", absFile)}
            title="Open file in VS Code"
          >
            VS Code
          </button>
          <button
            type="button"
            className="ade-editor-pill"
            disabled={openingApp !== null}
            onClick={() => void handleOpenIn("cursor", absFile)}
            title="Open file in Cursor"
          >
            Cursor
          </button>
        </div>
        {openError ? <div className="ade-pane-note text-rose-400">{openError}</div> : null}
        <div className="ade-pane-scroll">
          {previewLoading ? (
            <div className="ade-pane-note">Loading file…</div>
          ) : previewError ? (
            <div className="ade-pane-note text-rose-400">{previewError}</div>
          ) : (
            <pre className="ade-file-preview-code">{previewContent}</pre>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ade-pane-body">
      <div className="ade-editor-bar">
        <button
          type="button"
          className="ade-editor-btn"
          disabled={openingApp !== null}
          onClick={() => void handleOpenIn("vscode", workspacePath)}
          title={`Open ${workspacePath} in VS Code`}
        >
          <Code2 className="size-3.5 opacity-80" />
          <span>{openingApp === "vscode" ? "Opening…" : "VS Code"}</span>
          <ExternalLink className="size-3 opacity-50" />
        </button>
        <button
          type="button"
          className="ade-editor-btn"
          disabled={openingApp !== null}
          onClick={() => void handleOpenIn("cursor", workspacePath)}
          title={`Open ${workspacePath} in Cursor`}
        >
          <Code2 className="size-3.5 opacity-80" />
          <span>{openingApp === "cursor" ? "Opening…" : "Cursor"}</span>
          <ExternalLink className="size-3 opacity-50" />
        </button>
      </div>

      {openError ? <div className="ade-pane-note text-rose-400">{openError}</div> : null}

      <div className="ade-pane-toolbar">
        <div className="ade-search-box flex-1">
          <Search className="size-3.5 opacity-60" />
          <input
            type="text"
            placeholder="Filter files…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <button type="button" className="ade-icon-btn" onClick={() => setRefreshKey(k => k + 1)} title="Refresh files" aria-label="Refresh files">
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div className="ade-pane-subpath ade-truncate" title={workspacePath}>{workspacePath}</div>
      <div className="ade-pane-scroll">
        <DirectoryBranch
          key={`${scopeKey}:${refreshKey}`}
          queryParam={queryParam}
          workspacePath={workspacePath}
          path="."
          depth={0}
          filter={filter}
          onOpenFile={filePath => {
            if (onOpenFile) onOpenFile(filePath)
            else setPreviewPath(filePath)
          }}
          onOpenExternal={(app, absPath) => void handleOpenIn(app, absPath)}
        />
      </div>
    </div>
  )
}
