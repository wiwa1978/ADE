import { useMemo, useState } from "react"
import { Check, Pipette } from "lucide-react"
import { Button, SegmentedControl, SettingsRow, SettingsSection, type SegmentedOption } from "@/components/ui"
import {
  accentDisplayName,
  accentPresets,
  colorPalettes,
  contrastForegroundHex,
  lookPresets,
  normalizeHexColor,
  paletteVariables,
  resolveAccentHex,
  type Theme,
} from "../../../appearance-palettes"
import type { Settings } from "../../../useSettings"
import { CODE_FONT_OPTIONS, INTERFACE_FONT_OPTIONS } from "../../appearance/fonts"
import { FontPicker } from "../../appearance/FontPicker"
import { useI18n } from "../../i18n/I18nContext"

type TextDraft = {
  interfaceFont: string
  codeFont: string
  interfaceSize: string
  contentSize: string
  codeSize: string
  contentWidth: string
}

const TEXT_LIMITS: Record<keyof Omit<TextDraft, "interfaceFont" | "codeFont">, [number, number]> = {
  interfaceSize: [11, 20],
  contentSize: [12, 22],
  codeSize: [10, 18],
  contentWidth: [640, 1200],
}

function textFromSettings(settings: Settings): TextDraft {
  return {
    interfaceFont: settings.interfaceFont,
    codeFont: settings.codeFont,
    interfaceSize: String(settings.interfaceSize),
    contentSize: String(settings.contentSize),
    codeSize: String(settings.codeSize),
    contentWidth: String(settings.contentWidth),
  }
}

