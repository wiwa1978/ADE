import { useEffect, useState } from "react"
import { request, requestJson } from "../api"
import { useI18n } from "../i18n/I18nContext"
import { configuredCloudProviders, runTargetDescriptions, targetLabel, targetUnavailable, useRunTargets, type TargetSettings, type VmSize } from "../run-targets"

/** Project settings: where new sessions run by default, with the settings each target needs. */
export function ProjectRunOnSettings({ projectId }: { projectId: string }) {
  const { t } = useI18n()
  const info = useRunTargets()
  const [saved, setSaved] = useState<TargetSettings | null>(null)
  const [draft, setDraft] = useState<TargetSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let cancelled = false
    void request<TargetSettings>(`/api/projects/${encodeURIComponent(projectId)}/run-on`).then(result => {
      if (cancelled) return
      setSaved(result)
      setDraft(result)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [projectId])

  if (!draft || !saved) return null
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const set = (patch: Partial<TargetSettings>) => setDraft({ ...draft, ...patch })

  const save = async () => {
    setSaving(true)
    setMessage("")
    try {
      const result = await requestJson<TargetSettings>(`/api/projects/${encodeURIComponent(projectId)}/run-on`, "PUT", draft)
      setSaved(result)
      setDraft(result)
      setMessage(t("prjx.cfg.runOn.savedMsg"))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("prjx.cfg.runOn.saveError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="project-scripts" aria-labelledby="project-run-on-title">
      <h3 id="project-run-on-title">{t("prjx.cfg.runOn.title")}</h3>
      <p className="hint">{t("prjx.cfg.runOn.intro")}</p>
      <div className="st-segmented ade-run-on-choices" role="radiogroup" aria-label={t("prjx.cfg.runOn.groupAria")}>
        {(info?.available ?? ["local", "docker"]).map(target => {
          const blocked = target === "ssh" ? "" : targetUnavailable(target, info)
          return (
            <button key={target} type="button" role="radio" aria-checked={draft.target === target} className={draft.target === target ? "is-active" : ""} disabled={Boolean(blocked)} title={blocked || runTargetDescriptions[target]} onClick={() => set({ target })}>
              {targetLabel(target)}
            </button>
          )
        })}
      </div>
      <p className="hint">{runTargetDescriptions[draft.target]}</p>
      {draft.target === "docker" ? (
        <label>{t("prjx.cfg.runOn.dockerImage")}
          <input value={draft.image} onChange={event => set({ image: event.target.value })} placeholder="node:22-bookworm" spellCheck={false} disabled={saving} />
          <small className="hint">{t("prjx.cfg.runOn.dockerHint")}</small>
        </label>
      ) : null}
      {draft.target === "ssh" ? (
        <>
          <label>{t("prjx.cfg.runOn.sshHost")}
            <input value={draft.sshHost} onChange={event => set({ sshHost: event.target.value })} placeholder={t("prjx.cfg.runOn.sshHostPlaceholder")} spellCheck={false} disabled={saving} />
            <small className="hint">{t("prjx.cfg.runOn.sshHostHint")}</small>
          </label>
          <label>{t("prjx.cfg.runOn.remoteFolder")}
            <input value={draft.remoteRoot} onChange={event => set({ remoteRoot: event.target.value })} placeholder="ade-workspaces" spellCheck={false} disabled={saving} />
            <small className="hint">{t("prjx.cfg.runOn.remoteFolderHint")}</small>
          </label>
        </>
      ) : null}
      {draft.target === "wsl" ? (
        <label>{t("prjx.cfg.runOn.wslDistro")}
          <input value={draft.wslDistro} onChange={event => set({ wslDistro: event.target.value })} placeholder={t("prjx.cfg.runOn.wslDistroPlaceholder")} spellCheck={false} disabled={saving} />
        </label>
      ) : null}
      {draft.target === "boat" ? (
        <p className="hint">{info?.boat.configured ? t("prjx.cfg.runOn.boatConfigured") : t("prjx.cfg.runOn.boatUnconfigured")}</p>
      ) : null}
      {draft.target === "cloud" ? (() => {
        const providers = info?.cloudProviders ?? []
        const configured = configuredCloudProviders(info)
        const selectedProvider = providers.find(p => p.id === draft.cloudProvider) ?? configured[0] ?? providers[0] ?? null
        return (
          <>
            {configured.length === 0 ? (
              <p className="hint">Connect a Cloud VM provider (Boat.dev, Daytona, or E2B) in Settings → Integrations first.</p>
            ) : (
              <>
                <label>Cloud provider
                  <select
                    value={draft.cloudProvider || configured[0]?.id || ""}
                    onChange={event => set({ cloudProvider: event.target.value })}
                    disabled={saving}
                  >
                    {providers.map(provider => (
                      <option key={provider.id} value={provider.id} disabled={!provider.configured}>
                        {provider.label}{provider.configured ? "" : " (not connected)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>VM size
                  <select
                    value={draft.vmSize || "medium"}
                    onChange={event => set({ vmSize: event.target.value as VmSize })}
                    disabled={saving}
                  >
                    {(["small", "medium", "large"] as VmSize[]).map(size => (
                      <option key={size} value={size}>
                        {size[0].toUpperCase() + size.slice(1)}{selectedProvider ? ` (${selectedProvider.sizes[size]})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Auto-sleep idle VMs after (minutes)
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={draft.idleSleepMinutes ?? 15}
                    onChange={event => set({ idleSleepMinutes: Math.max(0, Number(event.target.value) || 0) })}
                    disabled={saving}
                  />
                  <small className="hint">0 disables auto-sleep. Sleeping VMs wake automatically on your next message.</small>
                </label>
              </>
            )}
          </>
        )
      })() : null}
      {draft.target === "docker" && info && !info.docker.available ? <p className="hint">{info.docker.message}</p> : null}
      <div className="form-actions">
        <button type="button" className="action-button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? t("prjx.cfg.saving") : t("prjx.cfg.runOn.saveButton")}</button>
        {message ? <span className="hint" role="status">{message}</span> : null}
      </div>
    </section>
  )
}
