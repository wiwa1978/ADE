import { useCallback, useContext, useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Pencil, Plug, Plus, Trash2, Unplug } from "lucide-react"
import { request, requestJson } from "../api"
import { ConfirmContext } from "@/components/ui/confirm-context"
import { EventStreamContext } from "../hooks/useEventStream"
import { useI18n } from "../i18n/I18nContext"
import "./skills-tools.css"

type State = { active: boolean; global: boolean | null; project: boolean | null }
type Skill = {
  key: string; name: string; description: string; path: string; dir: string
  origin: { kind: "project" | "git" | "ade" | "tool"; label: string; sourceId?: string; ref?: string | null; commit?: string | null }
  tokens: number; extraFiles: number; shadowedBy: string | null; state: State
}
type Source = { id: string; url: string; ref: string | null; subpath: string | null; commit: string | null; status: "ready" | "error"; error: string | null }
type Preview = { previewId: string; url: string; commit: string | null; skills: { name: string; description: string; relPath: string; extraFiles?: number }[] }
type Server = {
  id: string; key: string; name: string; transport: "stdio" | "http"; enabled: boolean
  command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>
  status: "disconnected" | "connecting" | "connected" | "error"; error: string | null; tools: { name: string; description?: string; enabled?: boolean }[]
  origin: { kind: "ade" | "file" | "project"; label: string; path?: string }
  readOnly: boolean; active: boolean; globalSetting: boolean | null; projectSetting: boolean | null; needsTrust: boolean; shadowedBy: string | null
}
type ProjectRef = { id: string; name: string }

function parseKvLines(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const idx = line.indexOf(sep)
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) out[key] = value
  }
  return out
}

function formatKvLines(map: Record<string, string> | undefined, sep: "=" | ":"): string {
  return Object.entries(map ?? {}).map(([k, v]) => `${k}${sep === ":" ? ": " : "="}${v}`).join("\n")
}

/**
 * Skills and tool servers: everything ADE found and where it came from, what is on, for all
 * projects or one. Everything is on unless turned off; a project's setting beats the global one.
 */
