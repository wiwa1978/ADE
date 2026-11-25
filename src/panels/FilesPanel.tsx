import { useEffect, useState } from "react"
import {
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
import { request, requestJson } from "../api"
import type { WorkspaceEntry } from "../app-types"
import { useI18n } from "../i18n/I18nContext"
import { RichFilePreview } from "./RichFilePreview"

function joinRelativePath(root: string, rel: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, "")
  const cleanRel = rel.replace(/^[./\\]+/, "")
  if (!cleanRel || cleanRel === ".") return cleanRoot
  return `${cleanRoot}/${cleanRel}`
}

async function openPathInEditor(app: "vscode" | "cursor", targetPath: string): Promise<void> {
  await requestJson("/api/system/open-in", "POST", { app, path: targetPath })
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
  const { t } = useI18n()
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
        if (!cancelled) setError(err instanceof Error ? err.message : t("pnlx.files.errLoadDir"))
      })
    return () => { cancelled = true }
  }, [queryParam, path, t])

  if (error) return <div className="ade-pane-note">{error}</div>
  if (!entries) return <div className="ade-pane-note">{t("pnlx.files.loading")}</div>

  const visible = filter.trim()
    ? entries.filter(e => e.kind === "directory" || e.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : entries

  if (visible.length === 0 && depth === 0) {
    return <div className="ade-pane-note">{filter.trim() ? t("pnlx.files.noMatch", { filter }) : t("pnlx.files.emptyFolder")}</div>
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
                  title={t("pnlx.files.openInVsCode", { name: entry.name })}
                  aria-label={t("pnlx.files.openInVsCode", { name: entry.name })}
                  onClick={e => { e.stopPropagation(); onOpenExternal("vscode", absPath) }}
                >
                  VS
                </button>
                <button
                  type="button"
                  className="ade-tree-action-btn"
                  title={t("pnlx.files.openInCursor", { name: entry.name })}
                  aria-label={t("pnlx.files.openInCursor", { name: entry.name })}
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
  const { t } = useI18n()
  const [filter, setFilter] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const [openError, setOpenError] = useState("")
  const [openingApp, setOpeningApp] = useState<"vscode" | "cursor" | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  const queryParam = projectId
    ? `projectId=${encodeURIComponent(projectId)}`
    : `sessionId=${encodeURIComponent(sessionId ?? "")}`
  const scopeKey = projectId ? `project:${projectId}` : `session:${sessionId ?? ""}`

  async function handleOpenIn(app: "vscode" | "cursor", absPath: string) {
    setOpenError("")
    setOpeningApp(app)
    try {
      await openPathInEditor(app, absPath)
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : t("pnlx.files.errOpenIn", { app: app === "vscode" ? "VS Code" : "Cursor" }))
    } finally {
      setOpeningApp(null)
    }
  }

  if (!workspacePath) {
    return (
      <div className="ade-pane-empty">
        <p>{projectId ? t("pnlx.files.noProjectFolder") : t("pnlx.files.noSessionWorkspace")}</p>
        {onOpenSettings ? (
          <button type="button" className="sf-btn-secondary !h-8 mt-2" onClick={onOpenSettings}>
            <Settings2 className="size-3.5" /> {t("pnlx.files.configureFolder")}
          </button>
        ) : null}
      </div>
    )
  }

  if (previewPath) {
    const absFile = joinRelativePath(workspacePath, previewPath)
    return (
      <RichFilePreview
        sessionId={sessionId}
        projectId={projectId}
        filePath={previewPath}
        onBack={() => setPreviewPath(null)}
        backLabel={t("pnlx.files.backToFiles")}
        canEdit={Boolean(sessionId)}
        toolbarExtra={
          <>
            <button
              type="button"
              className="ade-editor-pill"
              disabled={openingApp !== null}
              onClick={() => void handleOpenIn("vscode", absFile)}
              title={t("pnlx.files.openFileInVsCode")}
            >
              VS Code
            </button>
            <button
              type="button"
              className="ade-editor-pill"
              disabled={openingApp !== null}
              onClick={() => void handleOpenIn("cursor", absFile)}
              title={t("pnlx.files.openFileInCursor")}
            >
              Cursor
            </button>
          </>
        }
      />
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
          title={t("pnlx.files.openInVsCode", { name: workspacePath })}
        >
          <Code2 className="size-3.5 opacity-80" />
          <span>{openingApp === "vscode" ? t("pnlx.files.opening") : "VS Code"}</span>
          <ExternalLink className="size-3 opacity-50" />
        </button>
        <button
          type="button"
          className="ade-editor-btn"
          disabled={openingApp !== null}
          onClick={() => void handleOpenIn("cursor", workspacePath)}
          title={t("pnlx.files.openInCursor", { name: workspacePath })}
        >
          <Code2 className="size-3.5 opacity-80" />
          <span>{openingApp === "cursor" ? t("pnlx.files.opening") : "Cursor"}</span>
          <ExternalLink className="size-3 opacity-50" />
        </button>
      </div>

      {openError ? <div className="ade-pane-note text-rose-400">{openError}</div> : null}

      <div className="ade-pane-toolbar">
        <div className="ade-search-box flex-1">
          <Search className="size-3.5 opacity-60" />
          <input
            type="text"
            placeholder={t("pnlx.files.filterPlaceholder")}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <button type="button" className="ade-icon-btn" onClick={() => setRefreshKey(k => k + 1)} title={t("pnlx.files.refreshFiles")} aria-label={t("pnlx.files.refreshFiles")}>
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
