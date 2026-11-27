import { useEffect, useState } from "react"
import { request } from "../api"
import { useI18n } from "../i18n/I18nContext"
import type { TranslationKey } from "../i18n"

import type { CloudProviderInfo } from "../run-targets"

type SlackEvents = { finished: boolean; needsApproval: boolean; failed: boolean; automations: boolean }
type Status = {
  slack: { configured: boolean; events: SlackEvents }
  linear: { configured: boolean; viewer: string | null }
  boat?: { configured: boolean }
  cloudProviders?: CloudProviderInfo[]
}

const eventLabels: Array<[keyof SlackEvents, TranslationKey, TranslationKey]> = [
  ["needsApproval", "stx.int.event.needsApproval", "stx.int.event.needsApprovalDesc"],
  ["finished", "stx.int.event.finished", "stx.int.event.finishedDesc"],
  ["failed", "stx.int.event.failed", "stx.int.event.failedDesc"],
  ["automations", "stx.int.event.automations", "stx.int.event.automationsDesc"],
]

/** Settings → Integrations: Slack notifications and Linear issues. Credentials are write-only. */
export function IntegrationsSettings() {
  const { t } = useI18n()
  const [status, setStatus] = useState<Status | null>(null)
  const [webhook, setWebhook] = useState("")
  const [linearKey, setLinearKey] = useState("")
  const [cloudForms, setCloudForms] = useState<Record<string, Record<string, string>>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ area: string; text: string; error?: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    void request<Status>("/api/integrations").then(result => { if (!cancelled) setStatus(result) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const call = async (area: string, name: string, path: string, method: string, body?: unknown, success?: string) => {
    setBusy(name)
    setMessage(null)
    try {
      const result = await request<Status & { sent?: boolean }>(path, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      })
      if ("slack" in result) setStatus(result)
      if (success) setMessage({ area, text: success })
      return true
    } catch (err) {
      setMessage({ area, text: err instanceof Error ? err.message : t("stx.int.errorFallback"), error: true })
      return false
    } finally {
      setBusy(null)
    }
  }

  const note = (area: string) => message?.area === area
    ? <div className="st-row"><span className={message.error ? "st-error" : "st-row-title"} role="status">{message.text}</span></div>
    : null

  const setCloudField = (providerId: string, key: string, value: string) => {
    setCloudForms(prev => ({ ...prev, [providerId]: { ...(prev[providerId] ?? {}), [key]: value } }))
  }

  return (
    <>
      <section className="st-section">
        <h2>Slack</h2>
        <p className="st-section-desc">{t("stx.int.slack.descBefore")} <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">{t("stx.int.slack.descLink")}</a> {t("stx.int.slack.descAfter")}</p>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <span className="st-row-title">{t("stx.int.slack.webhook")}</span>
              <p>{status?.slack.configured ? t("stx.int.slack.connectedDesc") : t("stx.int.slack.notSetUp")}</p>
            </div>
            <div className="st-row-control">
              {status?.slack.configured ? (
                <>
                  <button type="button" className="st-button" disabled={Boolean(busy)} onClick={() => void call("slack", "test", "/api/integrations/slack/test", "POST", {}, t("stx.int.slack.testSent"))}>{busy === "test" ? t("stx.int.slack.sending") : t("stx.int.slack.sendTest")}</button>
                  <button type="button" className="st-button is-quiet" disabled={Boolean(busy)} onClick={() => void call("slack", "remove", "/api/integrations/slack", "DELETE")}>{t("stx.int.disconnect")}</button>
                </>
              ) : null}
            </div>
          </div>
          <form className="st-inline-form" onSubmit={event => { event.preventDefault(); void call("slack", "save", "/api/integrations/slack", "PUT", { webhook }, t("stx.int.saved")).then(ok => { if (ok) setWebhook("") }) }}>
            <input type="password" aria-label={t("stx.int.slack.urlAria")} placeholder="https://hooks.slack.com/services/…" value={webhook} onChange={event => setWebhook(event.target.value)} autoComplete="off" />
            <button type="submit" className="st-button" disabled={!webhook.trim() || Boolean(busy)}>{busy === "save" ? t("stx.int.saving") : t("stx.int.save")}</button>
          </form>
          {note("slack")}
          {status?.slack.configured ? eventLabels.map(([key, titleKey, descKey]) => {
            const title = t(titleKey)
            return (
              <div className="st-row" key={key}>
                <div className="st-row-text"><span className="st-row-title">{title}</span><p>{t(descKey)}</p></div>
                <div className="st-row-control">
                  <button
                    type="button"
                    role="switch"
                    aria-label={title}
                    aria-checked={status.slack.events[key]}
                    className={`st-switch ${status.slack.events[key] ? "is-on" : ""}`}
                    onClick={() => void call("slack", key, "/api/integrations/slack", "PUT", { events: { [key]: !status.slack.events[key] } })}
                  ><span /></button>
                </div>
              </div>
            )
          }) : null}
        </div>
      </section>

      <section className="st-section">
        <h2>Linear</h2>
        <p className="st-section-desc">{t("stx.int.linear.desc")}</p>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <span className="st-row-title">{status?.linear.configured ? (status.linear.viewer ? t("stx.int.connectedAs", { viewer: status.linear.viewer }) : t("stx.int.connected")) : t("stx.int.notConnected")}</span>
              <p>{t("stx.int.linear.keyLocal")}</p>
            </div>
            <div className="st-row-control">
              {status?.linear.configured ? <button type="button" className="st-button is-quiet" disabled={Boolean(busy)} onClick={() => void call("linear", "remove-linear", "/api/integrations/linear", "DELETE")}>{t("stx.int.disconnect")}</button> : null}
            </div>
          </div>
          <form className="st-inline-form" onSubmit={event => { event.preventDefault(); void call("linear", "linear", "/api/integrations/linear", "PUT", { apiKey: linearKey }, t("stx.int.connectedDone")).then(ok => { if (ok) setLinearKey("") }) }}>
            <input type="password" aria-label={t("stx.int.linear.keyAria")} placeholder="lin_api_…" value={linearKey} onChange={event => setLinearKey(event.target.value)} autoComplete="off" />
            <button type="submit" className="st-button" disabled={!linearKey.trim() || Boolean(busy)}>{busy === "linear" ? t("stx.int.checking") : status?.linear.configured ? t("stx.int.replace") : t("stx.int.connect")}</button>
          </form>
          {note("linear")}
        </div>
      </section>

      <section className="st-section">
        <h2>Cloud VM Providers</h2>
        <p className="st-section-desc">
          Run agent sessions on isolated cloud VMs. Connect one or more providers to enable <strong>Cloud VM</strong> under <em>Run on</em>, choose VM sizes per project, and auto-sleep idle VMs.
        </p>
        {(status?.cloudProviders ?? []).map(provider => {
          const area = `cloud:${provider.id}`
          const values = cloudForms[provider.id] ?? {}
          const missingRequired = provider.fields.some(field => field.required && !(values[field.key]?.trim()))
          const sleepSummary = provider.features.sleep === "pause"
            ? "Pauses idle VMs (keeps disk & RAM)"
            : provider.features.sleep === "checkpoint"
              ? "Checkpoints idle VMs (keeps disk)"
              : "Stops idle VMs (keeps disk)"
          return (
            <div className="st-card" key={provider.id} style={{ marginBottom: "0.75rem" }}>
              <div className="st-row">
                <div className="st-row-text">
                  <span className="st-row-title">
                    <a href={provider.website} target="_blank" rel="noreferrer">{provider.label}</a>
                    {" · "}
                    {provider.configured ? t("stx.int.connected") : t("stx.int.notConnected")}
                  </span>
                  <p>{provider.description}</p>
                  <p style={{ opacity: 0.75, fontSize: "0.85em" }}>
                    {sleepSummary} · Sizes: {provider.sizes.small} / {provider.sizes.medium} / {provider.sizes.large}
                  </p>
                </div>
                <div className="st-row-control">
                  {provider.configured ? (
                    <button
                      type="button"
                      className="st-button is-quiet"
                      disabled={Boolean(busy)}
                      onClick={() => void call(area, `remove-${provider.id}`, `/api/cloud-providers/${encodeURIComponent(provider.id)}`, "DELETE")}
                    >
                      {t("stx.int.disconnect")}
                    </button>
                  ) : null}
                </div>
              </div>
              <form
                className="st-inline-form"
                onSubmit={event => {
                  event.preventDefault()
                  void call(
                    area,
                    `save-${provider.id}`,
                    `/api/cloud-providers/${encodeURIComponent(provider.id)}`,
                    "PUT",
                    { values },
                    t("stx.int.connectedDone"),
                  ).then(ok => {
                    if (ok) setCloudForms(prev => ({ ...prev, [provider.id]: {} }))
                  })
                }}
              >
                {provider.fields.map(field => (
                  <input
                    key={field.key}
                    type={field.kind === "secret" ? "password" : "text"}
                    aria-label={`${provider.label} ${field.label}`}
                    placeholder={field.placeholder || field.label}
                    value={values[field.key] ?? ""}
                    onChange={event => setCloudField(provider.id, field.key, event.target.value)}
                    autoComplete="off"
                    title={field.help}
                  />
                ))}
                <button type="submit" className="st-button" disabled={missingRequired || Boolean(busy)}>
                  {busy === `save-${provider.id}` ? t("stx.int.checking") : provider.configured ? t("stx.int.replace") : t("stx.int.connect")}
                </button>
              </form>
              {note(area)}
            </div>
          )
        })}
      </section>
    </>
  )
}
