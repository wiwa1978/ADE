import type { CSSProperties } from "react"

export type Theme = "light" | "dark" | "system"
export type ResolvedTheme = Exclude<Theme, "system">
export type ColorPalette = "graphite" | "paseo" | "sand" | "slate" | "nord" | "sage" | "ash" | "amber" | "dusk"

export const colorPalettes: { id: ColorPalette; name: string; description: string }[] = [
  { id: "graphite", name: "Graphite", description: "Quiet neutral charcoal with calm steel blue." },
  { id: "paseo", name: "Paseo", description: "Warm charcoal surfaces with muted terracotta." },
  { id: "sand", name: "Sand", description: "Soft warm neutrals with understated clay." },
  { id: "slate", name: "Slate", description: "Crisp cool gray surfaces with refined blue." },
  { id: "nord", name: "Nord", description: "Muted arctic slate with frosted blue." },
  { id: "sage", name: "Sage", description: "Mineral stone neutrals with quiet eucalyptus." },
  { id: "ash", name: "Ash", description: "Pure monochrome ink and paper with zero hue." },
  { id: "amber", name: "Amber", description: "Warm obsidian and ivory with muted ochre." },
  { id: "dusk", name: "Dusk", description: "Subtle twilight neutrals with dusty violet." },
]

// Background, text, surface, navigation, muted text, border, accent, button, button text, secondary accent.
type PaletteColors = readonly [string, string, string, string, string, string, string, string, string, string]
const palettes: Record<ColorPalette, Record<ResolvedTheme, PaletteColors>> = {
  graphite: {
    light: ["#fbfbfa", "#1c1c1a", "#f3f3f1", "#efefec", "#6e6d68", "#e2e1dd", "#3b76a8", "#3b76a8", "#ffffff", "#b85c5c"],
    dark: ["#1e1e1d", "#e8e7e3", "#272725", "#191918", "#999891", "#363633", "#6ba3d1", "#6ba3d1", "#14181c", "#cf7b75"],
  },
  paseo: {
    light: ["#f7f5f2", "#252321", "#efede8", "#f2f0eb", "#756f69", "#dedad3", "#b86147", "#b86147", "#fffaf7", "#a65458"],
    dark: ["#1f1e1d", "#f2f0ec", "#282624", "#191817", "#a39e98", "#383430", "#d67d5e", "#d67d5e", "#201714", "#d98982"],
  },
  sand: {
    light: ["#faf8f3", "#2f2e2a", "#f1eee6", "#f5f3ec", "#6d6a62", "#e2ded3", "#a5563b", "#a5563b", "#ffffff", "#b0655c"],
    dark: ["#242320", "#e5e2da", "#2e2d29", "#1e1d1b", "#a9a59a", "#3e3c36", "#cf8a6f", "#cf8a6f", "#221b18", "#d1847b"],
  },
  slate: {
    light: ["#ffffff", "#1f242c", "#f4f6f8", "#f8f9fb", "#626c7a", "#dce1e8", "#3b6ea5", "#3b6ea5", "#ffffff", "#b85d68"],
    dark: ["#13161b", "#e3e7ee", "#1b2028", "#0f1216", "#8b95a5", "#2c333f", "#74a2d4", "#74a2d4", "#0f151d", "#cf7d85"],
  },
  nord: {
    light: ["#f2f5f8", "#2d333f", "#e8edf3", "#eceff4", "#566073", "#cfd7e2", "#4a7091", "#4a7091", "#ffffff", "#a35e6b"],
    dark: ["#252a34", "#e6ebf2", "#2f3542", "#1f242d", "#9aa7ba", "#3f4859", "#84b3c4", "#84b3c4", "#1a2229", "#c9828b"],
  },
  sage: {
    light: ["#fafaf7", "#282d29", "#f1f2ed", "#f5f6f1", "#626a62", "#dde0d7", "#3a745d", "#3a745d", "#ffffff", "#b0615d"],
    dark: ["#181c19", "#e4e9e4", "#212722", "#131714", "#97a397", "#313a33", "#7cb396", "#7cb396", "#13211a", "#cc827e"],
  },
  ash: {
    light: ["#ffffff", "#18181a", "#f4f4f5", "#f7f7f8", "#71717a", "#e4e4e7", "#3f3f46", "#3f3f46", "#ffffff", "#a85a5a"],
    dark: ["#141415", "#ececef", "#1e1e20", "#101011", "#94949c", "#2d2d31", "#a1a1aa", "#a1a1aa", "#141415", "#c97b7b"],
  },
  amber: {
    light: ["#fbfaf5", "#292621", "#f3efe4", "#f6f3ea", "#726a5c", "#e2dccd", "#9c6d27", "#9c6d27", "#ffffff", "#b05f54"],
    dark: ["#1c1b18", "#ece7dc", "#262420", "#161512", "#a39b8c", "#36332c", "#c99d56", "#c99d56", "#1e1a12", "#cf7f74"],
  },
  dusk: {
    light: ["#faf9fb", "#25222c", "#f2eff5", "#f5f3f8", "#6b6578", "#e0dce8", "#6b5b95", "#6b5b95", "#ffffff", "#b56372"],
    dark: ["#1a191f", "#eae7f0", "#23212a", "#141318", "#9d97ab", "#34313f", "#9d8ec4", "#9d8ec4", "#17151f", "#cf8290"],
  },
}

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system"
}

