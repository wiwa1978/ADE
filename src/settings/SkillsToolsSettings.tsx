import { useCallback, useEffect, useState } from "react"
import { Plug, Plus, Trash2, Unplug } from "lucide-react"
import { request } from "../../api"
import { useI18n } from "../i18n/I18nContext"
import "./skills-tools.css"

type State = { active: boolean; global: boolean | null; project: boolean | null }
type Skill = {
  key: string; name: string; description: string; path: string; dir: string
  origin: { kind: "project" | "git" | "ade" | "tool"; label: string; sourceId?: string }
  tokens: number; extraFiles: number; shadowedBy: string | null; state: State
}
type Source = { id: string; url: string; ref: string | null; subpath: string | null; commit: string | null; status: "ready" | "error"; error: string | null }
type Preview = { previewId: string; url: string; commit: string | null; skills: { name: string; description: string; relPath: string }[] }
type Server = {
  id: string; key: string; name: string; transport: "stdio" | "http"; enabled: boolean
  status: "disconnected" | "connecting" | "connected" | "error"; error: string | null; tools: { name: string }[]
  origin: { kind: "ade" | "file" | "project"; label: string }
  readOnly: boolean; active: boolean; globalSetting: boolean | null; projectSetting: boolean | null; needsTrust: boolean; shadowedBy: string | null
}
type ProjectRef = { id: string; name: string }
type Json = { "content-type": string }
const JSON_HEADERS: Json = { "content-type": "application/json" }

/**
 * Skills and tool servers: everything ADE found and where it came from, what is on, for all
 * projects or one. Everything is on unless turned off; a project's setting beats the global one.
 */
