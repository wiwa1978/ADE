import { useState } from "react"
import type { PluginSettingField } from "@ade/protocol"
import { Badge, Banner, Button, SettingsRow, SettingsSection, Switch } from "@/components/ui"
import type { PluginSettingValues, PluginView } from "./usePlugins"

export function PluginSettingsPanel({
  plugin,
  title,
  description,
  fields,
  detectLabel,
  installHint,
  busyId,
  onSave,
  onTestNotification,
}: {
  plugin: PluginView
  title: string
  description?: string
  fields: PluginSettingField[]
  detectLabel?: string
  installHint?: string
  busyId: string | null
  onSave: (pluginId: string, values: PluginSettingValues) => Promise<boolean>
  onTestNotification?: (pluginId: string) => Promise<{ ok: boolean; sent: string[]; error?: string }>
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [testNote, setTestNote] = useState<string>("")
  const saving = busyId === `settings:${plugin.id}`
  const testing = busyId === `test:${plugin.id}`
  const configuredSecrets = new Set(plugin.configuredSecrets ?? [])

  return (
    <SettingsSection title={title} description={description || plugin.description}>
      {detectLabel ? (
        <SettingsRow
          title="Installation status"
          description={
            plugin.detected
              ? `Detected (${detectLabel}). New ADE sessions will use this plugin.`
              : `Not found (${detectLabel}). Install it first, then open a new terminal.`
          }
        >
          <Badge tone={plugin.detected ? "ok" : "warn"}>
            {plugin.detected ? "Detected" : "Not installed"}
          </Badge>
        </SettingsRow>
      ) : null}

      {detectLabel && !plugin.detected && installHint ? (
        <SettingsRow title="Install command" description="Run this in your terminal to install it locally.">
          <code style={{ fontSize: "0.78rem", userSelect: "all", wordBreak: "break-all" }}>{installHint}</code>
        </SettingsRow>
      ) : null}

      {fields.map(field => {
        const draftKey = `${plugin.id}:${field.key}`
        const currentValue = plugin.settings[field.key] ?? field.defaultValue ?? ""
        if (field.kind === "select") {
          return (
            <SettingsRow key={field.key} title={field.label} description={field.description}>
              <select
                className="st-select"
                aria-label={`${title} ${field.label}`}
                disabled={saving}
                value={String(currentValue)}
                onChange={event => void onSave(plugin.id, { [field.key]: event.target.value })}
              >
                {(field.options ?? []).map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </SettingsRow>
          )
        }
        if (field.kind === "boolean") {
          return (
            <SettingsRow key={field.key} title={field.label} description={field.description}>
              <Switch
                label={field.label}
                checked={Boolean(currentValue)}
                onCheckedChange={checked => void onSave(plugin.id, { [field.key]: checked })}
              />
            </SettingsRow>
          )
        }
        if (field.kind === "secret") {
          const isSaved = configuredSecrets.has(field.key)
          const value = drafts[draftKey] ?? ""
          return (
            <SettingsRow
              key={field.key}
              title={field.label}
              description={field.description}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                {isSaved ? <Badge tone="ok">Saved</Badge> : null}
                <input
                  type="password"
                  aria-label={`${title} ${field.label}`}
                  placeholder={isSaved ? "Replace saved value…" : field.placeholder}
                  value={value}
                  autoComplete="off"
                  disabled={saving}
                  onChange={event => setDrafts(prev => ({ ...prev, [draftKey]: event.target.value }))}
                  style={{ minWidth: 180 }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!value.trim() || saving}
                  onClick={() => {
                    void onSave(plugin.id, { [field.key]: value.trim() }).then(ok => {
                      if (ok) setDrafts(prev => ({ ...prev, [draftKey]: "" }))
                    })
                  }}
                >
                  Save
                </Button>
                {isSaved ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => void onSave(plugin.id, { [field.key]: "" })}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </SettingsRow>
          )
        }
        const value = draftKey in drafts ? drafts[draftKey] : String(currentValue)
        return (
          <SettingsRow key={field.key} title={field.label} description={field.description}>
            <input
              type="text"
              aria-label={`${title} ${field.label}`}
              placeholder={field.placeholder}
              value={value}
              disabled={saving}
              onChange={event => setDrafts(prev => ({ ...prev, [draftKey]: event.target.value }))}
              onBlur={() => {
                if (value !== String(currentValue)) void onSave(plugin.id, { [field.key]: value })
              }}
              style={{ minWidth: 190 }}
            />
          </SettingsRow>
        )
      })}

      {onTestNotification ? (
        <SettingsRow title="Test delivery" description="Send a test alert to your configured channels.">
          <Button
            variant="outline"
            size="sm"
            loading={testing}
            onClick={() => {
              setTestNote("")
              void onTestNotification(plugin.id).then(res => {
                if (res.ok) setTestNote(`Sent test alert to: ${res.sent.join(", ")}.`)
              })
            }}
          >
            Send test
          </Button>
        </SettingsRow>
      ) : null}
      {testNote ? <Banner tone="info">{testNote}</Banner> : null}
    </SettingsSection>
  )
}
