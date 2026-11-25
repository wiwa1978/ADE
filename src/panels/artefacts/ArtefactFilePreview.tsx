import { ExternalLink } from "lucide-react"
import { Button } from "../../../components/ui/index.ts"
import { RichFilePreview } from "../RichFilePreview"
import type { ArtefactFileEntry } from "./useArtefactsData"

interface ArtefactFilePreviewProps {
  scope: "session" | "project"
  sessionId?: string
  projectId?: string
  file: ArtefactFileEntry
  onBack: () => void
  onOpenFileTab?: (filePath: string) => void
  onMentionInChat?: (filePath: string) => void
  onSaved?: () => void
}

export function ArtefactFilePreview({
  scope,
  sessionId,
  projectId,
  file,
  onBack,
  onOpenFileTab,
  onMentionInChat,
  onSaved,
}: ArtefactFilePreviewProps) {
  const fileSessionId = scope === "session" ? sessionId : file.sessionId
  const fileProjectId = fileSessionId ? undefined : projectId

  return (
    <RichFilePreview
      sessionId={fileSessionId}
      projectId={fileProjectId}
      filePath={file.path}
      onBack={onBack}
      backLabel="All artefacts"
      onMentionInChat={scope === "session" ? onMentionInChat : undefined}
      onSaved={onSaved}
      canEdit={Boolean(fileSessionId)}
      toolbarExtra={
        scope === "session" && onOpenFileTab ? (
          <Button
            variant="chip"
            size="xs"
            onClick={() => onOpenFileTab(file.path)}
            title="Open in its own tab"
          >
            <ExternalLink className="size-3" /> Tab
          </Button>
        ) : null
      }
    />
  )
}
