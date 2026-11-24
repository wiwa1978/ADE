import { useEffect, useState } from "react"
import { request, requestJson } from "../../api"

type InstructionFile = { name: "AGENTS.md" | "CLAUDE.md"; readBy: string; exists: boolean; content: string }

/**
 * Project settings section for the instruction files agents read at the start of every session.
 * They live in the repository root, so commit them to share them with your team.
 */
export function ProjectInstructionsSettings({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<InstructionFile[] | null>(null)
  const [active, setActive] = useState<InstructionFile["name"]>("AGENTS.md")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let cancelled = false
    void request<{ files: InstructionFile[] }>(`/api/projects/${encodeURIComponent(projectId)}/instructions`)
      .then(result => {
        if (cancelled) return
        setFiles(result.files)
        setDrafts(Object.fromEntries(result.files.map(file => [file.name, file.content])))
        // Open the file the project already uses.
        const existing = result.files.find(file => file.exists)
        if (existing) setActive(existing.name)
      })
      .catch(err => { if (!cancelled) setMessage(err instanceof Error ? err.message : "Could not read the instruction files.") })
    return () => { cancelled = true }
  }, [projectId])

  const file = files?.find(item => item.name === active)
  const draft = drafts[active] ?? ""
  const dirty = Boolean(file) && draft !== file?.content

  const save = async () => {
    setSaving(true)
    setMessage("")
    try {
      const result = await requestJson<{ files: InstructionFile[] }>(`/api/projects/${encodeURIComponent(projectId)}/instructions`, "PUT", { name: active, content: draft })
      setFiles(result.files)
      setMessage(`Saved ${active}. New messages use it.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="project-scripts" aria-labelledby="project-instructions-title">
      <h3 id="project-instructions-title">Agent instructions</h3>
      <p className="hint">Conventions agents read before every task: how to build and test, code style, what not to touch. Saved in the project folder.</p>
      <div className="st-segmented" role="tablist" aria-label="Instruction file">
        {(files ?? [{ name: "AGENTS.md" }, { name: "CLAUDE.md" }] as Array<Pick<InstructionFile, "name"> & Partial<InstructionFile>>).map(item => (
          <button
            key={item.name}
            type="button"
            role="tab"
            aria-selected={active === item.name}
            className={active === item.name ? "is-active" : ""}
            onClick={() => { setActive(item.name); setMessage("") }}
          >
            {item.name}
          </button>
        ))}
      </div>
      <label>
        <span className="sr-only">{active}</span>
        <textarea
          rows={10}
          value={draft}
          spellCheck={false}
          disabled={!files || saving}
          onChange={event => setDrafts(current => ({ ...current, [active]: event.target.value }))}
          placeholder={active === "AGENTS.md"
            ? "# How to work in this project\n\n- Install with `npm install`; run tests with `npm test`.\n- Keep changes small and add tests for new behaviour."
            : "# Claude Code instructions\n\nSee AGENTS.md for build and test commands."}
        />
        {file ? <small className="hint">Read by {file.readBy}.{file.exists ? "" : " It doesn’t exist yet; saving creates it in the project folder."}</small> : null}
      </label>
      <div className="form-actions">
        <button type="button" className="action-button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : `Save ${active}`}</button>
        {message ? <span className="hint" role="status">{message}</span> : null}
      </div>
    </section>
  )
}
