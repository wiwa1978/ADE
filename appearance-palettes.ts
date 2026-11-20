import type { CSSProperties } from "react"

export type Theme = "light" | "dark" | "system"
export type ResolvedTheme = Exclude<Theme, "system">
export type ColorPalette = "aitomium" | "monokai" | "github" | "anthropic" | "tokyo" | "classic" | "solarized" | "nord" | "dracula" | "rose-pine" | "catppuccin" | "gruvbox" | "crimson" | "raspberry" | "one" | "ayu" | "material" | "night-owl" | "everforest" | "cobalt" | "vitesse"

export const colorPalettes: { id: ColorPalette; name: string; description: string }[] = [
  { id: "aitomium", name: "AItomium", description: "The original purple and rose." },
  { id: "monokai", name: "Monokai", description: "Olive neutrals with a lime accent." },
  { id: "github", name: "GitHub", description: "Clean surfaces and familiar blue." },
  { id: "anthropic", name: "Anthropic", description: "Warm neutrals and terracotta." },
  { id: "tokyo", name: "Tokyo", description: "Cool indigo and city-inspired blue." },
  { id: "classic", name: "Classic", description: "Simple neutrals with a coral accent." },
  { id: "solarized", name: "Solarized", description: "Cream or ocean ink with teal." },
  { id: "nord", name: "Nord", description: "Arctic neutrals and frosted blue." },
  { id: "dracula", name: "Dracula", description: "Violet accents on cool, crisp surfaces." },
  { id: "rose-pine", name: "Rosé Pine", description: "Soft rose and muted pine neutrals." },
  { id: "catppuccin", name: "Catppuccin", description: "Lavender accents with soothing pastels." },
  { id: "gruvbox", name: "Gruvbox", description: "Warm earth tones and golden amber." },
  { id: "crimson", name: "Crimson", description: "Bold crimson and cool teal on stone neutrals." },
  { id: "raspberry", name: "Raspberry", description: "Rich berry pink with a fresh mint accent." },
  { id: "one", name: "One", description: "One-inspired charcoal, clear blue, and soft gold." },
  { id: "ayu", name: "Ayu", description: "Ayu-inspired amber and warm sand neutrals." },
  { id: "material", name: "Material", description: "Material-inspired teal and blue-gray surfaces." },
  { id: "night-owl", name: "Night Owl", description: "Night Owl-inspired ocean blue and luminous cyan." },
  { id: "everforest", name: "Everforest", description: "Everforest-inspired moss green and earthy cream." },
  { id: "cobalt", name: "Cobalt", description: "Cobalt-inspired royal blue with a golden accent." },
  { id: "vitesse", name: "Vitesse", description: "Vitesse-inspired jade and understated stone neutrals." },
]

