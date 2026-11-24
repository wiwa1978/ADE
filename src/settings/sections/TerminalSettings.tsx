import { SettingsRow, SettingsSection, Switch } from "@/components/ui"
import type { Settings } from "../../../useSettings"

export function TerminalSettings({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}) {
  return (
    <SettingsSection
      title="Terminal"
      description="Commands run as this host’s user. Agents run their own commands separately, subject to approvals."
    >
      <SettingsRow
        title="Start a shell automatically"
        description="Opening the Terminal panel starts a shell in the session’s workspace."
      >
        <Switch
          label="Start a shell automatically"
          checked={settings.terminalAutoStart}
          onCheckedChange={value => update({ terminalAutoStart: value })}
        />
      </SettingsRow>
      <SettingsRow title="Font size">
        <select
          className="st-select"
          aria-label="Terminal font size"
          value={settings.terminalFontSize}
          onChange={event => update({ terminalFontSize: Number(event.target.value) })}
        >
          {[11, 12, 13, 14, 15, 16, 18, 20].map(size => (
            <option key={size} value={size}>{size}px</option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow title="Scrollback">
        <select
          className="st-select"
          aria-label="Terminal scrollback"
          value={settings.terminalScrollback}
          onChange={event => update({ terminalScrollback: Number(event.target.value) })}
        >
          {[1000, 5000, 10000, 20000].map(lines => (
            <option key={lines} value={lines}>{lines.toLocaleString()} lines</option>
          ))}
        </select>
      </SettingsRow>
    </SettingsSection>
  )
}
