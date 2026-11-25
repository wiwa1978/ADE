import { Button, SettingsRow, SettingsSection, StatusPill } from "@/components/ui"
import type { EnvironmentDirectory, McpServerStatus, RuntimeHealth } from "../../../app-types"
import { EnvironmentSettings } from "../../../EnvironmentSettings"
import { useI18n } from "../../i18n/I18nContext"

export function EnvironmentsSettingsSection({
  activeEnvironmentName,
  runtime,
  runtimeError,
  mcpServers,
  disabled,
  autoOpenAddEnvironment,
  onEnvironmentChanged,
  onWorktreeDiagnostics,
}: {
  activeEnvironmentName: string
  runtime: RuntimeHealth | null
  runtimeError: string
  mcpServers: McpServerStatus[]
  disabled: boolean
  autoOpenAddEnvironment: boolean
  onEnvironmentChanged: (activeId: string, activeName: string, directory: EnvironmentDirectory) => void
  onWorktreeDiagnostics: () => void
}) {
  const { t } = useI18n()

  return (
    <>
      <SettingsSection title={t("settings.environments.hosts")} plain>
        <div className="st-embedded">
          <EnvironmentSettings
            onEnvironmentChanged={onEnvironmentChanged}
            disabled={disabled}
            autoOpenAdd={autoOpenAddEnvironment}
          />
        </div>
      </SettingsSection>
      <SettingsSection title={t("settings.environments.diagnostics")}>
        <SettingsRow title={t("settings.environments.activeEnv")}><span className="st-value">{activeEnvironmentName}</span></SettingsRow>
        <SettingsRow title={t("settings.environments.runtime")}>
          {runtime?.online ? (
            <StatusPill tone="ok">{t("common.online")}</StatusPill>
          ) : (
            <StatusPill tone="error">{runtimeError || t("common.waiting")}</StatusPill>
          )}
        </SettingsRow>
        <SettingsRow title={t("settings.environments.mcpConnected")}>
          <span className="st-value">{mcpServers.filter(server => server.status === "connected").length}</span>
        </SettingsRow>
        <SettingsRow title={t("settings.environments.gitWorktrees")} description={t("settings.environments.gitWorktreesDesc")}>
          <Button variant="secondary" size="sm" onClick={onWorktreeDiagnostics}>{t("common.inspect")}</Button>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("settings.environments.about")}>
        <SettingsRow
          title="ADE"
          description={t("settings.environments.aboutDesc")}
        />
      </SettingsSection>
    </>
  )
}
