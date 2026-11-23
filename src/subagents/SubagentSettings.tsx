import { useEffect, useState } from "react"
import { request } from "../../api"
import type { ProviderCatalogEntry } from "../../app-types"

type Harness = "pi" | "claude-code" | "codex"
type Policy = { allowed: Harness[]; choice: "agent" | Harness; piModel: string; claudeModel: string; codexModel: string }
type Info = { policy: Policy; harnesses: Array<{ id: Harness; name: string; installed: boolean }>; guidance: Record<Harness, string> }

/**
 * Settings → Subagents. The main agent is always the ADE agent on Pi Durable (it survives restarts
 * and coordinates the work); here you choose what its subagents may run on.
 */
export function SubagentSettings({ modelCatalog }: { modelCatalog: ProviderCatalogEntry[] }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")

  useEffect(() => {
    let cancelled = false
    void request<Info>("/api/subagent-policy").then(result => { if (!cancelled) setInfo(result) }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the subagent settings.") })
    return () => { cancelled = true }
  }, [])

  const save = async (patch: Partial<Policy>) => {
    if (!info) return
    setError("")
    setSaved("")
    try {
      const result = await request<{ policy: Policy }>("/api/subagent-policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...info.policy, ...patch }) })
      setInfo({ ...info, policy: result.policy })
      setSaved("Saved. New subagents use this.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.")
    }
  }

  if (!info) return error ? <p className="st-error">{error}</p> : null
  const { policy } = info
  const piModels = modelCatalog.filter(provider => provider.configured).flatMap(provider => provider.models.map(model => ({ value: `${provider.id}/${model.id}`, label: `${provider.name} · ${model.name}` })))

  return (
    <>
      <section className="st-section">
        <h2>Main agent</h2>
        <p className="st-section-desc">Every session is led by the ADE agent on Pi Durable. It keeps going after a restart or crash, plans the work, and hands parts of it to subagents. Claude Code and Codex aren't durable, so they work as subagents under it.</p>
      </section>

      <section className="st-section">
        <h2>Subagent harnesses</h2>
        <p className="st-section-desc">What subagents may run on. Pi is always available.</p>
        <div className="st-card">
          {info.harnesses.map(harness => {
            const on = policy.allowed.includes(harness.id)
            return (
              <div className="st-row" key={harness.id}>
                <div className="st-row-text">
                  <span className="st-row-title">{harness.name}</span>
                  <p>{info.guidance[harness.id].charAt(0).toUpperCase() + info.guidance[harness.id].slice(1)}{harness.id !== "pi" && !harness.installed ? " Not installed on this computer; ADE installs it when a session runs in Docker, over SSH or on Boat.dev." : ""}</p>
                </div>
                <div className="st-row-control">
                  <button type="button" role="switch" aria-label={`Allow ${harness.name}`} aria-checked={on} disabled={harness.id === "pi"}
                    className={`st-switch ${on ? "is-on" : ""}`}
                    onClick={() => void save({ allowed: on ? policy.allowed.filter(item => item !== harness.id) : [...policy.allowed, harness.id], ...(on && policy.choice === harness.id ? { choice: "agent" as const } : {}) })}>
                    <span />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="st-section">
        <h2>Choosing</h2>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <label htmlFor="subagent-choice">Who picks the harness</label>
              <p>{policy.choice === "agent" ? "The main agent picks the best fit for each subagent from the allowed harnesses, and says why." : "Every subagent uses this harness."}</p>
            </div>
            <div className="st-row-control">
              <select id="subagent-choice" className="st-select" value={policy.choice} onChange={event => void save({ choice: event.target.value as Policy["choice"] })}>
                <option value="agent">Main agent decides</option>
                {info.harnesses.filter(harness => policy.allowed.includes(harness.id)).map(harness => <option key={harness.id} value={harness.id}>Always {harness.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="st-section">
        <h2>Models</h2>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <label htmlFor="subagent-pi-model">Pi subagents</label>
              <p>For example a faster, cheaper model for research subagents.</p>
            </div>
            <div className="st-row-control">
              <select id="subagent-pi-model" className="st-select" value={policy.piModel} onChange={event => void save({ piModel: event.target.value })}>
                <option value="">Same as the main agent</option>
                {piModels.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}
                {policy.piModel && !piModels.some(model => model.value === policy.piModel) ? <option value={policy.piModel}>{policy.piModel}</option> : null}
              </select>
            </div>
          </div>
          <ModelField label="Claude Code" value={policy.claudeModel} placeholder="Claude Code's default" onSave={value => void save({ claudeModel: value })} />
          <ModelField label="Codex" value={policy.codexModel} placeholder="Codex's default" onSave={value => void save({ codexModel: value })} />
        </div>
        {error ? <p className="st-error" role="alert">{error}</p> : saved ? <p className="st-section-desc" role="status">{saved}</p> : null}
      </section>
    </>
  )
}

function ModelField({ label, value, placeholder, onSave }: { label: string; value: string; placeholder: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setDraft(value)
  }
  const id = `subagent-model-${label.replace(/\W+/g, "-").toLowerCase()}`
  return (
    <div className="st-row">
      <div className="st-row-text">
        <label htmlFor={id}>{label}</label>
        <p>Model name passed to the CLI. Leave empty for its default.</p>
      </div>
      <div className="st-row-control">
        <input id={id} className="st-input" value={draft} placeholder={placeholder} spellCheck={false}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => { if (draft.trim() !== value) onSave(draft.trim()) }}
          onKeyDown={event => { if (event.key === "Enter" && draft.trim() !== value) onSave(draft.trim()) }} />
      </div>
    </div>
  )
}
