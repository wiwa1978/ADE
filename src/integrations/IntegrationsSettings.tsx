import { useEffect, useState } from "react"
import { request } from "../../api"

type SlackEvents = { finished: boolean; needsApproval: boolean; failed: boolean; automations: boolean }
type Status = { slack: { configured: boolean; events: SlackEvents }; linear: { configured: boolean; viewer: string | null } }

const eventLabels: Array<[keyof SlackEvents, string, string]> = [
  ["needsApproval", "Needs approval", "An agent is waiting for you to approve a command."],
  ["finished", "Finished", "An agent finished its turn and the session is ready to review."],
  ["failed", "Failed", "An agent's turn failed."],
  ["automations", "Automation runs", "An automation started a session."],
]

/** Settings → Integrations: Slack notifications and Linear issues. Credentials are write-only. */
export function IntegrationsSettings() {
  const [status, setStatus] = useState<Status | null>(null)
  const [webhook, setWebhook] = useState("")
  const [linearKey, setLinearKey] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ area: "slack" | "linear"; text: string; error?: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    void request<Status>("/api/integrations").then(result => { if (!cancelled) setStatus(result) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const call = async (area: "slack" | "linear", name: string, path: string, method: string, body?: unknown, success?: string) => {
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
      setMessage({ area, text: err instanceof Error ? err.message : "That didn't work.", error: true })
      return false
    } finally {
      setBusy(null)
    }
  }

  const note = (area: "slack" | "linear") => message?.area === area
    ? <div className="st-row"><span className={message.error ? "st-error" : "st-row-title"} role="status">{message.text}</span></div>
    : null

  return (
    <>
      <section className="st-section">
        <h2>Slack</h2>
        <p className="st-section-desc">Get a Slack message when an agent needs you or is done, so you can step away while several agents work. Create an <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">incoming webhook</a> for a channel and paste its URL.</p>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <span className="st-row-title">Webhook</span>
              <p>{status?.slack.configured ? "Connected. Paste a new URL to replace it." : "Not set up."}</p>
            </div>
            <div className="st-row-control">
              {status?.slack.configured ? (
                <>
                  <button type="button" className="st-button" disabled={Boolean(busy)} onClick={() => void call("slack", "test", "/api/integrations/slack/test", "POST", {}, "Sent a test message.")}>{busy === "test" ? "Sending…" : "Send test"}</button>
                  <button type="button" className="st-button is-quiet" disabled={Boolean(busy)} onClick={() => void call("slack", "remove", "/api/integrations/slack", "DELETE")}>Disconnect</button>
                </>
              ) : null}
            </div>
          </div>
          <form className="st-inline-form" onSubmit={event => { event.preventDefault(); void call("slack", "save", "/api/integrations/slack", "PUT", { webhook }, "Saved.").then(ok => { if (ok) setWebhook("") }) }}>
            <input type="password" aria-label="Slack webhook URL" placeholder="https://hooks.slack.com/services/…" value={webhook} onChange={event => setWebhook(event.target.value)} autoComplete="off" />
            <button type="submit" className="st-button" disabled={!webhook.trim() || Boolean(busy)}>{busy === "save" ? "Saving…" : "Save"}</button>
          </form>
          {note("slack")}
          {status?.slack.configured ? eventLabels.map(([key, title, description]) => (
            <div className="st-row" key={key}>
              <div className="st-row-text"><span className="st-row-title">{title}</span><p>{description}</p></div>
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
          )) : null}
        </div>
      </section>

      <section className="st-section">
        <h2>Linear</h2>
        <p className="st-section-desc">Start sessions from Linear issues: New session gets an “Import Linear issue” button. Create a personal API key in Linear → Settings → Security &amp; access.</p>
        <div className="st-card">
          <div className="st-row">
            <div className="st-row-text">
              <span className="st-row-title">{status?.linear.configured ? `Connected${status.linear.viewer ? ` as ${status.linear.viewer}` : ""}` : "Not connected"}</span>
              <p>The key stays on this computer.</p>
            </div>
            <div className="st-row-control">
              {status?.linear.configured ? <button type="button" className="st-button is-quiet" disabled={Boolean(busy)} onClick={() => void call("linear", "remove-linear", "/api/integrations/linear", "DELETE")}>Disconnect</button> : null}
            </div>
          </div>
          <form className="st-inline-form" onSubmit={event => { event.preventDefault(); void call("linear", "linear", "/api/integrations/linear", "PUT", { apiKey: linearKey }, "Connected.").then(ok => { if (ok) setLinearKey("") }) }}>
            <input type="password" aria-label="Linear API key" placeholder="lin_api_…" value={linearKey} onChange={event => setLinearKey(event.target.value)} autoComplete="off" />
            <button type="submit" className="st-button" disabled={!linearKey.trim() || Boolean(busy)}>{busy === "linear" ? "Checking…" : status?.linear.configured ? "Replace" : "Connect"}</button>
          </form>
          {note("linear")}
        </div>
      </section>
    </>
  )
}
