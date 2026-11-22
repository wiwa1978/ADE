import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Search, Star } from "lucide-react"
import type { ApprovalPolicy, ProviderCatalogEntry } from "../../app-types"
import { ProviderGlyph } from "./ProviderGlyph"
import { ModelPickerFooter } from "./ModelPickerFooter"

export { ProviderGlyph }

const FAVORITES_STORAGE_KEY = "ade.favorite-models-v1"

const THINKING_LEVELS: { value: string; label: string }[] = [
  { value: "none", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
]

type FavoriteKey = string

function loadFavorites(): FavoriteKey[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function saveFavorites(list: FavoriteKey[]) {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(list))
  } catch (err) {
    console.warn("[ADE] Could not persist model favorites:", err instanceof Error ? err.message : String(err))
  }
}

function shortModelLabel(name: string): string {
  const cleaned = name.replace(/^(Claude|Gemini|GPT|OpenAI)\s+/i, "").trim()
  return (cleaned || name).slice(0, 18)
}

function thinkingLabel(value: string): string {
  if (value === "off") return "Off"
  return THINKING_LEVELS.find(t => t.value === value)?.label ?? "Medium"
}

type ModelEntry = {
  provider: string
  providerLabel: string
  id: string
  name: string
  isDefault?: boolean
  configured: boolean
}

