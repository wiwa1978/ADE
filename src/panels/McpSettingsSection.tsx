import { useState } from "react"
import { Shield, Trash2 } from "lucide-react"
import { useI18n } from "../i18n/I18nContext"
import type { ApprovalPolicy, ApprovalRule } from "../../app-types"

export function McpAndSecuritySettings({
  approvalPolicy,
  approvalRules,
  onChangeApprovalPolicy,
  onDeleteApprovalRule,
  onAddApprovalRule,
}: {
  approvalPolicy: ApprovalPolicy
  approvalRules: ApprovalRule[]
  onChangeApprovalPolicy: (policy: ApprovalPolicy) => Promise<void>
  onDeleteApprovalRule: (id: string) => Promise<void>
  onAddApprovalRule?: (prefix: string, effect: "allow" | "deny") => Promise<void>
}) {
  const { t } = useI18n()
  const [rulePrefix, setRulePrefix] = useState("")
  const [ruleEffect, setRuleEffect] = useState<"allow" | "deny">("deny")
  const [ruleError, setRuleError] = useState("")

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
    </div>
  )
}
