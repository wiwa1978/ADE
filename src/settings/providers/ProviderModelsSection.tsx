import { Check } from "lucide-react"
import { useI18n } from "../../i18n/I18nContext"
import type { UnifiedProviderItem } from "./provider-overrides"

export function ProviderModelsSection({
  item,
  selectedProvider,
  selectedModel,
  isDefaultProvider,
  reasoning,
  reasoningLevels,
  onSelectDefaultModel,
  onSelectReasoning,
}: {
  item: UnifiedProviderItem
  selectedProvider: string
  selectedModel: string
  isDefaultProvider: boolean
  reasoning: string
  reasoningLevels: { id: string; label: string }[]
  onSelectDefaultModel: (providerId: string, modelId: string) => void
  onSelectReasoning: (level: string) => void
}) {
  const { t } = useI18n()
  if (item.models.length === 0) return null

  return (
    <div className="st-prov-section">
      <div className="st-prov-section-title">{t("prov.models")}</div>
      <div className="st-prov-models-grid">
        {item.models.map(m => {
          const isSelected = selectedProvider === item.id && selectedModel === m.id
          return (
            <button
              key={m.id}
              type="button"
              className={`st-prov-model-chip ${isSelected ? "is-active" : ""}`}
              onClick={() => onSelectDefaultModel(item.id, m.id)}
            >
              <span className="truncate">{m.name}</span>
              {isSelected ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
            </button>
          )
        })}
      </div>
      {isDefaultProvider ? (
        <div className="st-prov-field-row mt-2">
          <div className="st-prov-field-text">
            <label htmlFor="prov-reasoning">{t("prov.reasoningEffort")}</label>
            <p>{t("prov.reasoningHint")}</p>
          </div>
          <select
            id="prov-reasoning"
            className="st-select"
            aria-label={t("prov.reasoningAria")}
            value={reasoning === "off" ? "none" : reasoning}
            onChange={e => onSelectReasoning(e.target.value)}
          >
            {reasoningLevels.map(level => (
              <option key={level.id} value={level.id}>{level.label}</option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  )
}
