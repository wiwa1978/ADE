import { useState } from "react"
import { Plug, Plus, Shield, Trash2, Unplug } from "lucide-react"
import { request } from "../../api"
import { useI18n } from "../i18n/I18nContext"
import type { ApprovalPolicy, ApprovalRule, McpServerStatus } from "../../app-types"

export function McpAndSecuritySettings({
  mcpServers,
  approvalPolicy,
  approvalRules,
  onRefreshMcp,
  onChangeApprovalPolicy,
  onDeleteApprovalRule,
  onAddApprovalRule,
}: {
  mcpServers: McpServerStatus[]
  approvalPolicy: ApprovalPolicy
  approvalRules: ApprovalRule[]
  onRefreshMcp: () => void
  onChangeApprovalPolicy: (policy: ApprovalPolicy) => Promise<void>
  onDeleteApprovalRule: (id: string) => Promise<void>
  onAddApprovalRule?: (prefix: string, effect: "allow" | "deny") => Promise<void>
}) {
  const { t } = useI18n()
  const [rulePrefix, setRulePrefix] = useState("")
  const [ruleEffect, setRuleEffect] = useState<"allow" | "deny">("deny")
  const [ruleError, setRuleError] = useState("")
  const [name, setName] = useState("")
  const [transport, setTransport] = useState<"stdio" | "http">("stdio")
  const [command, setCommand] = useState("")
  const [argsText, setArgsText] = useState("")
  const [url, setUrl] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")

  const addServer = async () => {
    setError("")
    setBusyId("add")
    try {
      await request("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          transport,
          command: transport === "stdio" ? command : undefined,
          args: transport === "stdio" && argsText.trim() ? argsText.trim().split(/\s+/) : [],
          url: transport === "http" ? url : undefined,
          enabled: true,
        }),
      })
      setName("")
      setCommand("")
      setArgsText("")
      setUrl("")
      onRefreshMcp()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mcpui.saveError"))
    } finally {
      setBusyId(null)
    }
  }

  const toggleConnect = async (server: McpServerStatus) => {
    setBusyId(server.id)
    setError("")
    try {
      await request(`/api/mcp/${encodeURIComponent(server.id)}/${server.status === "connected" ? "disconnect" : "connect"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      onRefreshMcp()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mcpui.actionError"))
    } finally {
      setBusyId(null)
    }
  }

  const removeServer = async (id: string) => {
    setBusyId(id)
    try {
      await request(`/api/mcp/${encodeURIComponent(id)}`, { method: "DELETE" })
      onRefreshMcp()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ade-ext-settings">
      <section className="ade-settings-card">
        <div className="ade-settings-card-head">
          <Shield className="size-4" />
          <div>
            <h3>{t("mcpui.approvalsTitle")}</h3>
            <p className="ade-muted ade-xs">{t("mcpui.approvalsDesc")}</p>
          </div>
        </div>

        <div className="ade-policy-row">
          {(["auto-safe", "ask", "auto-all"] as ApprovalPolicy[]).map(p => (
            <button
              key={p}
              type="button"
              className={`ade-chip-btn ${approvalPolicy === p ? "is-active" : ""}`}
              onClick={() => void onChangeApprovalPolicy(p)}
            >
              {p === "auto-safe" ? t("mcpui.policyAutoSafe") : p === "ask" ? t("mcpui.policyAsk") : t("mcpui.policyAutopilot")}
            </button>
          ))}
        </div>

        <p className="ade-muted ade-xs" dangerouslySetInnerHTML={{ __html: t("mcpui.autopilotNote") }} />
        <p className="ade-muted ade-xs" dangerouslySetInnerHTML={{ __html: t("mcpui.rulesNote") }} />
        {onAddApprovalRule ? (
          <form
            className="ade-rule-form"
            onSubmit={event => {
              event.preventDefault()
              const prefix = rulePrefix.trim()
              if (!prefix) return
              setRuleError("")
              void onAddApprovalRule(prefix, ruleEffect).then(() => setRulePrefix("")).catch((err: unknown) => setRuleError(err instanceof Error ? err.message : t("mcpui.addRuleError")))
            }}
          >
            <select aria-label={t("mcpui.ruleEffect")} value={ruleEffect} onChange={event => setRuleEffect(event.target.value as "allow" | "deny")}>
              <option value="deny">{t("mcpui.alwaysBlock")}</option>
              <option value="allow">{t("mcpui.alwaysAllow")}</option>
            </select>
            <input aria-label={t("mcpui.commandPrefix")} placeholder="git push" value={rulePrefix} onChange={event => setRulePrefix(event.target.value)} spellCheck={false} />
            <button type="submit" className="ade-chip-btn" disabled={!rulePrefix.trim()}>{t("mcpui.addRule")}</button>
          </form>
        ) : null}
        {ruleError ? <p className="ade-muted ade-xs" role="alert">{ruleError}</p> : null}

        {approvalRules.length > 0 ? (
          <div className="ade-rules-list">
            {approvalRules.map(rule => (
              <div key={rule.id} className="ade-rule-row">
                <div>
                  <span className={`ade-pill ${rule.effect === "deny" ? "is-deny" : ""}`}>{rule.effect === "deny" ? t("mcpui.block") : t("mcpui.allow")}</span>{" "}
                  <code>{rule.prefix}</code>
                  {rule.toolName !== "run_command" ? <span className="ade-muted ade-xs"> · {rule.toolName}</span> : null}
                </div>
                <button type="button" className="ade-icon-btn" onClick={() => void onDeleteApprovalRule(rule.id)} title={t("mcpui.removeRule")}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="ade-muted ade-xs">{t("mcpui.noRules")}</p>
        )}
      </section>

      <section className="ade-settings-card">
        <div className="ade-settings-card-head">
          <Plug className="size-4" />
          <div>
            <h3>{t("mcpui.serversTitle")}</h3>
            <p className="ade-muted ade-xs" dangerouslySetInnerHTML={{ __html: t("mcpui.serversDesc") }} />
          </div>
        </div>

        {error ? <div className="ade-banner-error">{error}</div> : null}

        <div className="ade-mcp-form">
          <input type="text" className="ade-input-sm" placeholder={t("mcpui.serverName")} value={name} onChange={e => setName(e.target.value)} />
          <div className="ade-segmented">
            <button type="button" className={transport === "stdio" ? "is-active" : ""} onClick={() => setTransport("stdio")}>stdio</button>
            <button type="button" className={transport === "http" ? "is-active" : ""} onClick={() => setTransport("http")}>HTTP</button>
          </div>
          {transport === "stdio" ? (
            <>
              <input type="text" className="ade-input-sm" placeholder={t("mcpui.command")} value={command} onChange={e => setCommand(e.target.value)} />
              <input type="text" className="ade-input-sm" placeholder={t("mcpui.args")} value={argsText} onChange={e => setArgsText(e.target.value)} />
            </>
          ) : (
            <input type="text" className="ade-input-sm flex-1" placeholder="https://example.com/mcp" value={url} onChange={e => setUrl(e.target.value)} />
          )}
          <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={busyId === "add" || !name.trim()} onClick={() => void addServer()}>
            <Plus className="size-3.5" /> {t("common.add")}
          </button>
        </div>

        <div className="ade-rules-list">
          {mcpServers.length === 0 ? (
            <p className="ade-muted ade-xs">{t("mcpui.none")}</p>
          ) : (
            mcpServers.map(srv => (
              <div key={srv.id} className="ade-rule-row">
                <div>
                  <span className={`ade-dot ade-dot-${srv.status === "connected" ? "completed" : srv.status === "error" ? "failed" : "unknown"}`} />{" "}
                  <strong>{srv.name}</strong> <span className="ade-pill">{srv.transport}</span>{" "}
                  <span className="ade-muted ade-xs">
                    {srv.status === "connected" ? srv.tools.length === 1 ? t("mcpui.toolOne") : t("mcpui.toolMany", { count: srv.tools.length }) : srv.error || srv.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" className="ade-chip-btn" disabled={busyId === srv.id} onClick={() => void toggleConnect(srv)}>
                    {srv.status === "connected" ? <><Unplug className="size-3" /> {t("common.disconnect")}</> : <><Plug className="size-3" /> {t("common.connect")}</>}
                  </button>
                  <button type="button" className="ade-icon-btn" disabled={busyId === srv.id} onClick={() => void removeServer(srv.id)} title={t("mcpui.removeServer")}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
