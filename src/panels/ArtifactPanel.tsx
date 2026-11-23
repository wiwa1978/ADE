import type { SessionArtifact, TimelineItem, WorkspaceGitSummary } from "../../app-types"
import { ArtefactsBrowserPanel } from "./ArtefactsBrowserPanel"

export function ArtifactPanel({
  sessionId,
  workspacePath,
  artifacts,
  activeArtifactId,
  gitSummary,
  timelineItems,
  onSelectArtifact,
  onReview,
  onOpenFileTab,
  onMentionInChat,
  onSaved,
}: {
  sessionId?: string
  workspacePath?: string | null
  artifacts: SessionArtifact[]
  activeArtifactId?: string
  gitSummary?: WorkspaceGitSummary
  timelineItems?: TimelineItem[]
  onSelectArtifact: (id: string | undefined) => void
  onReview: (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => Promise<void>
  onOpenFileTab?: (filePath: string) => void
  onMentionInChat?: (filePath: string) => void
  onSaved?: () => void
}) {
  return (
    <ArtefactsBrowserPanel
      scope="session"
      sessionId={sessionId}
      workspacePath={workspacePath}
      artifacts={artifacts}
      activeArtifactId={activeArtifactId}
      gitSummary={gitSummary}
      timelineItems={timelineItems}
      onSelectArtifact={onSelectArtifact}
      onReview={onReview}
      onOpenFileTab={onOpenFileTab}
      onMentionInChat={onMentionInChat}
      onSaved={onSaved}
    />
  )
}
