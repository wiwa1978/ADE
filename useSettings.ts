import { useEffect, useState } from "react"
import { isAccentColor, isColorPalette, isTheme, paletteVariables, resolveAccentHex, type ColorPalette, type Theme } from "./appearance-palettes"
import { ensureGoogleFontLoaded } from "./src/appearance/fonts"
import {
  DEFAULT_FORMAT_PREFERENCES, DEFAULT_LANGUAGE, getLanguageMeta, isCurrencyCode, isDateFormatPreference, isLanguageCode, isTimeFormatPreference, setCurrentLanguage, t,
  type DateFormatPreference, type LanguageCode, type TimeFormatPreference,
} from "./src/i18n"
import { CUSTOM_ACTION_OPTIONS, type CustomKeybinding } from "./src/keybindings"

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

function readSettings(): { settings: Settings; error: string } {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { settings: defaults, error: "" }
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== "object") throw new Error("Invalid saved settings")
    const value = saved as Partial<Settings>
    const language = isLanguageCode(value.language) ? value.language : defaults.language
    setCurrentLanguage(language)
    return {
      settings: {
        language,
        dateFormat: isDateFormatPreference(value.dateFormat) ? value.dateFormat : defaults.dateFormat,
        timeFormat: isTimeFormatPreference(value.timeFormat) ? value.timeFormat : defaults.timeFormat,
        currency: isCurrencyCode(value.currency) ? value.currency : defaults.currency,
        theme: isTheme(value.theme) ? value.theme : defaults.theme,
        palette: isColorPalette(value.palette) ? value.palette : defaults.palette,
        accentColor: isAccentColor(value.accentColor) ? value.accentColor : defaults.accentColor,
        model: typeof value.model === "string" ? value.model : defaults.model,
        provider: typeof value.provider === "string" && value.provider.length <= 64 ? value.provider : "",
        harness: defaults.harness,
        platform: ["local", "docker", "cloud-docker", "boat"].includes(value.platform ?? "") ? value.platform! : defaults.platform,
        reasoning: ["none", "off", "low", "medium", "high", "xhigh", "max"].includes(value.reasoning ?? "") ? value.reasoning! : defaults.reasoning,
        terminalFontSize: typeof value.terminalFontSize === "number" && Number.isInteger(value.terminalFontSize) && value.terminalFontSize >= 10 && value.terminalFontSize <= 20 ? value.terminalFontSize : defaults.terminalFontSize,
        terminalScrollback: typeof value.terminalScrollback === "number" && Number.isInteger(value.terminalScrollback) && value.terminalScrollback >= 500 && value.terminalScrollback <= 20_000 ? value.terminalScrollback : defaults.terminalScrollback,
        interfaceFont: typeof value.interfaceFont === "string" ? value.interfaceFont.slice(0, 200) : defaults.interfaceFont,
        interfaceSize: typeof value.interfaceSize === "number" && Number.isInteger(value.interfaceSize) && value.interfaceSize >= 11 && value.interfaceSize <= 20 ? value.interfaceSize : defaults.interfaceSize,
        contentSize: typeof value.contentSize === "number" && Number.isInteger(value.contentSize) && value.contentSize >= 12 && value.contentSize <= 22 ? value.contentSize : defaults.contentSize,
        codeFont: typeof value.codeFont === "string" ? value.codeFont.slice(0, 200) : defaults.codeFont,
        codeSize: typeof value.codeSize === "number" && Number.isInteger(value.codeSize) && value.codeSize >= 10 && value.codeSize <= 18 ? value.codeSize : defaults.codeSize,
        contentWidth: typeof value.contentWidth === "number" && Number.isInteger(value.contentWidth) && value.contentWidth >= 640 && value.contentWidth <= 1200 ? value.contentWidth : defaults.contentWidth,
        highlightTheme: value.highlightTheme === "github" || value.highlightTheme === "monochrome" ? value.highlightTheme : "auto",
        defaultWorkspaceKind: value.defaultWorkspaceKind === "checkout" || value.defaultWorkspaceKind === "none" ? value.defaultWorkspaceKind : defaults.defaultWorkspaceKind,
        archiveRemovesWorktree: typeof value.archiveRemovesWorktree === "boolean" ? value.archiveRemovesWorktree : defaults.archiveRemovesWorktree,
        terminalAutoStart: typeof value.terminalAutoStart === "boolean" ? value.terminalAutoStart : defaults.terminalAutoStart,
        prDraft: typeof value.prDraft === "boolean" ? value.prDraft : defaults.prDraft,
        notifyOnFinish: typeof value.notifyOnFinish === "boolean" ? value.notifyOnFinish : defaults.notifyOnFinish,
        notifyOnApproval: typeof value.notifyOnApproval === "boolean" ? value.notifyOnApproval : defaults.notifyOnApproval,
        restoreLastView: typeof value.restoreLastView === "boolean" ? value.restoreLastView : defaults.restoreLastView,
        monthlyBudget: typeof value.monthlyBudget === "number" && Number.isFinite(value.monthlyBudget) && value.monthlyBudget >= 0 && value.monthlyBudget <= 1_000_000 ? value.monthlyBudget : defaults.monthlyBudget,
        keybindings: (() => {
          if (!value.keybindings || typeof value.keybindings !== "object" || Array.isArray(value.keybindings)) return {}
          const cleaned: Record<string, string> = {}
          for (const [k, v] of Object.entries(value.keybindings)) {
            if (typeof k === "string" && typeof v === "string" && v.length <= 64) cleaned[k] = v
          }
          return cleaned
        })(),
        customKeybindings: (() => {
          if (!Array.isArray(value.customKeybindings)) return []
          const allowedActions = new Set(CUSTOM_ACTION_OPTIONS.map(o => o.action))
          return value.customKeybindings
            .filter((item): item is CustomKeybinding =>
              Boolean(item)
              && typeof item === "object"
              && typeof item.id === "string"
              && typeof item.label === "string"
              && typeof item.chord === "string"
              && allowedActions.has(item.action),
            )
            .slice(0, 40)
        })(),
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
    const update = () => setSystemDark(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
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

  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch }
    if (patch.language) setCurrentLanguage(patch.language)
    setSettings(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setError("")
    } catch (cause) {
      console.warn("Could not save settings", cause)
      setError(t("settings.error.save"))
    }
  }

  return { settings, error, resolved, update }
}
