import { useState } from "react"
import { Banner, Button, SettingsRow, SettingsSection, StatusPill, Switch } from "@/components/ui"
import type { Settings } from "../../useSettings"
import { useI18n } from "../../i18n/I18nContext"
import { usePlugins } from "../../marketplace/usePlugins"
import { PluginSettingsPanel } from "../../marketplace/PluginSettingsPanel"

function notificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission
}

export function NotificationsSettings({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}) {
  const { t } = useI18n()
  const [permission, setPermission] = useState(notificationPermission)
  const plugins = usePlugins()

  const requestPermission = async () => {
    if (typeof Notification === "undefined") return
    setPermission(await Notification.requestPermission())
  }

  const notificationPlugins = (plugins.snapshot?.installed ?? []).filter(
    plugin => plugin.enabled && (plugin.capabilities.notificationChannels?.length ?? 0) > 0,
  )

  return (
    <>
      <SettingsSection title={t("settings.notifications.title")} description={t("settings.notifications.desc")}>
        <SettingsRow
          title={t("settings.notifications.permission")}
          description={
            permission === "denied"
              ? t("settings.notifications.blockedDesc")
              : permission === "unsupported"
                ? t("settings.notifications.unsupportedDesc")
                : undefined
          }
        >
          {permission === "granted" ? (
            <>
              <StatusPill tone="ok">{t("common.allowed")}</StatusPill>
              <Button variant="outline" size="sm" onClick={() => new Notification("ADE", { body: t("settings.notifications.testBody") })}>
                {t("settings.notifications.sendTest")}
              </Button>
            </>
          ) : permission === "default" ? (
            <Button variant="secondary" size="sm" onClick={() => void requestPermission()}>{t("common.allow")}</Button>
          ) : (
            <StatusPill tone="neutral">{permission === "denied" ? t("common.blocked") : t("common.unavailable")}</StatusPill>
          )}
        </SettingsRow>
        <SettingsRow title={t("settings.notifications.onFinish")}>
          <Switch
            label={t("settings.notifications.onFinishAria")}
            checked={settings.notifyOnFinish}
            disabled={permission !== "granted"}
            onCheckedChange={value => update({ notifyOnFinish: value })}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.notifications.onApproval")}>
          <Switch
            label={t("settings.notifications.onApprovalAria")}
            checked={settings.notifyOnApproval}
            disabled={permission !== "granted"}
            onCheckedChange={value => update({ notifyOnApproval: value })}
          />
        </SettingsRow>
      </SettingsSection>

      {plugins.error ? <Banner tone="error">{plugins.error}</Banner> : null}

      {notificationPlugins.map(plugin => {
        const channel = plugin.capabilities.notificationChannels![0]
        return (
          <PluginSettingsPanel
            key={plugin.id}
            plugin={plugin}
            title={channel.name}
            description={channel.description}
            fields={channel.settingsFields ?? []}
            busyId={plugins.busyId}
            onSave={plugins.updatePluginSettings}
            onTestNotification={plugins.testNotification}
          />
        )
      })}
    </>
  )
}
