import { ChevronRight, FolderGit2, FolderPlus, GitBranch, Link2 } from "lucide-react"
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
  return (
    <div className="ade-wizard-body">
      <div className="ade-wizard-section-label">Sources</div>
      <div className="ade-wizard-list" role="listbox" aria-label="Project sources">
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
                <span className="ade-wizard-item-title">{item.title}</span>
                <span className="ade-wizard-item-sub">{item.subtitle}</span>
              </span>
              <ChevronRight className="size-3.5 opacity-45 shrink-0" />
            </button>
          )
        })}

        {sources.length === 0 ? (
          <div className="px-3 py-5 text-center text-xs opacity-60">
            No sources match “{searchQuery}”.
          </div>
        ) : null}
      </div>
    </div>
  )
}
