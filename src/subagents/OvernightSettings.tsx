import { useEffect, useState } from "react"
import { request, requestJson } from "../../api"
import type { ProviderCatalogEntry } from "../../app-types"

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
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the limits.") })
    return () => { cancelled = true }
  }, [])

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
      setSaved("Saved.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the limits.")
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
          <input id={`limit-${key}`} inputMode="decimal" value={draft[key]} placeholder="No limit" onChange={set(key)}
            onKeyDown={event => { if (event.key === "Enter" && changed) void apply() }} />
          <small>{unit}</small>
        </span>
      </div>
    </div>
  )

  return (
    <>
      <section className="st-section">
        <h2>Unattended work</h2>
        <p className="st-section-desc">For work you leave running, such as overnight. When a limit is reached, ADE stops that agent and its subagents and tells you (Inbox and Slack). Nothing is undone; you can continue the session yourself. Leave a field empty for no limit.</p>
        <div className="st-card">
          {field("taskMinutes", "Time per task", "How long one request to an agent may run.", "min")}
          {field("taskCost", "Cost per task", "What one request may spend, its subagents included.", "$")}
          {field("dayCost", "Cost per day", `What all agents together may spend today. Spent so far: $${todayCost.toFixed(2)}.`, "$")}
        </div>
      </section>

      <section className="st-section">
        <h2>Usage limits</h2>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <label htmlFor="limit-fallback">When a model hits its usage limit</label>
              <p>{draft.fallback ? "The main agent continues on this model straight away." : "ADE waits until the limit resets, then tells the agent to continue."} Claude Code and Codex subagents always wait for their reset.</p>
            </div>
            <div className="st-row-control">
              <select id="limit-fallback" className="st-select" value={draft.fallback} onChange={set("fallback")}>
                <option value="">Wait for the reset</option>
                {models.map(model => <option key={model.value} value={model.value}>Switch to {model.label}</option>)}
                {draft.fallback && !models.some(model => model.value === draft.fallback) ? <option value={draft.fallback}>Switch to {draft.fallback}</option> : null}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="st-section">
        <h2>Subagents at once</h2>
        <div className="st-card">
          {field("maxSubagents", "Claude Code and Codex subagents", "The main agent can hand out any number of tasks; ADE starts them as this machine has room (about 1 GB of memory each) and queues the rest. Set a number to cap it. Subagents on SSH hosts or Boat.dev don't count.", "max")}
        </div>
        {error ? <p className="st-error" role="alert">{error}</p> : saved ? <p className="st-section-desc" role="status">{saved}</p> : null}
        {changed ? (
          <div className="st-apply-bar" role="region" aria-label="Unsaved limits">
            <span>Limits changed. Apply them to use them from the next check.</span>
            <button type="button" className="st-button is-quiet" onClick={() => setDraft(toDraft(limits))}>Revert</button>
            <button type="button" className="st-button is-primary" onClick={() => void apply()}>Apply</button>
          </div>
        ) : null}
      </section>
    </>
  )
}
