import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Search, SlidersHorizontal } from "lucide-react"
import {
  ensureGoogleFontLoaded,
  matchFontOption,
  preloadFontPreviews,
  type FontOption,
} from "./fonts"

export function FontPicker({
  label,
  value,
  options,
  previewGroup,
  sampleText,
  customPlaceholder,
  onChange,
  onCommit,
}: {
  label: string
  value: string
  options: FontOption[]
  previewGroup: "interface" | "code"
  sampleText: string
  customPlaceholder: string
  onChange: (nextValue: string) => void
  onCommit?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [customMode, setCustomMode] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const matched = matchFontOption(options, value)
  const isCustom = customMode || (!matched && Boolean(value.trim()))

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(opt =>
      opt.label.toLowerCase().includes(q)
      || opt.category.toLowerCase().includes(q)
      || (opt.googleFamily ? "google".includes(q) : "system".includes(q)),
    )
  }, [options, query])

  // Group filtered options by category preserving catalog order
  const grouped = useMemo(() => {
    const map = new Map<string, FontOption[]>()
    for (const opt of filtered) {
      const list = map.get(opt.category) ?? []
      list.push(opt)
      map.set(opt.category, list)
    }
    return [...map.entries()]
  }, [filtered])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [open])

  const openMenu = () => {
    preloadFontPreviews(options, previewGroup)
    setQuery("")
    setHighlightIndex(0)
    setOpen(true)
    setTimeout(() => searchRef.current?.focus(), 10)
  }

  const pickOption = (opt: FontOption) => {
    ensureGoogleFontLoaded(opt.value)
    setCustomMode(false)
    onChange(opt.value)
    setOpen(false)
  }

  const triggerLabel = isCustom
    ? (value.trim() ? `Custom: ${value.split(",")[0].replace(/["']/g, "").trim()}` : "Custom…")
    : (matched?.label ?? "System default")

  const flatFiltered = filtered

  return (
    <span className="st-font-pick" ref={rootRef}>
      <div className="st-fp-wrap">
        <button
          type="button"
          className={`st-fp-trigger ${open ? "is-open" : ""}`}
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => (open ? setOpen(false) : openMenu())}
        >
          <span
            className="st-fp-trigger-label ade-truncate"
            style={value.trim() ? { fontFamily: value } : undefined}
          >
            {triggerLabel}
          </span>
          {matched?.googleFamily ? <span className="st-fp-badge">Google</span> : null}
          <ChevronDown className="size-3.5 opacity-60 shrink-0" />
        </button>

        {open ? (
          <div className="st-fp-popover" role="dialog" aria-label={`Choose ${label}`}>
            <div className="st-fp-search">
              <Search className="size-3.5 opacity-55 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                className="st-fp-search-input"
                placeholder={`Search ${options.length} fonts…`}
                value={query}
                onChange={e => {
                  setQuery(e.target.value)
                  setHighlightIndex(0)
                }}
                onKeyDown={e => {
                  if (e.key === "Escape") {
                    e.preventDefault()
                    setOpen(false)
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault()
                    setHighlightIndex(i => (flatFiltered.length ? (i + 1) % flatFiltered.length : 0))
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault()
                    setHighlightIndex(i => (flatFiltered.length ? (i - 1 + flatFiltered.length) % flatFiltered.length : 0))
                  } else if (e.key === "Enter") {
                    const target = flatFiltered[highlightIndex] ?? flatFiltered[0]
                    if (target) {
                      e.preventDefault()
                      pickOption(target)
                    }
                  }
                }}
              />
            </div>

            <div className="st-fp-list" role="listbox" aria-label={label}>
              {grouped.length === 0 ? (
                <div className="st-fp-empty">No fonts match “{query}”.</div>
              ) : (
                grouped.map(([category, items]) => (
                  <div key={category} className="st-fp-group">
                    <div className="st-fp-group-label">{category}</div>
                    {items.map(opt => {
                      const flatIdx = flatFiltered.indexOf(opt)
                      const selected = !isCustom && matched?.value === opt.value
                      const highlighted = flatIdx === highlightIndex
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`st-fp-item ${selected ? "is-selected" : ""} ${highlighted ? "is-highlighted" : ""}`}
                          onMouseEnter={() => setHighlightIndex(flatIdx)}
                          onClick={() => pickOption(opt)}
                        >
                          <span className="st-fp-item-name ade-truncate" style={opt.value ? { fontFamily: opt.value } : undefined}>
                            {opt.label}
                          </span>
                          <span className="st-fp-item-right">
                            <span className="st-fp-sample" style={opt.value ? { fontFamily: opt.value } : undefined}>
                              {opt.sample ?? sampleText}
                            </span>
                            {opt.googleFamily ? <span className="st-fp-tag">Google</span> : null}
                            {selected ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : <span className="size-3.5 shrink-0" />}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="st-fp-footer">
              <button
                type="button"
                className={`st-fp-custom-btn ${isCustom ? "is-selected" : ""}`}
                onClick={() => {
                  setCustomMode(true)
                  setOpen(false)
                }}
              >
                <SlidersHorizontal className="size-3.5" />
                <span>Custom local font…</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {isCustom ? (
        <input
          className="st-input"
          aria-label={`${label} (custom)`}
          value={value}
          placeholder={customPlaceholder}
          spellCheck={false}
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") onCommit?.()
          }}
        />
      ) : null}
    </span>
  )
}
