import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, ChevronUp, Search, Shield, ShieldAlert, ShieldOff, Star } from "lucide-react"
import type { ApprovalPolicy, ProviderCatalogEntry } from "../../app-types"

const FAVORITES_STORAGE_KEY = "ade.favorite-models-v1"

const THINKING_LEVELS: { value: string; label: string }[] = [
  { value: "none", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
]

const ACCESS_OPTIONS: { value: ApprovalPolicy; label: string; description: string }[] = [
  { value: "auto-all", label: "Full access", description: "Run commands without pausing" },
  { value: "auto-safe", label: "Auto-safe", description: "Auto-allow read-only commands" },
  { value: "ask", label: "Ask every cmd", description: "Require approval for every command" },
]

type FavoriteKey = string // `${provider}::${modelId}`

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
  } catch {
    // ignore
  }
}

export function ProviderGlyph({ provider, size = 16 }: { provider: string; size?: number }) {
  if (provider === "anthropic" || provider === "claude") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <g stroke="#d97757" strokeWidth="2.1" strokeLinecap="round">
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
          <line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
        </g>
      </svg>
    )
  }
  if (provider === "openai" || provider === "codex") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="4" y="3" width="16" height="18" rx="3" stroke="currentColor" strokeWidth="2.2" />
        <rect x="8.5" y="7.5" width="7" height="9" rx="1" fill="currentColor" opacity="0.55" />
      </svg>
    )
  }
  if (provider === "github-copilot" || provider === "copilot") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path
          d="M6.5 10.5C6.5 7.5 8.8 5.5 12 5.5C15.2 5.5 17.5 7.5 17.5 10.5V15.5C17.5 17 16.3 18 14.8 18H9.2C7.7 18 6.5 17 6.5 15.5V10.5Z"
          stroke="currentColor"
          strokeWidth="1.9"
        />
        <circle cx="9.8" cy="12" r="1.4" fill="currentColor" />
        <circle cx="14.2" cy="12" r="1.4" fill="currentColor" />
        <path d="M4 11.5V14.5M20 11.5V14.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  if (provider === "radius" || provider === "pi") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="shrink-0">
        <rect x="3" y="3" width="4.2" height="14" rx="0.6" />
        <rect x="3" y="3" width="10.5" height="4.2" rx="0.6" />
        <rect x="9.3" y="7.2" width="4.2" height="4.2" rx="0.6" />
        <rect x="13.5" y="12.5" width="3.5" height="4.5" rx="0.6" />
      </svg>
    )
  }
  if (provider === "oh-my-pi") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="shrink-0">
        <rect x="2.5" y="4" width="3.8" height="12.5" rx="0.6" />
        <rect x="2.5" y="4" width="9.5" height="3.8" rx="0.6" />
        <rect x="8.2" y="7.8" width="3.8" height="3.8" rx="0.6" />
        <circle cx="15.5" cy="5.5" r="2.1" fill="#d97757" />
        <rect x="12.8" y="12.2" width="3.8" height="4.3" rx="0.6" />
      </svg>
    )
  }
  if (provider === "opencode") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M8 9.5L11 12L8 14.5M12.5 14.5H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (provider === "antigravity") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M12 3.5L19 19.5H15.2L12 11.8L8.8 19.5H5L12 3.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      </svg>
    )
  }
  if (provider === "muse-code") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M4.5 18V6L12 13L19.5 6V18" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (provider === "hermes") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M13 3L5.5 13H12L11 21L18.5 11H12L13 3Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      </svg>
    )
  }
  if (provider === "cursor") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M5.5 4L18.5 11.2L12.3 13.1L10.1 19.5L5.5 4Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      </svg>
    )
  }
  if (provider === "devin") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M6 5H12.5C16.2 5 18.5 7.7 18.5 12C18.5 16.3 16.2 19 12.5 19H6V5Z" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  )
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

  // Keep activeTab synced when opening
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

  // Close on outside click
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
      // Search across ALL providers when typing
      return allEntries.filter(
        e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.provider.toLowerCase().includes(q),
      )
    }
    if (activeTab === "favorites") {
      const favSet = new Set(favorites)
      const pinned = allEntries.filter(e => favSet.has(`${e.provider}::${e.id}`))
      if (pinned.length > 0) return pinned
      // If user has no stars yet, show quick picks across all enabled providers
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

  // Keyboard shortcuts while open (Cmd+1..9, arrows, Enter, Escape)
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

  const currentAccess = ACCESS_OPTIONS.find(a => a.value === (approvalPolicy ?? "auto-safe")) ?? ACCESS_OPTIONS[1]
  const AccessIcon = currentAccess.value === "auto-all" ? ShieldOff : currentAccess.value === "ask" ? ShieldAlert : Shield

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
            {/* Left Vertical Provider Rail */}
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

            {/* Middle Searchable Model List */}
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
                      <button
                        type="button"
                        className="ade-chip-btn"
                        onClick={() => { setOpen(false); onOpenSettings() }}
                      >
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
                        {entry.providerLabel ? (
                          <span className="ade-mp-row-provider ade-truncate">{entry.providerLabel}</span>
                        ) : null}
                        <div className="ade-mp-row-right">
                          {!entry.isDefault ? (
                            <button
                              type="button"
                              className={`ade-mp-star-btn ${isFav ? "is-fav" : ""}`}
                              title={isFav ? "Unpin favorite" : "Pin to favorites"}
                              onClick={e => {
                                e.stopPropagation()
                                toggleFavorite(entry.provider, entry.id)
                              }}
                            >
                              <Star className="size-3" fill={isFav ? "currentColor" : "none"} />
                            </button>
                          ) : null}
                          {idx < 9 ? (
                            <kbd className="ade-mp-shortcut">⌘{idx + 1}</kbd>
                          ) : null}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Right Thinking Level Column */}
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

          {/* Bottom Footer Bar (Access / Approval Policy Switcher) */}
          <div className="ade-mp-footer">
            <span className="ade-mp-footer-hint">
              {activeTab === "favorites" ? "Pinned & quick-pick models" : activeProviderMeta?.name ?? ""}
            </span>

            {onChangeApprovalPolicy ? (
              <div className="ade-mp-access-wrap">
                {accessMenuOpen ? (
                  <div className="ade-mp-access-menu" role="menu">
                    {ACCESS_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={currentAccess.value === opt.value}
                        className={`ade-mp-access-item ${currentAccess.value === opt.value ? "is-selected" : ""}`}
                        onClick={() => {
                          onChangeApprovalPolicy(opt.value)
                          setAccessMenuOpen(false)
                        }}
                      >
                        <div>
                          <strong>{opt.label}</strong>
                          <small>{opt.description}</small>
                        </div>
                        {currentAccess.value === opt.value ? <Check className="size-3.5 text-[rgb(var(--primary))]" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="ade-mp-access-btn"
                  onClick={() => setAccessMenuOpen(v => !v)}
                  title="Change command execution access level"
                >
                  <AccessIcon className="size-3.5 opacity-75" />
                  <span>{currentAccess.label}</span>
                  <ChevronUp className="size-3 opacity-60" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
