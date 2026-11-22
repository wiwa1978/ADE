import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Plus, Search, Settings2 } from "lucide-react"
import type { EnvironmentSummary } from "../../app-types"

export function EnvironmentPalette({
  open,
  environments,
  activeId,
  onSelect,
  onManageEnvironments,
  onAddHost,
  onClose,
}: {
  open: boolean
  environments: EnvironmentSummary[]
  activeId: string
  onSelect: (env: EnvironmentSummary) => Promise<void>
  onManageEnvironments: () => void
  onAddHost: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const [prevOpen, setPrevOpen] = useState(open)
  const [busyId, setBusyId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setQuery("")
      setIndex(0)
    }
  }

  const filtered = environments.filter(e => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      e.name.toLowerCase().includes(q) ||
      (e.sshHost ?? "").toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q)
    )
  })

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  if (!open) return null

  const totalRows = filtered.length + 1 // +1 for "+ Add host"
  const safeIndex = Math.min(index, Math.max(0, totalRows - 1))

  async function choose(env: EnvironmentSummary) {
    setBusyId(env.id)
    try {
      await onSelect(env)
      onClose()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="sf-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="w-full max-w-lg rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] shadow-2xl overflow-hidden"
        onKeyDown={e => {
          if (e.key === "Escape") {
            e.preventDefault()
            onClose()
          } else if (e.key === "ArrowDown" && totalRows) {
            e.preventDefault()
            setIndex(i => (i + 1) % totalRows)
          } else if (e.key === "ArrowUp" && totalRows) {
            e.preventDefault()
            setIndex(i => (i - 1 + totalRows) % totalRows)
          } else if (e.key === "Enter") {
            e.preventDefault()
            if (safeIndex < filtered.length && filtered[safeIndex]) {
              void choose(filtered[safeIndex])
            } else {
              onClose()
              onAddHost()
            }
          }
        }}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[rgb(var(--border)/0.8)]">
          <button type="button" className="sf-btn-ghost !h-7 !px-1.5" onClick={onClose} aria-label="Back">
            <ArrowLeft className="size-4" />
          </button>
          <Search className="size-4 opacity-50 shrink-0" />
          <input
            ref={inputRef}
            className="ade-cmd-input"
            placeholder="Search environments…"
            value={query}
            onChange={e => { setQuery(e.target.value); setIndex(0) }}
          />
        </div>

        <div className="p-2">
          <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold opacity-60">Environments</div>
          <div className="flex flex-col gap-0.5">
            {filtered.map((env, i) => {
              const highlighted = i === safeIndex
              const isLocal = env.kind === "local"
              const isActive = env.id === activeId
              const dotClass =
                env.status === "connected" || isActive
                  ? "ade-dot-completed"
                  : env.status === "error"
                    ? "ade-dot-failed"
                    : "ade-dot-waiting"
              const hostLabel = isLocal
                ? "localhost:4318"
                : env.sshHost || env.id
              return (
                <div
                  key={env.id}
                  role="button"
                  tabIndex={0}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => { if (busyId === null) void choose(env) }}
                  onKeyDown={e => { if (e.key === "Enter" && busyId === null) void choose(env) }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer"
                  style={{
                    background: highlighted ? "rgb(var(--surface-raised))" : "transparent",
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`ade-dot ${dotClass}`} />
                    <span className="text-[13px] font-medium truncate">{env.name}</span>
                    <span className="text-[12px] opacity-55 font-mono truncate">{hostLabel}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isActive ? <span className="sf-badge sf-badge-ok">Active</span> : null}
                    {busyId === env.id ? <span className="text-[11px] opacity-60">Connecting…</span> : null}
                    <button
                      type="button"
                      className="ade-icon-btn !w-6 !h-6"
                      title={`Manage ${env.name}`}
                      onClick={e => {
                        e.stopPropagation()
                        onClose()
                        onManageEnvironments()
                      }}
                    >
                      <Settings2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}

            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] opacity-60">
                No environments match “{query}”.
              </div>
            ) : null}

            <div className="my-1 border-t border-[rgb(var(--border)/0.6)]" />

            <button
              type="button"
              onMouseMove={() => setIndex(filtered.length)}
              onClick={() => {
                onClose()
                onAddHost()
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-[13px] transition-colors cursor-pointer"
              style={{
                background: safeIndex === filtered.length ? "rgb(var(--surface-raised))" : "transparent",
              }}
            >
              <Plus className="size-4 opacity-75 shrink-0" />
              <span>Add host</span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[rgb(var(--border)/0.7)] bg-[rgb(var(--surface)/0.5)] text-[11px] opacity-75">
          <div className="flex items-center gap-3">
            <span><kbd className="ade-kbd">↑</kbd> <kbd className="ade-kbd">↓</kbd> Navigate</span>
            <span><kbd className="ade-kbd">Enter</kbd> Select</span>
            <span><kbd className="ade-kbd">Esc</kbd> Close</span>
          </div>
          <button
            type="button"
            className="sf-btn-ghost !h-6 !text-[11px]"
            onClick={() => {
              onClose()
              onManageEnvironments()
            }}
          >
            <Settings2 className="size-3" /> Manage
          </button>
        </div>
      </div>
    </div>
  )
}
