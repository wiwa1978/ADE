import { useCallback, useContext, useState, type FormEvent } from "react"
import { CalendarClock, Play, Plus, Sparkles, Tag, Trash2 } from "lucide-react"
import { request } from "../api"
import { Badge, Banner, Button, EmptyState, IconButton, Input, Switch, Textarea } from "@/components/ui"
import { ConfirmContext } from "@/components/ui/confirm-context"
import { useStarterRecipes, type StarterRecipeOption } from "../blueprints/blueprint-options"
import { usePolling } from "../hooks/usePolling"
import { useI18n, type I18nContextValue } from "../i18n/I18nContext"
import { relativeTime } from "../session-state"

type Trigger =
  | { type: "schedule"; every: "hourly" | "daily" | "weekdays" | "weekly"; at: string; day?: number }
  | { type: "issue-label"; label: string }
type Run = { at: number; sessionId: string | null; reason: string; error?: string }
type Automation = { id: string; name: string; prompt: string; agent: "pi" | "claude-code" | "codex" | "opencode"; trigger: Trigger; enabled: boolean; lastRunAt: number | null; runs: Run[] }

const DAY_KEYS = [
  "prjx.auto.day.0",
  "prjx.auto.day.1",
  "prjx.auto.day.2",
  "prjx.auto.day.3",
  "prjx.auto.day.4",
  "prjx.auto.day.5",
  "prjx.auto.day.6",
] as const

const BLANK = {
  name: "", prompt: "", agent: "pi" as Automation["agent"], triggerType: "schedule" as Trigger["type"],
  every: "daily" as "hourly" | "daily" | "weekdays" | "weekly", at: "09:00", day: 1, label: "agent",
}

function describe(trigger: Trigger, t: I18nContextValue["t"]) {
  if (trigger.type === "issue-label") return t("prjx.auto.descIssueLabel", { label: trigger.label })
  if (trigger.every === "hourly") return t("prjx.auto.descHourly", { minute: trigger.at.split(":")[1] ?? "00" })
  if (trigger.every === "daily") return t("prjx.auto.descDaily", { time: trigger.at })
  if (trigger.every === "weekdays") return t("prjx.auto.descWeekdays", { time: trigger.at })
  return t("prjx.auto.descWeekly", { day: t(DAY_KEYS[trigger.day ?? 1] ?? DAY_KEYS[1]), time: trigger.at })
}

