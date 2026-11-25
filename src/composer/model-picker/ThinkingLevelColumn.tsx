import { Check } from "lucide-react"
import { THINKING_LEVELS } from "./model-favorites"
import { useI18n } from "../../i18n/I18nContext"
import type { TranslationKey } from "../../i18n"

const LEVEL_KEYS: Record<string, TranslationKey> = {
  none: "wsx.comp.thinkingOff",
  low: "wsx.comp.thinkingLow",
  medium: "wsx.comp.thinkingMedium",
  high: "wsx.comp.thinkingHigh",
  xhigh: "wsx.comp.thinkingXHigh",
  max: "wsx.comp.thinkingMax",
}

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
  const { t } = useI18n()
  return (
    <div className="ade-mp-thinking-col" aria-label={t("wsx.comp.thinkingLevelAria")}>
      <div className="ade-mp-thinking-head">
        <span>{t("wsx.comp.thinkingHeader")}</span>
        <span className="ade-mp-thinking-model ade-truncate" title={headerTitle}>
          {headerModelName}
        </span>
      </div>
      <div className="ade-mp-thinking-list">
        {THINKING_LEVELS.map(level => {
          const active = effectiveReasoning === level.value
          const key = LEVEL_KEYS[level.value]
          return (
            <button
              key={level.value}
              type="button"
              className={`ade-mp-thinking-row ${active ? "is-selected" : ""}`}
              aria-pressed={active}
              onClick={() => onSelectReasoning(level.value)}
            >
              <span>{key ? t(key) : level.label}</span>
              {active ? <Check className="size-3.5 text-[rgb(var(--primary))]" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
