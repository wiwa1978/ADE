import { useCallback, useEffect, useState } from "react"
import { z } from "zod"
import { isAccentColor, paletteVariables, resolveAccentHex, type ColorPalette, type Theme } from "./appearance-palettes"
import { ReasoningLevelSchema } from "./packages/protocol/index.ts"
import { ensureGoogleFontLoaded } from "./src/appearance/fonts"
import {
  DEFAULT_FORMAT_PREFERENCES, DEFAULT_LANGUAGE, getLanguageMeta, isCurrencyCode, isDateFormatPreference, isLanguageCode, isTimeFormatPreference, setCurrentLanguage, t,
  type DateFormatPreference, type LanguageCode, type TimeFormatPreference,
} from "./src/i18n"
import { CUSTOM_ACTION_OPTIONS, type CustomKeybinding, type CustomKeybindingAction } from "./src/keybindings"

export type Settings = {
  /** Interface display language (e.g. "en", "nl"). */
  language: LanguageCode
  /** How calendar dates are written ("auto" follows the display language). */
  dateFormat: DateFormatPreference
  /** 12- or 24-hour clock ("auto" follows the display language). */
  timeFormat: TimeFormatPreference
  /** Preferred currency (ISO 4217) for money amounts. */
  currency: string
  theme: Theme
  palette: ColorPalette
  /** Optional accent color preset id or #rrggbb hex; "" uses the palette default. */
  accentColor: string
  model: string
  provider: string
  harness: string
  platform: string
  reasoning: string
  terminalFontSize: number
  terminalScrollback: number
  interfaceFont: string
  interfaceSize: number
  contentSize: number
  codeFont: string
  codeSize: number
  contentWidth: number
  highlightTheme: "auto" | "github" | "monochrome"
  /** Workspace type preselected when starting a session in a project with a local checkout. */
  defaultWorkspaceKind: "worktree" | "checkout" | "none"
  /** Remove a session's ADE worktree when it is archived (the branch is always kept). */
  archiveRemovesWorktree: boolean
  /** Start a shell automatically when the terminal pane opens. */
  terminalAutoStart: boolean
  /** Open pull requests as drafts by default. */
  prDraft: boolean
  /** Desktop notifications. */
  notifyOnFinish: boolean
  notifyOnApproval: boolean
  /** Reopen the last project or session after a reload. */
  restoreLastView: boolean
  /** Monthly spend (USD) to warn at; 0 = no budget. */
  monthlyBudget: number
  /** Overrides for built-in keyboard shortcuts (action id -> canonical chord, "" = unbound). */
  keybindings: Record<string, string>
  /** User-defined custom keyboard shortcuts. */
  customKeybindings: CustomKeybinding[]
}

const storageKey = "ade-settings-v1"
const defaults: Settings = {
  language: DEFAULT_LANGUAGE,
  dateFormat: DEFAULT_FORMAT_PREFERENCES.dateFormat,
  timeFormat: DEFAULT_FORMAT_PREFERENCES.timeFormat,
  currency: DEFAULT_FORMAT_PREFERENCES.currency,
  theme: "dark",
  palette: "graphite",
  accentColor: "",
  model: "",
  provider: "",
  harness: "pi",
  platform: "local",
  reasoning: "medium",
  terminalFontSize: 13,
  terminalScrollback: 5000,
  interfaceFont: "",
  interfaceSize: 14,
  contentSize: 15,
  codeFont: "",
  codeSize: 12,
  contentWidth: 820,
  highlightTheme: "auto",
  defaultWorkspaceKind: "worktree",
  archiveRemovesWorktree: true,
  terminalAutoStart: true,
  prDraft: true,
  notifyOnFinish: false,
  notifyOnApproval: false,
  restoreLastView: true,
  monthlyBudget: 0,
  keybindings: {},
  customKeybindings: [],
}

const ThemeSchema = z.enum(["light", "dark", "system"])
const ColorPaletteSchema = z.enum(["graphite", "paseo", "sand", "slate", "nord", "sage", "ash", "amber", "dusk"])
const PlatformSchema = z.enum(["local", "docker", "cloud-docker", "boat"])
const ReasoningSettingSchema = z.enum([...ReasoningLevelSchema.options, "none", "xhigh", "max"])
const HighlightThemeSchema = z.enum(["auto", "github", "monochrome"])
const WorkspaceKindSchema = z.enum(["worktree", "checkout", "none"])

const customActionIds = CUSTOM_ACTION_OPTIONS.map(o => o.action) as [CustomKeybindingAction, ...CustomKeybindingAction[]]
const CustomKeybindingSchema = z.object({
  id: z.string(),
  label: z.string(),
  action: z.enum(customActionIds),
  arg: z.string().optional(),
  chord: z.string(),
})

const KeybindingsRecordSchema = z
  .record(z.string(), z.unknown())
  .transform((entries) => {
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(entries)) {
      if (typeof v === "string" && v.length <= 64) cleaned[k] = v
    }
    return cleaned
  })
  .catch({})

const CustomKeybindingsListSchema = z
  .array(z.unknown())
  .transform((items): CustomKeybinding[] => {
    const valid: CustomKeybinding[] = []
    for (const item of items) {
      if (valid.length >= 40) break
      const parsed = CustomKeybindingSchema.safeParse(item)
      if (parsed.success) valid.push(parsed.data)
    }
    return valid
  })
  .catch([])

