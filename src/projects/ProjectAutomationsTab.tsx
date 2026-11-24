import { useCallback, useContext, useState, type FormEvent } from "react"
import { CalendarClock, Play, Plus, Tag, Trash2 } from "lucide-react"
import { request } from "../../api"
import { Badge, Banner, Button, EmptyState, IconButton, Input, Switch, Textarea } from "@/components/ui"
import { ConfirmContext } from "@/components/ui/confirm-context"
import { usePolling } from "../hooks/usePolling"
import { relativeTime } from "../session-state"

type Trigger =
  | { type: "schedule"; every: "hourly" | "daily" | "weekdays" | "weekly"; at: string; day?: number }
  | { type: "issue-label"; label: string }
type Run = { at: number; sessionId: string | null; reason: string; error?: string }
type Automation = { id: string; name: string; prompt: string; agent: "pi" | "claude-code" | "codex"; trigger: Trigger; enabled: boolean; lastRunAt: number | null; runs: Run[] }

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const BLANK = {
  name: "", prompt: "", agent: "pi" as Automation["agent"], triggerType: "schedule" as Trigger["type"],
  every: "daily" as "hourly" | "daily" | "weekdays" | "weekly", at: "09:00", day: 1, label: "agent",
}

function describe(trigger: Trigger) {
  if (trigger.type === "issue-label") return `When an issue gets the “${trigger.label}” label`
  const time = trigger.every === "hourly" ? `at :${trigger.at.split(":")[1]}` : `at ${trigger.at}`
  if (trigger.every === "hourly") return `Every hour ${time}`
  if (trigger.every === "daily") return `Every day ${time}`
  if (trigger.every === "weekdays") return `Weekdays ${time}`
  return `Every ${DAYS[trigger.day ?? 1]} ${time}`
}

