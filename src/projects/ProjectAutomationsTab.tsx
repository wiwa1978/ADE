import { useEffect, useState, type FormEvent } from "react"
import { CalendarClock, Play, Plus, Tag, Trash2 } from "lucide-react"
import { request } from "../../api"
import { relativeTime } from "../session-state"

type Trigger =
  | { type: "schedule"; every: "hourly" | "daily" | "weekdays" | "weekly"; at: string; day?: number }
  | { type: "issue-label"; label: string }
type Run = { at: number; sessionId: string | null; reason: string; error?: string }
type Automation = { id: string; name: string; prompt: string; agent: "pi" | "claude-code" | "codex"; trigger: Trigger; enabled: boolean; lastRunAt: number | null; runs: Run[] }

const agentNames = { pi: "ADE agent", "claude-code": "Claude Code", codex: "Codex" }
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function describe(trigger: Trigger) {
  if (trigger.type === "issue-label") return `When an issue gets the “${trigger.label}” label`
  const time = trigger.every === "hourly" ? `at :${trigger.at.split(":")[1]}` : `at ${trigger.at}`
  if (trigger.every === "hourly") return `Every hour ${time}`
  if (trigger.every === "daily") return `Every day ${time}`
  if (trigger.every === "weekdays") return `Weekdays ${time}`
  return `Every ${days[trigger.day ?? 1]} ${time}`
}

const blank = { name: "", prompt: "", agent: "pi" as Automation["agent"], triggerType: "schedule" as Trigger["type"], every: "daily" as "hourly" | "daily" | "weekdays" | "weekly", at: "09:00", day: 1, label: "agent" }

/**
 * Project tab for background agents: run a prompt on a schedule, or start a session whenever a
 * GitHub issue gets a label. Every run is a normal session in its own worktree, so it lands in the Inbox.
 */
