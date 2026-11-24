import { Button, SettingsRow, SettingsSection, StatusPill } from "@/components/ui"
import type { EnvironmentDirectory, McpServerStatus, RuntimeHealth } from "../../../app-types"
import { EnvironmentSettings } from "../../../EnvironmentSettings"

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
  return (
    <>
      <SettingsSection title="Hosts" plain>
        <div className="st-embedded">
          <EnvironmentSettings
            onEnvironmentChanged={onEnvironmentChanged}
            disabled={disabled}
            autoOpenAdd={autoOpenAddEnvironment}
          />
        </div>
      </SettingsSection>
      <SettingsSection title="Diagnostics">
        <SettingsRow title="Active environment"><span className="st-value">{activeEnvironmentName}</span></SettingsRow>
        <SettingsRow title="Runtime">
          {runtime?.online ? (
            <StatusPill tone="ok">Online</StatusPill>
          ) : (
            <StatusPill tone="error">{runtimeError || "Waiting"}</StatusPill>
          )}
        </SettingsRow>
        <SettingsRow title="MCP servers connected">
          <span className="st-value">{mcpServers.filter(server => server.status === "connected").length}</span>
        </SettingsRow>
        <SettingsRow title="Git worktrees" description="Inspect worktrees registered for a repository.">
          <Button variant="secondary" size="sm" onClick={onWorktreeDiagnostics}>Inspect</Button>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="About">
        <SettingsRow
          title="ADE"
          description="Projects, isolated agent sessions on their own branches, review, and pull requests in one app."
        />
      </SettingsSection>
    </>
  )
}
