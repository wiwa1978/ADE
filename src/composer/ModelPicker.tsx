import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Sparkles } from "lucide-react"
import { useClickOutside } from "../../components/ui/index.ts"
import type { ApprovalPolicy, ProviderCatalogEntry } from "../../app-types"
import { ModelPickerFooter } from "./ModelPickerFooter"
import { ProviderGlyph } from "./ProviderGlyph"
import {
  buildAllModelEntries, computeVisibleEntries, loadFavorites, saveFavorites,
  shortModelLabel, sortCatalog, thinkingLabel, type FavoriteKey, type ModelEntry,
} from "./model-picker/model-favorites"
import { ModelPickerList } from "./model-picker/ModelPickerList"
import { ModelPickerProviderRail } from "./model-picker/ModelPickerProviderRail"
import { ThinkingLevelColumn } from "./model-picker/ThinkingLevelColumn"

export { ProviderGlyph }

export interface ModelPickerProps {
  catalog: ProviderCatalogEntry[]; selectedProvider: string; selectedModel: string; reasoning: string
  approvalPolicy?: ApprovalPolicy; onSelectModel: (provider: string, modelId: string) => void
  onSelectReasoning: (level: string) => void; onChangeApprovalPolicy?: (policy: ApprovalPolicy) => void
  onOpenSettings?: () => void; align?: "top" | "bottom"
}

export function ModelPicker({
  catalog, selectedProvider, selectedModel, reasoning, approvalPolicy,
  onSelectModel, onSelectReasoning, onChangeApprovalPolicy, onOpenSettings, align = "top",
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [accessMenuOpen, setAccessMenuOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<string>(() => selectedProvider || catalog[0]?.id || "favorites")
  const [query, setQuery] = useState("")
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [favorites, setFavorites] = useState<FavoriteKey[]>(loadFavorites)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const orderedCatalog = useMemo(() => sortCatalog(catalog), [catalog])
  const allEntries = useMemo(() => buildAllModelEntries(orderedCatalog), [orderedCatalog])
  const visibleEntries = useMemo(
    () => computeVisibleEntries(query, activeTab, favorites, allEntries, orderedCatalog),
    [query, activeTab, favorites, allEntries, orderedCatalog],
  )

  const closeAll = useCallback(() => { setOpen(false); setAccessMenuOpen(false) }, [])
  useClickOutside(rootRef, closeAll, open)

  const openPicker = () => {
    const nextTab = orderedCatalog.some(p => p.id === selectedProvider) ? selectedProvider : orderedCatalog[0]?.id ?? "favorites"
    setActiveTab(nextTab)
    setQuery("")
    setHighlightIndex(0)
    setAccessMenuOpen(false)
    setOpen(true)
    setTimeout(() => searchRef.current?.focus(), 10)
  }

  const toggleFavorite = (provider: string, modelId: string) => {
    const key = `${provider}::${modelId}`
    setFavorites(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      saveFavorites(next)
      return next
    })
  }

  const pickModel = useCallback((entry: ModelEntry) => { onSelectModel(entry.provider, entry.id); setOpen(false) }, [onSelectModel])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return }
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const item = visibleEntries[Number(e.key) - 1]
        if (item) { e.preventDefault(); pickModel(item) }
        return
      }
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIndex(i => (visibleEntries.length ? (i + 1) % visibleEntries.length : 0)) }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIndex(i => (visibleEntries.length ? (i - 1 + visibleEntries.length) % visibleEntries.length : 0)) }
      else if (e.key === "Enter" && document.activeElement === searchRef.current) {
        const item = visibleEntries[highlightIndex] ?? visibleEntries[0]
        if (item) { e.preventDefault(); pickModel(item) }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, visibleEntries, highlightIndex, pickModel])

  const activeProviderEntry = orderedCatalog.find(p => p.id === selectedProvider) ?? orderedCatalog[0]
  const currentModelObj = activeProviderEntry?.models.find(m => m.id === selectedModel)
  const triggerModelName = currentModelObj?.name || selectedModel || activeProviderEntry?.defaultModel || "Select model"
  const highlightedEntry = visibleEntries[highlightIndex]
  const rightHeaderModelName = shortModelLabel(highlightedEntry && !highlightedEntry.isDefault ? highlightedEntry.name : triggerModelName)
  const effectiveReasoning = reasoning === "off" ? "none" : reasoning
  const activeProviderMeta = activeTab !== "favorites" ? orderedCatalog.find(p => p.id === activeTab) ?? null : null

  if (catalog.length > 0 && !catalog.some(p => p.configured)) {
    return (
      <div className="ade-mp-root" ref={rootRef}>
        <button type="button" className="ade-mp-trigger ade-mp-setup" onClick={() => onOpenSettings?.()} title="No model provider is set up yet">
          <Sparkles className="size-3.5 shrink-0" />
          <span className="ade-mp-trigger-name">Set up a model</span>
        </button>
      </div>
    )
  }

  return (
    <div className="ade-mp-root" ref={rootRef}>
      <button
        type="button"
        className={`ade-mp-trigger ${open ? "is-open" : ""}`}
        aria-label="Model"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <ProviderGlyph provider={selectedProvider || activeProviderEntry?.id || "openai"} size={14} />
        <span className="ade-mp-trigger-name ade-truncate">{triggerModelName}</span>
        <span className="ade-mp-trigger-thinking">{thinkingLabel(effectiveReasoning)}</span>
        <ChevronDown className="size-3 opacity-60 shrink-0" />
      </button>

      {open ? (
        <div className={`ade-mp-popover ${align === "bottom" ? "is-bottom" : "is-top"}`} role="dialog" aria-label="Select model and thinking level">
          <div className="ade-mp-columns">
            <ModelPickerProviderRail
              orderedCatalog={orderedCatalog}
              activeTab={activeTab}
              onSelectTab={tab => { setActiveTab(tab); setQuery(""); setHighlightIndex(0) }}
            />
            <ModelPickerList
              searchRef={searchRef}
              query={query}
              visibleEntries={visibleEntries}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              highlightIndex={highlightIndex}
              favorites={favorites}
              activeProviderMeta={activeProviderMeta}
              onQueryChange={q => { setQuery(q); setHighlightIndex(0) }}
              onHighlight={setHighlightIndex}
              onPickModel={pickModel}
              onToggleFavorite={toggleFavorite}
              onOpenSettings={onOpenSettings ? () => { setOpen(false); onOpenSettings() } : undefined}
            />
            <ThinkingLevelColumn
              headerTitle={highlightedEntry?.name || triggerModelName}
              headerModelName={rightHeaderModelName}
              effectiveReasoning={effectiveReasoning}
              onSelectReasoning={onSelectReasoning}
            />
          </div>
          <ModelPickerFooter
            hint={activeTab === "favorites" ? "Pinned & quick-pick models" : activeProviderMeta?.name ?? ""}
            approvalPolicy={approvalPolicy}
            accessMenuOpen={accessMenuOpen}
            onToggleAccessMenu={() => setAccessMenuOpen(v => !v)}
            onChangeApprovalPolicy={onChangeApprovalPolicy}
          />
        </div>
      ) : null}
    </div>
  )
}