export function ProjectAutomationsTab({
  projectId,
  hasGitHub,
  hasCheckout,
  onOpenSession,
}: {
  projectId: string
  hasGitHub: boolean
  hasCheckout: boolean
  onOpenSession: (sessionId: string) => void
}) {
  const [items, setItems] = useState<Automation[] | null>(null)
  const [form, setForm] = useState<typeof blank | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = () => request<{ automations: Automation[] }>(`/api/projects/${encodeURIComponent(projectId)}/automations`)
      .then(result => { if (!cancelled) setItems(result.automations) })
      .catch(err => { if (!cancelled) { setItems([]); setError(err instanceof Error ? err.message : "Could not load automations.") } })
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [projectId])

  const call = async (name: string, path: string, method: string, body?: unknown) => {
    setBusy(name)
    setError("")
    try {
      const result = await request<{ automations: Automation[]; sessionId?: string }>(path, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      })
      setItems(result.automations)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.")
      return null
    } finally {
      setBusy(null)
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!form) return
    const trigger: Trigger = form.triggerType === "issue-label"
      ? { type: "issue-label", label: form.label }
      : { type: "schedule", every: form.every, at: form.at, ...(form.every === "weekly" ? { day: form.day } : {}) }
    const result = await call("create", `/api/projects/${encodeURIComponent(projectId)}/automations`, "POST", { name: form.name, prompt: form.prompt, agent: form.agent, trigger })
    if (result) setForm(null)
  }

  if (!hasCheckout) {
    return <div className="ade-pane-empty"><p>Automations need a local checkout of the project to create worktrees in.</p></div>
  }

  return (
    <div className="ade-automations">
      <header className="ade-automations-head">
        <div>
          <h2>Automations</h2>
          <p>Agents that start by themselves: on a schedule, or when an issue gets a label. Each run is a session on its own branch and shows up in the Inbox for review.</p>
        </div>
        {!form ? <button type="button" className="sf-btn-primary !h-8" onClick={() => setForm({ ...blank })}><Plus className="size-3.5" /> New automation</button> : null}
      </header>
      {error ? <div className="ade-banner-error" role="alert">{error}</div> : null}

      {form ? (
        <form className="ade-automation-form" onSubmit={event => void save(event)}>
          <label>Name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Weekly dependency update" required /></label>
          <div className="ade-automation-row">
            <label>Starts
              <select value={form.triggerType} onChange={event => setForm({ ...form, triggerType: event.target.value as Trigger["type"] })}>
                <option value="schedule">On a schedule</option>
                <option value="issue-label" disabled={!hasGitHub}>When an issue gets a label{hasGitHub ? "" : " (link GitHub first)"}</option>
              </select>
            </label>
            {form.triggerType === "schedule" ? (
              <>
                <label>Every
                  <select value={form.every} onChange={event => setForm({ ...form, every: event.target.value as typeof form.every })}>
                    <option value="hourly">Hour</option>
                    <option value="daily">Day</option>
                    <option value="weekdays">Weekday</option>
                    <option value="weekly">Week</option>
                  </select>
                </label>
                {form.every === "weekly" ? (
                  <label>On
                    <select value={form.day} onChange={event => setForm({ ...form, day: Number(event.target.value) })}>
                      {days.map((day, index) => <option key={day} value={index}>{day}</option>)}
                    </select>
                  </label>
                ) : null}
                <label>At<input type="time" value={form.at} onChange={event => setForm({ ...form, at: event.target.value })} required /></label>
              </>
            ) : (
              <label>Label<input value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} placeholder="agent" required /></label>
            )}
            <label>Agent
              <select value={form.agent} onChange={event => setForm({ ...form, agent: event.target.value as Automation["agent"] })}>
                {Object.entries(agentNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          </div>
          <label>What should the agent do?
            <textarea rows={4} value={form.prompt} onChange={event => setForm({ ...form, prompt: event.target.value })} required
              placeholder={form.triggerType === "issue-label" ? "Investigate and fix this issue: {{issue}}\nAdd a test that reproduces it." : "Update outdated dependencies, run the tests, and summarize what changed."} />
          </label>
          {form.triggerType === "issue-label" ? <p className="ade-muted ade-xs"><code>{"{{issue}}"}</code> is replaced by the issue's number, title, link and description. Issues that already have the label now are skipped; one new issue starts per check (every 5 minutes).</p> : null}
          <div className="ade-review-actions">
            <button type="submit" className="ade-btn ade-btn-primary ade-btn-xs" disabled={busy === "create"}>{busy === "create" ? "Saving…" : "Create automation"}</button>
            <button type="button" className="ade-chip-btn" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ) : null}

      {items === null ? <p className="ade-muted">Loading…</p> : !items.length && !form ? (
        <div className="ade-pane-empty"><p>No automations yet.</p><p className="ade-muted ade-xs">For example: “Every weekday at 08:00, triage new issues”, or “When an issue gets the <code>agent</code> label, fix it”.</p></div>
      ) : (
        <ul className="ade-automation-list">
          {items.map(item => (
            <li key={item.id} className={item.enabled ? "" : "is-paused"}>
              <div className="ade-automation-main">
                <strong>{item.name}</strong>
                <span className="ade-muted ade-xs">
                  {item.trigger.type === "issue-label" ? <Tag className="inline size-3" /> : <CalendarClock className="inline size-3" />} {describe(item.trigger)} · {agentNames[item.agent]}
                </span>
                <span className="ade-muted ade-xs ade-truncate" title={item.prompt}>{item.prompt}</span>
                {item.runs[0] ? (
                  <span className="ade-xs">
                    Last run {relativeTime(item.runs[0].at)} ({item.runs[0].reason}){item.runs[0].error ? <span className="ade-text-error"> · failed: {item.runs[0].error}</span> : null}
                    {item.runs[0].sessionId ? <> · <button type="button" className="ade-link-btn" onClick={() => onOpenSession(item.runs[0].sessionId!)}>Open session</button></> : null}
                  </span>
                ) : <span className="ade-muted ade-xs">Hasn't run yet.</span>}
              </div>
              <div className="ade-automation-actions">
                <label className="ade-automation-toggle" title={item.enabled ? "Pause" : "Resume"}>
                  <input type="checkbox" checked={item.enabled} onChange={event => void call(item.id, `/api/automations/${encodeURIComponent(item.id)}`, "PUT", { enabled: event.target.checked })} />
                  {item.enabled ? "On" : "Paused"}
                </label>
                {item.trigger.type === "schedule" ? (
                  <button type="button" className="ade-chip-btn" disabled={busy === item.id} title="Start a run now" onClick={() => void call(item.id, `/api/automations/${encodeURIComponent(item.id)}/run`, "POST", {}).then(result => { if (result?.sessionId) onOpenSession(result.sessionId) })}>
                    <Play className="size-3" /> {busy === item.id ? "Starting…" : "Run now"}
                  </button>
                ) : null}
                <button type="button" className="ade-icon-btn" aria-label={`Delete ${item.name}`} title="Delete" onClick={() => { if (confirm(`Delete the automation "${item.name}"? Its past sessions stay.`)) void call(item.id, `/api/automations/${encodeURIComponent(item.id)}`, "DELETE") }}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
