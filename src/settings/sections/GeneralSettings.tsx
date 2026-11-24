import { SettingsRow, SettingsSection, Switch } from "@/components/ui"
import type { Settings } from "../../../useSettings"
import { KeybindingsSection } from "../KeybindingsSection"

export function GeneralSettings({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}) {
  return (
    <>
      <SettingsSection title="New sessions">
        <SettingsRow
          title="Default workspace"
          description="Used when a project has a local checkout. Worktree sessions get their own branch, like ade/fix-login-1a2b3c4d."
        >
          <select
            className="st-select"
            value={settings.defaultWorkspaceKind}
            onChange={event => update({ defaultWorkspaceKind: event.target.value as Settings["defaultWorkspaceKind"] })}
          >
            <option value="worktree">Worktree</option>
            <option value="checkout">Project folder</option>
            <option value="none">Chat only</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Archiving">
        <SettingsRow
          title="Remove the worktree when archiving"
          description="Frees disk space. The branch and conversation are kept; restoring recreates the worktree. Worktrees with uncommitted changes are never removed."
        >
          <Switch
            label="Remove the worktree when archiving"
            checked={settings.archiveRemovesWorktree}
            onCheckedChange={value => update({ archiveRemovesWorktree: value })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Startup">
        <SettingsRow
          title="Reopen the last view"
          description="After a reload or restart, return to the project or session you had open."
        >
          <Switch
            label="Reopen the last view"
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
