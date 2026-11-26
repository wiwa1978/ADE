import { useCallback, useContext, useEffect, useState } from "react"
import { request, requestJson } from "../api"
import { Banner, Button } from "@/components/ui"
import { EventStreamContext } from "../hooks/useEventStream"
import { useI18n } from "../i18n/I18nContext"
import "../settings/skills-tools.css"

type SkillState = { active: boolean; global: boolean | null; project: boolean | null }
type ProjectSkill = {
  key: string; name: string; description: string; path: string
  origin: { kind: "project" | "git" | "ade" | "tool"; label: string }
  shadowedBy: string | null; state: SkillState
}
type ProjectServer = {
  id: string; key: string; name: string; transport: "stdio" | "http"
  origin: { kind: "ade" | "file" | "project"; label: string; path?: string }
  active: boolean; globalSetting: boolean | null; projectSetting: boolean | null; needsTrust: boolean; shadowedBy: string | null
}

/**
 * Project settings section for Skills & MCP: turn skills or MCP servers on/off for this project
 * (overriding the global setting) and trust a repository's `.mcp.json` once.
 */
export function ProjectCapabilitiesSettings({ projectId }: { projectId: string }) {
  const { t } = useI18n()
  const stream = useContext(EventStreamContext)
  const [skills, setSkills] = useState<ProjectSkill[] | null>(null)
  const [servers, setServers] = useState<ProjectServer[] | null>(null)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const refresh = useCallback(() => setReload(v => v + 1), [])

  useEffect(() => {
    if (!stream) return
    const unsubCap = stream.subscribe("capabilities.update", refresh)
    const unsubMcp = stream.subscribe("mcp.update", refresh)
    return () => { unsubCap(); unsubMcp() }
  }, [stream, refresh])

  useEffect(() => {
    let alive = true
    const qs = `?projectId=${encodeURIComponent(projectId)}`
    void Promise.all([
      request<{ skills: ProjectSkill[] }>(`/api/skills/landscape${qs}`),
      request<{ servers: ProjectServer[] }>(`/api/mcp/scoped${qs}`),
    ]).then(
      ([skillRes, mcpRes]) => {
        if (!alive) return
        setSkills(skillRes.skills.filter(s => !s.shadowedBy))
        setServers(mcpRes.servers.filter(s => !s.shadowedBy))
        setError("")
      },
      err => {
        if (!alive) return
        setSkills([])
        setServers([])
        setError(err instanceof Error ? err.message : t("skills.loadError"))
      },
    )
    return () => { alive = false }
  }, [projectId, reload, t])

  const setCapability = async (kind: "skill" | "mcp" | "mcp-trust", key: string, enabled: boolean | null) => {
    setError("")
    try {
      await requestJson("/api/capabilities", "PUT", { scope: "project", projectId, kind, key, enabled })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skills.saveError"))
    }
  }

  const effectiveSkills = skills ?? []
  const effectiveServers = servers ?? []
  const activeSkills = effectiveSkills.filter(s => s.state.active).length
  const needsTrust = effectiveServers.some(s => s.needsTrust)

  return (
    <section className="project-scripts" aria-labelledby="project-capabilities-title">
      <h3 id="project-capabilities-title">{t("prjx.cfg.capabilities.title")}</h3>
      <p className="hint">{t("prjx.cfg.capabilities.intro")}</p>
      {error ? <Banner tone="error">{error}</Banner> : null}

      {needsTrust ? (
        <div className="ade-st-trust" role="status">
          <span>{t("tools.needsTrust")}</span>
          <Button type="button" variant="primary" size="sm" onClick={() => void setCapability("mcp-trust", ".mcp.json", true)}>
            {t("tools.trust")}
          </Button>
        </div>
      ) : null}

      <h4>{t("skills.title")} {skills ? <span className="hint">{t("skills.count", { active: activeSkills, total: effectiveSkills.length })}</span> : null}</h4>
      {skills && effectiveSkills.length === 0 ? <p className="hint">{t("skills.empty")}</p> : null}
      {effectiveSkills.length > 0 ? (
        <ul className="ade-st-list">
          {effectiveSkills.map(skill => (
            <li key={skill.key}>
              <div className="ade-st-main">
                <strong>{skill.name}</strong>
                <span className={`ade-st-pill is-${skill.origin.kind}`}>{skill.origin.label}</span>
                {skill.state.project !== null ? (
                  <span className="hint">{skill.state.project ? t("skills.onHere") : t("skills.offHere")}</span>
                ) : skill.state.global !== null ? (
                  <span className="hint">{skill.state.global ? t("skills.onFromAll") : t("skills.offFromAll")}</span>
                ) : null}
              </div>
              <div className="ade-st-actions">
                <button
                  type="button"
                  role="switch"
                  aria-checked={skill.state.active}
                  aria-label={t("skills.toggle", { name: skill.name })}
                  className={`st-switch ${skill.state.active ? "is-on" : ""}`}
                  onClick={() => void setCapability("skill", skill.name, !skill.state.active)}
                ><span /></button>
                {skill.state.project !== null ? (
                  <button type="button" className="ade-st-link" onClick={() => void setCapability("skill", skill.name, null)}>{t("skills.inherit")}</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <h4>{t("tools.title")}</h4>
      {servers && effectiveServers.length === 0 ? <p className="hint">{t("tools.none")}</p> : null}
      {effectiveServers.length > 0 ? (
        <ul className="ade-st-list">
          {effectiveServers.map(server => (
            <li key={server.id} className={server.needsTrust ? "is-dim" : ""}>
              <div className="ade-st-main">
                <strong>{server.name}</strong>
                <span className="ade-st-pill">{server.origin.label}</span>
                <span className="ade-st-pill">{server.transport}</span>
                {server.projectSetting !== null ? (
                  <span className="hint">{server.projectSetting ? t("skills.onHere") : t("skills.offHere")}</span>
                ) : server.globalSetting !== null ? (
                  <span className="hint">{server.globalSetting ? t("skills.onFromAll") : t("skills.offFromAll")}</span>
                ) : null}
              </div>
              <div className="ade-st-actions">
                <button
                  type="button"
                  role="switch"
                  aria-checked={server.active}
                  aria-label={t("skills.toggle", { name: server.name })}
                  className={`st-switch ${server.active ? "is-on" : ""}`}
                  disabled={server.needsTrust}
                  onClick={() => void setCapability("mcp", server.key, !server.active)}
                ><span /></button>
                {server.projectSetting !== null ? (
                  <button type="button" className="ade-st-link" onClick={() => void setCapability("mcp", server.key, null)}>{t("skills.inherit")}</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
