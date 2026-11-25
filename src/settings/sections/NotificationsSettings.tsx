import { useState } from "react"
import { Button, SettingsRow, SettingsSection, StatusPill, Switch } from "@/components/ui"
import type { Settings } from "../../useSettings"
import { useI18n } from "../../i18n/I18nContext"

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

  const requestPermission = async () => {
    if (typeof Notification === "undefined") return
    setPermission(await Notification.requestPermission())
  }

  return (
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
  )
}
