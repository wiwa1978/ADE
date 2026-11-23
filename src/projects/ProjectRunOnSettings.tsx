import { useEffect, useState } from "react"
import { request } from "../../api"

type RunOn = { target: "local" | "docker"; image: string }

/** Project settings: where new sessions run by default, and which Docker image they use. */
export function ProjectRunOnSettings({ projectId }: { projectId: string }) {
  const [saved, setSaved] = useState<RunOn | null>(null)
  const [target, setTarget] = useState<RunOn["target"]>("local")
  const [image, setImage] = useState("")
  const [docker, setDocker] = useState<{ available: boolean; version: string | null; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let cancelled = false
    void request<RunOn>(`/api/projects/${encodeURIComponent(projectId)}/run-on`).then(result => {
      if (cancelled) return
      setSaved(result)
      setTarget(result.target)
      setImage(result.image)
    }).catch(() => undefined)
    void request<{ available: boolean; version: string | null; message: string }>("/api/docker").then(result => { if (!cancelled) setDocker(result) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [projectId])

  const dirty = saved ? target !== saved.target || image.trim() !== saved.image : false

  const save = async () => {
    setSaving(true)
    setMessage("")
    try {
      const result = await request<RunOn>(`/api/projects/${encodeURIComponent(projectId)}/run-on`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, image }),
      })
      setSaved(result)
      setImage(result.image)
      setMessage("Saved. New sessions use this.")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="project-scripts" aria-labelledby="project-run-on-title">
      <h3 id="project-run-on-title">Run sessions on</h3>
      <p className="hint">Where agents' commands, terminals and scripts run in new sessions. You can still choose per session.</p>
      <div className="st-segmented" role="radiogroup" aria-label="Default for new sessions">
        <button type="button" role="radio" aria-checked={target === "local"} className={target === "local" ? "is-active" : ""} onClick={() => setTarget("local")}>This Mac</button>
        <button type="button" role="radio" aria-checked={target === "docker"} className={target === "docker" ? "is-active" : ""} disabled={docker !== null && !docker.available} title={docker && !docker.available ? docker.message : undefined} onClick={() => setTarget("docker")}>Docker</button>
      </div>
      {docker ? <p className="hint">{docker.available ? `Docker ${docker.version} is running.` : docker.message}</p> : null}
      <label>Docker image
        <input value={image} onChange={event => setImage(event.target.value)} placeholder="node:22-bookworm" spellCheck={false} disabled={!saved || saving} />
        <small className="hint">Needs git and a shell. Pulled the first time a session uses it, which can take a few minutes.</small>
      </label>
      <div className="form-actions">
        <button type="button" className="action-button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        {message ? <span className="hint" role="status">{message}</span> : null}
      </div>
    </section>
  )
}