// Background, text, surface, navigation, muted text, border, accent, button, button text, secondary accent.
type PaletteColors = readonly [string, string, string, string, string, string, string, string, string, string]
const palettes: Record<ColorPalette, Record<ResolvedTheme, PaletteColors>> = {
  aitomium: {
    light: ["#f7f3fc", "#1a1823", "#f4effa", "#ece7f4", "#5e586f", "#dbd3e6", "#8534f3", "#5526ad", "#ffffff", "#f472b6"],
    dark: ["#0b0b0f", "#f8f7fc", "#16161a", "#0c0c0f", "#bcb8cb", "#464452", "#b07dff", "#8534f3", "#ffffff", "#fb7185"],
  },
  monokai: {
    light: ["#fafaf5", "#272822", "#f0f1e8", "#eeefe4", "#636653", "#d3d6c4", "#50740b", "#50740b", "#ffffff", "#b81d60"],
    dark: ["#272822", "#f8f8f2", "#30312a", "#20211c", "#b8b6a5", "#44463b", "#a6e22e", "#a6e22e", "#20211c", "#f92672"],
  },
  github: {
    light: ["#ffffff", "#1f2328", "#f0f3f6", "#f6f8fa", "#59636e", "#d1d9e0", "#0969da", "#0969da", "#ffffff", "#8250df"],
    dark: ["#0d1117", "#e6edf3", "#161b22", "#010409", "#9198a1", "#3d444d", "#79c0ff", "#79c0ff", "#0d1117", "#d2a8ff"],
  },
  anthropic: {
    light: ["#faf9f5", "#34332f", "#f0eee6", "#f5f4ed", "#68665e", "#e0ddd2", "#ad4e32", "#ad4e32", "#ffffff", "#8062ba"],
    dark: ["#262624", "#e0ded6", "#30302e", "#21211f", "#b9b7ad", "#45453e", "#e19b82", "#e19b82", "#262624", "#b69cdb"],
  },
  tokyo: {
    light: ["#e1e2e7", "#343b58", "#dbdce2", "#d5d6db", "#50556d", "#bfc3d0", "#34548a", "#34548a", "#ffffff", "#5a4a78"],
    dark: ["#1a1b26", "#c0caf5", "#24283b", "#16161e", "#a0abd0", "#343b58", "#7aa2f7", "#7aa2f7", "#16161e", "#bb9af7"],
  },
  classic: {
    light: ["#ffffff", "#292622", "#f7f6f4", "#fcfaf8", "#716b65", "#dedbd6", "#bd3c30", "#bd3c30", "#ffffff", "#83519c"],
    dark: ["#202020", "#eeeae5", "#2c2a28", "#252322", "#b2aaa2", "#3a3632", "#f09a88", "#f09a88", "#29201e", "#c5a3e0"],
  },
  solarized: {
    light: ["#fdf6e3", "#073642", "#f5efdc", "#eee8d5", "#52676b", "#d8d0bb", "#08716e", "#08716e", "#ffffff", "#6c539b"],
    dark: ["#002b36", "#eee8d5", "#073642", "#00232c", "#93a7a8", "#24505a", "#5cc0bb", "#5cc0bb", "#002b36", "#b39ddb"],
  },
  nord: {
    light: ["#eceff4", "#2e3440", "#e5e9f0", "#d8dee9", "#4c566a", "#b8c2d0", "#345d80", "#345d80", "#ffffff", "#7c5680"],
    dark: ["#2e3440", "#eceff4", "#3b4252", "#272d38", "#c4cedc", "#58677e", "#88c0d0", "#88c0d0", "#2e3440", "#b48ead"],
  },
  dracula: {
    light: ["#faf8ff", "#282a36", "#f0ebfa", "#e9e2f5", "#5b536b", "#cfc3e2", "#7040a0", "#7040a0", "#ffffff", "#a42c6a"],
    dark: ["#282a36", "#f8f8f2", "#343746", "#21222c", "#c0bdd5", "#5e6178", "#bd93f9", "#bd93f9", "#282a36", "#ff79c6"],
  },
  "rose-pine": {
    light: ["#faf4ed", "#575279", "#fffaf3", "#f2e9e1", "#625d79", "#d8cfc8", "#9d3e61", "#9d3e61", "#ffffff", "#286983"],
    dark: ["#191724", "#e0def4", "#26233a", "#1f1d2e", "#b6b0ce", "#524c68", "#ebbcba", "#ebbcba", "#191724", "#9ccfd8"],
  },
  catppuccin: {
    light: ["#eff1f5", "#4c4f69", "#e6e9ef", "#dce0e8", "#5c5f77", "#bcc0cc", "#7924bd", "#7924bd", "#ffffff", "#a32d59"],
    dark: ["#1e1e2e", "#cdd6f4", "#313244", "#181825", "#bac2de", "#585b70", "#cba6f7", "#cba6f7", "#1e1e2e", "#f5c2e7"],
  },
  gruvbox: {
    light: ["#fbf1c7", "#3c3836", "#f2e5bc", "#ebdbb2", "#665c54", "#c4b38a", "#854500", "#854500", "#ffffff", "#9d3932"],
    dark: ["#282828", "#ebdbb2", "#3c3836", "#1d2021", "#c8b99a", "#665c54", "#fabd2f", "#fabd2f", "#282828", "#b8bb26"],
  },
  crimson: {
    light: ["#fcf8f6", "#302528", "#f3ebe9", "#ede2df", "#68585c", "#d9c4c6", "#a51d3d", "#a51d3d", "#ffffff", "#267b78"],
    dark: ["#1c1518", "#faedef", "#2a2025", "#160f12", "#c8b1b8", "#65434e", "#ff8ba4", "#ff8ba4", "#28131c", "#79c8bf"],
  },
  raspberry: {
    light: ["#fdf7fb", "#342635", "#f5eaf2", "#eddfe9", "#6d566b", "#dcc5d6", "#a01a61", "#a01a61", "#ffffff", "#24786b"],
    dark: ["#211320", "#fbeafa", "#321f30", "#190d18", "#cfb0ca", "#704666", "#ff8fc7", "#ff8fc7", "#301024", "#83d1b6"],
  },
  one: {
    light: ["#fafafa", "#383a42", "#f0f1f3", "#e7e9ed", "#596170", "#c8ccd4", "#245991", "#245991", "#ffffff", "#98651a"],
    dark: ["#282c34", "#e6e9ef", "#303640", "#21252b", "#b2bac8", "#515b6b", "#7bb9ef", "#7bb9ef", "#202630", "#e5c07b"],
  },
  ayu: {
    light: ["#fcfaf5", "#39352c", "#f4efe4", "#ece5d7", "#6a604e", "#d9ccb4", "#875400", "#875400", "#ffffff", "#347b80"],
    dark: ["#101820", "#eee6d5", "#1a2530", "#0b121a", "#bdb5a5", "#465360", "#ffcb6b", "#ffcb6b", "#241d10", "#7cc9c4"],
  },
  material: {
    light: ["#f7faf9", "#263238", "#ecf2f1", "#e1eae8", "#526568", "#bfd1cd", "#00685f", "#00685f", "#ffffff", "#7257a5"],
    dark: ["#1b292e", "#edf5f2", "#26383e", "#142126", "#b3c9c7", "#48646a", "#80d9cc", "#80d9cc", "#102d2b", "#b8a2df"],
  },
  "night-owl": {
    light: ["#f7fbfd", "#173849", "#eaf3f7", "#dfedf3", "#4d6574", "#bdd2de", "#096579", "#096579", "#ffffff", "#7760a8"],
    dark: ["#011627", "#e4f2f8", "#0b293b", "#00101d", "#adc5d3", "#31576b", "#82d9e3", "#82d9e3", "#062531", "#c5a5eb"],
  },
  everforest: {
    light: ["#f8f5e8", "#333e32", "#efeddf", "#e5e6d5", "#58634f", "#c6cbb4", "#49622e", "#49622e", "#ffffff", "#8d672a"],
    dark: ["#272f2b", "#e3e8d7", "#333f36", "#202822", "#bdc9b3", "#586c56", "#b4cf91", "#b4cf91", "#24301e", "#ddbc7c"],
  },
  cobalt: {
    light: ["#f8faff", "#1d3151", "#edf2fb", "#e0e9f6", "#50627d", "#becde3", "#164ec0", "#164ec0", "#ffffff", "#8f6815"],
    dark: ["#122b49", "#edf4ff", "#1c3b5e", "#0c213b", "#b5cbe4", "#466a91", "#83c6ff", "#83c6ff", "#0d2945", "#ffcf66"],
  },
  vitesse: {
    light: ["#fafaf7", "#303630", "#f0f1ec", "#e7e9e2", "#596357", "#c9d0c4", "#236d52", "#236d52", "#ffffff", "#8a6c38"],
    dark: ["#171b18", "#e5ebe3", "#232b24", "#111612", "#b3c2b1", "#475c48", "#8ccfa8", "#8ccfa8", "#152c20", "#c8b787"],
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
  const [background, foreground, surface, nav, muted, border, primary, strong, primaryForeground, rose] = palettes[palette][mode].map(rgb)
  const original = palette === "aitomium"
  return {
    "--background": background,
    "--foreground": foreground,
    "--card": original ? (mode === "light" ? "255 255 255" : "27 27 31") : background,
    "--surface": surface,
    "--surface-raised": original ? (mode === "light" ? "255 255 255" : "36 34 43") : surface,
    "--field": original ? (mode === "light" ? "255 255 255" : "18 18 22") : background,
    "--nav": nav,
    "--muted": muted,
    "--border": border,
    "--card-border": original ? (mode === "light" ? "146 137 161" : "255 255 255") : border,
    "--primary": primary,
    "--primary-strong": strong,
    "--primary-foreground": primaryForeground,
    "--rose": rose,
    "--orbit": primary,
    "--shadow": mode === "dark" ? "0 0 0" : original ? "47 31 72" : foreground,
  }
}
