import { ChevronRight, FolderGit2, FolderPlus, GitBranch, Link2 } from "lucide-react"
import { useI18n } from "../../i18n/I18nContext"
import type { ConcreteProjectSource, SourceChoice } from "./wizard-helpers"

function sourceIcon(id: ConcreteProjectSource) {
  if (id === "scratch") return <FolderGit2 className="size-4 opacity-75 shrink-0" />
  if (id === "local") return <FolderPlus className="size-4 opacity-75 shrink-0" />
  if (id === "url") return <Link2 className="size-4 opacity-75 shrink-0" />
  return <GitBranch className="size-4 opacity-75 shrink-0" />
}

export function WizardSourceStep({
  sources,
  activeIndex,
  searchQuery,
  busy,
  onHover,
  onSelect,
}: {
  sources: readonly SourceChoice[]
  activeIndex: number
  searchQuery: string
  busy: boolean
  onHover: (index: number) => void
  onSelect: (source: ConcreteProjectSource) => void
}) {
  const { t } = useI18n()

  const sourceTitle = (id: ConcreteProjectSource) =>
    id === "scratch" ? t("prjx.wiz.source.scratch.title")
      : id === "local" ? t("prjx.wiz.source.local.title")
        : id === "url" ? t("prjx.wiz.source.url.title")
          : t("prjx.wiz.source.github.title")

  const sourceSubtitle = (id: ConcreteProjectSource) =>
    id === "scratch" ? t("prjx.wiz.source.scratch.subtitle")
      : id === "local" ? t("prjx.wiz.source.local.subtitle")
        : id === "url" ? t("prjx.wiz.source.url.subtitle")
          : t("prjx.wiz.source.github.subtitle")

  return (
    <div className="ade-wizard-body">
      <div className="ade-wizard-section-label">{t("prjx.wiz.source.sectionLabel")}</div>
      <div className="ade-wizard-list" role="listbox" aria-label={t("prjx.wiz.source.listboxAria")}>
        {sources.map((item, idx) => {
          const highlighted = idx === activeIndex
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={highlighted}
              className={`ade-wizard-item ${highlighted ? "is-active" : ""}`}
              onMouseMove={() => onHover(idx)}
              onClick={() => onSelect(item.id)}
              disabled={busy}
            >
              <span className="ade-wizard-item-icon">{sourceIcon(item.id)}</span>
              <span className="ade-wizard-item-copy">
                <span className="ade-wizard-item-title">{sourceTitle(item.id)}</span>
                <span className="ade-wizard-item-sub">{sourceSubtitle(item.id)}</span>
              </span>
              <ChevronRight className="size-3.5 opacity-45 shrink-0" />
            </button>
          )
        })}

        {sources.length === 0 ? (
          <div className="px-3 py-5 text-center text-xs opacity-60">
            {t("prjx.wiz.source.noMatch", { query: searchQuery })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