export function ProjectAutomationsTab({
  projectId, hasGitHub, hasCheckout, onOpenSession,
}: {
  projectId: string
  hasGitHub: boolean
  hasCheckout: boolean
  onOpenSession: (sessionId: string) => void
}) {
  const { t } = useI18n()
  const confirmCtx = useContext(ConfirmContext)
  const recipes = useStarterRecipes()
  const [items, setItems] = useState<Automation[] | null>(null)
  const [form, setForm] = useState<typeof BLANK | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  const applyRecipe = (recipe: StarterRecipeOption) => {
    const useIssueLabel = recipe.suggestedTrigger.type === "issue-label" && hasGitHub
    const sched = recipe.suggestedTrigger.type === "schedule" ? recipe.suggestedTrigger : null
    setForm({
      ...BLANK,
      name: recipe.name,
      prompt: useIssueLabel ? (recipe.automationPrompt ?? recipe.prompt) : recipe.prompt,
      triggerType: useIssueLabel ? "issue-label" : "schedule",
      every: sched?.every ?? "daily",
      at: sched?.at ?? "09:00",
      day: sched?.day ?? 1,
      label: recipe.suggestedTrigger.type === "issue-label" ? recipe.suggestedTrigger.label : "agent",
    })
  }

  const loadAutomations = useCallback(async (signal: AbortSignal) => {
    try {
      const result = await request<{ automations: Automation[] }>(`/api/projects/${encodeURIComponent(projectId)}/automations`, { signal })
      setItems(result.automations)
    } catch (err) {
      if (signal.aborted) return
      setItems(prev => prev ?? [])
      setError(err instanceof Error ? err.message : t("prjx.auto.loadError"))
    }
  }, [projectId, t])

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
      setError(err instanceof Error ? err.message : t("prjx.auto.genericError"))
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
      ? await confirmCtx.confirm({ title: t("prjx.auto.deleteTitle", { name: item.name }), description: t("prjx.auto.deleteDesc"), confirmLabel: t("prjx.auto.deleteConfirm"), destructive: true })
      : (typeof window === "undefined" || typeof window.confirm !== "function" ? true : window.confirm(t("prjx.auto.deletePrompt", { name: item.name })))
    if (ok) void call(item.id, `/api/automations/${encodeURIComponent(item.id)}`, "DELETE")
  }

  if (!hasCheckout) {
    return <EmptyState icon={<CalendarClock className="size-5" />} title={t("prjx.auto.noCheckoutTitle")} description={t("prjx.auto.noCheckoutDesc")} />
  }

  return (
    <div className="ade-automations">
      <header className="ade-automations-head">
        <div>
          <h2>{t("prjx.auto.title")}</h2>
          <p>{t("prjx.auto.intro")}</p>
        </div>
        {!form ? <Button variant="primary" size="md" onClick={() => setForm({ ...BLANK })}><Plus /> {t("prjx.auto.newAutomation")}</Button> : null}
      </header>
      {error ? <Banner tone="error">{error}</Banner> : null}

      {!form && recipes.length > 0 ? (
        <section className="ade-recipe-strip" aria-label="Starter recipes" style={{ marginBottom: 14 }}>
          <div className="ade-xs ade-muted" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Sparkles className="size-3.5" /> <span>Starter recipes — click to pre-fill an automation</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {recipes.map(recipe => (
              <Button
                key={recipe.id}
                variant="chip"
                size="xs"
                title={recipe.summary}
                onClick={() => applyRecipe(recipe)}
              >
                {recipe.name}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {form ? (
        <form className="ade-automation-form" onSubmit={event => void save(event)}>
          <label>{t("prjx.auto.fieldName")}<Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t("prjx.auto.namePlaceholder")} required /></label>
          <div className="ade-automation-row">
            <label>{t("prjx.auto.fieldStarts")}
              <select value={form.triggerType} onChange={e => setForm({ ...form, triggerType: e.target.value as Trigger["type"] })}>
                <option value="schedule">{t("prjx.auto.triggerSchedule")}</option>
                <option value="issue-label" disabled={!hasGitHub}>{hasGitHub ? t("prjx.auto.triggerIssueLabel") : t("prjx.auto.triggerIssueLabelDisabled")}</option>
              </select>
            </label>
            {form.triggerType === "schedule" ? (
              <>
                <label>{t("prjx.auto.fieldEvery")}
                  <select value={form.every} onChange={e => setForm({ ...form, every: e.target.value as typeof form.every })}>
                    <option value="hourly">{t("prjx.auto.everyHourly")}</option><option value="daily">{t("prjx.auto.everyDaily")}</option><option value="weekdays">{t("prjx.auto.everyWeekdays")}</option><option value="weekly">{t("prjx.auto.everyWeekly")}</option>
                  </select>
                </label>
                {form.every === "weekly" ? (
                  <label>{t("prjx.auto.fieldOn")}<select value={form.day} onChange={e => setForm({ ...form, day: Number(e.target.value) })}>{DAY_KEYS.map((dayKey, idx) => <option key={dayKey} value={idx}>{t(dayKey)}</option>)}</select></label>
                ) : null}
                <label>{t("prjx.auto.fieldAt")}<Input inputSize="sm" type="time" value={form.at} onChange={e => setForm({ ...form, at: e.target.value })} required /></label>
              </>
            ) : (
              <label>{t("prjx.auto.fieldLabel")}<Input inputSize="sm" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="agent" required /></label>
            )}
          </div>
          <label>{t("prjx.auto.fieldPrompt")}
            <Textarea
              rows={4} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} required
              placeholder={form.triggerType === "issue-label" ? t("prjx.auto.promptPlaceholderIssue") : t("prjx.auto.promptPlaceholderSchedule")}
            />
          </label>
          {form.triggerType === "issue-label" ? (
            <p className="ade-muted ade-xs"><code>{"{{issue}}"}</code> {t("prjx.auto.issuePlaceholderHint")}</p>
          ) : null}
          <div className="ade-review-actions">
            <Button type="submit" variant="primary" size="xs" loading={busy === "create"}>{busy === "create" ? t("prjx.cfg.saving") : t("prjx.auto.createAutomation")}</Button>
            <Button variant="chip" size="xs" onClick={() => setForm(null)}>{t("prjx.auto.cancel")}</Button>
          </div>
        </form>
      ) : null}

      {items === null ? <p className="ade-muted">{t("prjx.auto.loading")}</p> : !items.length && !form ? (
        <EmptyState
          compact icon={<CalendarClock className="size-4" />} title={t("prjx.auto.emptyTitle")}
          description={<>{t("prjx.auto.emptyDescBefore")}<code>agent</code>{t("prjx.auto.emptyDescAfter")}</>}
        />
      ) : (
        <ul className="ade-automation-list">
          {items.map(item => (
            <li key={item.id} className={item.enabled ? "" : "is-paused"}>
              <div className="ade-automation-main">
                <div className="flex items-center gap-2">
                  <strong>{item.name}</strong>
                  <Badge tone={item.enabled ? "ok" : "neutral"}>{item.enabled ? t("prjx.auto.statusOn") : t("prjx.auto.statusPaused")}</Badge>
                </div>
                <span className="ade-muted ade-xs">
                  {item.trigger.type === "issue-label" ? <Tag className="inline size-3" /> : <CalendarClock className="inline size-3" />} {describe(item.trigger, t)}
                </span>
                <span className="ade-muted ade-xs ade-truncate" title={item.prompt}>{item.prompt}</span>
                {item.runs[0] ? (
                  <span className="ade-xs">
                    {t("prjx.auto.lastRun", { time: relativeTime(item.runs[0].at), reason: item.runs[0].reason })}
                    {item.runs[0].error ? <span className="ade-text-error">{t("prjx.auto.failedSuffix", { error: item.runs[0].error })}</span> : null}
                    {item.runs[0].sessionId ? <> · <button type="button" className="ade-link-btn" onClick={() => onOpenSession(item.runs[0].sessionId!)}>{t("prjx.auto.openSession")}</button></> : null}
                  </span>
                ) : <span className="ade-muted ade-xs">{t("prjx.auto.neverRun")}</span>}
              </div>
              <div className="ade-automation-actions">
                <Switch checked={item.enabled} label={item.enabled ? t("prjx.auto.pauseAria", { name: item.name }) : t("prjx.auto.resumeAria", { name: item.name })} onCheckedChange={enabled => void call(item.id, `/api/automations/${encodeURIComponent(item.id)}`, "PUT", { enabled })} />
                {item.trigger.type === "schedule" ? (
                  <Button variant="chip" size="xs" loading={busy === item.id} title={t("prjx.auto.runNowTitle")} onClick={() => void call(item.id, `/api/automations/${encodeURIComponent(item.id)}/run`, "POST", {}).then(res => { if (res?.sessionId) onOpenSession(res.sessionId) })}>
                    {busy !== item.id ? <Play className="size-3" /> : null}
                    {busy === item.id ? t("prjx.list.sessions.starting") : t("prjx.auto.runNow")}
                  </Button>
                ) : null}
                <IconButton aria-label={t("prjx.auto.deleteAria", { name: item.name })} title={t("prjx.auto.deleteConfirm")} onClick={() => void handleDelete(item)}><Trash2 className="size-3.5" /></IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
