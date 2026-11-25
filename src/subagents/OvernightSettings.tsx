import { useEffect, useState } from "react"
import { request, requestJson } from "../api"
import type { ProviderCatalogEntry } from "../app-types"
import { useI18n } from "../i18n/I18nContext"

type Limits = { taskMinutes: number; taskCost: number; dayCost: number; fallbackProvider: string; fallbackModel: string; maxSubagents: number }
type Draft = Record<"taskMinutes" | "taskCost" | "dayCost" | "maxSubagents", string> & { fallback: string }

const toDraft = (limits: Limits): Draft => ({
  taskMinutes: limits.taskMinutes ? String(limits.taskMinutes) : "",
  taskCost: limits.taskCost ? String(limits.taskCost) : "",
  dayCost: limits.dayCost ? String(limits.dayCost) : "",
  maxSubagents: limits.maxSubagents ? String(limits.maxSubagents) : "",
  fallback: limits.fallbackProvider && limits.fallbackModel ? `${limits.fallbackProvider}/${limits.fallbackModel}` : "",
})

/**
 * Settings → Agents & permissions → Unattended work: limits per task and per day, what happens at a
 * provider's usage limit, and how many Claude Code / Codex subagents run at once on this machine.
 */
export function OvernightSettings({ modelCatalog }: { modelCatalog: ProviderCatalogEntry[] }) {
  const { t } = useI18n()
  const [limits, setLimits] = useState<Limits | null>(null)
  const [todayCost, setTodayCost] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")

  useEffect(() => {
    let cancelled = false
    void request<{ limits: Limits; todayCost: number }>("/api/limits").then(result => {
      if (cancelled) return
      setLimits(result.limits)
      setDraft(toDraft(result.limits))
      setTodayCost(result.todayCost)
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : t("stx.overnight.loadError")) })
    return () => { cancelled = true }
  }, [t])

  if (!limits || !draft) return error ? <p className="st-error">{error}</p> : null
  const changed = JSON.stringify(draft) !== JSON.stringify(toDraft(limits))
  const models = modelCatalog.filter(provider => provider.configured).flatMap(provider => provider.models.map(model => ({ value: `${provider.id}/${model.id}`, label: `${provider.name} · ${model.name}` })))
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => { setSaved(""); setDraft({ ...draft, [key]: event.target.value }) }

  const apply = async () => {
    setError("")
    setSaved("")
    const slash = draft.fallback.indexOf("/")
    try {
      const result = await requestJson<{ limits: Limits }>("/api/limits", "PUT", {
          taskMinutes: Number(draft.taskMinutes || 0),
          taskCost: Number(draft.taskCost || 0),
          dayCost: Number(draft.dayCost || 0),
          maxSubagents: Number(draft.maxSubagents || 0),
          fallbackProvider: slash > 0 ? draft.fallback.slice(0, slash) : "",
          fallbackModel: slash > 0 ? draft.fallback.slice(slash + 1) : "",
        })
      setLimits(result.limits)
      setDraft(toDraft(result.limits))
      setSaved(t("stx.overnight.saved"))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("stx.overnight.saveError"))
    }
  }

  const field = (key: "taskMinutes" | "taskCost" | "dayCost" | "maxSubagents", title: string, description: string, unit: string) => (
    <div className="st-row">
      <div className="st-row-text">
        <label htmlFor={`limit-${key}`}>{title}</label>
        <p>{description}</p>
      </div>
      <div className="st-row-control">
        <span className="st-number">
          <input id={`limit-${key}`} inputMode="decimal" value={draft[key]} placeholder={t("stx.overnight.noLimit")} onChange={set(key)}
            onKeyDown={event => { if (event.key === "Enter" && changed) void apply() }} />
          <small>{unit}</small>
        </span>
      </div>
    </div>
  )

  return (
    <>
      <section className="st-section">
        <h2>{t("stx.overnight.title")}</h2>
        <p className="st-section-desc">{t("stx.overnight.desc")}</p>
        <div className="st-card">
          {field("taskMinutes", t("stx.overnight.timePerTask"), t("stx.overnight.timePerTaskDesc"), t("stx.overnight.unitMin"))}
          {field("taskCost", t("stx.overnight.costPerTask"), t("stx.overnight.costPerTaskDesc"), "$")}
          {field("dayCost", t("stx.overnight.costPerDay"), t("stx.overnight.costPerDayDesc", { amount: todayCost.toFixed(2) }), "$")}
        </div>
      </section>

      <section className="st-section">
        <h2>{t("stx.overnight.usageLimits")}</h2>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <label htmlFor="limit-fallback">{t("stx.overnight.whenLimitHit")}</label>
              <p>{draft.fallback ? t("stx.overnight.fallbackContinue") : t("stx.overnight.fallbackWait")} {t("stx.overnight.subagentsAlwaysWait")}</p>
            </div>
            <div className="st-row-control">
              <select id="limit-fallback" className="st-select" value={draft.fallback} onChange={set("fallback")}>
                <option value="">{t("stx.overnight.waitForReset")}</option>
                {models.map(model => <option key={model.value} value={model.value}>{t("stx.overnight.switchTo", { model: model.label })}</option>)}
                {draft.fallback && !models.some(model => model.value === draft.fallback) ? <option value={draft.fallback}>{t("stx.overnight.switchTo", { model: draft.fallback })}</option> : null}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="st-section">
        <h2>{t("stx.overnight.subagentsAtOnce")}</h2>
        <div className="st-card">
          {field("maxSubagents", t("stx.overnight.maxSubagents"), t("stx.overnight.maxSubagentsDesc"), t("stx.overnight.unitMax"))}
        </div>
        {error ? <p className="st-error" role="alert">{error}</p> : saved ? <p className="st-section-desc" role="status">{saved}</p> : null}
        {changed ? (
          <div className="st-apply-bar" role="region" aria-label={t("stx.overnight.unsavedLimits")}>
            <span>{t("stx.overnight.limitsChanged")}</span>
            <button type="button" className="st-button is-quiet" onClick={() => setDraft(toDraft(limits))}>{t("stx.overnight.revert")}</button>
            <button type="button" className="st-button is-primary" onClick={() => void apply()}>{t("stx.overnight.apply")}</button>
          </div>
        ) : null}
      </section>
    </>
  )
}
