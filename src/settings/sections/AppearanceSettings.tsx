import { useState } from "react"
import { Check } from "lucide-react"
import { Button, SegmentedControl, SettingsRow, SettingsSection, type SegmentedOption } from "@/components/ui"
import { colorPalettes, lookPresets, paletteVariables, type Theme } from "../../../appearance-palettes"
import type { Settings } from "../../../useSettings"
import { CODE_FONT_OPTIONS, INTERFACE_FONT_OPTIONS } from "../../appearance/fonts"
import { FontPicker } from "../../appearance/FontPicker"

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

const THEME_OPTIONS: readonly SegmentedOption<Theme>[] = [
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
]

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
  const [draftEdits, setDraftEdits] = useState<Partial<TextDraft>>({})
  const appliedText = textFromSettings(settings)
  const textDraft: TextDraft = { ...appliedText, ...draftEdits }
  const textDirty = (Object.keys(appliedText) as Array<keyof TextDraft>).some(
    key => textDraft[key].trim() !== appliedText[key].trim(),
  )

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
        {sizes.includes(textDraft[key]) ? null : <option value="" disabled>Choose</option>}
        {sizes.map(size => (
          <option key={size} value={size}>{size} px{key === "interfaceSize" && size === "14" ? " (default)" : ""}</option>
        ))}
      </select>
    )
  }

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
      <SettingsSection title="Theme">
        <SettingsRow title="Mode" description={settings.theme === "system" ? `Following your system (${resolved}).` : undefined}>
          <SegmentedControl
            aria-label="Mode"
            options={THEME_OPTIONS}
            value={settings.theme}
            onValueChange={theme => update({ theme })}
          />
        </SettingsRow>
        <SettingsRow title="Look" description="A palette, fonts, sizes and width in one click, in the style of familiar tools. Fine-tune below." stacked>
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
        <SettingsRow title="Color palette" description="Nine quiet themes tuned for both light and dark mode." stacked>
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

      <SettingsSection title="Text">
        <SettingsRow title="Interface font" description="Google Fonts load automatically when online; offline falls back to the system font.">
          <FontPicker
            label="Interface font"
            value={textDraft.interfaceFont}
            options={INTERFACE_FONT_OPTIONS}
            previewGroup="interface"
            sampleText="Aa"
            customPlaceholder="e.g. Avenir Next"
            onChange={next => setDraftEdits(current => ({ ...current, interfaceFont: next }))}
            onCommit={applyText}
          />
        </SettingsRow>
        <SettingsRow title="Interface size" description="Scales the whole app, like zooming.">{sizeSelect("Interface size", "interfaceSize")}</SettingsRow>
        <SettingsRow title="Chat text size" description="Messages in the conversation.">{sizeSelect("Chat text size", "contentSize")}</SettingsRow>
        <SettingsRow title="Code font" description="Code blocks, diffs, and the terminal.">
          <FontPicker
            label="Code font"
            value={textDraft.codeFont}
            options={CODE_FONT_OPTIONS}
            previewGroup="code"
            sampleText="0O1l"
            customPlaceholder="e.g. Berkeley Mono"
            onChange={next => setDraftEdits(current => ({ ...current, codeFont: next }))}
            onCommit={applyText}
          />
        </SettingsRow>
        <SettingsRow title="Code size">{sizeSelect("Code size", "codeSize")}</SettingsRow>
      </SettingsSection>

      <SettingsSection title="Layout">
        <SettingsRow title="Conversation width" description="Maximum width of chat on wide screens.">
          <span className={`st-number ${textInvalid("contentWidth") ? "is-invalid" : ""}`} title={`${TEXT_LIMITS.contentWidth[0]}–${TEXT_LIMITS.contentWidth[1]} px`}>
            <input
              aria-label="Conversation width"
              inputMode="numeric"
              value={textDraft.contentWidth}
              aria-invalid={textInvalid("contentWidth")}
              onChange={event => setDraftEdits(current => ({ ...current, contentWidth: event.target.value.replace(/[^0-9]/g, "") }))}
              onKeyDown={event => { if (event.key === "Enter") applyText() }}
            />
            <small>px</small>
          </span>
        </SettingsRow>
        <SettingsRow title="Syntax colors">
          <select
            className="st-select"
            aria-label="Syntax colors"
            value={settings.highlightTheme}
            onChange={event => update({ highlightTheme: event.target.value as "auto" | "github" | "monochrome" })}
          >
            <option value="auto">Automatic</option>
            <option value="github">GitHub</option>
            <option value="monochrome">Monochrome</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      {textDirty ? (
        <div className="st-apply-bar" role="status">
          <span>
            {textErrors.length
              ? `Check the highlighted ${textErrors.length === 1 ? "value" : "values"}: interface ${TEXT_LIMITS.interfaceSize.join("–")}, chat ${TEXT_LIMITS.contentSize.join("–")}, code ${TEXT_LIMITS.codeSize.join("–")}, width ${TEXT_LIMITS.contentWidth.join("–")} px.`
              : "Text and layout changes aren’t applied yet."}
          </span>
          <Button variant="outline" size="sm" onClick={() => setDraftEdits({})}>Revert</Button>
          <Button variant="primary" size="sm" disabled={textErrors.length > 0} onClick={applyText}>Apply</Button>
        </div>
      ) : null}
    </>
  )
}
