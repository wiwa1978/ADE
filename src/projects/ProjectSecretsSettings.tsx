import { useContext, useEffect, useState, type FormEvent } from "react"
import { KeyRound, X } from "lucide-react"
import { request, requestJson } from "../../api"
import { Banner, Button, IconButton, Input } from "@/components/ui"
import { ConfirmContext } from "@/components/ui/confirm-context"
import { relativeTime } from "../session-state"

type Secret = { name: string; updatedAt: number }

/**
 * Project settings section for secrets: environment variables every session in the project gets
 * (agents, setup/run scripts and terminals). Values are write-only here.
 */
export function ProjectSecretsSettings({ projectId }: { projectId: string }) {
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
          setMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not read the secrets." })
        }
      })
    return () => { cancelled = true }
  }, [projectId])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const trimmed = name.trim()
      const replacing = secrets?.some(secret => secret.name === trimmed)
      const result = await requestJson<{ secrets: Secret[] }>(`/api/projects/${encodeURIComponent(projectId)}/secrets`, "PUT", { name: trimmed, value })
      setSecrets(result.secrets)
      setMessage({ tone: "info", text: `${replacing ? "Replaced" : "Saved"} ${trimmed}. New commands and sessions get it.` })
      setName("")
      setValue("")
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not save the secret." })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (secretName: string) => {
    const promptText = `Remove ${secretName}? Sessions won't get it anymore.`
    const ok = confirmCtx
      ? await confirmCtx.confirm({
          title: `Remove ${secretName}?`,
          description: "Sessions won't get it anymore.",
          confirmLabel: "Remove",
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
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not remove the secret." })
    }
  }

  return (
    <section className="project-scripts" aria-labelledby="project-secrets-title">
      <h3 id="project-secrets-title">Secrets</h3>
      <p className="hint">Environment variables for agents, scripts and terminals in this project, like API keys. Stored on this computer only, never shown again, and masked in agent output.</p>
      {secrets && secrets.length ? (
        <ul className="ade-secret-list">
          {secrets.map(secret => (
            <li key={secret.name}>
              <KeyRound className="size-3.5" />
              <code>{secret.name}</code>
              <span className="hint">set {relativeTime(secret.updatedAt)}</span>
              <IconButton aria-label={`Remove ${secret.name}`} title="Remove" onClick={() => void remove(secret.name)}>
                <X className="size-3" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : secrets ? <p className="hint">No secrets yet.</p> : null}
      <form className="ade-secret-form" onSubmit={event => void save(event)}>
        <Input
          inputSize="sm"
          aria-label="Secret name"
          placeholder="NAME"
          value={name}
          onChange={event => setName(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
          spellCheck={false}
          autoComplete="off"
        />
        <Input
          inputSize="sm"
          aria-label="Secret value"
          placeholder="Value"
          type="password"
          value={value}
          onChange={event => setValue(event.target.value)}
          autoComplete="new-password"
        />
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!name.trim() || !value}>
          {busy ? "Saving…" : "Add"}
        </Button>
      </form>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
    </section>
  )
}
