import { useEffect, useState } from "react"
import { request } from "../api"
import { useI18n } from "../i18n/I18nContext"
import type { TranslationKey } from "../i18n"

type SlackEvents = { finished: boolean; needsApproval: boolean; failed: boolean; automations: boolean }
type Status = { slack: { configured: boolean; events: SlackEvents }; linear: { configured: boolean; viewer: string | null }; boat?: { configured: boolean } }

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
  const [boatKey, setBoatKey] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ area: "slack" | "linear" | "boat"; text: string; error?: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    void request<Status>("/api/integrations").then(result => { if (!cancelled) setStatus(result) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const call = async (area: "slack" | "linear" | "boat", name: string, path: string, method: string, body?: unknown, success?: string) => {
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

  const note = (area: "slack" | "linear" | "boat") => message?.area === area
    ? <div className="st-row"><span className={message.error ? "st-error" : "st-row-title"} role="status">{message.text}</span></div>
    : null

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
        <h2>Boat.dev</h2>
        <p className="st-section-desc">{t("stx.int.boat.descBefore")} <code>boat api-key create ade --preset full-sandbox</code> {t("stx.int.boat.descMid")} <a href="https://boat.dev/dashboard?tab=api-keys" target="_blank" rel="noreferrer">{t("stx.int.boat.descLink")}</a>.</p>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <span className="st-row-title">{status?.boat?.configured ? t("stx.int.connected") : t("stx.int.notConnected")}</span>
              <p>{t("stx.int.boat.keyLocal")}</p>
            </div>
            <div className="st-row-control">
              {status?.boat?.configured ? <button type="button" className="st-button is-quiet" disabled={Boolean(busy)} onClick={() => void call("boat", "remove-boat", "/api/integrations/boat", "DELETE")}>{t("stx.int.disconnect")}</button> : null}
            </div>
          </div>
          <form className="st-inline-form" onSubmit={event => { event.preventDefault(); void call("boat", "boat", "/api/integrations/boat", "PUT", { apiKey: boatKey }, t("stx.int.connectedDone")).then(ok => { if (ok) setBoatKey("") }) }}>
            <input type="password" aria-label={t("stx.int.boat.keyAria")} placeholder="boat_…" value={boatKey} onChange={event => setBoatKey(event.target.value)} autoComplete="off" />
            <button type="submit" className="st-button" disabled={!boatKey.trim() || Boolean(busy)}>{busy === "boat" ? t("stx.int.checking") : status?.boat?.configured ? t("stx.int.replace") : t("stx.int.connect")}</button>
          </form>
          {note("boat")}
        </div>
      </section>
    </>
  )
}
