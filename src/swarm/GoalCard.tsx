import { useState } from "react"
import { Check, Pencil } from "lucide-react"
import { requestJson } from "../../api"

export function GoalCard({
  sessionId,
  swarmTitle,
  goalTitle,
  goalSummary,
  editing,
  onToggleEdit,
  onSaved,
}: {
  sessionId: string
  swarmTitle: string
  goalTitle: string
  goalSummary: string
  editing: boolean
  onToggleEdit: (open: boolean) => void
  onSaved: () => void
}) {
  if (editing) {
    return (
      <GoalEditor
        key={`${swarmTitle}|${goalTitle}|${goalSummary}`}
        sessionId={sessionId}
        initialTitle={swarmTitle}
        initialGoalTitle={goalTitle}
        initialGoalSummary={goalSummary}
        onCancel={() => onToggleEdit(false)}
        onSaved={onSaved}
      />
    )
  }

  return (
    <section className="ade-swarm-card ade-swarm-goal" aria-label="Swarm goal">
      <div className="ade-swarm-goal-head">
        <span className="ade-swarm-eyebrow">GOAL</span>
        <button type="button" className="ade-swarm-goal-edit" onClick={() => onToggleEdit(true)} title="Edit swarm title and goal" aria-label="Edit goal">
          <Pencil className="size-3" />
        </button>
      </div>
      <h3>{goalTitle}</h3>
      {goalSummary ? <p>{goalSummary}</p> : null}
    </section>
  )
}

function GoalEditor({
  sessionId,
  initialTitle,
  initialGoalTitle,
  initialGoalSummary,
  onCancel,
  onSaved,
}: {
  sessionId: string
  initialTitle: string
  initialGoalTitle: string
  initialGoalSummary: string
  onCancel: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [gTitle, setGTitle] = useState(initialGoalTitle)
  const [gSummary, setGSummary] = useState(initialGoalSummary)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    setSaving(true)
    setError("")
    try {
      await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/team/overview`, "PUT", { title, goalTitle: gTitle, goalSummary: gSummary })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update goal.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ade-swarm-card ade-swarm-goal is-editing" aria-label="Edit swarm goal">
      <span className="ade-swarm-eyebrow">GOAL</span>
      <input className="ade-input-sm" value={title} onChange={e => setTitle(e.target.value)} placeholder="Swarm title" />
      <input className="ade-input-sm" value={gTitle} onChange={e => setGTitle(e.target.value)} placeholder="Goal headline" />
      <textarea className="ade-input-sm" rows={2} value={gSummary} onChange={e => setGSummary(e.target.value)} placeholder="Goal summary" />
      {error ? <p className="ade-error-text ade-xs" role="alert">{error}</p> : null}
      <div className="ade-swarm-goal-actions">
        <button type="button" className="ade-chip-btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="ade-chip-btn is-primary" onClick={() => void save()} disabled={saving}>
          <Check className="size-3.5" /> {saving ? "Saving…" : "Save goal"}
        </button>
      </div>
    </section>
  )
}
