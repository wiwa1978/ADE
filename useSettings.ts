import { useEffect, useState } from "react"
import { isColorPalette, isTheme, paletteVariables, type ColorPalette, type Theme } from "./appearance-palettes"

export type Settings = {
  theme: Theme
  palette: ColorPalette
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
}

const storageKey = "ade-settings-v1"
const defaults: Settings = {
  theme: "dark",
  palette: "graphite",
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
}

function readSettings(): { settings: Settings; error: string } {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { settings: defaults, error: "" }
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== "object") throw new Error("Invalid saved settings")
    const value = saved as Partial<Settings>
    return {
      settings: {
        theme: isTheme(value.theme) ? value.theme : defaults.theme,
        palette: isColorPalette(value.palette) ? value.palette : defaults.palette,
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
      },
      error: "",
    }
  } catch (error) {
    console.warn("Could not read settings", error)
    return { settings: defaults, error: "Could not read saved settings. Defaults are shown." }
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
    root.dataset.theme = resolved
    root.style.colorScheme = resolved
    const interfaceFont = settings.interfaceFont.trim()
      ? settings.interfaceFont
      : 'system-ui,-apple-system,"Segoe UI Variable","Segoe UI",sans-serif'
    const codeFont = settings.codeFont.trim()
      ? settings.codeFont
      : '"SFMono-Regular",Menlo,Monaco,Consolas,"Liberation Mono",monospace'
    root.style.setProperty("--interface-font", interfaceFont)
    root.style.setProperty("--interface-size", `${settings.interfaceSize}px`)
    root.style.setProperty("--input-size", `${Math.max(11, Math.round(settings.interfaceSize * 0.93))}px`)
    root.style.setProperty("--ui-scale", String(settings.interfaceSize / 14))
    root.style.setProperty("--content-size", `${settings.contentSize}px`)
    root.style.setProperty("--code-font", codeFont)
    root.style.setProperty("--code-size", `${settings.codeSize}px`)
    root.style.setProperty("--content-width", `${settings.contentWidth}px`)
    root.style.fontFamily = interfaceFont
    root.style.fontSize = `${settings.interfaceSize}px`
    root.dataset.highlightTheme = settings.highlightTheme
    Object.entries(paletteVariables(settings.palette, resolved)).forEach(([name, value]) => root.style.setProperty(name, value))
  }, [settings.palette, resolved, settings.interfaceFont, settings.interfaceSize, settings.contentSize, settings.codeFont, settings.codeSize, settings.contentWidth, settings.highlightTheme])

  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setError("")
    } catch (cause) {
      console.warn("Could not save settings", cause)
      setError("Could not save settings. Changes apply only for this session.")
    }
  }

  return { settings, error, resolved, update }
}
