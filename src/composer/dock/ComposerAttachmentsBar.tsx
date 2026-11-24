import { Paperclip, X } from "lucide-react"

export interface ComposerAttachment {
  id: string
  name: string
  content: string
}

interface ComposerAttachmentsBarProps {
  attachments: ComposerAttachment[]
  onRemoveAttachment?: (id: string) => void
}

export function ComposerAttachmentsBar({ attachments, onRemoveAttachment }: ComposerAttachmentsBarProps) {
  if (attachments.length === 0) return null

  return (
    <div className="ade-attachment-row">
      {attachments.map(att => (
        <span key={att.id} className="ade-attachment-chip">
          <Paperclip className="size-3" />
          <span>{att.name}</span>
          {onRemoveAttachment ? (
            <button type="button" onClick={() => onRemoveAttachment(att.id)} aria-label={`Remove ${att.name}`}>
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}
