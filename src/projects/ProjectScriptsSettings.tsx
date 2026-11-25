import { useEffect, useState } from "react"
import { request, requestJson } from "../api"
import { useI18n } from "../i18n/I18nContext"

type Scripts = { setup: string; run: string; copy: string[]; check: string; checkAutoFix: boolean }
type ScriptsResponse = { saved: Scripts; repository: Scripts | null; effective: Scripts & { source: Record<string, string> } }

/** Project settings section for the setup and run scripts used by every session in the project. */
export function ProjectScriptsSettings({ projectId }: { projectId: string }) {
  const { t } = useI18n()
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
    }).catch(() => setMessage(t("prjx.cfg.scripts.loadError")))
    return () => { active = false }
  }, [projectId, t])

  const dirty = data ? setup !== data.saved.setup || run !== data.saved.run || copy.trim() !== data.saved.copy.join("\n") || check !== (data.saved.check ?? "") || checkAutoFix !== Boolean(data.saved.checkAutoFix) : false

  const save = async () => {
    setSaving(true)
    setMessage("")
    try {
      const result = await requestJson<ScriptsResponse>(`/api/projects/${encodeURIComponent(projectId)}/scripts`, "PUT", { setup, run, copy: copy.split("\n").map(line => line.trim()).filter(Boolean), check, checkAutoFix })
      setData(result)
      setMessage(t("prjx.cfg.scripts.savedMsg"))
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t("prjx.cfg.scripts.saveError"))
    } finally {
      setSaving(false)
    }
  }

  const repo = data?.repository
  return (
    <section className="project-scripts" aria-labelledby="project-scripts-title">
      <h3 id="project-scripts-title">{t("prjx.cfg.scripts.title")}</h3>
      <p className="hint">{t("prjx.cfg.scripts.intro")}</p>
      <label>{t("prjx.cfg.scripts.setupLabel")}
        <textarea rows={2} value={setup} onChange={event => setSetup(event.target.value)} placeholder={repo?.setup || "npm install"} spellCheck={false} disabled={!data || saving} />
      </label>
      <label>{t("prjx.cfg.scripts.copyLabel")}
        <textarea rows={2} value={copy} onChange={event => setCopy(event.target.value)} placeholder={repo?.copy.join("\n") || ".env\n.env.local"} spellCheck={false} disabled={!data || saving} />
        <small className="hint">{t("prjx.cfg.scripts.copyHint")}</small>
      </label>
      <label>{t("prjx.cfg.scripts.runLabel")}
        <textarea rows={2} value={run} onChange={event => setRun(event.target.value)} placeholder={repo?.run || "npm run dev -- --port $PORT"} spellCheck={false} disabled={!data || saving} />
        <small className="hint">{t("prjx.cfg.scripts.runHintBefore")} <code>$PORT</code>{t("prjx.cfg.scripts.runHintAfter")}</small>
      </label>
      <label>{t("prjx.cfg.scripts.checkLabel")}
        <textarea rows={2} value={check} onChange={event => setCheck(event.target.value)} placeholder={repo?.check || "npm run lint && npm test"} spellCheck={false} disabled={!data || saving} />
        <small className="hint">{t("prjx.cfg.scripts.checkHint")}</small>
      </label>
      <label className="project-scripts-check">
        <input type="checkbox" checked={checkAutoFix} onChange={event => setCheckAutoFix(event.target.checked)} disabled={!data || saving} />
        {t("prjx.cfg.scripts.checkAutoFix")}
      </label>
      {repo ? <p className="hint">{t("prjx.cfg.scripts.repoConfigBefore")} <code>.ade/project.json</code>{t("prjx.cfg.scripts.repoConfigAfter")}</p>
        : <p className="hint">{t("prjx.cfg.scripts.tipBefore")} <code>.ade/project.json</code> {t("prjx.cfg.scripts.tipAfter")}</p>}
      <div className="form-actions">
        <button type="button" className="action-button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? t("prjx.cfg.saving") : t("prjx.cfg.scripts.saveButton")}</button>
        {message ? <span className="hint" role="status">{message}</span> : null}
      </div>
    </section>
  )
}
