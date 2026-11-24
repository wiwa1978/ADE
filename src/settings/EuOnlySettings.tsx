import { useCallback, useEffect, useState } from "react"
import { Globe2, ShieldCheck } from "lucide-react"
import { request } from "../../api"
import { useI18n } from "../i18n/I18nContext"
import "./eu-only.css"

type Region = "eu" | "local" | "non-eu"
type Item = { kind: "provider" | "engine" | "mcp"; id: string; name: string; region: Region; allowed: boolean; exception: boolean }
type EuState = { settings: { euOnly: boolean; exceptions: string[]; compatibleInEu: boolean }; items: Item[] }

/**
 * EU-only mode: one switch. On, everything that would send your code outside the EU stays off
 * (models, agent CLIs, remote tool servers). The only way around it is an exception, set here.
 */
export function EuOnlySettings() {
  const { t } = useI18n()
  const [state, setState] = useState<EuState | null>(null)
  const [error, setError] = useState("")
  const regionLabel: Record<Region, string> = {
    eu: t("settings.eu.region.eu"),
    local: t("settings.eu.region.local"),
    "non-eu": t("settings.eu.region.nonEu"),
  }
  const kindLabel: Record<Item["kind"], string> = {
    provider: t("settings.eu.kind.provider"),
    engine: t("settings.eu.kind.engine"),
    mcp: t("settings.eu.kind.mcp"),
  }
  const load = useCallback(async () => {
    try { setState(await request<EuState>("/api/eu")) } catch (err) { setError(err instanceof Error ? err.message : t("settings.eu.loadError")) }
  }, [t])
  useEffect(() => {
    let alive = true
    request<EuState>("/api/eu").then(next => { if (alive) setState(next) }, err => { if (alive) setError(err instanceof Error ? err.message : t("settings.eu.loadError")) })
    return () => { alive = false }
  }, [t])

  const save = async (patch: Partial<EuState["settings"]>) => {
    setError("")
    try {
      await request("/api/eu", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : t("settings.eu.saveError")) }
  }
  if (!state) return error ? <p className="st-banner is-error" role="alert">{error}</p> : null
  const { settings, items } = state
  const toggleException = (item: Item) => {
    const key = `${item.kind}:${item.id}`
    void save({ exceptions: item.exception ? settings.exceptions.filter(entry => entry !== key) : [...settings.exceptions, key] })
  }
  return (
    <section className={`ade-eu ${settings.euOnly ? "is-on" : ""}`} aria-label={t("settings.eu.title")}>
      <div className="ade-eu-head">
        <ShieldCheck className="size-5" aria-hidden="true" />
        <div className="ade-eu-title">
          <strong>{t("settings.eu.title")}</strong>
          <span>{t("settings.eu.desc")}</span>
        </div>
        <label className="ade-eu-switch">
          <input type="checkbox" role="switch" checked={settings.euOnly} onChange={event => void save({ euOnly: event.target.checked })} aria-label={t("settings.eu.title")} />
          <span aria-hidden="true" />
        </label>
      </div>
      {error ? <p className="st-banner is-error" role="alert">{error}</p> : null}
      <label className="ade-eu-declare">
        <input type="checkbox" checked={settings.compatibleInEu} onChange={event => void save({ compatibleInEu: event.target.checked })} />
        <span>{t("settings.eu.compatibleInEu")} <em>{t("settings.eu.compatibleInEuHint")}</em></span>
      </label>
      <ul className="ade-eu-list">
        {items.map(item => (
          <li key={`${item.kind}:${item.id}`} className={`is-${item.region} ${item.allowed ? "" : "is-blocked"}`}>
            <Globe2 className="size-3.5" aria-hidden="true" />
            <span className="ade-eu-name">{item.name}<small>{kindLabel[item.kind]}</small></span>
            <span className={`ade-eu-region is-${item.region}`}>{regionLabel[item.region]}</span>
            {item.region === "non-eu" ? (
              settings.euOnly ? (
                <label className="ade-eu-allow"><input type="checkbox" checked={item.exception} onChange={() => toggleException(item)} /> {t("settings.eu.allowAnyway")}</label>
              ) : <span className="ade-eu-allow ade-muted">{t("settings.eu.wouldBeOff")}</span>
            ) : <span className="ade-eu-allow ade-muted">{t("common.allowed")}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
