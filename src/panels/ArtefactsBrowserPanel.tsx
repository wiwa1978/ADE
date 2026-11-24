import { useMemo, useState } from "react"
import type { SessionArtifact, TimelineItem, WorkspaceGitSummary } from "../../app-types"
import type { ArtefactFilterBucket } from "./file-preview-utils"
import { ArtefactFilePreview } from "./artefacts/ArtefactFilePreview"
import { ArtefactsListView } from "./artefacts/ArtefactsListView"
import { SessionArtifactPreview } from "./artefacts/SessionArtifactPreview"
import { useArtefactsData, type ArtefactFileEntry, type EnrichedSessionArtifact } from "./artefacts/useArtefactsData"

export type { ArtefactFileEntry, EnrichedSessionArtifact }

type SelectedItem =
  | { kind: "artifact"; artifact: EnrichedSessionArtifact }
  | { kind: "file"; file: ArtefactFileEntry }

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
  const [query, setQuery] = useState("")
  const [bucket, setBucket] = useState<ArtefactFilterBucket>("all")
  const [selectedFile, setSelectedFile] = useState<ArtefactFileEntry | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | undefined>(activeArtifactId)

  const scopeKey = scope === "project" ? `project:${projectId ?? ""}` : `session:${sessionId ?? ""}`
  const [prevScopeKey, setPrevScopeKey] = useState(scopeKey)
  if (scopeKey !== prevScopeKey) {
    setPrevScopeKey(scopeKey)
    setSelectedFile(null)
    setSelectedArtifactId(activeArtifactId)
    setQuery("")
    setBucket("all")
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

  const data = useArtefactsData({
    scope,
    sessionId,
    projectId,
    workspacePath,
    liveArtifacts,
    gitSummary,
    timelineItems,
    query,
    bucket,
  })

  const selectedArtifact = useMemo(
    () => (selectedArtifactId ? data.allArtifacts.find(a => a.id === selectedArtifactId) ?? null : null),
    [data.allArtifacts, selectedArtifactId],
  )

  const selected: SelectedItem | null = selectedFile
    ? { kind: "file", file: selectedFile }
    : selectedArtifact
      ? { kind: "artifact", artifact: selectedArtifact }
      : null

  if (selected?.kind === "file") {
    return (
      <ArtefactFilePreview
        scope={scope}
        sessionId={sessionId}
        projectId={projectId}
        file={selected.file}
        onBack={() => setSelectedFile(null)}
        onOpenFileTab={onOpenFileTab}
        onMentionInChat={onMentionInChat}
        onSaved={onSaved}
      />
    )
  }

  if (selected?.kind === "artifact") {
    return (
      <SessionArtifactPreview
        scope={scope}
        artifact={selected.artifact}
        allArtifacts={data.allArtifacts}
        workspacePath={workspacePath}
        onBack={() => {
          setSelectedArtifactId(undefined)
          onSelectArtifact?.(undefined)
        }}
        onSelectArtifact={id => {
          setSelectedArtifactId(id)
          onSelectArtifact?.(id)
        }}
        onOpenFile={setSelectedFile}
        onOpenSession={onOpenSession}
        onReview={onReview}
      />
    )
  }

  return (
    <ArtefactsListView
      scope={scope}
      query={query}
      bucket={bucket}
      counts={data.counts}
      loading={data.loading}
      error={data.error}
      totalCount={data.allArtifacts.length + data.allFiles.length}
      filteredArtifacts={data.filteredArtifacts}
      filteredFiles={data.filteredFiles}
      onQueryChange={setQuery}
      onBucketChange={setBucket}
      onRefresh={() => void data.reload()}
      onSelectArtifact={id => {
        setSelectedArtifactId(id)
        onSelectArtifact?.(id)
      }}
      onSelectFile={setSelectedFile}
    />
  )
}
