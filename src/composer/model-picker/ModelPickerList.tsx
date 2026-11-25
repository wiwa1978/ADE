import type { RefObject } from "react"
import { Star } from "lucide-react"
import { Button, EmptyState, SearchInput } from "../../../components/ui/index.ts"
import type { ProviderCatalogEntry } from "../../app-types"
import { ProviderGlyph } from "../ProviderGlyph"
import { useI18n } from "../../i18n/I18nContext"
import type { FavoriteKey, ModelEntry } from "./model-favorites"

interface ModelPickerListProps {
  searchRef: RefObject<HTMLInputElement | null>
  query: string
  visibleEntries: ModelEntry[]
  selectedProvider: string
  selectedModel: string
  highlightIndex: number
  favorites: FavoriteKey[]
  activeProviderMeta: ProviderCatalogEntry | null
  onQueryChange: (value: string) => void
  onHighlight: (index: number) => void
  onPickModel: (entry: ModelEntry) => void
  onToggleFavorite: (provider: string, modelId: string) => void
  onOpenSettings?: () => void
}

export function ModelPickerList({
  searchRef,
  query,
  visibleEntries,
  selectedProvider,
  selectedModel,
  highlightIndex,
  favorites,
  activeProviderMeta,
  onQueryChange,
  onHighlight,
  onPickModel,
  onToggleFavorite,
  onOpenSettings,
}: ModelPickerListProps) {
  const { t } = useI18n()
  const emptyText = query
    ? t("wsx.comp.noModelsMatch", { query })
    : activeProviderMeta && !activeProviderMeta.configured
      ? activeProviderMeta.setupMessage || t("wsx.comp.providerNotConfigured", { name: activeProviderMeta.name })
      : t("wsx.comp.noModelsAvailable")

  return (
    <div className="ade-mp-models-col">
      <div className="ade-mp-search-wrap">
        <SearchInput
          ref={searchRef}
          value={query}
          onValueChange={onQueryChange}
          placeholder={t("wsx.comp.searchModels")}
          clearOnEscape={false}
          className="border-0 bg-transparent h-7 px-0 focus-within:ring-0"
          inputClassName="ade-mp-search-input"
        />
      </div>

      <div className="ade-mp-list" role="listbox" aria-label={t("wsx.comp.modelsAria")}>
        {visibleEntries.length === 0 ? (
          <EmptyState
            compact
            title={emptyText}
            action={
              onOpenSettings && activeProviderMeta && !activeProviderMeta.configured ? (
                <Button variant="chip" size="xs" onClick={onOpenSettings}>
                  {t("wsx.comp.configureInSettings")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          visibleEntries.map((entry, idx) => {
            const isSelected = !entry.isDefault && entry.provider === selectedProvider && entry.id === selectedModel
            const isHighlighted = idx === highlightIndex
            const isFav = favorites.includes(`${entry.provider}::${entry.id}`)
            return (
              <div
                key={`${entry.provider}:${entry.id}:${entry.isDefault ? "def" : "m"}`}
                role="option"
                aria-selected={isSelected}
                className={`ade-mp-row ${isHighlighted ? "is-highlighted" : ""} ${isSelected ? "is-selected" : ""}`}
                onMouseEnter={() => onHighlight(idx)}
                onClick={() => onPickModel(entry)}
              >
                <ProviderGlyph provider={entry.provider} size={15} />
                <span className="ade-mp-row-name ade-truncate" title={entry.name}>{entry.name}</span>
                {entry.providerLabel ? <span className="ade-mp-row-provider ade-truncate">{entry.providerLabel}</span> : null}
                <div className="ade-mp-row-right">
                  {!entry.isDefault ? (
                    <button
                      type="button"
                      className={`ade-mp-star-btn ${isFav ? "is-fav" : ""}`}
                      title={isFav ? t("wsx.comp.unpinFavorite") : t("wsx.comp.pinToFavorites")}
                      onClick={e => {
                        e.stopPropagation()
                        onToggleFavorite(entry.provider, entry.id)
                      }}
                    >
                      <Star className="size-3" fill={isFav ? "currentColor" : "none"} />
                    </button>
                  ) : null}
                  {idx < 9 ? <kbd className="ade-mp-shortcut">⌘{idx + 1}</kbd> : null}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