export function ProjectAutomationsTab({
  projectId, hasGitHub, hasCheckout, onOpenSession,
}: {
  projectId: string
  hasGitHub: boolean
  hasCheckout: boolean
  onOpenSession: (sessionId: string) => void
}) {
  const confirmCtx = useContext(ConfirmContext)
  const [items, setItems] = useState<Automation[] | null>(null)
  const [form, setForm] = useState<typeof BLANK | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  const loadAutomations = useCallback(async (signal: AbortSignal) => {
    try {
      const result = await request<{ automations: Automation[] }>(`/api/projects/${encodeURIComponent(projectId)}/automations`, { signal })
      setItems(result.automations)
    } catch (err) {
      if (signal.aborted) return
      setItems(prev => prev ?? [])
      setError(err instanceof Error ? err.message : "Could not load automations.")
    }
  }, [projectId])

  usePolling(loadAutomations, 30_000, { enabled: hasCheckout })

  const call = async (name: string, path: string, method: string, body?: unknown) => {
    setBusy(name); setError("")
    try {
      const result = await request<{ automations: Automation[]; sessionId?: string }>(path, {
        method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      })
      setItems(result.automations)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.")
      return null
    } finally { setBusy(null) }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!form) return
    const trigger: Trigger = form.triggerType === "issue-label"
      ? { type: "issue-label", label: form.label }
      : { type: "schedule", every: form.every, at: form.at, ...(form.every === "weekly" ? { day: form.day } : {}) }
    const result = await call("create", `/api/projects/${encodeURIComponent(projectId)}/automations`, "POST", {
      name: form.name, prompt: form.prompt, agent: form.agent, trigger,
    })
    if (result) setForm(null)
  }

  const handleDelete = async (item: Automation) => {
    const ok = confirmCtx
      ? await confirmCtx.confirm({ title: `Delete "${item.name}"?`, description: "Its past sessions will remain in your history.", confirmLabel: "Delete", destructive: true })
      : (typeof window === "undefined" || typeof window.confirm !== "function" ? true : window.confirm(`Delete the automation "${item.name}"? Its past sessions stay.`))
    if (ok) void call(item.id, `/api/automations/${encodeURIComponent(item.id)}`, "DELETE")
  }

  if (!hasCheckout) {
    return <EmptyState icon={<CalendarClock className="size-5" />} title="Local checkout required" description="Automations need a local checkout of the project to create worktrees in." />
  }

  return (
    <div className="ade-automations">
      <header className="ade-automations-head">
        <div>
          <h2>Automations</h2>
          <p>Agents that start by themselves: on a schedule, or when an issue gets a label. Each run is a session on its own branch and shows up in the Inbox for review.</p>
        </div>
        {!form ? <Button variant="primary" size="md" onClick={() => setForm({ ...BLANK })}><Plus /> New automation</Button> : null}
      </header>
      {error ? <Banner tone="error">{error}</Banner> : null}

      {form ? (
        <form className="ade-automation-form" onSubmit={event => void save(event)}>
          <label>Name<Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Weekly dependency update" required /></label>
          <div className="ade-automation-row">
            <label>Starts
              <select value={form.triggerType} onChange={e => setForm({ ...form, triggerType: e.target.value as Trigger["type"] })}>
                <option value="schedule">On a schedule</option>
                <option value="issue-label" disabled={!hasGitHub}>When an issue gets a label{hasGitHub ? "" : " (link GitHub first)"}</option>
              </select>
            </label>
            {form.triggerType === "schedule" ? (
              <>
                <label>Every
                  <select value={form.every} onChange={e => setForm({ ...form, every: e.target.value as typeof form.every })}>
                    <option value="hourly">Hour</option><option value="daily">Day</option><option value="weekdays">Weekday</option><option value="weekly">Week</option>
                  </select>
                </label>
                {form.every === "weekly" ? (
                  <label>On<select value={form.day} onChange={e => setForm({ ...form, day: Number(e.target.value) })}>{DAYS.map((day, idx) => <option key={day} value={idx}>{day}</option>)}</select></label>
                ) : null}
                <label>At<Input inputSize="sm" type="time" value={form.at} onChange={e => setForm({ ...form, at: e.target.value })} required /></label>
              </>
            ) : (
              <label>Label<Input inputSize="sm" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="agent" required /></label>
            )}
          </div>
          <label>What should the agent do?
            <Textarea
              rows={4} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} required
              placeholder={form.triggerType === "issue-label" ? "Investigate and fix this issue: {{issue}}\nAdd a test that reproduces it." : "Update outdated dependencies, run the tests, and summarize what changed."}
            />
          </label>
          {form.triggerType === "issue-label" ? (
            <p className="ade-muted ade-xs"><code>{"{{issue}}"}</code> is replaced by the issue's number, title, link and description. Issues that already have the label now are skipped; one new issue starts per check (every 5 minutes).</p>
          ) : null}
          <div className="ade-review-actions">
            <Button type="submit" variant="primary" size="xs" loading={busy === "create"}>{busy === "create" ? "Saving…" : "Create automation"}</Button>
            <Button variant="chip" size="xs" onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {items === null ? <p className="ade-muted">Loading…</p> : !items.length && !form ? (
        <EmptyState
          compact icon={<CalendarClock className="size-4" />} title="No automations yet."
          description={<>For example: “Every weekday at 08:00, triage new issues”, or “When an issue gets the <code>agent</code> label, fix it”.</>}
        />
      ) : (
        <ul className="ade-automation-list">
          {items.map(item => (
            <li key={item.id} className={item.enabled ? "" : "is-paused"}>
              <div className="ade-automation-main">
                <div className="flex items-center gap-2">
                  <strong>{item.name}</strong>
                  <Badge tone={item.enabled ? "ok" : "neutral"}>{item.enabled ? "On" : "Paused"}</Badge>
                </div>
                <span className="ade-muted ade-xs">
                  {item.trigger.type === "issue-label" ? <Tag className="inline size-3" /> : <CalendarClock className="inline size-3" />} {describe(item.trigger)}
                </span>
                <span className="ade-muted ade-xs ade-truncate" title={item.prompt}>{item.prompt}</span>
                {item.runs[0] ? (
                  <span className="ade-xs">
                    Last run {relativeTime(item.runs[0].at)} ({item.runs[0].reason})
                    {item.runs[0].error ? <span className="ade-text-error"> · failed: {item.runs[0].error}</span> : null}
                    {item.runs[0].sessionId ? <> · <button type="button" className="ade-link-btn" onClick={() => onOpenSession(item.runs[0].sessionId!)}>Open session</button></> : null}
                  </span>
                ) : <span className="ade-muted ade-xs">Hasn't run yet.</span>}
              </div>
              <div className="ade-automation-actions">
                <Switch checked={item.enabled} label={item.enabled ? `Pause ${item.name}` : `Resume ${item.name}`} onCheckedChange={enabled => void call(item.id, `/api/automations/${encodeURIComponent(item.id)}`, "PUT", { enabled })} />
                {item.trigger.type === "schedule" ? (
                  <Button variant="chip" size="xs" loading={busy === item.id} title="Start a run now" onClick={() => void call(item.id, `/api/automations/${encodeURIComponent(item.id)}/run`, "POST", {}).then(res => { if (res?.sessionId) onOpenSession(res.sessionId) })}>
                    {busy !== item.id ? <Play className="size-3" /> : null}
                    {busy === item.id ? "Starting…" : "Run now"}
                  </Button>
                ) : null}
                <IconButton aria-label={`Delete ${item.name}`} title="Delete" onClick={() => void handleDelete(item)}><Trash2 className="size-3.5" /></IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
