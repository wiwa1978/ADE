import { useState } from "react"
import { Plug, Plus, Shield, Trash2, Unplug } from "lucide-react"
import { request } from "../../api"
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
      setError(err instanceof Error ? err.message : "Could not save MCP server.")
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
      setError(err instanceof Error ? err.message : "MCP connection action failed.")
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
            <h3>Command Approvals &amp; Allowlist</h3>
            <p className="ade-muted ade-xs">Control when agent shell commands and MCP tools pause for interactive approval.</p>
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
              {p === "auto-safe" ? "Auto-safe (read-only allowed)" : p === "ask" ? "Ask every command" : "Full auto"}
            </button>
          ))}
        </div>

        <p className="ade-muted ade-xs">Rules apply to the ADE agent. <strong>Always allow</strong> skips the approval prompt; <strong>Always block</strong> stops the command under every policy, including Full auto. A rule matches commands that start with it.</p>
        {onAddApprovalRule ? (
          <form
            className="ade-rule-form"
            onSubmit={event => {
              event.preventDefault()
              const prefix = rulePrefix.trim()
              if (!prefix) return
              setRuleError("")
              void onAddApprovalRule(prefix, ruleEffect).then(() => setRulePrefix("")).catch((err: unknown) => setRuleError(err instanceof Error ? err.message : "Could not add the rule."))
            }}
          >
            <select aria-label="Rule effect" value={ruleEffect} onChange={event => setRuleEffect(event.target.value as "allow" | "deny")}>
              <option value="deny">Always block</option>
              <option value="allow">Always allow</option>
            </select>
            <input aria-label="Command prefix" placeholder="git push" value={rulePrefix} onChange={event => setRulePrefix(event.target.value)} spellCheck={false} />
            <button type="submit" className="ade-chip-btn" disabled={!rulePrefix.trim()}>Add rule</button>
          </form>
        ) : null}
        {ruleError ? <p className="ade-muted ade-xs" role="alert">{ruleError}</p> : null}

        {approvalRules.length > 0 ? (
          <div className="ade-rules-list">
            {approvalRules.map(rule => (
              <div key={rule.id} className="ade-rule-row">
                <div>
                  <span className={`ade-pill ${rule.effect === "deny" ? "is-deny" : ""}`}>{rule.effect === "deny" ? "Block" : "Allow"}</span>{" "}
                  <code>{rule.prefix}</code>
                  {rule.toolName !== "run_command" ? <span className="ade-muted ade-xs"> · {rule.toolName}</span> : null}
                </div>
                <button type="button" className="ade-icon-btn" onClick={() => void onDeleteApprovalRule(rule.id)} title="Remove rule">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="ade-muted ade-xs">No rules yet. Approving a command with “Always allow” also adds one here.</p>
        )}
      </section>

      <section className="ade-settings-card">
        <div className="ade-settings-card-head">
          <Plug className="size-4" />
          <div>
            <h3>MCP Servers</h3>
            <p className="ade-muted ade-xs">Connect Model Context Protocol servers (stdio or Streamable HTTP). Also auto-imports <code>~/.ade/mcp.json</code>.</p>
          </div>
        </div>

        {error ? <div className="ade-banner-error">{error}</div> : null}

        <div className="ade-mcp-form">
          <input type="text" className="ade-input-sm" placeholder="Server name (e.g. filesystem)" value={name} onChange={e => setName(e.target.value)} />
          <div className="ade-segmented">
            <button type="button" className={transport === "stdio" ? "is-active" : ""} onClick={() => setTransport("stdio")}>stdio</button>
            <button type="button" className={transport === "http" ? "is-active" : ""} onClick={() => setTransport("http")}>HTTP</button>
          </div>
          {transport === "stdio" ? (
            <>
              <input type="text" className="ade-input-sm" placeholder="Command (e.g. npx)" value={command} onChange={e => setCommand(e.target.value)} />
              <input type="text" className="ade-input-sm" placeholder="Args (space-separated)" value={argsText} onChange={e => setArgsText(e.target.value)} />
            </>
          ) : (
            <input type="text" className="ade-input-sm flex-1" placeholder="https://example.com/mcp" value={url} onChange={e => setUrl(e.target.value)} />
          )}
          <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={busyId === "add" || !name.trim()} onClick={() => void addServer()}>
            <Plus className="size-3.5" /> Add
          </button>
        </div>

        <div className="ade-rules-list">
          {mcpServers.length === 0 ? (
            <p className="ade-muted ade-xs">No MCP servers configured yet.</p>
          ) : (
            mcpServers.map(srv => (
              <div key={srv.id} className="ade-rule-row">
                <div>
                  <span className={`ade-dot ade-dot-${srv.status === "connected" ? "completed" : srv.status === "error" ? "failed" : "unknown"}`} />{" "}
                  <strong>{srv.name}</strong> <span className="ade-pill">{srv.transport}</span>{" "}
                  <span className="ade-muted ade-xs">
                    {srv.status === "connected" ? `${srv.tools.length} tool${srv.tools.length === 1 ? "" : "s"}` : srv.error || srv.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" className="ade-chip-btn" disabled={busyId === srv.id} onClick={() => void toggleConnect(srv)}>
                    {srv.status === "connected" ? <><Unplug className="size-3" /> Disconnect</> : <><Plug className="size-3" /> Connect</>}
                  </button>
                  <button type="button" className="ade-icon-btn" disabled={busyId === srv.id} onClick={() => void removeServer(srv.id)} title="Remove MCP server">
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
