import { useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen, RefreshCw, Search } from "lucide-react"
import { request } from "../../api"
import type { WorkspaceEntry } from "../../app-types"

function DirectoryBranch({
  sessionId,
  path,
  depth,
  filter,
  onOpenFile,
}: {
  sessionId: string
  path: string
  depth: number
  filter: string
  onOpenFile: (filePath: string) => void
}) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await request<{ entries: WorkspaceEntry[] }>(
        `/api/workspace/tree?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
      )
      setEntries(res.entries)
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load directory")
    }
  }, [sessionId, path])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <div className="ade-pane-note">{error}</div>
  if (!entries) return <div className="ade-pane-note">Loading…</div>

  const visible = filter.trim()
    ? entries.filter(e => e.kind === "directory" || e.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : entries

  return (
    <div className="ade-tree-list">
      {visible.map(entry => {
        const isOpen = Boolean(expanded[entry.path])
        return (
          <div key={entry.path}>
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
              <span className="ade-truncate">{entry.name}</span>
            </button>
            {entry.kind === "directory" && isOpen ? (
              <DirectoryBranch sessionId={sessionId} path={entry.path} depth={depth + 1} filter={filter} onOpenFile={onOpenFile} />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function FilesPanel({
  sessionId,
  workspacePath,
  onOpenFile,
}: {
  sessionId: string
  workspacePath: string | null
  onOpenFile: (path: string) => void
}) {
  const [filter, setFilter] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)

  if (!workspacePath) {
    return (
      <div className="ade-pane-empty">
        <p>This session has no bound local workspace.</p>
      </div>
    )
  }

  return (
    <div className="ade-pane-body">
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
        <button type="button" className="ade-icon-btn" onClick={() => setRefreshKey(k => k + 1)} title="Refresh files">
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div className="ade-pane-subpath ade-truncate" title={workspacePath}>{workspacePath}</div>
      <div className="ade-pane-scroll">
        <DirectoryBranch key={`${sessionId}:${refreshKey}`} sessionId={sessionId} path="." depth={0} filter={filter} onOpenFile={onOpenFile} />
      </div>
    </div>
  )
}
