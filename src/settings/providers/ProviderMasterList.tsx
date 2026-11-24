import { Bot, Cpu, KeyRound, Plus, Server, Sparkles, Terminal } from "lucide-react"
import { Switch } from "@/components/ui"
import type { ProviderOverridesMap, UnifiedProviderItem } from "./provider-overrides"

export function ProviderGlyph({ item }: { item: UnifiedProviderItem }) {
  if (item.kind === "copilot") return <Sparkles className="size-4 shrink-0" />
  if (item.kind === "api") {
    return item.id === "compatible" ? <Server className="size-4 shrink-0" /> : <KeyRound className="size-4 shrink-0" />
  }
  if (item.id === "claude" || item.id === "codex") return <Bot className="size-4 shrink-0" />
  if (item.id === "pi" || item.id === "oh-my-pi") return <Cpu className="size-4 shrink-0" />
  return <Terminal className="size-4 shrink-0" />
}

export function ProviderMasterList({
  items,
  activeId,
  overrides,
  busyProviderId,
  onSelect,
  onToggle,
  onAddCompatible,
}: {
  items: readonly UnifiedProviderItem[]
  activeId: string | null
  overrides: ProviderOverridesMap
  busyProviderId: string | null
  onSelect: (id: string) => void
  onToggle: (item: UnifiedProviderItem, enabled: boolean) => void
  onAddCompatible: () => void
}) {
  return (
    <div className="st-prov-list" role="listbox" aria-label="Model providers">
      <div className="st-prov-list-items">
        {items.map(item => {
          const selected = activeId === item.id
          const busyToggle = busyProviderId === item.id
          return (
            <div
              key={item.id}
              role="option"
              aria-selected={selected}
              tabIndex={0}
              className={`st-prov-row ${selected ? "is-active" : ""}`}
              onClick={() => onSelect(item.id)}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onSelect(item.id)
                }
              }}
            >
              <span className="st-prov-row-icon"><ProviderGlyph item={item} /></span>
              <span className="st-prov-row-copy">
                <span className="st-prov-row-head">
                  <span className="st-prov-row-name">{overrides[item.id]?.displayName || item.name}</span>
                  {item.command ? <code className="st-prov-row-ver">{item.command}</code> : null}
                </span>
                <span className={`st-prov-row-status is-${item.tone}`}>
                  {item.statusText}
                </span>
              </span>
              {item.canToggle ? (
                <span onClick={e => e.stopPropagation()}>
                  <Switch
                    checked={item.enabled}
                    label={`Enable ${item.name}`}
                    disabled={busyToggle}
                    onCheckedChange={next => onToggle(item, next)}
                  />
                </span>
              ) : (
                <span className={`st-dot ${item.available ? "is-ok" : ""}`} title={item.statusText} />
              )}
            </div>
          )
        })}
      </div>

      <button type="button" className="st-prov-add-row" onClick={onAddCompatible}>
        <Plus className="size-3.5" />
        <span>Add provider</span>
      </button>
    </div>
  )
}