export function SkillsToolsSettings({ projects, onRefreshMcp }: { projects: ProjectRef[]; onRefreshMcp?: () => void }) {
  const { t } = useI18n()
  const [projectId, setProjectId] = useState("")
  const scopeQuery = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
  const [skills, setSkills] = useState<Skill[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [servers, setServers] = useState<Server[]>([])
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const refresh = useCallback(() => setReload(value => value + 1), [])

  useEffect(() => {
    let alive = true
    request<{ skills: Skill[]; sources: Source[] }>(`/api/skills/landscape${scopeQuery}`).then(
      data => { if (alive) { setSkills(data.skills); setSources(data.sources) } },
      err => { if (alive) setError(err instanceof Error ? err.message : t("skills.loadError")) },
    )
    request<{ servers: Server[] }>(`/api/mcp/scoped${scopeQuery}`).then(
      data => { if (alive) setServers(data.servers) },
      err => { if (alive) setError(err instanceof Error ? err.message : t("tools.loadError")) },
    )
    return () => { alive = false }
  }, [scopeQuery, reload, t])

  const attempt = async (action: () => Promise<unknown>) => {
    setError("")
    try { await action() } catch (err) { setError(err instanceof Error ? err.message : t("skills.saveError")) }
    refresh()
    onRefreshMcp?.()
  }

  /** Turn one item on/off in the chosen scope; null goes back to inheriting. */
  const setCapability = (kind: "skill" | "mcp" | "mcp-trust", key: string, enabled: boolean | null) => attempt(() => request("/api/capabilities", {
    method: "PUT", headers: JSON_HEADERS,
    body: JSON.stringify({ scope: projectId ? "project" : "global", projectId: projectId || undefined, kind, key, enabled }),
  }))

  const stateHint = (state: { global: boolean | null; project: boolean | null; active: boolean }) => {
    if (projectId && state.project !== null) return state.project ? t("skills.onHere") : t("skills.offHere")
    if (state.global !== null) return state.global ? t("skills.onFromAll") : t("skills.offFromAll")
    return ""
  }
  const ownSetting = (state: { global: boolean | null; project: boolean | null }) => projectId ? state.project : state.global
  const shownActive = (state: State) => projectId ? state.active : (state.global ?? true)

  return (
    <div className="ade-st-tools">
      <div className="ade-st-scope">
        <label htmlFor="st-capability-scope">{t("skills.scope")}</label>
        <select id="st-capability-scope" className="st-select" value={projectId} onChange={event => setProjectId(event.target.value)}>
          <option value="">{t("skills.scopeGlobal")}</option>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <span className="st-hint">{t("skills.scopeHint")}</span>
      </div>
      {error ? <p className="st-banner is-error" role="alert">{error}</p> : null}

      <SkillList skills={skills} projectId={projectId} stateHint={stateHint} ownSetting={ownSetting} shownActive={shownActive} setCapability={setCapability} attempt={attempt} />
      <SourcesCard sources={sources} attempt={attempt} />
      <WriteSkillCard attempt={attempt} />

      <section className="ade-st-card" aria-label={t("tools.title")}>
        <h3>{t("tools.title")}</h3>
        <p className="st-hint">{t("tools.hint")}</p>
        {servers.length === 0 ? <p className="st-hint">{t("tools.none")}</p> : null}
        {servers.some(server => server.needsTrust) ? (
          <div className="ade-st-trust" role="status">
            <span>{t("tools.needsTrust")}</span>
            {projectId
              ? <button type="button" className="st-button is-primary" onClick={() => void setCapability("mcp-trust", ".mcp.json", true)}>{t("tools.trust")}</button>
              : <span className="st-hint">{t("tools.trustPickProject")}</span>}
          </div>
        ) : null}
        <ul className="ade-st-list">
          {servers.map(server => (
            <li key={server.id} className={server.shadowedBy || server.needsTrust ? "is-dim" : ""}>
              <div className="ade-st-main">
                <strong>{server.name}</strong>
                <span className="ade-st-pill">{server.origin.label}</span>
                <span className="ade-st-pill">{server.transport}</span>
                <span className="st-hint">{server.status === "connected" ? (server.tools.length === 1 ? t("tools.oneTool") : t("tools.toolCount", { count: server.tools.length })) : server.error || ""}</span>
                {server.shadowedBy ? <span className="st-hint">{t("tools.shadowed")}</span> : null}
                {server.readOnly ? <span className="st-hint">{t("tools.readOnly", { origin: server.origin.label })}</span> : null}
              </div>
              <div className="ade-st-actions">
                {server.readOnly && !server.needsTrust ? <button type="button" className="st-button" onClick={() => void attempt(() => request(`/api/mcp/${encodeURIComponent(server.id)}/adopt${scopeQuery}`, { method: "POST", headers: JSON_HEADERS, body: "{}" }))}>{t("tools.copyIntoAde")}</button> : null}
                {server.active ? (
                  <button type="button" className="st-button is-quiet" title={server.status === "connected" ? t("common.disconnect") : t("common.connect")} onClick={() => void attempt(() => request(`/api/mcp/${encodeURIComponent(server.id)}/${server.status === "connected" ? "disconnect" : "connect"}${scopeQuery}`, { method: "POST", headers: JSON_HEADERS, body: "{}" }))}>
                    {server.status === "connected" ? <Unplug className="size-3.5" /> : <Plug className="size-3.5" />}
                  </button>
                ) : null}
                {!server.readOnly ? <button type="button" className="st-prov-icon-btn" aria-label={t("skills.remove")} onClick={() => void attempt(() => request(`/api/mcp/${encodeURIComponent(server.id)}`, { method: "DELETE" }))}><Trash2 className="size-3.5" /></button> : null}
                <Switch label={t("skills.toggle", { name: server.name })} on={projectId ? server.active : (server.globalSetting ?? server.enabled)} onChange={on => void setCapability("mcp", server.key, on)} />
                {projectId && server.projectSetting !== null ? <button type="button" className="ade-st-link" onClick={() => void setCapability("mcp", server.key, null)}>{t("skills.inherit")}</button> : null}
              </div>
            </li>
          ))}
        </ul>
        <ImportMcp attempt={attempt} />
      </section>
    </div>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`st-switch ${on ? "is-on" : ""}`} onClick={() => onChange(!on)}><span /></button>
}

type Attempt = (action: () => Promise<unknown>) => Promise<void>

function SkillList({ skills, projectId, stateHint, ownSetting, shownActive, setCapability, attempt }: {
  skills: Skill[]; projectId: string
  stateHint: (state: State) => string
  ownSetting: (state: State) => boolean | null
  shownActive: (state: State) => boolean
  setCapability: (kind: "skill", key: string, enabled: boolean | null) => Promise<void>
  attempt: Attempt
}) {
  const { t } = useI18n()
  const [filter, setFilter] = useState("")
  const effective = skills.filter(skill => !skill.shadowedBy)
  const needle = filter.trim().toLowerCase()
  const shown = needle ? skills.filter(skill => `${skill.name} ${skill.description} ${skill.origin.label}`.toLowerCase().includes(needle)) : skills
  const activeCount = effective.filter(skill => shownActive(skill.state)).length
  const originLabel = (skill: Skill) => skill.origin.kind === "tool" ? skill.origin.label : skill.origin.kind === "git" ? skill.origin.label : skill.origin.label
  return (
    <section className="ade-st-card" aria-label={t("skills.title")}>
      <h3>{t("skills.title")} <span className="st-hint">{t("skills.count", { active: activeCount, total: effective.length })}</span></h3>
      {skills.length === 0 ? <p className="st-hint">{t("skills.empty")}</p> : <input className="st-input ade-st-filter" value={filter} onChange={event => setFilter(event.target.value)} placeholder={t("skills.search")} aria-label={t("skills.search")} />}
      {skills.length > 0 && shown.length === 0 ? <p className="st-hint">{t("skills.noMatch")}</p> : null}
      <ul className="ade-st-list">
        {shown.map(skill => (
          <li key={skill.key} className={skill.shadowedBy ? "is-dim" : ""}>
            <div className="ade-st-main">
              <strong>{skill.name}</strong>
              <span className={`ade-st-pill is-${skill.origin.kind}`}>{originLabel(skill)}</span>
              <span className="st-hint">{t("skills.tokens", { count: skill.tokens })}{skill.extraFiles ? ` · ${t("skills.extraFiles", { count: skill.extraFiles })}` : ""}</span>
              <p className="ade-st-desc">{skill.description}</p>
              {skill.shadowedBy ? <span className="st-hint">{t("skills.shadowed")}</span> : stateHint(skill.state) ? <span className="st-hint">{stateHint(skill.state)}</span> : null}
            </div>
            {!skill.shadowedBy ? (
              <div className="ade-st-actions">
                {skill.origin.kind === "ade" ? <>
                  <button type="button" className="st-prov-icon-btn" aria-label={t("skills.delete")} onClick={() => { if (window.confirm(t("skills.deleteConfirm", { name: skill.name }))) void attempt(() => request(`/api/skills/user?path=${encodeURIComponent(skill.path)}`, { method: "DELETE" })) }}><Trash2 className="size-3.5" /></button>
                </> : null}
                <Switch label={t("skills.toggle", { name: skill.name })} on={shownActive(skill.state)} onChange={on => void setCapability("skill", skill.name, on)} />
                {projectId && ownSetting(skill.state) !== null ? <button type="button" className="ade-st-link" onClick={() => void setCapability("skill", skill.name, null)}>{t("skills.inherit")}</button> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function SourcesCard({ sources, attempt }: { sources: Source[]; attempt: Attempt }) {
  const { t } = useI18n()
  const [url, setUrl] = useState("")
  const [ref, setRef] = useState("")
  const [subpath, setSubpath] = useState("")
  const [busy, setBusy] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name)
    await attempt(action)
    setBusy("")
  }
  return (
    <section className="ade-st-card" aria-label={t("skills.sources")}>
      <h3>{t("skills.sources")}</h3>
      <p className="st-hint">{t("skills.sourcesHint")}</p>
      <form className="ade-st-form" onSubmit={event => {
        event.preventDefault()
        void run("preview", async () => {
          const data = await request<{ preview: Preview }>("/api/skills/sources/preview", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url, ref, subpath }) })
          setPreview(data.preview)
        })
      }}>
        <input className="st-input" value={url} onChange={event => setUrl(event.target.value)} placeholder={t("skills.repoPlaceholder")} aria-label={t("skills.sources")} required />
        <input className="st-input" value={ref} onChange={event => setRef(event.target.value)} placeholder={t("skills.branch")} aria-label={t("skills.branch")} />
        <input className="st-input" value={subpath} onChange={event => setSubpath(event.target.value)} placeholder={t("skills.folder")} aria-label={t("skills.folder")} />
        <button className="st-button" disabled={!url.trim() || busy === "preview"}>{busy === "preview" ? t("skills.previewing") : t("skills.preview")}</button>
      </form>
      {preview ? (
        <div className="ade-st-preview">
          <strong>{t("skills.previewTitle", { count: preview.skills.length, url: preview.url })}</strong>
          {preview.commit ? <span className="st-hint">{t("skills.previewCommit", { commit: preview.commit.slice(0, 7) })}</span> : null}
          <ul>{preview.skills.map(skill => <li key={skill.relPath}><strong>{skill.name}</strong> <span className="st-hint">{skill.description}</span></li>)}</ul>
          <div className="ade-st-actions">
            <button type="button" className="st-button is-quiet" onClick={() => { void request("/api/skills/sources/discard", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ previewId: preview.previewId }) }).catch(() => undefined); setPreview(null) }}>{t("common.cancel")}</button>
            <button type="button" className="st-button is-primary" disabled={busy === "install"} onClick={() => void run("install", async () => {
              await request("/api/skills/sources/confirm", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ previewId: preview.previewId }) })
              setPreview(null); setUrl(""); setRef(""); setSubpath("")
            })}>{busy === "install" ? t("skills.installing") : t("skills.install")}</button>
          </div>
        </div>
      ) : null}
      {sources.length === 0 ? <p className="st-hint">{t("skills.noSources")}</p> : (
        <ul className="ade-st-list">
          {sources.map(source => (
            <li key={source.id}>
              <div className="ade-st-main">
                <strong>{source.url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "")}</strong>
                {source.ref ? <span className="ade-st-pill">{source.ref}</span> : null}
                {source.commit ? <code>{source.commit.slice(0, 7)}</code> : null}
                {source.status === "error" ? <span className="st-hint">{t("skills.sourceError", { error: source.error ?? "" })}</span> : null}
                {source.id in checks ? <span className="st-hint">{checks[source.id] ? t("skills.updateAvailable") : t("skills.upToDate")}</span> : null}
              </div>
              <div className="ade-st-actions">
                <button type="button" className="st-button is-quiet" disabled={busy === source.id} onClick={() => void run(source.id, async () => {
                  const result = await request<{ updateAvailable: boolean }>(`/api/skills/sources/${encodeURIComponent(source.id)}/check`)
                  setChecks(current => ({ ...current, [source.id]: result.updateAvailable }))
                })}>{t("skills.check")}</button>
                <button type="button" className="st-button" disabled={busy === source.id} onClick={() => void run(source.id, () => request(`/api/skills/sources/${encodeURIComponent(source.id)}/update`, { method: "POST", headers: JSON_HEADERS, body: "{}" }))}>{t("skills.update")}</button>
                <button type="button" className="st-prov-icon-btn" aria-label={t("skills.remove")} onClick={() => void run(source.id, () => request(`/api/skills/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" }))}><Trash2 className="size-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function WriteSkillCard({ attempt }: { attempt: Attempt }) {
  const { t } = useI18n()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [body, setBody] = useState("")
  return (
    <section className="ade-st-card" aria-label={t("skills.write")}>
      <h3>{t("skills.write")}</h3>
      <p className="st-hint">{t("skills.writeHint")}</p>
      <form className="ade-st-form is-stacked" onSubmit={event => {
        event.preventDefault()
        void attempt(async () => {
          await request("/api/skills/user", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name, description, body }) })
          setName(""); setDescription(""); setBody("")
        })
      }}>
        <input className="st-input" value={name} onChange={event => setName(event.target.value)} placeholder={t("skills.name")} aria-label={t("skills.name")} required />
        <input className="st-input" value={description} onChange={event => setDescription(event.target.value)} placeholder={t("skills.description")} aria-label={t("skills.description")} required />
        <textarea className="st-input" rows={4} value={body} onChange={event => setBody(event.target.value)} placeholder={t("skills.body")} aria-label={t("skills.body")} />
        <div><button className="st-button is-primary" disabled={!name.trim() || !description.trim()}><Plus className="size-3.5 inline mr-1" />{t("skills.create")}</button></div>
      </form>
    </section>
  )
}

function ImportMcp({ attempt }: { attempt: Attempt }) {
  const { t } = useI18n()
  const [text, setText] = useState("")
  const [done, setDone] = useState("")
  return (
    <form className="ade-st-form is-stacked" onSubmit={event => {
      event.preventDefault()
      void attempt(async () => {
        const data = await request<{ servers: unknown[] }>("/api/mcp/import", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ text }) })
        setDone(t("tools.imported", { count: data.servers.length }))
        setText("")
      })
    }}>
      <h4>{t("tools.import")}</h4>
      <p className="st-hint">{t("tools.importHint")}</p>
      <textarea className="st-input" rows={3} value={text} onChange={event => setText(event.target.value)} placeholder='{ "mcpServers": { "name": { "command": "npx", "args": ["-y", "…"] } } }' aria-label={t("tools.import")} spellCheck={false} />
      <div><button className="st-button" disabled={!text.trim()}>{t("tools.importButton")}</button> {done ? <span className="st-hint" role="status">{done}</span> : null}</div>
    </form>
  )
}
