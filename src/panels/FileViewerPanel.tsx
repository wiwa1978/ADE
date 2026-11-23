import { RichFilePreview } from "./RichFilePreview"

export function FileViewerPanel({
  sessionId,
  filePath,
  onMentionInChat,
  onSaved,
}: {
  sessionId: string
  filePath: string
  onMentionInChat?: (filePath: string) => void
  onSaved?: () => void
}) {
  return (
    <RichFilePreview
      sessionId={sessionId}
      filePath={filePath}
      onMentionInChat={onMentionInChat}
      onSaved={onSaved}
      canEdit
    />
  )
}
