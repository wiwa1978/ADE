import { useEffect, useState } from "react"
import { request, requestJson } from "../api"
import type { ProviderCatalogEntry } from "../app-types"
import { useI18n } from "../i18n/I18nContext"

type Harness = "pi" | "claude-code" | "codex" | "opencode"
type Policy = { allowed: Harness[]; choice: "agent" | Harness; piModel: string; claudeModel: string; codexModel: string; opencodeModel: string }
type Info = { policy: Policy; harnesses: Array<{ id: Harness; name: string; installed: boolean }>; guidance: Record<Harness, string> }

/**
 * Settings → Subagents. The main agent is always the ADE agent on Pi Durable (it survives restarts
 * and coordinates the work); here you choose what its subagents may run on.
 */
export function SubagentSettings({ modelCatalog }: { modelCatalog: ProviderCatalogEntry[] }) {
  const { t } = useI18n()
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")

  useEffect(() => {
    let cancelled = false
    void request<Info>("/api/subagent-policy").then(result => { if (!cancelled) setInfo(result) }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : t("stx.sub.loadError")) })
    return () => { cancelled = true }
  }, [t])

  const save = async (patch: Partial<Policy>) => {
    if (!info) return
    setError("")
    setSaved("")
    try {
      const result = await requestJson<{ policy: Policy }>("/api/subagent-policy", "PUT", { ...info.policy, ...patch })
      setInfo({ ...info, policy: result.policy })
      setSaved(t("stx.sub.saved"))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("stx.sub.saveError"))
    }
  }

  if (!info) return error ? <p className="st-error">{error}</p> : null
  const { policy } = info
  const piModels = modelCatalog.filter(provider => provider.configured).flatMap(provider => provider.models.map(model => ({ value: `${provider.id}/${model.id}`, label: `${provider.name} · ${model.name}` })))

  return (
    <>
      <section className="st-section">
        <h2>{t("stx.sub.mainAgent")}</h2>
        <p className="st-section-desc">{t("stx.sub.mainAgentDesc")}</p>
      </section>

      <section className="st-section">
        <h2>{t("stx.sub.harnesses")}</h2>
        <p className="st-section-desc">{t("stx.sub.harnessesDesc")}</p>
        <div className="st-card">
          {info.harnesses.map(harness => {
            const on = policy.allowed.includes(harness.id)
            return (
              <div className="st-row" key={harness.id}>
                <div className="st-row-text">
                  <span className="st-row-title">{harness.name}</span>
                  <p>{info.guidance[harness.id].charAt(0).toUpperCase() + info.guidance[harness.id].slice(1)}{harness.id !== "pi" && !harness.installed ? t("stx.sub.notInstalledSuffix") : ""}</p>
                </div>
                <div className="st-row-control">
                  <button type="button" role="switch" aria-label={t("stx.sub.allowHarness", { name: harness.name })} aria-checked={on} disabled={harness.id === "pi"}
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
        <h2>{t("stx.sub.choosing")}</h2>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <label htmlFor="subagent-choice">{t("stx.sub.whoPicks")}</label>
              <p>{policy.choice === "agent" ? t("stx.sub.agentPicksDesc") : t("stx.sub.alwaysUsesDesc")}</p>
            </div>
            <div className="st-row-control">
              <select id="subagent-choice" className="st-select" value={policy.choice} onChange={event => void save({ choice: event.target.value as Policy["choice"] })}>
                <option value="agent">{t("stx.sub.mainAgentDecides")}</option>
                {info.harnesses.filter(harness => policy.allowed.includes(harness.id)).map(harness => <option key={harness.id} value={harness.id}>{t("stx.sub.alwaysHarness", { name: harness.name })}</option>)}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="st-section">
        <h2>{t("stx.sub.models")}</h2>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <label htmlFor="subagent-pi-model">{t("stx.sub.piSubagents")}</label>
              <p>{t("stx.sub.piSubagentsDesc")}</p>
            </div>
            <div className="st-row-control">
              <select id="subagent-pi-model" className="st-select" value={policy.piModel} onChange={event => void save({ piModel: event.target.value })}>
                <option value="">{t("stx.sub.sameAsMain")}</option>
                {piModels.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}
                {policy.piModel && !piModels.some(model => model.value === policy.piModel) ? <option value={policy.piModel}>{policy.piModel}</option> : null}
              </select>
            </div>
          </div>
          <ModelField label="Claude Code" value={policy.claudeModel} placeholder={t("stx.sub.claudeDefault")} onSave={value => void save({ claudeModel: value })} />
          <ModelField label="Codex" value={policy.codexModel} placeholder={t("stx.sub.codexDefault")} onSave={value => void save({ codexModel: value })} />
          <ModelField label="OpenCode" value={policy.opencodeModel ?? ""} placeholder="OpenCode default (e.g. mistral/devstral-latest)" onSave={value => void save({ opencodeModel: value })} />
        </div>
        {error ? <p className="st-error" role="alert">{error}</p> : saved ? <p className="st-section-desc" role="status">{saved}</p> : null}
      </section>
    </>
  )
}

function ModelField({ label, value, placeholder, onSave }: { label: string; value: string; placeholder: string; onSave: (value: string) => void }) {
  const { t } = useI18n()
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
        <p>{t("stx.sub.cliModelDesc")}</p>
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
