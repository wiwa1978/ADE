import { Sparkles } from "lucide-react"

/**
 * Shared centered empty-state hero used by both active conversations (TimelineView)
 * and NewSessionView so visual changes stay consistent across both screens.
 */
export function WorkspaceEmptyHero({
  title,
  subtitle,
  editableTitle,
}: {
  title: string
  subtitle: string
  editableTitle?: {
    value: string
    placeholder: string
    ariaLabel: string
    maxLength?: number
    onChange: (value: string) => void
  }
}) {
  return (
    <div className="ade-timeline-empty">
      <div className="ade-empty-badge">
        <Sparkles className="size-4" />
      </div>
      {editableTitle ? (
        <input
          type="text"
          className="ade-empty-title-input"
          value={editableTitle.value}
          placeholder={editableTitle.placeholder}
          aria-label={editableTitle.ariaLabel}
          maxLength={editableTitle.maxLength ?? 120}
          onChange={e => editableTitle.onChange(e.target.value)}
        />
      ) : (
        <h3>{title}</h3>
      )}
      <p>{subtitle}</p>
    </div>
  )
}
