import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { Layers } from "lucide-react"
import { request } from "../api"
import type { ConversationTimelineSnapshot } from "../app-types"
import { EventStreamContext } from "../hooks/useEventStream"
import { useI18n } from "../i18n/I18nContext"
import { usePlugins } from "../marketplace/usePlugins"
import "../settings/skills-tools.css"

type ActiveSkill = {
  key: string
  name: string
  origin: { kind: "project" | "git" | "ade" | "tool"; label: string }
  shadowedBy: string | null
  state: { active: boolean }
}

type ActiveServer = {
  id: string
  name: string
  status: "disconnected" | "connecting" | "connected" | "error"
  origin: { kind: "ade" | "file" | "project"; label: string }
  active: boolean
  shadowedBy: string | null
}

function safeServerPrefix(name: string): string {
  return `mcp_${name.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24)}_`
}

/**
 * Compact header pill showing how many skills and MCP servers are active in this session,
 * plus a popover highlighting which ones the agent has actually used in the timeline.
 */
export function SessionCapabilitiesChip({
  projectId,
  timeline,
  onOpenSettings,
}: {
  projectId?: string | null
  timeline?: ConversationTimelineSnapshot | null
  onOpenSettings?: () => void
}) {
  const { t } = useI18n()
  const plugins = usePlugins()
  const stream = useContext(EventStreamContext)
  const [open, setOpen] = useState(false)
  const [skills, setSkills] = useState<ActiveSkill[] | null>(null)
  const [servers, setServers] = useState<ActiveServer[] | null>(null)
  const [reload, setReload] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const refresh = useCallback(() => setReload(v => v + 1), [])

  useEffect(() => {
    if (!stream) return
    const unsubCap = stream.subscribe("capabilities.update", refresh)
    const unsubMcp = stream.subscribe("mcp.update", refresh)
    return () => { unsubCap(); unsubMcp() }
  }, [stream, refresh])

  useEffect(() => {
    let alive = true
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
    void Promise.all([
      request<{ skills?: ActiveSkill[] }>(`/api/skills/landscape${qs}`).catch(() => ({ skills: [] })),
      request<{ servers?: ActiveServer[] }>(`/api/mcp/scoped${qs}`).catch(() => ({ servers: [] })),
    ]).then(([skillRes, mcpRes]) => {
      if (!alive) return
      setSkills((skillRes.skills ?? []).filter(s => !s.shadowedBy && s.state.active))
      setServers((mcpRes.servers ?? []).filter(s => !s.shadowedBy && s.active))
    })
    return () => { alive = false }
  }, [projectId, reload])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const usage = useMemo(() => {
    const skillCounts = new Map<string, number>()
    const mcpCalls: string[] = []
    for (const item of timeline?.items ?? []) {
      if (item.kind !== "assistant") continue
      for (const call of item.toolCalls ?? []) {
        if (call.name === "read_skill") {
          const argName = typeof call.arguments?.name === "string" ? call.arguments.name.trim().toLowerCase() : ""
          if (argName) skillCounts.set(argName, (skillCounts.get(argName) ?? 0) + 1)
        } else if (call.name.startsWith("mcp_")) {
          mcpCalls.push(call.name)
        }
      }
    }
    const serverCounts = new Map<string, number>()
    for (const server of servers ?? []) {
      const prefix = safeServerPrefix(server.name)
      const count = mcpCalls.filter(name => name.startsWith(prefix)).length
      if (count > 0) serverCounts.set(server.id, count)
    }
    return { skillCounts, serverCounts }
  }, [timeline, servers])

  if (!plugins.isModuleEnabled("skills-mcp")) return null
  if (skills === null || servers === null) return null
  if (skills.length === 0 && servers.length === 0) return null

  return (
    <div ref={wrapRef} className="ade-cap-wrap">
      <button
        type="button"
        className="ade-pill"
        aria-expanded={open}
        title={t("session.cap.title")}
        onClick={() => {
          if (onOpenSettings) {
            onOpenSettings()
          } else {
            setOpen(v => !v)
          }
        }}
      >
        <Layers className="size-3" />
        {t("session.cap.chip", { skills: skills.length, mcp: servers.length })}
      </button>
      {open ? (
        <div className="ade-cap-popover" role="dialog" aria-label={t("session.cap.title")}>
          <div className="ade-cap-popover-head">
            <strong>{t("session.cap.title")}</strong>
            {onOpenSettings ? (
              <button
                type="button"
                className="ade-st-link"
                onClick={() => { setOpen(false); onOpenSettings() }}
              >
                {t("session.cap.manage")}
              </button>
            ) : null}
          </div>

          <div>
            <h4>{t("skills.title")} ({skills.length})</h4>
            {skills.length === 0 ? <p className="st-hint">{t("session.cap.noneActive")}</p> : (
              <ul className="ade-cap-list">
                {skills.map(skill => {
                  const used = usage.skillCounts.get(skill.name.toLowerCase()) ?? 0
                  return (
                    <li key={skill.key}>
                      <span>
                        <strong>{skill.name}</strong>{" "}
                        <span className={`ade-st-pill is-${skill.origin.kind}`}>{skill.origin.label}</span>
                      </span>
                      {used > 0 ? <span className="ade-cap-used">{t("session.cap.used", { count: used })}</span> : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div>
            <h4>{t("tools.title")} ({servers.length})</h4>
            {servers.length === 0 ? <p className="st-hint">{t("session.cap.noneActive")}</p> : (
              <ul className="ade-cap-list">
                {servers.map(server => {
                  const used = usage.serverCounts.get(server.id) ?? 0
                  return (
                    <li key={server.id}>
                      <span>
                        <strong>{server.name}</strong>{" "}
                        <span className="ade-st-pill">{server.origin.label}</span>
                      </span>
                      {used > 0 ? <span className="ade-cap-used">{t("session.cap.used", { count: used })}</span> : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
