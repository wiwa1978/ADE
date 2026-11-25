import { useState } from "react"
import { Check, Pencil } from "lucide-react"
import { requestJson } from "../api"
import { useI18n } from "../i18n/I18nContext"

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
  const { t } = useI18n()

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
    <section className="ade-swarm-card ade-swarm-goal" aria-label={t("swx.swarm.goal.ariaLabel")}>
      <div className="ade-swarm-goal-head">
        <span className="ade-swarm-eyebrow">{t("swx.swarm.goal.eyebrow")}</span>
        <button type="button" className="ade-swarm-goal-edit" onClick={() => onToggleEdit(true)} title={t("swx.swarm.goal.editTitle")} aria-label={t("swx.swarm.goal.editAria")}>
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
  const { t } = useI18n()
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
      setError(err instanceof Error ? err.message : t("swx.swarm.goal.updateError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ade-swarm-card ade-swarm-goal is-editing" aria-label={t("swx.swarm.goal.editSectionAria")}>
      <span className="ade-swarm-eyebrow">{t("swx.swarm.goal.eyebrow")}</span>
      <input className="ade-input-sm" value={title} onChange={e => setTitle(e.target.value)} placeholder={t("swx.swarm.goal.titlePlaceholder")} />
      <input className="ade-input-sm" value={gTitle} onChange={e => setGTitle(e.target.value)} placeholder={t("swx.swarm.goal.headlinePlaceholder")} />
      <textarea className="ade-input-sm" rows={2} value={gSummary} onChange={e => setGSummary(e.target.value)} placeholder={t("swx.swarm.goal.summaryPlaceholder")} />
      {error ? <p className="ade-error-text ade-xs" role="alert">{error}</p> : null}
      <div className="ade-swarm-goal-actions">
        <button type="button" className="ade-chip-btn" onClick={onCancel} disabled={saving}>{t("swx.swarm.goal.cancel")}</button>
        <button type="button" className="ade-chip-btn is-primary" onClick={() => void save()} disabled={saving}>
          <Check className="size-3.5" /> {saving ? t("swx.swarm.goal.saving") : t("swx.swarm.goal.save")}
        </button>
      </div>
    </section>
  )
}