const PersistedSettingsSchema = z.object({
  language: z.custom<LanguageCode>(isLanguageCode).catch(defaults.language),
  dateFormat: z.custom<DateFormatPreference>(isDateFormatPreference).catch(defaults.dateFormat),
  timeFormat: z.custom<TimeFormatPreference>(isTimeFormatPreference).catch(defaults.timeFormat),
  currency: z.string().refine(isCurrencyCode).catch(defaults.currency),
  theme: ThemeSchema.catch(defaults.theme),
  palette: ColorPaletteSchema.catch(defaults.palette),
  accentColor: z.string().refine(isAccentColor).catch(defaults.accentColor),
  model: z.string().catch(defaults.model),
  provider: z.string().max(64).catch(defaults.provider),
  platform: PlatformSchema.catch("local"),
  reasoning: ReasoningSettingSchema.catch("medium"),
  terminalFontSize: z.number().int().min(10).max(20).catch(defaults.terminalFontSize),
  terminalScrollback: z.number().int().min(500).max(20_000).catch(defaults.terminalScrollback),
  interfaceFont: z.string().transform(s => s.slice(0, 200)).catch(defaults.interfaceFont),
  interfaceSize: z.number().int().min(11).max(20).catch(defaults.interfaceSize),
  contentSize: z.number().int().min(12).max(22).catch(defaults.contentSize),
  codeFont: z.string().transform(s => s.slice(0, 200)).catch(defaults.codeFont),
  codeSize: z.number().int().min(10).max(18).catch(defaults.codeSize),
  contentWidth: z.number().int().min(640).max(1200).catch(defaults.contentWidth),
  highlightTheme: HighlightThemeSchema.catch(defaults.highlightTheme),
  defaultWorkspaceKind: WorkspaceKindSchema.catch(defaults.defaultWorkspaceKind),
  archiveRemovesWorktree: z.boolean().catch(defaults.archiveRemovesWorktree),
  terminalAutoStart: z.boolean().catch(defaults.terminalAutoStart),
  prDraft: z.boolean().catch(defaults.prDraft),
  notifyOnFinish: z.boolean().catch(defaults.notifyOnFinish),
  notifyOnApproval: z.boolean().catch(defaults.notifyOnApproval),
  restoreLastView: z.boolean().catch(defaults.restoreLastView),
  monthlyBudget: z.number().finite().min(0).max(1_000_000).catch(defaults.monthlyBudget),
  keybindings: KeybindingsRecordSchema,
  customKeybindings: CustomKeybindingsListSchema,
})

function readSettings(): { settings: Settings; error: string } {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { settings: defaults, error: "" }
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      throw new Error("Invalid saved settings")
    }
    const parsed = PersistedSettingsSchema.parse(saved)
    setCurrentLanguage(parsed.language)
    return {
      settings: {
        ...parsed,
        harness: defaults.harness,
      },
      error: "",
    }
  } catch (error) {
    console.warn("Could not read settings", error)
    return { settings: defaults, error: t("settings.error.read") }
  }
}

export function useSettings() {
  const [initial] = useState(readSettings)
  const [settings, setSettings] = useState(initial.settings)
  const [error, setError] = useState(initial.error)
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches)

  const resolved = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])
  useEffect(() => {
    const root = document.documentElement
    setCurrentLanguage(settings.language)
    root.lang = getLanguageMeta(settings.language).bcp47
    root.dataset.theme = resolved
    root.style.colorScheme = resolved
    const interfaceFont = settings.interfaceFont.trim()
      ? settings.interfaceFont
      : 'system-ui,-apple-system,"Segoe UI Variable","Segoe UI",sans-serif'
    const codeFont = settings.codeFont.trim()
      ? settings.codeFont
      : '"SFMono-Regular",Menlo,Monaco,Consolas,"Liberation Mono",monospace'
    ensureGoogleFontLoaded(interfaceFont)
    ensureGoogleFontLoaded(codeFont)
    // Interface size scales the whole app (most of the UI uses fixed pixel sizes), like zooming
    // in an editor. Chat and code sizes are then divided by the zoom, so they land on exactly the
    // pixel size chosen.
    const zoom = settings.interfaceSize / 14
    root.style.setProperty("--ui-zoom", String(zoom))
    root.style.setProperty("zoom", zoom === 1 ? "" : String(zoom))
    root.style.setProperty("--interface-font", interfaceFont)
    root.style.setProperty("--interface-size", "14px")
    root.style.setProperty("--input-size", "13px")
    root.style.setProperty("--ui-scale", String(zoom))
    root.style.setProperty("--content-size", `${settings.contentSize / zoom}px`)
    root.style.setProperty("--code-font", codeFont)
    root.style.setProperty("--code-size", `${settings.codeSize / zoom}px`)
    root.style.setProperty("--content-width", `${settings.contentWidth / zoom}px`)
    root.style.fontFamily = interfaceFont
    root.style.fontSize = "14px"
    root.dataset.highlightTheme = settings.highlightTheme
    const activeAccent = resolveAccentHex(settings.accentColor, resolved)
    if (activeAccent) root.dataset.accent = "on"
    else delete root.dataset.accent
    Object.entries(paletteVariables(settings.palette, resolved, settings.accentColor)).forEach(([name, value]) => root.style.setProperty(name, value))
  }, [settings.language, settings.palette, settings.accentColor, resolved, settings.interfaceFont, settings.interfaceSize, settings.contentSize, settings.codeFont, settings.codeSize, settings.contentWidth, settings.highlightTheme])

  const update = useCallback((patch: Partial<Settings>) => {
    if (patch.language) setCurrentLanguage(patch.language)
    setSettings(prev => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
        setError("")
      } catch (cause) {
        console.warn("Could not save settings", cause)
        setError(t("settings.error.save"))
      }
      return next
    })
  }, [])

  return { settings, error, resolved, update }
}
