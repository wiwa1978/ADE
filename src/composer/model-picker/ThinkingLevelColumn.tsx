import { Check } from "lucide-react"
import { THINKING_LEVELS } from "./model-favorites"

interface ThinkingLevelColumnProps {
  headerTitle: string
  headerModelName: string
  effectiveReasoning: string
  onSelectReasoning: (level: string) => void
}

export function ThinkingLevelColumn({
  headerTitle,
  headerModelName,
  effectiveReasoning,
  onSelectReasoning,
}: ThinkingLevelColumnProps) {
  return (
    <div className="ade-mp-thinking-col" aria-label="Thinking level">
      <div className="ade-mp-thinking-head">
        <span>Thinking</span>
        <span className="ade-mp-thinking-model ade-truncate" title={headerTitle}>
          {headerModelName}
        </span>
      </div>
      <div className="ade-mp-thinking-list">
        {THINKING_LEVELS.map(level => {
          const active = effectiveReasoning === level.value
          return (
            <button
              key={level.value}
              type="button"
              className={`ade-mp-thinking-row ${active ? "is-selected" : ""}`}
              aria-pressed={active}
              onClick={() => onSelectReasoning(level.value)}
            >
              <span>{level.label}</span>
              {active ? <Check className="size-3.5 text-[rgb(var(--primary))]" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
