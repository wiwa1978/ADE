import { Star } from "lucide-react"
import type { ProviderCatalogEntry } from "../../app-types"
import { ProviderGlyph } from "../ProviderGlyph"
import { useI18n } from "../../i18n/I18nContext"

interface ModelPickerProviderRailProps {
  orderedCatalog: ProviderCatalogEntry[]
  activeTab: string
  onSelectTab: (tab: string) => void
}

export function ModelPickerProviderRail({
  orderedCatalog,
  activeTab,
  onSelectTab,
}: ModelPickerProviderRailProps) {
  const { t } = useI18n()
  return (
    <nav className="ade-mp-rail" aria-label={t("wsx.comp.modelProvidersAria")}>
      <button
        type="button"
        className={`ade-mp-rail-btn ${activeTab === "favorites" ? "is-active" : ""}`}
        title={t("wsx.comp.favoritesQuickPicks")}
        onClick={() => onSelectTab("favorites")}
      >
        <Star className="size-4" fill={activeTab === "favorites" ? "currentColor" : "none"} />
      </button>
      <div className="ade-mp-rail-sep" />
      {orderedCatalog.map(p => (
        <button
          key={p.id}
          type="button"
          className={`ade-mp-rail-btn ${activeTab === p.id ? "is-active" : ""} ${!p.configured ? "is-unconfigured" : ""}`}
          title={p.configured ? p.name : t("wsx.comp.providerNotConfiguredSuffix", { name: p.name })}
          onClick={() => onSelectTab(p.id)}
        >
          <ProviderGlyph provider={p.id} size={18} />
        </button>
      ))}
    </nav>
  )
}