export function ModelPicker({
  catalog,
  selectedProvider,
  selectedModel,
  reasoning,
  approvalPolicy,
  onSelectModel,
  onSelectReasoning,
  onChangeApprovalPolicy,
  onOpenSettings,
  align = "top",
}: {
  catalog: ProviderCatalogEntry[]
  selectedProvider: string
  selectedModel: string
  reasoning: string
  approvalPolicy?: ApprovalPolicy
  onSelectModel: (provider: string, modelId: string) => void
  onSelectReasoning: (level: string) => void
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => void
  onOpenSettings?: () => void
  align?: "top" | "bottom"
}) {
  const [open, setOpen] = useState(false)
  const [accessMenuOpen, setAccessMenuOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<string>(() => selectedProvider || catalog[0]?.id || "favorites")
  const [query, setQuery] = useState("")
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [favorites, setFavorites] = useState<FavoriteKey[]>(loadFavorites)

  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const orderedCatalog = useMemo(() => {
    const order = [
      "claude", "codex", "copilot", "opencode", "pi", "oh-my-pi",
      "antigravity", "muse-code", "hermes", "cursor", "devin",
      "anthropic", "openai", "github-copilot", "radius", "compatible",
    ]
    return [...catalog].sort((a, b) => {
      const ia = order.indexOf(a.id)
      const ib = order.indexOf(b.id)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
  }, [catalog])

  const openPicker = () => {
    const nextTab = orderedCatalog.some(p => p.id === selectedProvider)
      ? selectedProvider
      : orderedCatalog[0]?.id ?? "favorites"
    setActiveTab(nextTab)
    setQuery("")
    setHighlightIndex(0)
    setAccessMenuOpen(false)
    setOpen(true)
    setTimeout(() => searchRef.current?.focus(), 10)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setAccessMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [open])

  const allEntries = useMemo<ModelEntry[]>(() => {
    const list: ModelEntry[] = []
    for (const p of orderedCatalog) {
      if (p.models.length === 0) {
        list.push({
          provider: p.id,
          providerLabel: p.id,
          id: p.defaultModel || "default",
          name: `${p.name.replace(/\s*\(.*?\)/, "")} default`,
          isDefault: true,
          configured: p.configured,
        })
      } else {
        for (const m of p.models) {
          list.push({
            provider: p.id,
            providerLabel: p.id,
            id: m.id,
            name: m.name,
            configured: p.configured,
          })
        }
      }
    }
    return list
  }, [orderedCatalog])

  const visibleEntries = useMemo<ModelEntry[]>(() => {
    const q = query.trim().toLowerCase()
    if (q) {
      return allEntries.filter(
        e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.provider.toLowerCase().includes(q),
      )
    }
    if (activeTab === "favorites") {
      const favSet = new Set(favorites)
      const pinned = allEntries.filter(e => favSet.has(`${e.provider}::${e.id}`))
      if (pinned.length > 0) return pinned
      return orderedCatalog.flatMap(p => {
        if (p.models.length === 0) {
          return [{
            provider: p.id,
            providerLabel: p.id,
            id: p.defaultModel || "default",
            name: `${p.name.replace(/\s*\(.*?\)/, "")} default`,
            isDefault: true,
            configured: p.configured,
          }]
        }
        return p.models.slice(0, 2).map<ModelEntry>(m => ({
          provider: p.id,
          providerLabel: p.id,
          id: m.id,
          name: m.name,
          configured: p.configured,
        }))
      })
    }
    const providerEntry = orderedCatalog.find(p => p.id === activeTab)
    if (!providerEntry) return []
    const rows: ModelEntry[] = []
    const defaultId = providerEntry.defaultModel || providerEntry.models[0]?.id || "default"
    if (providerEntry.configured || providerEntry.models.length > 0) {
      rows.push({
        provider: providerEntry.id,
        providerLabel: "",
        id: defaultId,
        name: `${providerEntry.name.replace(/\s*\(.*?\)/, "")} default`,
        isDefault: true,
        configured: providerEntry.configured,
      })
    }
    for (const m of providerEntry.models) {
      rows.push({
        provider: providerEntry.id,
        providerLabel: providerEntry.id,
        id: m.id,
        name: m.name,
        configured: providerEntry.configured,
      })
    }
    return rows
  }, [query, activeTab, favorites, allEntries, orderedCatalog])

  const toggleFavorite = (provider: string, modelId: string) => {
    const key = `${provider}::${modelId}`
    setFavorites(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      saveFavorites(next)
      return next
    })
  }

  const pickModel = (entry: ModelEntry) => {
    onSelectModel(entry.provider, entry.id)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setOpen(false)
        return
      }
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1
        const item = visibleEntries[idx]
        if (item) {
          e.preventDefault()
          pickModel(item)
        }
        return
      }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlightIndex(i => (visibleEntries.length ? (i + 1) % visibleEntries.length : 0))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlightIndex(i => (visibleEntries.length ? (i - 1 + visibleEntries.length) % visibleEntries.length : 0))
      } else if (e.key === "Enter" && document.activeElement === searchRef.current) {
        const item = visibleEntries[highlightIndex] ?? visibleEntries[0]
        if (item) {
          e.preventDefault()
          pickModel(item)
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, visibleEntries, highlightIndex])

  const activeProviderEntry = orderedCatalog.find(p => p.id === selectedProvider) ?? orderedCatalog[0]
  const currentModelObj = activeProviderEntry?.models.find(m => m.id === selectedModel)
  const triggerModelName = currentModelObj?.name || selectedModel || activeProviderEntry?.defaultModel || "Select model"
  const highlightedEntry = visibleEntries[highlightIndex]
  const rightHeaderModelName = shortModelLabel((highlightedEntry && !highlightedEntry.isDefault ? highlightedEntry.name : triggerModelName))
  const effectiveReasoning = reasoning === "off" ? "none" : reasoning
  const activeProviderMeta = activeTab !== "favorites" ? orderedCatalog.find(p => p.id === activeTab) : null

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
        <div
          className={`ade-mp-popover ${align === "bottom" ? "is-bottom" : "is-top"}`}
          role="dialog"
          aria-label="Select model and thinking level"
        >
          <div className="ade-mp-columns">
            <nav className="ade-mp-rail" aria-label="Model providers">
              <button
                type="button"
                className={`ade-mp-rail-btn ${activeTab === "favorites" ? "is-active" : ""}`}
                title="Favorites & Quick Picks"
                onClick={() => { setActiveTab("favorites"); setQuery(""); setHighlightIndex(0) }}
              >
                <Star className="size-4" fill={activeTab === "favorites" ? "currentColor" : "none"} />
              </button>
              <div className="ade-mp-rail-sep" />
              {orderedCatalog.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`ade-mp-rail-btn ${activeTab === p.id ? "is-active" : ""} ${!p.configured ? "is-unconfigured" : ""}`}
                  title={`${p.name}${p.configured ? "" : " (not configured)"}`}
                  onClick={() => { setActiveTab(p.id); setQuery(""); setHighlightIndex(0) }}
                >
                  <ProviderGlyph provider={p.id} size={18} />
                </button>
              ))}
            </nav>

            <div className="ade-mp-models-col">
              <div className="ade-mp-search-wrap">
                <Search className="size-3.5 opacity-55 shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  className="ade-mp-search-input"
                  placeholder="Search models..."
                  value={query}
                  onChange={e => { setQuery(e.target.value); setHighlightIndex(0) }}
                />
              </div>

              <div className="ade-mp-list" role="listbox" aria-label="Models">
                {visibleEntries.length === 0 ? (
                  <div className="ade-mp-empty">
                    <p>
                      {query
                        ? `No models match "${query}".`
                        : activeProviderMeta && !activeProviderMeta.configured
                          ? activeProviderMeta.setupMessage || `${activeProviderMeta.name} is not configured yet.`
                          : "No models available."}
                    </p>
                    {onOpenSettings && activeProviderMeta && !activeProviderMeta.configured ? (
                      <button type="button" className="ade-chip-btn" onClick={() => { setOpen(false); onOpenSettings() }}>
                        Configure in Settings
                      </button>
                    ) : null}
                  </div>
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
                        onMouseEnter={() => setHighlightIndex(idx)}
                        onClick={() => pickModel(entry)}
                      >
                        <ProviderGlyph provider={entry.provider} size={15} />
                        <span className="ade-mp-row-name ade-truncate" title={entry.name}>{entry.name}</span>
                        {entry.providerLabel ? <span className="ade-mp-row-provider ade-truncate">{entry.providerLabel}</span> : null}
                        <div className="ade-mp-row-right">
                          {!entry.isDefault ? (
                            <button
                              type="button"
                              className={`ade-mp-star-btn ${isFav ? "is-fav" : ""}`}
                              title={isFav ? "Unpin favorite" : "Pin to favorites"}
                              onClick={e => { e.stopPropagation(); toggleFavorite(entry.provider, entry.id) }}
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

            <div className="ade-mp-thinking-col" aria-label="Thinking level">
              <div className="ade-mp-thinking-head">
                <span>Thinking</span>
                <span className="ade-mp-thinking-model ade-truncate" title={highlightedEntry?.name || triggerModelName}>
                  {rightHeaderModelName}
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