export function SkillsToolsSettings({ projects, activeEnvironmentName, onRefreshMcp, fixedProjectId }: { projects: ProjectRef[]; activeEnvironmentName?: string; onRefreshMcp?: () => void; fixedProjectId?: string }) {
  const { t } = useI18n()
  const stream = useContext(EventStreamContext)
  const [projectId, setProjectId] = useState(fixedProjectId ?? "")
  const scopeQuery = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
  const [skills, setSkills] = useState<Skill[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [servers, setServers] = useState<Server[]>([])
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [editingServer, setEditingServer] = useState<Server | null>(null)
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const refresh = useCallback(() => setReload(value => value + 1), [])

  useEffect(() => {
    if (!stream) return
    const unsubCap = stream.subscribe("capabilities.update", refresh)
    const unsubMcp = stream.subscribe("mcp.update", refresh)
    return () => { unsubCap(); unsubMcp() }
  }, [stream, refresh])

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
  const setCapability = (kind: "skill" | "mcp" | "mcp-trust" | "mcp-tool", key: string, enabled: boolean | null) => attempt(() => requestJson("/api/capabilities", "PUT", { scope: projectId ? "project" : "global", projectId: projectId || undefined, kind, key, enabled }))

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
        {activeEnvironmentName ? <span className="ade-st-env">{t("skills.environment", { name: activeEnvironmentName })}</span> : null}
        {fixedProjectId ? <span className="st-hint">{t("skills.projectScopeHint")}</span> : (
          <>
            <label htmlFor="st-capability-scope">{t("skills.scope")}</label>
            <select id="st-capability-scope" className="st-select" value={projectId} onChange={event => setProjectId(event.target.value)}>
              <option value="">{t("skills.scopeGlobal")}</option>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <span className="st-hint">{t("skills.scopeHint")}</span>
          </>
        )}
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
                {server.status === "connected" ? (
                  <button
                    type="button"
                    className="ade-st-tools-btn"
                    aria-expanded={Boolean(expandedTools[server.id])}
                    title={t("tools.inspectTools")}
                    onClick={() => setExpandedTools(cur => ({ ...cur, [server.id]: !cur[server.id] }))}
                  >
                    {expandedTools[server.id] ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    {server.tools.length === 1 ? t("tools.oneTool") : t("tools.toolCount", { count: server.tools.length })}
                  </button>
                ) : (
                  server.error ? <span className="st-hint">{server.error}</span> : null
                )}
                {server.origin.path ? <code className="ade-st-path">{server.origin.path}</code> : null}
                {server.shadowedBy ? <span className="st-hint">{t("tools.shadowed")}</span> : null}
                {server.readOnly ? <span className="st-hint">{t("tools.readOnly", { origin: server.origin.label })}</span> : null}
                {expandedTools[server.id] && server.tools.length > 0 ? (
                  <ul className="ade-st-tools-list">
                    {server.tools.map(tool => (
                      <li key={tool.name}>
                        <code>{tool.name}</code>
                        {tool.description ? <span className="st-hint">{tool.description}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {server.tools.length ? (
                  <ul className="ade-st-tool-switches">
                    {server.tools.map(tool => (
                      <li key={tool.name}>
                        <label>
                          <input type="checkbox" checked={tool.enabled !== false} onChange={event => void setCapability("mcp-tool", `${server.key}::${tool.name}`, event.target.checked)} />
                          {tool.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : server.active ? <span className="st-hint">{t("tools.connectForTools")}</span> : null}
              </div>
              <div className="ade-st-actions">
                {server.readOnly && !server.needsTrust ? <button type="button" className="st-button" onClick={() => void attempt(() => requestJson(`/api/mcp/${encodeURIComponent(server.id)}/adopt${scopeQuery}`, "POST"))}>{t("tools.copyIntoAde")}</button> : null}
                {server.active ? (
                  <button type="button" className="st-button is-quiet" title={server.status === "connected" ? t("common.disconnect") : t("common.connect")} onClick={() => void attempt(() => requestJson(`/api/mcp/${encodeURIComponent(server.id)}/${server.status === "connected" ? "disconnect" : "connect"}${scopeQuery}`, "POST"))}>
                    {server.status === "connected" ? <Unplug className="size-3.5" /> : <Plug className="size-3.5" />}
                  </button>
                ) : null}
                {!server.readOnly ? (
                  <>
                    <button type="button" className="st-prov-icon-btn" aria-label={t("tools.edit")} title={t("tools.edit")} onClick={() => setEditingServer(server)}><Pencil className="size-3.5" /></button>
                    <button type="button" className="st-prov-icon-btn" aria-label={t("skills.remove")} onClick={() => void attempt(() => request(`/api/mcp/${encodeURIComponent(server.id)}`, { method: "DELETE" }))}><Trash2 className="size-3.5" /></button>
                  </>
                ) : null}
                <Switch label={t("skills.toggle", { name: server.name })} on={projectId ? server.active : (server.globalSetting ?? server.enabled)} onChange={on => void setCapability("mcp", server.key, on)} />
                {projectId && server.projectSetting !== null ? <button type="button" className="ade-st-link" onClick={() => void setCapability("mcp", server.key, null)}>{t("skills.inherit")}</button> : null}
              </div>
            </li>
          ))}
        </ul>
        <AddOrEditMcp key={editingServer?.id ?? "new"} editing={editingServer} onDone={() => setEditingServer(null)} attempt={attempt} />
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
  const confirmCtx = useContext(ConfirmContext)
  const [filter, setFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "off" | "shadowed">("all")
  const [originFilter, setOriginFilter] = useState<"all" | "project" | "git" | "ade" | "tool">("all")
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState("")
  const effective = skills.filter(skill => !skill.shadowedBy)
  const needle = filter.trim().toLowerCase()
  const shown = skills.filter(skill => {
    if (originFilter !== "all" && skill.origin.kind !== originFilter) return false
    if (statusFilter === "shadowed" && !skill.shadowedBy) return false
    if (statusFilter === "active" && (skill.shadowedBy || !shownActive(skill.state))) return false
    if (statusFilter === "off" && (skill.shadowedBy || shownActive(skill.state))) return false
    if (needle && !`${skill.name} ${skill.description} ${skill.origin.label} ${skill.path}`.toLowerCase().includes(needle)) return false
    return true
  })
  const activeCount = effective.filter(skill => shownActive(skill.state)).length
  const openEdit = (path: string) => void attempt(async () => {
    const data = await request<{ path: string; content: string }>(`/api/skills/user?path=${encodeURIComponent(path)}`)
    setEditingPath(data.path)
    setEditingContent(data.content)
  })
  const deleteSkill = async (skill: Skill) => {
    const promptText = t("skills.deleteConfirm", { name: skill.name })
    const ok = confirmCtx
      ? await confirmCtx.confirm({ title: t("skills.deleteTitle"), description: promptText, confirmLabel: t("skills.delete"), destructive: true })
      : (typeof window === "undefined" || typeof window.confirm !== "function" ? true : window.confirm(promptText))
    if (!ok) return
    await attempt(() => request(`/api/skills/user?path=${encodeURIComponent(skill.path)}`, { method: "DELETE" }))
  }
  return (
    <section className="ade-st-card" aria-label={t("skills.title")}>
      <h3>{t("skills.title")} <span className="st-hint">{t("skills.count", { active: activeCount, total: effective.length })}</span></h3>
      {skills.length === 0 ? <p className="st-hint">{t("skills.empty")}</p> : (
        <>
          <input className="st-input ade-st-filter" value={filter} onChange={event => setFilter(event.target.value)} placeholder={t("skills.search")} aria-label={t("skills.search")} />
          <div className="ade-st-filters">
            {([
              ["all", t("skills.filterAll")],
              ["active", t("skills.filterActive")],
              ["off", t("skills.filterOff")],
              ["shadowed", t("skills.filterShadowed")],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" className={`ade-st-chip ${statusFilter === id ? "is-active" : ""}`} onClick={() => setStatusFilter(id)}>{label}</button>
            ))}
            <select className="st-select" value={originFilter} onChange={event => setOriginFilter(event.target.value as typeof originFilter)} aria-label={t("skills.allOrigins")}>
              <option value="all">{t("skills.allOrigins")}</option>
              <option value="project">{t("skills.originProject")}</option>
              <option value="git">{t("skills.originGit")}</option>
              <option value="ade">{t("skills.originAde")}</option>
              <option value="tool">{t("skills.originTool")}</option>
            </select>
          </div>
        </>
      )}
      {skills.length > 0 && shown.length === 0 ? <p className="st-hint">{t("skills.noMatch")}</p> : null}
      <ul className="ade-st-list">
        {shown.map(skill => (
          <li key={skill.key} className={skill.shadowedBy ? "is-dim" : ""}>
            <div className="ade-st-main">
              <strong>{skill.name}</strong>
              <span className={`ade-st-pill is-${skill.origin.kind}`}>{skill.origin.label}</span>
              {skill.origin.commit ? <code>{skill.origin.commit.slice(0, 7)}</code> : null}
              <span className="st-hint">{t("skills.tokens", { count: skill.tokens })}{skill.extraFiles ? ` · ${t("skills.extraFiles", { count: skill.extraFiles })}` : ""}</span>
              <p className="ade-st-desc">{skill.description}</p>
              <code className="ade-st-path">{skill.path}</code>
              {skill.shadowedBy ? <span className="st-hint">{t("skills.shadowed")}</span> : stateHint(skill.state) ? <span className="st-hint">{stateHint(skill.state)}</span> : null}
              {editingPath === skill.path ? (
                <div className="ade-st-editor">
                  <textarea className="st-input" rows={8} value={editingContent} onChange={event => setEditingContent(event.target.value)} aria-label={t("skills.body")} spellCheck={false} />
                  <div className="ade-st-actions">
                    <button type="button" className="st-button is-quiet" onClick={() => setEditingPath(null)}>{t("common.cancel")}</button>
                    <button type="button" className="st-button is-primary" onClick={() => void attempt(async () => {
                      await requestJson("/api/skills/user", "PUT", { path: skill.path, content: editingContent })
                      setEditingPath(null)
                    })}>{t("skills.save")}</button>
                  </div>
                </div>
              ) : null}
            </div>
            {!skill.shadowedBy ? (
              <div className="ade-st-actions">
                {skill.origin.kind === "ade" ? <>
                  <button type="button" className="st-prov-icon-btn" aria-label={t("skills.edit")} title={t("skills.edit")} onClick={() => openEdit(skill.path)}><Pencil className="size-3.5" /></button>
                  <button type="button" className="st-prov-icon-btn" aria-label={t("skills.delete")} onClick={() => void deleteSkill(skill)}><Trash2 className="size-3.5" /></button>
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
  const [unticked, setUnticked] = useState<Record<string, boolean>>({})
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
          const data = await requestJson<{ preview: Preview }>("/api/skills/sources/preview", "POST", { url, ref, subpath })
          setPreview(data.preview)
          setUnticked({})
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
          <span className="st-hint">{t("skills.previewHint")}</span>
          <ul className="ade-st-preview-list">
            {preview.skills.map(skill => (
              <li key={skill.relPath}>
                <label>
                  <input type="checkbox" checked={!unticked[skill.name]} onChange={event => setUnticked(cur => ({ ...cur, [skill.name]: !event.target.checked }))} />
                  <strong>{skill.name}</strong>
                  {skill.extraFiles ? <span className="ade-st-pill is-warn">{t("skills.scriptsWarning")}</span> : null}
                  <span className="st-hint">{skill.description}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="ade-st-actions">
            <button type="button" className="st-button is-quiet" onClick={() => { void requestJson("/api/skills/sources/discard", "POST", { previewId: preview.previewId }).catch(() => undefined); setPreview(null); setUnticked({}) }}>{t("common.cancel")}</button>
            <button type="button" className="st-button is-primary" disabled={busy === "install"} onClick={() => void run("install", async () => {
              await requestJson("/api/skills/sources/confirm", "POST", { previewId: preview.previewId })
              for (const skill of preview.skills) {
                if (unticked[skill.name]) {
                  await requestJson("/api/capabilities", "PUT", { scope: "global", kind: "skill", key: skill.name, enabled: false })
                }
              }
              setPreview(null); setUnticked({}); setUrl(""); setRef(""); setSubpath("")
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
                <button type="button" className="st-button" disabled={busy === source.id} onClick={() => void run(source.id, () => requestJson(`/api/skills/sources/${encodeURIComponent(source.id)}/update`, "POST"))}>{t("skills.update")}</button>
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
          await requestJson("/api/skills/user", "POST", { name, description, body })
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

function AddOrEditMcp({ editing, onDone, attempt }: { editing: Server | null; onDone: () => void; attempt: Attempt }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(Boolean(editing))
  const [name, setName] = useState(editing?.name ?? "")
  const [transport, setTransport] = useState<"stdio" | "http">(editing?.transport ?? "stdio")
  const [command, setCommand] = useState(editing?.command ?? "")
  const [argsText, setArgsText] = useState(editing?.args?.join(" ") ?? "")
  const [url, setUrl] = useState(editing?.url ?? "")
  const [kvText, setKvText] = useState(editing ? (editing.transport === "http" ? formatKvLines(editing.headers, ":") : formatKvLines(editing.env, "=")) : "")

  if (!open && !editing) {
    return <div><button type="button" className="st-button" onClick={() => setOpen(true)}><Plus className="size-3.5 inline mr-1" />{t("tools.add")}</button></div>
  }

  return (
    <form className="ade-st-form is-stacked" onSubmit={event => {
      event.preventDefault()
      void attempt(async () => {
        await requestJson("/api/mcp", "POST", {
          id: editing?.id,
          name,
          transport,
          command: transport === "stdio" ? command : undefined,
          args: transport === "stdio" && argsText.trim() ? argsText.trim().split(/\s+/) : [],
          env: transport === "stdio" ? parseKvLines(kvText, "=") : undefined,
          url: transport === "http" ? url : undefined,
          headers: transport === "http" ? parseKvLines(kvText, ":") : undefined,
          enabled: editing ? editing.enabled : true,
        })
        setOpen(false)
        onDone()
      })
    }}>
      <h4>{editing ? `${t("tools.edit")}: ${editing.name}` : t("tools.add")}</h4>
      <div className="ade-st-form">
        <input className="st-input" value={name} onChange={event => setName(event.target.value)} placeholder={t("tools.namePlaceholder")} aria-label={t("tools.namePlaceholder")} required />
        <select className="st-select" value={transport} onChange={event => setTransport(event.target.value as "stdio" | "http")} aria-label="Transport">
          <option value="stdio">stdio</option>
          <option value="http">HTTP</option>
        </select>
      </div>
      {transport === "stdio" ? (
        <div className="ade-st-form">
          <input className="st-input" value={command} onChange={event => setCommand(event.target.value)} placeholder={t("tools.commandPlaceholder")} aria-label={t("tools.commandPlaceholder")} required />
          <input className="st-input" value={argsText} onChange={event => setArgsText(event.target.value)} placeholder={t("tools.argsPlaceholder")} aria-label={t("tools.argsPlaceholder")} />
        </div>
      ) : (
        <input className="st-input" value={url} onChange={event => setUrl(event.target.value)} placeholder={t("tools.urlPlaceholder")} aria-label={t("tools.urlPlaceholder")} required />
      )}
      <textarea className="st-input" rows={2} value={kvText} onChange={event => setKvText(event.target.value)} placeholder={transport === "stdio" ? t("tools.envPlaceholder") : t("tools.headersPlaceholder")} spellCheck={false} />
      <div className="ade-st-actions">
        <button type="button" className="st-button is-quiet" onClick={() => { setOpen(false); onDone() }}>{t("common.cancel")}</button>
        <button type="submit" className="st-button is-primary" disabled={!name.trim() || (transport === "stdio" ? !command.trim() : !url.trim())}>{editing ? t("tools.saveServer") : t("tools.addServer")}</button>
      </div>
    </form>
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
        const data = await requestJson<{ servers: unknown[] }>("/api/mcp/import", "POST", { text })
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
