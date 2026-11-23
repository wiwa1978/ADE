import { useEffect, useMemo, useState } from "react"
import { Plus, RotateCcw, Trash2 } from "lucide-react"
import {
  BUILTIN_KEYBINDINGS,
  CUSTOM_ACTION_OPTIONS,
  DEFAULT_KEYBINDINGS,
  eventToChord,
  formatShortcut,
  resolveKeybindings,
  type CustomKeybinding,
  type CustomKeybindingAction,
  type KeybindingId,
} from "../keybindings"

type RecordingTarget =
  | { kind: "builtin"; id: KeybindingId }
  | { kind: "custom"; id: string }
  | { kind: "draft" }
  | null

export function KeybindingsSection({
  overrides,
  customBindings,
  onChangeOverrides,
  onChangeCustomBindings,
}: {
  overrides: Record<string, string>
  customBindings: CustomKeybinding[]
  onChangeOverrides: (next: Record<string, string>) => void
  onChangeCustomBindings: (next: CustomKeybinding[]) => void
}) {
  const [recording, setRecording] = useState<RecordingTarget>(null)
  const [adding, setAdding] = useState(false)
  const [draftAction, setDraftAction] = useState<CustomKeybindingAction>("panel:diff")
  const [draftArg, setDraftArg] = useState("/plan")
  const [draftLabel, setDraftLabel] = useState("")
  const [draftChord, setDraftChord] = useState("")

  const resolved = useMemo(() => resolveKeybindings(overrides), [overrides])
  const hasAnyOverride = useMemo(
    () => BUILTIN_KEYBINDINGS.some(spec => resolved[spec.id] !== spec.defaultChord),
    [resolved],
  )

  // Map lowercased chord -> list of action labels using it, for conflict detection
  const chordOwners = useMemo(() => {
    const map = new Map<string, string[]>()
    const add = (chord: string, label: string) => {
      const key = chord.trim().toLowerCase()
      if (!key) return
      const list = map.get(key) ?? []
      list.push(label)
      map.set(key, list)
    }
    for (const spec of BUILTIN_KEYBINDINGS) add(resolved[spec.id], spec.label)
    for (const custom of customBindings) add(custom.chord, custom.label)
    return map
  }, [resolved, customBindings])

  // Global capture listener while recording so app shortcuts don't fire during rebinding
  useEffect(() => {
    if (!recording) return
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      if (e.key === "Escape") {
        setRecording(null)
        return
      }
      if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (recording.kind === "builtin") {
          onChangeOverrides({ ...overrides, [recording.id]: "" })
        } else if (recording.kind === "custom") {
          onChangeCustomBindings(customBindings.map(item => (item.id === recording.id ? { ...item, chord: "" } : item)))
        } else {
          setDraftChord("")
        }
        setRecording(null)
        return
      }

      const chord = eventToChord(e)
      if (!chord) return

      if (recording.kind === "builtin") {
        const next = { ...overrides }
        if (chord === DEFAULT_KEYBINDINGS[recording.id]) delete next[recording.id]
        else next[recording.id] = chord
        onChangeOverrides(next)
      } else if (recording.kind === "custom") {
        onChangeCustomBindings(customBindings.map(item => (item.id === recording.id ? { ...item, chord } : item)))
      } else {
        setDraftChord(chord)
      }
      setRecording(null)
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [recording, overrides, customBindings, onChangeOverrides, onChangeCustomBindings])

  const selectedActionMeta = CUSTOM_ACTION_OPTIONS.find(o => o.action === draftAction) ?? CUSTOM_ACTION_OPTIONS[0]

  const conflictFor = (chord: string, selfLabel: string): string | null => {
    const key = chord.trim().toLowerCase()
    if (!key) return null
    const others = (chordOwners.get(key) ?? []).filter(l => l !== selfLabel)
    return others.length > 0 ? others[0] : null
  }

  function addCustomBinding() {
    if (!draftChord.trim()) return
    const baseLabel = draftLabel.trim()
      || (selectedActionMeta.needsArg
        ? `Run ${draftArg.trim() || "/plan"}`
        : selectedActionMeta.label)
    const entry: CustomKeybinding = {
      id: `kb-${crypto.randomUUID().slice(0, 8)}`,
      label: baseLabel,
      action: draftAction,
      ...(selectedActionMeta.needsArg ? { arg: draftArg.trim() || "/plan" } : {}),
      chord: draftChord.trim(),
    }
    onChangeCustomBindings([...customBindings, entry])
    setDraftLabel("")
    setDraftChord("")
    setAdding(false)
  }

  return (
    <section className="st-section">
      <div className="st-kb-section-head">
        <div>
          <h2>Keyboard shortcuts</h2>
          <p className="st-section-desc">
            Click any shortcut to record a new key combination. Press Backspace while recording to unbind, or Esc to cancel. Changes update badges across the app immediately.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasAnyOverride ? (
            <button
              type="button"
              className="st-button is-quiet"
              onClick={() => onChangeOverrides({})}
              title="Reset all built-in shortcuts to defaults"
            >
              <RotateCcw className="size-3.5 inline mr-1" /> Reset all
            </button>
          ) : null}
          <button
            type="button"
            className="st-button"
            onClick={() => setAdding(v => !v)}
          >
            <Plus className="size-3.5 inline mr-1" /> Add shortcut
          </button>
        </div>
      </div>

      {/* Inline Custom Shortcut Creator */}
      {adding ? (
        <div className="st-card st-kb-creator">
          <div className="st-row">
            <div className="st-row-text">
              <label htmlFor="kb-custom-action">Action</label>
              <p>What this custom shortcut should trigger.</p>
            </div>
            <div className="st-row-control">
              <select
                id="kb-custom-action"
                className="st-select"
                value={draftAction}
                onChange={e => setDraftAction(e.target.value as CustomKeybindingAction)}
              >
                {CUSTOM_ACTION_OPTIONS.map(opt => (
                  <option key={opt.action} value={opt.action}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {selectedActionMeta.needsArg ? (
            <div className="st-row">
              <div className="st-row-text">
                <label htmlFor="kb-custom-arg">Slash command</label>
                <p>Inserted and sent in the active session.</p>
              </div>
              <div className="st-row-control">
                <input
                  id="kb-custom-arg"
                  className="st-input font-mono !text-[12px]"
                  value={draftArg}
                  placeholder={selectedActionMeta.placeholder}
                  onChange={e => setDraftArg(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          <div className="st-row">
            <div className="st-row-text">
              <label htmlFor="kb-custom-label">Label <small className="opacity-60">(optional)</small></label>
            </div>
            <div className="st-row-control">
              <input
                id="kb-custom-label"
                className="st-input"
                placeholder={selectedActionMeta.label}
                value={draftLabel}
                onChange={e => setDraftLabel(e.target.value)}
              />
            </div>
          </div>

          <div className="st-row">
            <div className="st-row-text">
              <label>Shortcut keys</label>
              <p>Click the button and press your key combination.</p>
            </div>
            <div className="st-row-control">
              <button
                type="button"
                className={`st-kbd-btn ${recording?.kind === "draft" ? "is-recording" : ""}`}
                aria-label="Record custom shortcut"
                onClick={() => setRecording(r => (r?.kind === "draft" ? null : { kind: "draft" }))}
              >
                {recording?.kind === "draft" ? "Press keys…" : formatShortcut(draftChord)}
              </button>
              <button type="button" className="st-button is-quiet" onClick={() => { setAdding(false); setRecording(null) }}>
                Cancel
              </button>
              <button type="button" className="st-button is-primary" disabled={!draftChord.trim()} onClick={addCustomBinding}>
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Built-in Shortcuts Card */}
      <div className="st-card">
        {BUILTIN_KEYBINDINGS.map(spec => {
          const chord = resolved[spec.id]
          const modified = chord !== spec.defaultChord
          const isRec = recording?.kind === "builtin" && recording.id === spec.id
          const conflict = conflictFor(chord, spec.label)
          return (
            <div key={spec.id} className="st-row">
              <div className="st-row-text">
                <span className="st-row-title">{spec.label}</span>
                <p>
                  {spec.description}
                  {conflict ? <span className="st-kb-conflict"> · Conflicts with {conflict}</span> : null}
                </p>
              </div>
              <div className="st-row-control">
                {modified ? (
                  <button
                    type="button"
                    className="st-prov-icon-btn"
                    title={`Reset to ${formatShortcut(spec.defaultChord)}`}
                    aria-label={`Reset ${spec.label} shortcut`}
                    onClick={() => {
                      const next = { ...overrides }
                      delete next[spec.id]
                      onChangeOverrides(next)
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`st-kbd-btn ${isRec ? "is-recording" : ""} ${!chord ? "is-unbound" : ""}`}
                  aria-label={`Change shortcut for ${spec.label}`}
                  onClick={() => setRecording(isRec ? null : { kind: "builtin", id: spec.id })}
                >
                  {isRec ? "Press keys…" : formatShortcut(chord)}
                </button>
              </div>
            </div>
          )
        })}

        {/* User-defined Custom Shortcuts */}
        {customBindings.map(item => {
          const isRec = recording?.kind === "custom" && recording.id === item.id
          const actionLabel = CUSTOM_ACTION_OPTIONS.find(o => o.action === item.action)?.label ?? item.action
          const conflict = conflictFor(item.chord, item.label)
          return (
            <div key={item.id} className="st-row">
              <div className="st-row-text">
                <span className="st-row-title">
                  {item.label} <span className="st-kb-custom-tag">Custom</span>
                </span>
                <p>
                  {item.action === "slash" && item.arg ? `Runs ${item.arg}` : actionLabel}
                  {conflict ? <span className="st-kb-conflict"> · Conflicts with {conflict}</span> : null}
                </p>
              </div>
              <div className="st-row-control">
                <button
                  type="button"
                  className={`st-kbd-btn ${isRec ? "is-recording" : ""} ${!item.chord ? "is-unbound" : ""}`}
                  aria-label={`Change shortcut for ${item.label}`}
                  onClick={() => setRecording(isRec ? null : { kind: "custom", id: item.id })}
                >
                  {isRec ? "Press keys…" : formatShortcut(item.chord)}
                </button>
                <button
                  type="button"
                  className="st-prov-icon-btn"
                  title={`Remove ${item.label}`}
                  aria-label={`Remove ${item.label}`}
                  onClick={() => onChangeCustomBindings(customBindings.filter(c => c.id !== item.id))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
