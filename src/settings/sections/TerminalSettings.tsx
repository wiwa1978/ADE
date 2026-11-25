import { SettingsRow, SettingsSection, Switch } from "@/components/ui"
import type { Settings } from "../../useSettings"
import { useI18n } from "../../i18n/I18nContext"

export function TerminalSettings({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}) {
  const { t, formatNumber } = useI18n()

  return (
    <SettingsSection
      title={t("settings.terminal.title")}
      description={t("settings.terminal.desc")}
    >
      <SettingsRow
        title={t("settings.terminal.autoStart")}
        description={t("settings.terminal.autoStartDesc")}
      >
        <Switch
          label={t("settings.terminal.autoStart")}
          checked={settings.terminalAutoStart}
          onCheckedChange={value => update({ terminalAutoStart: value })}
        />
      </SettingsRow>
      <SettingsRow title={t("settings.terminal.fontSize")}>
        <select
          className="st-select"
          aria-label={t("settings.terminal.fontSizeAria")}
          value={settings.terminalFontSize}
          onChange={event => update({ terminalFontSize: Number(event.target.value) })}
        >
          {[11, 12, 13, 14, 15, 16, 18, 20].map(size => (
            <option key={size} value={size}>{size}px</option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow title={t("settings.terminal.scrollback")}>
        <select
          className="st-select"
          aria-label={t("settings.terminal.scrollbackAria")}
          value={settings.terminalScrollback}
          onChange={event => update({ terminalScrollback: Number(event.target.value) })}
        >
          {[1000, 5000, 10000, 20000].map(lines => (
            <option key={lines} value={lines}>{t("common.linesCount", { count: formatNumber(lines) })}</option>
          ))}
        </select>
      </SettingsRow>
    </SettingsSection>
  )
}
