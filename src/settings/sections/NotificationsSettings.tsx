import { useState } from "react"
import { Button, SettingsRow, SettingsSection, StatusPill, Switch } from "@/components/ui"
import type { Settings } from "../../../useSettings"

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
  const [permission, setPermission] = useState(notificationPermission)

  const requestPermission = async () => {
    if (typeof Notification === "undefined") return
    setPermission(await Notification.requestPermission())
  }

  return (
    <SettingsSection title="Desktop notifications" description="Shown only when ADE isn’t the window you’re using.">
      <SettingsRow
        title="Permission"
        description={
          permission === "denied"
            ? "Blocked. Allow notifications for ADE in your system settings."
            : permission === "unsupported"
              ? "This window can’t show notifications."
              : undefined
        }
      >
        {permission === "granted" ? (
          <>
            <StatusPill tone="ok">Allowed</StatusPill>
            <Button variant="outline" size="sm" onClick={() => new Notification("ADE", { body: "Notifications are working." })}>
              Send test
            </Button>
          </>
        ) : permission === "default" ? (
          <Button variant="secondary" size="sm" onClick={() => void requestPermission()}>Allow</Button>
        ) : (
          <StatusPill tone="neutral">{permission === "denied" ? "Blocked" : "Unavailable"}</StatusPill>
        )}
      </SettingsRow>
      <SettingsRow title="When an agent finishes">
        <Switch
          label="Notify when an agent finishes"
          checked={settings.notifyOnFinish}
          disabled={permission !== "granted"}
          onCheckedChange={value => update({ notifyOnFinish: value })}
        />
      </SettingsRow>
      <SettingsRow title="When an agent needs approval">
        <Switch
          label="Notify when an agent needs approval"
          checked={settings.notifyOnApproval}
          disabled={permission !== "granted"}
          onCheckedChange={value => update({ notifyOnApproval: value })}
        />
      </SettingsRow>
    </SettingsSection>
  )
}
