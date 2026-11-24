import { SettingsRow, SettingsSection, StatusPill } from "@/components/ui"
import type {
  ApprovalPolicy,
  ApprovalRule,
  BrowserState,
  McpServerStatus,
  ProviderCatalogEntry,
  SkillsAndRulesCatalog,
} from "../../../app-types"
import { McpAndSecuritySettings } from "../../panels/McpSettingsSection"
import { OvernightSettings } from "../../subagents/OvernightSettings"

export function AgentsSettings({
  browserState,
  skillsCatalog,
  modelCatalog,
  mcpServers,
  approvalPolicy,
  approvalRules,
  onRefreshMcp,
  onChangeApprovalPolicy,
  onDeleteApprovalRule,
  onAddApprovalRule,
}: {
  browserState?: BrowserState
  skillsCatalog?: SkillsAndRulesCatalog
  modelCatalog: ProviderCatalogEntry[]
  mcpServers: McpServerStatus[]
  approvalPolicy: ApprovalPolicy
  approvalRules: ApprovalRule[]
  onRefreshMcp?: () => void
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => Promise<void>
  onDeleteApprovalRule?: (id: string) => Promise<void>
  onAddApprovalRule?: (prefix: string, effect: "allow" | "deny") => Promise<void>
}) {
  return (
    <>
      <SettingsSection
        title="Capabilities"
        description="Sessions with a workspace can read and edit files, search, and run commands in their branch, start subagents, and drive the built-in browser."
      >
        <SettingsRow title="Built-in browser">
          {browserState?.available ? (
            <StatusPill tone="ok">Chrome found</StatusPill>
          ) : (
            <StatusPill tone="warn">Chrome not found — set ADE_CHROME_PATH</StatusPill>
          )}
        </SettingsRow>
        <SettingsRow title="Skills found"><span className="st-value">{skillsCatalog?.skills.length ?? 0}</span></SettingsRow>
        <SettingsRow title="Rules files"><span className="st-value">{skillsCatalog?.rules.length ?? 0}</span></SettingsRow>
        <SettingsRow title="Slash commands"><span className="st-value">{skillsCatalog?.commands.length ?? 0}</span></SettingsRow>
      </SettingsSection>

      {onChangeApprovalPolicy && onDeleteApprovalRule && onRefreshMcp ? (
        <SettingsSection title="Approvals and MCP servers" plain>
          <div className="st-embedded">
            <McpAndSecuritySettings
              mcpServers={mcpServers}
              approvalPolicy={approvalPolicy}
              approvalRules={approvalRules}
              onRefreshMcp={onRefreshMcp}
              onChangeApprovalPolicy={onChangeApprovalPolicy}
              onDeleteApprovalRule={onDeleteApprovalRule}
              onAddApprovalRule={onAddApprovalRule}
            />
          </div>
        </SettingsSection>
      ) : null}

      <OvernightSettings modelCatalog={modelCatalog} />
    </>
  )
}
