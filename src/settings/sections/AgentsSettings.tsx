import { Banner, SettingsRow, SettingsSection, StatusPill } from "@/components/ui"
import type {
  ApprovalPolicy,
  ApprovalRule,
  BrowserState,
  ProviderCatalogEntry,
  SkillsAndRulesCatalog,
} from "../../app-types"
import { useI18n } from "../../i18n/I18nContext"
import { McpAndSecuritySettings } from "../../panels/McpSettingsSection"
import { OvernightSettings } from "../../subagents/OvernightSettings"
import { usePlugins } from "../../marketplace/usePlugins"
import { PluginSettingsPanel } from "../../marketplace/PluginSettingsPanel"

export function AgentsSettings({
  browserState,
  skillsCatalog,
  modelCatalog,
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
  approvalPolicy: ApprovalPolicy
  approvalRules: ApprovalRule[]
  onRefreshMcp?: () => void
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => Promise<void>
  onDeleteApprovalRule?: (id: string) => Promise<void>
  onAddApprovalRule?: (prefix: string, effect: "allow" | "deny") => Promise<void>
}) {
  const { t } = useI18n()
  const plugins = usePlugins()
  const guardrailPlugins = (plugins.snapshot?.installed ?? []).filter(
    plugin => plugin.enabled && (plugin.capabilities.guardrails?.length ?? 0) > 0,
  )

  return (
    <>
      <SettingsSection
        title={t("settings.agents.capabilities")}
        description={t("settings.agents.capabilitiesDesc")}
      >
        <SettingsRow title={t("settings.agents.builtinBrowser")}>
          {browserState?.available ? (
            <StatusPill tone="ok">{t("settings.agents.chromeFound")}</StatusPill>
          ) : (
            <StatusPill tone="warn">{t("settings.agents.chromeNotFound")}</StatusPill>
          )}
        </SettingsRow>
        <SettingsRow title={t("settings.agents.skillsFound")}><span className="st-value">{skillsCatalog?.skills.length ?? 0}</span></SettingsRow>
        <SettingsRow title={t("settings.agents.rulesFiles")}><span className="st-value">{skillsCatalog?.rules.length ?? 0}</span></SettingsRow>
        <SettingsRow title={t("settings.agents.slashCommands")}><span className="st-value">{skillsCatalog?.commands.length ?? 0}</span></SettingsRow>
      </SettingsSection>

      {onChangeApprovalPolicy && onDeleteApprovalRule && onRefreshMcp ? (
        <SettingsSection title={t("settings.agents.approvalsAndMcp")} plain>
          <div className="st-embedded">
            <McpAndSecuritySettings
              approvalPolicy={approvalPolicy}
              approvalRules={approvalRules}
              onChangeApprovalPolicy={onChangeApprovalPolicy}
              onDeleteApprovalRule={onDeleteApprovalRule}
              onAddApprovalRule={onAddApprovalRule}
            />
          </div>
        </SettingsSection>
      ) : null}

      <OvernightSettings modelCatalog={modelCatalog} />

      {plugins.error ? <Banner tone="error">{plugins.error}</Banner> : null}

      {guardrailPlugins.map(plugin => {
        const guardrail = plugin.capabilities.guardrails![0]
        return (
          <PluginSettingsPanel
            key={plugin.id}
            plugin={plugin}
            title={guardrail.name}
            description={guardrail.description}
            fields={guardrail.settingsFields ?? []}
            busyId={plugins.busyId}
            onSave={plugins.updatePluginSettings}
          />
        )
      })}
    </>
  )
}
