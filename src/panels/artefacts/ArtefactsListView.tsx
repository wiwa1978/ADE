import { FileCode2, FileImage, FileText, Layers, RefreshCw, Sparkles } from "lucide-react"
import { Badge, Banner, EmptyState, IconButton, SearchInput, Spinner } from "../../../components/ui/index.ts"
import {
  formatFileSize,
  getFilePreviewKind,
  type ArtefactFilterBucket,
} from "../file-preview-utils"
import { splitDirAndName, type ArtefactFileEntry, type EnrichedSessionArtifact } from "./useArtefactsData"

function fileIcon(path: string, mimeType?: string) {
  const kind = getFilePreviewKind(path, mimeType)
  if (kind === "image" || kind === "svg") return <FileImage className="size-3.5 shrink-0 text-[var(--accent)]" />
  if (kind === "code") return <FileCode2 className="size-3.5 shrink-0 opacity-80" />
  return <FileText className="size-3.5 shrink-0 opacity-80" />
}

interface ArtefactsListViewProps {
  scope: "session" | "project"
  query: string
  bucket: ArtefactFilterBucket
  counts: { all: number; plans: number; docs: number; code: number; images: number }
  loading: boolean
  error: string
  totalCount: number
  filteredArtifacts: EnrichedSessionArtifact[]
  filteredFiles: ArtefactFileEntry[]
  onQueryChange: (value: string) => void
  onBucketChange: (bucket: ArtefactFilterBucket) => void
  onRefresh: () => void
  onSelectArtifact: (id: string) => void
  onSelectFile: (file: ArtefactFileEntry) => void
}

export function ArtefactsListView({
  scope,
  query,
  bucket,
  counts,
  loading,
  error,
  totalCount,
  filteredArtifacts,
  filteredFiles,
  onQueryChange,
  onBucketChange,
  onRefresh,
  onSelectArtifact,
  onSelectFile,
}: ArtefactsListViewProps) {
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
        <SearchInput
          className="flex-1"
          placeholder={scope === "project" ? "Filter project artefacts…" : "Filter session artefacts…"}
          value={query}
          onValueChange={onQueryChange}
          aria-label={scope === "project" ? "Filter project artefacts" : "Filter session artefacts"}
        />
        <IconButton aria-label="Refresh artefacts" title="Refresh artefacts" onClick={onRefresh}>
          <RefreshCw className="size-3.5" />
        </IconButton>
      </div>

      <div className="ade-artefacts-filters" role="tablist" aria-label="Artefact type filter">
        {filterTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={bucket === tab.id}
            className={`ade-chip-btn ${bucket === tab.id ? "is-active" : ""}`}
            onClick={() => onBucketChange(tab.id)}
          >
            <span>{tab.label}</span>
            <span className="ade-count-badge">{tab.count}</span>
          </button>
        ))}
      </div>

      {error ? <Banner tone="error" className="mx-3 mt-2">{error}</Banner> : null}

      <div className="ade-pane-scroll ade-artefacts-list-scroll">
        {loading && totalCount === 0 ? (
          <div className="ade-pane-note">
            <Spinner size="xs" label="Loading artefacts…" />
          </div>
        ) : isEmpty ? (
          <EmptyState
            compact
            icon={<Layers className="size-5 opacity-60" />}
            title={query || bucket !== "all" ? "No artefacts match this filter." : scope === "project" ? "No project artefacts yet." : "No artefacts yet in this session."}
            description={
              scope === "project"
                ? "Files created in this project (.txt, .py, .md, .jpg, etc.) and plans from its sessions will appear here."
                : "Files created by the agent (.txt, .py, .md, .jpg, etc.) or plans from /plan will appear here."
            }
          />
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
                    onClick={() => onSelectArtifact(art.id)}
                  >
                    <Sparkles className="size-3.5 shrink-0 text-[var(--accent)]" />
                    <div className="ade-artefact-row-main">
                      <span className="ade-artefact-row-name ade-truncate">{art.title}</span>
                      <span className="ade-artefact-row-meta ade-truncate">
                        {art.sessionLabel ? `${art.sessionLabel} · ` : ""}{art.kind}
                      </span>
                    </div>
                    <Badge tone={art.status === "approved" ? "ok" : art.status === "awaiting_approval" ? "warn" : "neutral"}>
                      {art.status.replace("_", " ")}
                    </Badge>
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
                  const gitTone = file.gitStatus === "untracked" || file.gitStatus === "added" || file.gitStatus === "created" ? "ok" : "warn"
                  return (
                    <button
                      key={`${file.sessionId ?? "repo"}:${file.path}`}
                      type="button"
                      className="ade-artefact-row"
                      onClick={() => onSelectFile(file)}
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
                          <Badge tone={gitTone}>{file.gitStatus === "untracked" ? "new" : file.gitStatus}</Badge>
                        ) : null}
                        <Badge className="font-mono">{extLabel}</Badge>
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
