import { SettingsRow, SettingsSection, Switch } from "@/components/ui"
import type { Settings } from "../../../useSettings"
import { useI18n } from "../../i18n/I18nContext"
import { KeybindingsSection } from "../KeybindingsSection"

export function GeneralSettings({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}) {
  const { t } = useI18n()

  return (
    <>
      <SettingsSection title={t("settings.general.newSessions")}>
        <SettingsRow
          title={t("settings.general.defaultWorkspace")}
          description={t("settings.general.defaultWorkspaceDesc")}
        >
          <select
            className="st-select"
            value={settings.defaultWorkspaceKind}
            onChange={event => update({ defaultWorkspaceKind: event.target.value as Settings["defaultWorkspaceKind"] })}
          >
            <option value="worktree">{t("settings.general.workspaceWorktree")}</option>
            <option value="checkout">{t("settings.general.workspaceCheckout")}</option>
            <option value="none">{t("settings.general.workspaceNone")}</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("settings.general.archiving")}>
        <SettingsRow
          title={t("settings.general.archiveRemovesWorktree")}
          description={t("settings.general.archiveRemovesWorktreeDesc")}
        >
          <Switch
            label={t("settings.general.archiveRemovesWorktree")}
            checked={settings.archiveRemovesWorktree}
            onCheckedChange={value => update({ archiveRemovesWorktree: value })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("settings.general.startup")}>
        <SettingsRow
          title={t("settings.general.restoreLastView")}
          description={t("settings.general.restoreLastViewDesc")}
        >
          <Switch
            label={t("settings.general.restoreLastView")}
            checked={settings.restoreLastView}
            onCheckedChange={value => update({ restoreLastView: value })}
          />
        </SettingsRow>
      </SettingsSection>

      <KeybindingsSection
        overrides={settings.keybindings}
        customBindings={settings.customKeybindings}
        onChangeOverrides={next => update({ keybindings: next })}
        onChangeCustomBindings={next => update({ customKeybindings: next })}
      />
    </>
  )
}
