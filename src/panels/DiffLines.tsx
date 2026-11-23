import { useState } from "react"
import { MessageSquarePlus, X } from "lucide-react"
import { parseDiff, type DiffNote } from "./diff-notes"

/**
 * A unified diff with line numbers. When notes are enabled, clicking a line opens a small field
 * to leave a review note there; notes show under their line until they are sent or removed.
 */
export function DiffLines({
  diff,
  path,
  notes = [],
  onAddNote,
  onRemoveNote,
}: {
  diff: string
  path: string | null
  notes?: DiffNote[]
  onAddNote?: (note: Omit<DiffNote, "id">) => void
  onRemoveNote?: (id: string) => void
}) {
  const [composing, setComposing] = useState<number | null>(null)
  const [text, setText] = useState("")
  const lines = parseDiff(diff)
  if (!lines.length) return <div className="ade-diff-code"><div className="ade-pane-note">No diff lines to show.</div></div>
  const canNote = Boolean(onAddNote && path)
  const fileNotes = notes.filter(note => note.path === path)

  const submit = (index: number) => {
    const line = lines[index]
    const number = line.newLine ?? line.oldLine
    if (!text.trim() || !path || number === null || !onAddNote) return
    onAddNote({ path, line: number, side: line.newLine !== null ? "new" : "old", code: line.text.slice(1).trim().slice(0, 200), text: text.trim() })
    setText("")
    setComposing(null)
  }

  return (
    <div className={`ade-diff-code ${canNote ? "is-notable" : ""}`}>
      {lines.map((line, index) => {
        const number = line.newLine ?? line.oldLine
        const side = line.newLine !== null ? "new" : "old"
        const lineNotes = number === null ? [] : fileNotes.filter(note => note.line === number && note.side === side)
        const notable = canNote && number !== null
        return (
          <div key={index}>
            <div className={`ade-diff-line is-${line.kind === "context" ? "ctx" : line.kind}`}>
              <span className="ade-diff-gutter" aria-hidden="true">{line.kind === "del" ? line.oldLine : line.newLine ?? ""}</span>
              {notable ? (
                <button
                  type="button"
                  className="ade-diff-note-btn"
                  title="Leave a note for the agent on this line"
                  aria-label={`Add a note on line ${number}`}
                  onClick={() => { setComposing(composing === index ? null : index); setText("") }}
                >
                  <MessageSquarePlus className="size-3" />
                </button>
              ) : <span className="ade-diff-note-spacer" />}
              <span className="ade-diff-text">{line.text || " "}</span>
            </div>
            {lineNotes.map(note => (
              <div key={note.id} className="ade-diff-note">
                <span>{note.text}</span>
                {onRemoveNote ? (
                  <button type="button" className="ade-icon-btn" aria-label="Remove note" title="Remove note" onClick={() => onRemoveNote(note.id)}>
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
            {composing === index ? (
              <form className="ade-diff-note-form" onSubmit={event => { event.preventDefault(); submit(index) }}>
                <textarea
                  autoFocus
                  rows={2}
                  value={text}
                  placeholder="What should the agent change here?"
                  aria-label={`Note on line ${number}`}
                  onChange={event => setText(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(index) }
                    if (event.key === "Escape") setComposing(null)
                  }}
                />
                <div className="ade-diff-note-actions">
                  <button type="button" className="ade-chip-btn" onClick={() => setComposing(null)}>Cancel</button>
                  <button type="submit" className="ade-btn ade-btn-primary ade-btn-xs" disabled={!text.trim()}>Add note</button>
                </div>
              </form>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
