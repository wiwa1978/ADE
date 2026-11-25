import { useContext, useEffect, useState, type FormEvent } from "react"
import { KeyRound, X } from "lucide-react"
import { request, requestJson } from "../api"
import { Banner, Button, IconButton, Input } from "@/components/ui"
import { ConfirmContext } from "@/components/ui/confirm-context"
import { useI18n } from "../i18n/I18nContext"
import { relativeTime } from "../session-state"

type Secret = { name: string; updatedAt: number }

/**
 * Project settings section for secrets: environment variables every session in the project gets
 * (agents, setup/run scripts and terminals). Values are write-only here.
 */
export function ProjectSecretsSettings({ projectId }: { projectId: string }) {
  const { t } = useI18n()
  const confirmCtx = useContext(ConfirmContext)
  const [secrets, setSecrets] = useState<Secret[] | null>(null)
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void request<{ secrets: Secret[] }>(`/api/projects/${encodeURIComponent(projectId)}/secrets`)
      .then(result => { if (!cancelled) setSecrets(result.secrets) })
      .catch(err => {
        if (!cancelled) {
          setSecrets([])
          setMessage({ tone: "error", text: err instanceof Error ? err.message : t("prjx.cfg.secrets.readError") })
        }
      })
    return () => { cancelled = true }
  }, [projectId, t])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const trimmed = name.trim()
      const replacing = secrets?.some(secret => secret.name === trimmed)
      const result = await requestJson<{ secrets: Secret[] }>(`/api/projects/${encodeURIComponent(projectId)}/secrets`, "PUT", { name: trimmed, value })
      setSecrets(result.secrets)
      setMessage({ tone: "info", text: t(replacing ? "prjx.cfg.secrets.replacedMsg" : "prjx.cfg.secrets.savedMsg", { name: trimmed }) })
      setName("")
      setValue("")
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("prjx.cfg.secrets.saveError") })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (secretName: string) => {
    const promptText = t("prjx.cfg.secrets.removeConfirmPrompt", { name: secretName })
    const ok = confirmCtx
      ? await confirmCtx.confirm({
          title: t("prjx.cfg.secrets.removeConfirmTitle", { name: secretName }),
          description: t("prjx.cfg.secrets.removeConfirmDesc"),
          confirmLabel: t("prjx.cfg.secrets.remove"),
          destructive: true,
        })
      : (typeof window === "undefined" || typeof window.confirm !== "function" ? true : window.confirm(promptText))
    if (!ok) return
    try {
      const result = await request<{ secrets: Secret[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretName)}`,
        { method: "DELETE" },
      )
      setSecrets(result.secrets)
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("prjx.cfg.secrets.removeError") })
    }
  }

  return (
    <section className="project-scripts" aria-labelledby="project-secrets-title">
      <h3 id="project-secrets-title">{t("prjx.cfg.secrets.title")}</h3>
      <p className="hint">{t("prjx.cfg.secrets.intro")}</p>
      {secrets && secrets.length ? (
        <ul className="ade-secret-list">
          {secrets.map(secret => (
            <li key={secret.name}>
              <KeyRound className="size-3.5" />
              <code>{secret.name}</code>
              <span className="hint">{t("prjx.cfg.secrets.setTime", { time: relativeTime(secret.updatedAt) })}</span>
              <IconButton aria-label={t("prjx.cfg.secrets.removeAria", { name: secret.name })} title={t("prjx.cfg.secrets.remove")} onClick={() => void remove(secret.name)}>
                <X className="size-3" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : secrets ? <p className="hint">{t("prjx.cfg.secrets.empty")}</p> : null}
      <form className="ade-secret-form" onSubmit={event => void save(event)}>
        <Input
          inputSize="sm"
          aria-label={t("prjx.cfg.secrets.nameAria")}
          placeholder={t("prjx.cfg.secrets.namePlaceholder")}
          value={name}
          onChange={event => setName(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
          spellCheck={false}
          autoComplete="off"
        />
        <Input
          inputSize="sm"
          aria-label={t("prjx.cfg.secrets.valueAria")}
          placeholder={t("prjx.cfg.secrets.valuePlaceholder")}
          type="password"
          value={value}
          onChange={event => setValue(event.target.value)}
          autoComplete="new-password"
        />
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!name.trim() || !value}>
          {busy ? t("prjx.cfg.saving") : t("prjx.cfg.secrets.add")}
        </Button>
      </form>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
    </section>
  )
}
