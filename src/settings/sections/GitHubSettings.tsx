import { Banner, Button, SettingsRow, SettingsSection, StatusPill, Switch } from "@/components/ui"
import type { useConnections } from "../../useConnections"
import type { Settings } from "../../useSettings"
import { useI18n } from "../../i18n/I18nContext"

export function GitHubSettings({
  settings,
  connections,
  update,
}: {
  settings: Settings
  connections: ReturnType<typeof useConnections>
  update: (patch: Partial<Settings>) => void
}) {
  const { t } = useI18n()
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
        title={t("settings.github.account")}
        description={t("settings.github.accountDesc")}
      >
        <SettingsRow
          title={githubConnection?.login ? t("settings.github.connectedAs", { login: githubConnection.login }) : t("settings.github.cli")}
          description={
            githubStatusError ||
            (!githubConnection?.login
              ? (githubCliError || t("settings.github.signInHint"))
              : t("settings.github.disconnectHint"))
          }
        >
          {githubConnection?.login ? <StatusPill tone="ok">{t("common.connected")}</StatusPill> : <StatusPill tone="neutral">{t("common.notConnected")}</StatusPill>}
          <Button
            variant="secondary"
            size="sm"
            loading={githubConnectionBusy}
            disabled={!githubConnection || Boolean(githubStatusError)}
            onClick={() => void changeGitHubConnection("connect")}
          >
            {githubConnectionBusy ? t("common.working") : githubConnection?.login ? t("common.check") : t("common.connect")}
          </Button>
          {githubConnection?.login ? (
            <Button variant="outline" size="sm" disabled={githubConnectionBusy} onClick={() => void changeGitHubConnection("disconnect")}>
              {t("common.disconnect")}
            </Button>
          ) : null}
        </SettingsRow>
        {githubActionError ? (
          <div className="px-4 py-3">
            <Banner tone="error">{githubActionError}</Banner>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t("settings.github.pullRequests")}>
        <SettingsRow title={t("settings.github.openAsDraft")} description={t("settings.github.openAsDraftDesc")}>
          <Switch
            label={t("settings.github.openAsDraftAria")}
            checked={settings.prDraft}
            onCheckedChange={value => update({ prDraft: value })}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
