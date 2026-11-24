import { Banner, Button, SettingsRow, SettingsSection, StatusPill, Switch } from "@/components/ui"
import type { useConnections } from "../../../useConnections"
import type { Settings } from "../../../useSettings"

export function GitHubSettings({
  settings,
  connections,
  update,
}: {
  settings: Settings
  connections: ReturnType<typeof useConnections>
  update: (patch: Partial<Settings>) => void
}) {
  const {
    githubConnection,
    githubStatusError,
    githubCliError,
    githubActionError,
    githubConnectionBusy,
    changeGitHubConnection,
  } = connections

  return (
    <>
      <SettingsSection
        title="GitHub account"
        description="Issues, pushes, and pull requests go through the GitHub CLI (gh) on this host, with that account’s permissions. ADE never stores a token."
      >
        <SettingsRow
          title={githubConnection?.login ? `Connected as ${githubConnection.login}` : "GitHub CLI"}
          description={
            githubStatusError ||
            (!githubConnection?.login
              ? (githubCliError || "Sign in first with gh auth login --hostname github.com --web")
              : "Disconnecting here doesn’t sign out of the GitHub CLI.")
          }
        >
          {githubConnection?.login ? <StatusPill tone="ok">Connected</StatusPill> : <StatusPill tone="neutral">Not connected</StatusPill>}
          <Button
            variant="secondary"
            size="sm"
            loading={githubConnectionBusy}
            disabled={!githubConnection || Boolean(githubStatusError)}
            onClick={() => void changeGitHubConnection("connect")}
          >
            {githubConnectionBusy ? "Working…" : githubConnection?.login ? "Check" : "Connect"}
          </Button>
          {githubConnection?.login ? (
            <Button variant="outline" size="sm" disabled={githubConnectionBusy} onClick={() => void changeGitHubConnection("disconnect")}>
              Disconnect
            </Button>
          ) : null}
        </SettingsRow>
        {githubActionError ? (
          <div className="px-4 py-3">
            <Banner tone="error">{githubActionError}</Banner>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Pull requests">
        <SettingsRow title="Open as draft" description="You can still choose for each pull request.">
          <Switch
            label="Open pull requests as drafts"
            checked={settings.prDraft}
            onCheckedChange={value => update({ prDraft: value })}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
