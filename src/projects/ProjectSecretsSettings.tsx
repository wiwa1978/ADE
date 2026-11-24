import { useEffect, useState, type FormEvent } from "react"
import { KeyRound, X } from "lucide-react"
import { request, requestJson } from "../../api"
import { relativeTime } from "../session-state"

type Secret = { name: string; updatedAt: number }

/**
 * Project settings section for secrets: environment variables every session in the project gets
 * (agents, setup/run scripts and terminals). Values are write-only here.
 */
export function ProjectSecretsSettings({ projectId }: { projectId: string }) {
  const [secrets, setSecrets] = useState<Secret[] | null>(null)
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let cancelled = false
    void request<{ secrets: Secret[] }>(`/api/projects/${encodeURIComponent(projectId)}/secrets`)
      .then(result => { if (!cancelled) setSecrets(result.secrets) })
      .catch(err => { if (!cancelled) { setSecrets([]); setMessage(err instanceof Error ? err.message : "Could not read the secrets.") } })
    return () => { cancelled = true }
  }, [projectId])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage("")
    try {
      const replacing = secrets?.some(secret => secret.name === name.trim())
      const result = await requestJson<{ secrets: Secret[] }>(`/api/projects/${encodeURIComponent(projectId)}/secrets`, "PUT", { name: name.trim(), value })
      setSecrets(result.secrets)
      setMessage(`${replacing ? "Replaced" : "Saved"} ${name.trim()}. New commands and sessions get it.`)
      setName("")
      setValue("")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save the secret.")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (secretName: string) => {
    if (!confirm(`Remove ${secretName}? Sessions won't get it anymore.`)) return
    try {
      const result = await request<{ secrets: Secret[] }>(`/api/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretName)}`, { method: "DELETE" })
      setSecrets(result.secrets)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not remove the secret.")
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
              <button type="button" className="ade-icon-btn" aria-label={`Remove ${secret.name}`} title="Remove" onClick={() => void remove(secret.name)}><X className="size-3" /></button>
            </li>
          ))}
        </ul>
      ) : secrets ? <p className="hint">No secrets yet.</p> : null}
      <form className="ade-secret-form" onSubmit={event => void save(event)}>
        <input aria-label="Secret name" placeholder="NAME" value={name} onChange={event => setName(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} spellCheck={false} autoComplete="off" />
        <input aria-label="Secret value" placeholder="Value" type="password" value={value} onChange={event => setValue(event.target.value)} autoComplete="new-password" />
        <button type="submit" className="action-button" disabled={busy || !name.trim() || !value}>{busy ? "Saving…" : "Add"}</button>
      </form>
      {message ? <p className="hint" role="status">{message}</p> : null}
    </section>
  )
}