export function isColorPalette(value: unknown): value is ColorPalette {
  return colorPalettes.some((palette) => palette.id === value)
}

function rgb(hex: string) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(" ")
}

export function paletteVariables(palette: ColorPalette, mode: ResolvedTheme): CSSProperties & Record<`--${string}`, string> {
  const resolvedPalette: ColorPalette = isColorPalette(palette) ? palette : "graphite"
  const [background, foreground, surface, nav, muted, border, primary, strong, primaryForeground, rose] = palettes[resolvedPalette][mode].map(rgb)
  const raised = mode === "dark" ? (resolvedPalette === "paseo" ? rgb("#302e2b") : surface) : rgb("#ffffff")
  return {
    "--background": background,
    "--foreground": foreground,
    "--card": background,
    "--surface": surface,
    "--surface-raised": raised,
    "--field": background,
    "--nav": nav,
    "--muted": muted,
    "--placeholder": muted,
    "--border": border,
    "--card-border": border,
    "--primary": primary,
    "--primary-strong": strong,
    "--primary-foreground": primaryForeground,
    "--rose": rose,
    "--orbit": primary,
    "--shadow": mode === "dark" ? "0 0 0" : foreground,
  }
}

/** A whole look in one click: palette plus fonts, sizes and width, in the style of a familiar tool. */
export type LookPreset = {
  id: string
  name: string
  description: string
  palette: ColorPalette
  interfaceFont: string
  interfaceSize: number
  contentSize: number
  codeFont: string
  codeSize: number
  contentWidth: number
}

export const lookPresets: LookPreset[] = [
  { id: "ade", name: "ADE", description: "Graphite, system font, comfortable reading width.", palette: "graphite", interfaceFont: "", interfaceSize: 14, contentSize: 15, codeFont: "", codeSize: 12, contentWidth: 820 },
  { id: "cursor", name: "Cursor-style", description: "Crisp cool grays and blue, compact, with a narrow chat.", palette: "slate", interfaceFont: "", interfaceSize: 13, contentSize: 14, codeFont: "", codeSize: 12, contentWidth: 760 },
  { id: "claude", name: "Claude-style", description: "Warm charcoal and terracotta, larger reading text.", palette: "paseo", interfaceFont: "", interfaceSize: 14, contentSize: 16, codeFont: "", codeSize: 13, contentWidth: 740 },
  { id: "antigravity", name: "Antigravity-style", description: "Muted slate and frosted blue, roomy layout.", palette: "nord", interfaceFont: "", interfaceSize: 14, contentSize: 15, codeFont: "", codeSize: 13, contentWidth: 880 },
  { id: "codex", name: "Codex-style", description: "Minimal black and white, compact.", palette: "ash", interfaceFont: "", interfaceSize: 13, contentSize: 14, codeFont: "", codeSize: 12, contentWidth: 760 },
]
