import { useEffect, useState } from "react"
import { request } from "../../api"

type Scripts = { setup: string; run: string; copy: string[]; check: string; checkAutoFix: boolean }
type ScriptsResponse = { saved: Scripts; repository: Scripts | null; effective: Scripts & { source: Record<string, string> } }

/** Project settings section for the setup and run scripts used by every session in the project. */
export function ProjectScriptsSettings({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ScriptsResponse | null>(null)
  const [setup, setSetup] = useState("")
  const [run, setRun] = useState("")
  const [copy, setCopy] = useState("")
  const [check, setCheck] = useState("")
  const [checkAutoFix, setCheckAutoFix] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let active = true
    void request<ScriptsResponse>(`/api/projects/${encodeURIComponent(projectId)}/scripts`).then(result => {
      if (!active) return
      setData(result)
      setSetup(result.saved.setup)
      setRun(result.saved.run)
      setCopy(result.saved.copy.join("\n"))
      setCheck(result.saved.check ?? "")
      setCheckAutoFix(Boolean(result.saved.checkAutoFix))
    }).catch(() => setMessage("Could not load the project's scripts."))
    return () => { active = false }
  }, [projectId])

  const dirty = data ? setup !== data.saved.setup || run !== data.saved.run || copy.trim() !== data.saved.copy.join("\n") || check !== (data.saved.check ?? "") || checkAutoFix !== Boolean(data.saved.checkAutoFix) : false

  const save = async () => {
    setSaving(true)
    setMessage("")
    try {
      const result = await request<ScriptsResponse>(`/api/projects/${encodeURIComponent(projectId)}/scripts`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setup, run, copy: copy.split("\n").map(line => line.trim()).filter(Boolean), check, checkAutoFix }),
      })
      setData(result)
      setMessage("Saved. New sessions use these scripts.")
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not save the scripts.")
    } finally {
      setSaving(false)
    }
  }

  const repo = data?.repository
  return (
    <section className="project-scripts" aria-labelledby="project-scripts-title">
      <h3 id="project-scripts-title">Scripts</h3>
      <p className="hint">Run automatically for every new session, so each agent starts with a working copy of the project.</p>
      <label>Setup — runs when a session’s worktree is created
        <textarea rows={2} value={setup} onChange={event => setSetup(event.target.value)} placeholder={repo?.setup || "npm install"} spellCheck={false} disabled={!data || saving} />
      </label>
      <label>Copy into new worktrees — one path per line
        <textarea rows={2} value={copy} onChange={event => setCopy(event.target.value)} placeholder={repo?.copy.join("\n") || ".env\n.env.local"} spellCheck={false} disabled={!data || saving} />
        <small className="hint">Files that aren’t in Git, such as .env, copied from the project folder.</small>
      </label>
      <label>Run — starts the app from a session’s Run button
        <textarea rows={2} value={run} onChange={event => setRun(event.target.value)} placeholder={repo?.run || "npm run dev -- --port $PORT"} spellCheck={false} disabled={!data || saving} />
        <small className="hint">Each session gets its own free port in <code>$PORT</code>; the first URL the script prints opens in the session’s browser.</small>
      </label>
      <label>Check — runs after every agent turn
        <textarea rows={2} value={check} onChange={event => setCheck(event.target.value)} placeholder={repo?.check || "npm run lint && npm test"} spellCheck={false} disabled={!data || saving} />
        <small className="hint">A hook for lint, typecheck or tests. The result shows in the session header and its Run panel.</small>
      </label>
      <label className="project-scripts-check">
        <input type="checkbox" checked={checkAutoFix} onChange={event => setCheckAutoFix(event.target.checked)} disabled={!data || saving} />
        Send failures back to the agent automatically (at most twice in a row)
      </label>
      {repo ? <p className="hint">This repository has an <code>.ade/project.json</code>; empty fields here use its values (shown as placeholders).</p>
        : <p className="hint">Tip: commit these as <code>.ade/project.json</code> to share them with your team.</p>}
      <div className="form-actions">
        <button type="button" className="action-button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save scripts"}</button>
        {message ? <span className="hint" role="status">{message}</span> : null}
      </div>
    </section>
  )
}