export function AppearanceSettings({
  settings,
  resolved,
  update,
}: {
  settings: Settings
  resolved: Exclude<Theme, "system">
  update: (patch: Partial<Settings>) => void
}) {
  const { t } = useI18n()
  const [draftEdits, setDraftEdits] = useState<Partial<TextDraft>>({})
  const appliedText = textFromSettings(settings)
  const textDraft: TextDraft = { ...appliedText, ...draftEdits }
  const textDirty = (Object.keys(appliedText) as Array<keyof TextDraft>).some(
    key => textDraft[key].trim() !== appliedText[key].trim(),
  )

  const themeOptions = useMemo<readonly SegmentedOption<Theme>[]>(() => [
    { value: "light", label: t("settings.appearance.mode.light") },
    { value: "system", label: t("settings.appearance.mode.system") },
    { value: "dark", label: t("settings.appearance.mode.dark") },
  ], [t])

  const textInvalid = (key: keyof typeof TEXT_LIMITS) => {
    const value = Number(textDraft[key])
    return !textDraft[key].trim() || !Number.isFinite(value) || value < TEXT_LIMITS[key][0] || value > TEXT_LIMITS[key][1]
  }
  const textErrors = (Object.keys(TEXT_LIMITS) as Array<keyof typeof TEXT_LIMITS>).filter(textInvalid)

  const applyText = () => {
    if (textErrors.length) return
    update({
      interfaceFont: textDraft.interfaceFont.trim(),
      codeFont: textDraft.codeFont.trim(),
      interfaceSize: Math.round(Number(textDraft.interfaceSize)),
      contentSize: Math.round(Number(textDraft.contentSize)),
      codeSize: Math.round(Number(textDraft.codeSize)),
      contentWidth: Math.round(Number(textDraft.contentWidth)),
    })
    setDraftEdits({})
  }

  const sizeSelect = (label: string, key: "interfaceSize" | "contentSize" | "codeSize") => {
    const [min, max] = TEXT_LIMITS[key]
    const sizes = Array.from({ length: max - min + 1 }, (_, index) => String(min + index))
    return (
      <select
        className="st-select is-narrow"
        aria-label={label}
        value={sizes.includes(textDraft[key]) ? textDraft[key] : ""}
        onChange={event => setDraftEdits(current => ({ ...current, [key]: event.target.value }))}
      >
        {sizes.includes(textDraft[key]) ? null : <option value="" disabled>{t("common.choose")}</option>}
        {sizes.map(size => (
          <option key={size} value={size}>
            {key === "interfaceSize" && size === "14"
              ? t("settings.appearance.sizeDefault", { size })
              : t("settings.appearance.sizePx", { size })}
          </option>
        ))}
      </select>
    )
  }

  const activeAccentHex = resolveAccentHex(settings.accentColor, resolved)
  const isCustomAccent = Boolean(settings.accentColor) && !accentPresets.some(preset => preset.id === settings.accentColor)
  const resolvedModeLabel = resolved === "dark"
    ? t("settings.appearance.mode.dark").toLowerCase()
    : t("settings.appearance.mode.light").toLowerCase()

  const activePreset = lookPresets.find(
    preset =>
      preset.palette === settings.palette &&
      preset.interfaceFont === settings.interfaceFont &&
      preset.codeFont === settings.codeFont &&
      preset.interfaceSize === settings.interfaceSize &&
      preset.contentSize === settings.contentSize &&
      preset.codeSize === settings.codeSize &&
      preset.contentWidth === settings.contentWidth,
  )

  return (
    <>
      <SettingsSection title={t("settings.appearance.theme")}>
        <SettingsRow
          title={t("settings.appearance.mode")}
          description={settings.theme === "system" ? t("settings.appearance.followingSystem", { resolved: resolvedModeLabel }) : undefined}
        >
          <SegmentedControl
            aria-label={t("settings.appearance.mode")}
            options={themeOptions}
            value={settings.theme}
            onValueChange={theme => update({ theme })}
          />
        </SettingsRow>
        <SettingsRow
          title={t("settings.appearance.accentColor")}
          description={t("settings.appearance.accentColorDesc")}
          stacked
        >
          <div className="st-accent-picker" role="group" aria-label={t("settings.appearance.accentColor")}>
            <button
              type="button"
              className={`st-accent-none ${!settings.accentColor ? "is-active" : ""}`}
              aria-pressed={!settings.accentColor}
              title={t("settings.appearance.accentDefaultTitle")}
              onClick={() => update({ accentColor: "" })}
            >
              <span className="st-accent-none-dot" aria-hidden="true" />
              <span>{t("common.default")}</span>
            </button>
            <div className="st-accent-swatches">
              {accentPresets.map(preset => {
                const hex = preset[resolved]
                const active = settings.accentColor === preset.id
                return (
                  <button
                    type="button"
                    key={preset.id}
                    className={`st-accent-swatch ${active ? "is-active" : ""}`}
                    style={{ backgroundColor: hex, color: contrastForegroundHex(hex) }}
                    aria-label={preset.name}
                    aria-pressed={active}
                    title={preset.name}
                    onClick={() => update({ accentColor: preset.id })}
                  >
                    {active ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
                  </button>
                )
              })}
              <label
                className={`st-accent-swatch st-accent-custom ${isCustomAccent ? "is-active" : ""}`}
                style={isCustomAccent && activeAccentHex ? { backgroundColor: activeAccentHex, color: contrastForegroundHex(activeAccentHex) } : undefined}
                title={isCustomAccent ? t("settings.appearance.customWithHex", { hex: settings.accentColor.toUpperCase() }) : t("settings.appearance.customColor")}
              >
                <input
                  type="color"
                  className="st-accent-color-input"
                  aria-label={t("settings.appearance.customAccentAria")}
                  value={activeAccentHex ?? "#3b82f6"}
                  onChange={event => {
                    const hex = normalizeHexColor(event.target.value)
                    if (hex) update({ accentColor: hex })
                  }}
                />
                {isCustomAccent ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : <Pipette size={13} aria-hidden="true" />}
              </label>
            </div>
            <span className="st-accent-current">
              <strong>{settings.accentColor ? accentDisplayName(settings.accentColor) : t("common.default")}</strong>
              {activeAccentHex ? <code>{activeAccentHex.toUpperCase()}</code> : null}
            </span>
          </div>
        </SettingsRow>
        <SettingsRow title={t("settings.appearance.look")} description={t("settings.appearance.lookDesc")} stacked>
          <div className="st-looks">
            {lookPresets.map(preset => (
              <button
                type="button"
                key={preset.id}
                className={`st-look ${activePreset?.id === preset.id ? "is-active" : ""}`}
                aria-pressed={activePreset?.id === preset.id}
                title={preset.description}
                onClick={() => {
                  setDraftEdits({})
                  update({
                    palette: preset.palette,
                    interfaceFont: preset.interfaceFont,
                    codeFont: preset.codeFont,
                    interfaceSize: preset.interfaceSize,
                    contentSize: preset.contentSize,
                    codeSize: preset.codeSize,
                    contentWidth: preset.contentWidth,
                  })
                }}
              >
                <span className="st-look-swatch" style={paletteVariables(preset.palette, resolved)} aria-hidden="true"><i /><i /><i /></span>
                <span className="st-look-text"><strong>{preset.name}</strong><small>{preset.description}</small></span>
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow title={t("settings.appearance.colorPalette")} description={t("settings.appearance.colorPaletteDesc")} stacked>
          <div className="st-palettes">
            {colorPalettes.map(palette => {
              const variables = paletteVariables(palette.id, resolved)
              const active = settings.palette === palette.id
              return (
                <button
                  type="button"
                  key={palette.id}
                  className={`st-palette-tile ${active ? "is-active" : ""}`}
                  onClick={() => update({ palette: palette.id })}
                  aria-pressed={active}
                  title={palette.description}
                >
                  <span className="st-tile-preview" style={variables} aria-hidden="true">
                    <span className="st-tile-sidebar"><i className="is-dot" /><i /><i className="is-short" /></span>
                    <span className="st-tile-canvas">
                      <span className="st-tile-line is-strong" />
                      <span className="st-tile-line is-muted" />
                      <span className="st-tile-card"><span className="st-tile-line is-short" /><span className="st-tile-accent" /></span>
                    </span>
                  </span>
                  <span className="st-tile-meta">
                    <span className="st-tile-head"><strong>{palette.name}</strong>{active ? <Check size={13} className="st-tile-check" /> : null}</span>
                    <small>{palette.description}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("settings.appearance.text")}>
        <SettingsRow title={t("settings.appearance.interfaceFont")} description={t("settings.appearance.interfaceFontDesc")}>
          <FontPicker
            label={t("settings.appearance.interfaceFont")}
            value={textDraft.interfaceFont}
            options={INTERFACE_FONT_OPTIONS}
            previewGroup="interface"
            sampleText="Aa"
            customPlaceholder={t("stx.sec.appearance.interfaceFontPlaceholder")}
            onChange={next => setDraftEdits(current => ({ ...current, interfaceFont: next }))}
            onCommit={applyText}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.appearance.interfaceSize")} description={t("settings.appearance.interfaceSizeDesc")}>
          {sizeSelect(t("settings.appearance.interfaceSize"), "interfaceSize")}
        </SettingsRow>
        <SettingsRow title={t("settings.appearance.chatTextSize")} description={t("settings.appearance.chatTextSizeDesc")}>
          {sizeSelect(t("settings.appearance.chatTextSize"), "contentSize")}
        </SettingsRow>
        <SettingsRow title={t("settings.appearance.codeFont")} description={t("settings.appearance.codeFontDesc")}>
          <FontPicker
            label={t("settings.appearance.codeFont")}
            value={textDraft.codeFont}
            options={CODE_FONT_OPTIONS}
            previewGroup="code"
            sampleText="0O1l"
            customPlaceholder={t("stx.sec.appearance.codeFontPlaceholder")}
            onChange={next => setDraftEdits(current => ({ ...current, codeFont: next }))}
            onCommit={applyText}
          />
        </SettingsRow>
        <SettingsRow title={t("settings.appearance.codeSize")}>{sizeSelect(t("settings.appearance.codeSize"), "codeSize")}</SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("settings.appearance.layout")}>
        <SettingsRow title={t("settings.appearance.conversationWidth")} description={t("settings.appearance.conversationWidthDesc")}>
          <span className={`st-number ${textInvalid("contentWidth") ? "is-invalid" : ""}`} title={`${TEXT_LIMITS.contentWidth[0]}–${TEXT_LIMITS.contentWidth[1]} px`}>
            <input
              aria-label={t("settings.appearance.conversationWidth")}
              inputMode="numeric"
              value={textDraft.contentWidth}
              aria-invalid={textInvalid("contentWidth")}
              onChange={event => setDraftEdits(current => ({ ...current, contentWidth: event.target.value.replace(/[^0-9]/g, "") }))}
              onKeyDown={event => { if (event.key === "Enter") applyText() }}
            />
            <small>px</small>
          </span>
        </SettingsRow>
        <SettingsRow title={t("settings.appearance.syntaxColors")}>
          <select
            className="st-select"
            aria-label={t("settings.appearance.syntaxColors")}
            value={settings.highlightTheme}
            onChange={event => update({ highlightTheme: event.target.value as "auto" | "github" | "monochrome" })}
          >
            <option value="auto">{t("settings.appearance.syntaxAuto")}</option>
            <option value="github">{t("settings.appearance.syntaxGithub")}</option>
            <option value="monochrome">{t("settings.appearance.syntaxMonochrome")}</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      {textDirty ? (
        <div className="st-apply-bar" role="status">
          <span>
            {textErrors.length
              ? t("settings.appearance.invalidValues", {
                  countLabel: textErrors.length === 1 ? t("settings.appearance.valueSingular") : t("settings.appearance.valuePlural"),
                  iface: TEXT_LIMITS.interfaceSize.join("–"),
                  chat: TEXT_LIMITS.contentSize.join("–"),
                  code: TEXT_LIMITS.codeSize.join("–"),
                  width: TEXT_LIMITS.contentWidth.join("–"),
                })
              : t("settings.appearance.unappliedText")}
          </span>
          <Button variant="outline" size="sm" onClick={() => setDraftEdits({})}>{t("common.revert")}</Button>
          <Button variant="primary" size="sm" disabled={textErrors.length > 0} onClick={applyText}>{t("common.apply")}</Button>
        </div>
      ) : null}
    </>
  )
}
