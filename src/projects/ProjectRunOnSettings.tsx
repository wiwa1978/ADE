import { useEffect, useState } from "react"
import { request } from "../../api"
import { runTargetDescriptions, targetLabel, targetUnavailable, useRunTargets, type TargetSettings } from "../run-targets"

/** Project settings: where new sessions run by default, with the settings each target needs. */
export function ProjectRunOnSettings({ projectId }: { projectId: string }) {
  const info = useRunTargets()
  const [saved, setSaved] = useState<TargetSettings | null>(null)
  const [draft, setDraft] = useState<TargetSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let cancelled = false
    void request<TargetSettings>(`/api/projects/${encodeURIComponent(projectId)}/run-on`).then(result => {
      if (cancelled) return
      setSaved(result)
      setDraft(result)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [projectId])

  if (!draft || !saved) return null
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const set = (patch: Partial<TargetSettings>) => setDraft({ ...draft, ...patch })

  const save = async () => {
    setSaving(true)
    setMessage("")
    try {
      const result = await request<TargetSettings>(`/api/projects/${encodeURIComponent(projectId)}/run-on`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      })
      setSaved(result)
      setDraft(result)
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
      <div className="st-segmented ade-run-on-choices" role="radiogroup" aria-label="Default for new sessions">
        {(info?.available ?? ["local", "docker"]).map(target => {
          const blocked = target === "ssh" ? "" : targetUnavailable(target, info)
          return (
            <button key={target} type="button" role="radio" aria-checked={draft.target === target} className={draft.target === target ? "is-active" : ""} disabled={Boolean(blocked)} title={blocked || runTargetDescriptions[target]} onClick={() => set({ target })}>
              {targetLabel(target)}
            </button>
          )
        })}
      </div>
      <p className="hint">{runTargetDescriptions[draft.target]}</p>
      {draft.target === "docker" ? (
        <label>Docker image
          <input value={draft.image} onChange={event => set({ image: event.target.value })} placeholder="node:22-bookworm" spellCheck={false} disabled={saving} />
          <small className="hint">Needs git and a shell; npm lets ADE install Claude Code or Codex inside. Pulled the first time it's used.</small>
        </label>
      ) : null}
      {draft.target === "ssh" ? (
        <>
          <label>SSH host
            <input value={draft.sshHost} onChange={event => set({ sshHost: event.target.value })} placeholder="build-server or me@10.0.0.5" spellCheck={false} disabled={saving} />
            <small className="hint">A host or alias from your ~/.ssh/config that you can reach without a password prompt (an SSH key). The machine needs rsync and bash.</small>
          </label>
          <label>Folder on that machine
            <input value={draft.remoteRoot} onChange={event => set({ remoteRoot: event.target.value })} placeholder="ade-workspaces" spellCheck={false} disabled={saving} />
            <small className="hint">Relative to the home folder unless it starts with /. Each session gets a folder inside it.</small>
          </label>
        </>
      ) : null}
      {draft.target === "wsl" ? (
        <label>WSL distribution
          <input value={draft.wslDistro} onChange={event => set({ wslDistro: event.target.value })} placeholder="Default distribution" spellCheck={false} disabled={saving} />
        </label>
      ) : null}
      {draft.target === "boat" ? (
        <p className="hint">{info?.boat.configured ? "Each session gets its own Boat.dev VM, deleted when the session is archived. Boat stops idle VMs after an hour and ADE resumes them when needed." : "Add a Boat.dev API key in Settings → Integrations to use this."}</p>
      ) : null}
      {draft.target === "docker" && info && !info.docker.available ? <p className="hint">{info.docker.message}</p> : null}
      <div className="form-actions">
        <button type="button" className="action-button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        {message ? <span className="hint" role="status">{message}</span> : null}
      </div>
    </section>
  )
}
