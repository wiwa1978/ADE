export type FontOption = {
  value: string
  label: string
  category: "System" | "Modern Sans" | "Editorial Serif" | "Code Mono"
  googleFamily?: string
  weights?: string
  sample?: string
}

export const INTERFACE_FONT_OPTIONS: FontOption[] = [
  // System
  { value: "", label: "System default", category: "System" },
  { value: '"SF Pro Text", -apple-system, sans-serif', label: "SF Pro", category: "System" },
  { value: '"Helvetica Neue", Helvetica, sans-serif', label: "Helvetica Neue", category: "System" },
  { value: '"Avenir Next", Avenir, sans-serif', label: "Avenir Next", category: "System" },
  { value: '"Segoe UI", sans-serif', label: "Segoe UI", category: "System" },

  // Modern Sans (Google Fonts)
  { value: '"Inter", sans-serif', label: "Inter", category: "Modern Sans", googleFamily: "Inter" },
  { value: '"Geist", sans-serif', label: "Geist", category: "Modern Sans", googleFamily: "Geist" },
  { value: '"Plus Jakarta Sans", sans-serif', label: "Plus Jakarta Sans", category: "Modern Sans", googleFamily: "Plus Jakarta Sans" },
  { value: '"DM Sans", sans-serif', label: "DM Sans", category: "Modern Sans", googleFamily: "DM Sans" },
  { value: '"Instrument Sans", sans-serif', label: "Instrument Sans", category: "Modern Sans", googleFamily: "Instrument Sans" },
  { value: '"Manrope", sans-serif', label: "Manrope", category: "Modern Sans", googleFamily: "Manrope" },
  { value: '"Figtree", sans-serif', label: "Figtree", category: "Modern Sans", googleFamily: "Figtree" },
  { value: '"Onest", sans-serif', label: "Onest", category: "Modern Sans", googleFamily: "Onest" },
  { value: '"IBM Plex Sans", sans-serif', label: "IBM Plex Sans", category: "Modern Sans", googleFamily: "IBM Plex Sans" },
  { value: '"Source Sans 3", sans-serif', label: "Source Sans 3", category: "Modern Sans", googleFamily: "Source Sans 3" },
  { value: '"Public Sans", sans-serif', label: "Public Sans", category: "Modern Sans", googleFamily: "Public Sans" },
  { value: '"Outfit", sans-serif', label: "Outfit", category: "Modern Sans", googleFamily: "Outfit" },
  { value: '"Space Grotesk", sans-serif', label: "Space Grotesk", category: "Modern Sans", googleFamily: "Space Grotesk" },
  { value: '"Sora", sans-serif', label: "Sora", category: "Modern Sans", googleFamily: "Sora" },
  { value: '"Albert Sans", sans-serif', label: "Albert Sans", category: "Modern Sans", googleFamily: "Albert Sans" },
  { value: '"Bricolage Grotesque", sans-serif', label: "Bricolage Grotesque", category: "Modern Sans", googleFamily: "Bricolage Grotesque" },
  { value: '"Work Sans", sans-serif', label: "Work Sans", category: "Modern Sans", googleFamily: "Work Sans" },
  { value: '"Rubik", sans-serif', label: "Rubik", category: "Modern Sans", googleFamily: "Rubik" },
  { value: '"Roboto", sans-serif', label: "Roboto", category: "Modern Sans", googleFamily: "Roboto" },
  { value: '"Nunito Sans", sans-serif', label: "Nunito Sans", category: "Modern Sans", googleFamily: "Nunito Sans" },
  { value: '"Lato", sans-serif', label: "Lato", category: "Modern Sans", googleFamily: "Lato", weights: "400;700" },

  // Editorial / Serif
  { value: '"Newsreader", Georgia, serif', label: "Newsreader", category: "Editorial Serif", googleFamily: "Newsreader" },
  { value: '"Source Serif 4", Georgia, serif', label: "Source Serif 4", category: "Editorial Serif", googleFamily: "Source Serif 4" },
  { value: '"Literata", Georgia, serif', label: "Literata", category: "Editorial Serif", googleFamily: "Literata" },
  { value: '"Lora", Georgia, serif', label: "Lora", category: "Editorial Serif", googleFamily: "Lora" },
  { value: '"Merriweather", Georgia, serif', label: "Merriweather", category: "Editorial Serif", googleFamily: "Merriweather", weights: "400;700" },
  { value: "Georgia, serif", label: "Georgia", category: "Editorial Serif" },
]

export const CODE_FONT_OPTIONS: FontOption[] = [
  // System / Local
  { value: "", label: "System default", category: "System" },
  { value: '"SF Mono", SFMono-Regular, monospace', label: "SF Mono", category: "System" },
  { value: "Menlo, monospace", label: "Menlo", category: "System" },
  { value: '"Cascadia Code", monospace', label: "Cascadia Code", category: "System" },
  { value: '"Berkeley Mono", monospace', label: "Berkeley Mono", category: "System" },

  // Google Fonts Monospace
  { value: '"JetBrains Mono", monospace', label: "JetBrains Mono", category: "Code Mono", googleFamily: "JetBrains Mono" },
  { value: '"Geist Mono", monospace', label: "Geist Mono", category: "Code Mono", googleFamily: "Geist Mono" },
  { value: '"Fira Code", monospace', label: "Fira Code", category: "Code Mono", googleFamily: "Fira Code" },
  { value: '"IBM Plex Mono", monospace', label: "IBM Plex Mono", category: "Code Mono", googleFamily: "IBM Plex Mono" },
  { value: '"Source Code Pro", monospace', label: "Source Code Pro", category: "Code Mono", googleFamily: "Source Code Pro" },
  { value: '"Roboto Mono", monospace', label: "Roboto Mono", category: "Code Mono", googleFamily: "Roboto Mono" },
  { value: '"Inconsolata", monospace', label: "Inconsolata", category: "Code Mono", googleFamily: "Inconsolata" },
  { value: '"Martian Mono", monospace', label: "Martian Mono", category: "Code Mono", googleFamily: "Martian Mono" },
  { value: '"Victor Mono", monospace', label: "Victor Mono", category: "Code Mono", googleFamily: "Victor Mono" },
  { value: '"Red Hat Mono", monospace', label: "Red Hat Mono", category: "Code Mono", googleFamily: "Red Hat Mono" },
  { value: '"Space Mono", monospace', label: "Space Mono", category: "Code Mono", googleFamily: "Space Mono", weights: "400;700" },
  { value: '"Azeret Mono", monospace', label: "Azeret Mono", category: "Code Mono", googleFamily: "Azeret Mono" },
  { value: '"Spline Sans Mono", monospace', label: "Spline Sans Mono", category: "Code Mono", googleFamily: "Spline Sans Mono" },
  { value: '"Fragment Mono", monospace', label: "Fragment Mono", category: "Code Mono", googleFamily: "Fragment Mono", weights: "400" },
  { value: '"Ubuntu Mono", monospace', label: "Ubuntu Mono", category: "Code Mono", googleFamily: "Ubuntu Mono", weights: "400;700" },
  { value: '"Anonymous Pro", monospace', label: "Anonymous Pro", category: "Code Mono", googleFamily: "Anonymous Pro", weights: "400;700" },
]

const ALL_FONTS = [...INTERFACE_FONT_OPTIONS, ...CODE_FONT_OPTIONS]
const loadedFamilies = new Set<string>()

export function firstFontFamily(cssFont: string): string {
  return cssFont.split(",")[0]?.replace(/["']/g, "").trim().toLowerCase() ?? ""
}

export function matchFontOption(options: FontOption[], cssFont: string): FontOption | undefined {
  const trimmed = cssFont.trim()
  const primary = firstFontFamily(trimmed)
  return options.find(
    opt => opt.value === trimmed || (Boolean(opt.value) && Boolean(trimmed) && firstFontFamily(opt.value) === primary),
  )
}

function buildGoogleFontsHref(items: { family: string; weights: string }[]): string {
  const query = items
    .map(item => `family=${encodeURIComponent(item.family).replace(/%20/g, "+")}:wght@${item.weights}`)
    .join("&")
  return `https://fonts.googleapis.com/css2?${query}&display=swap`
}

function injectStylesheet(id: string, href: string): void {
  if (typeof document === "undefined" || !document.head) return
  if (document.getElementById(id)) return
  const link = document.createElement("link")
  link.id = id
  link.rel = "stylesheet"
  link.href = href
  document.head.appendChild(link)
}

/** Load a single Google Font on demand if the CSS font string matches our catalog. */
export function ensureGoogleFontLoaded(cssFont: string): void {
  if (!cssFont.trim() || typeof document === "undefined") return
  const primary = firstFontFamily(cssFont)
  const found = ALL_FONTS.find(opt => opt.googleFamily && firstFontFamily(opt.value) === primary)
  if (!found?.googleFamily) return
  if (loadedFamilies.has(found.googleFamily)) return
  loadedFamilies.add(found.googleFamily)
  const slug = found.googleFamily.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  injectStylesheet(`ade-gfont-${slug}`, buildGoogleFontsHref([{ family: found.googleFamily, weights: found.weights ?? "400;500;600;700" }]))
}

/** Batch-load preview weights for a font dropdown so each option renders in its actual typeface. */
export function preloadFontPreviews(options: FontOption[], groupKey: string): void {
  if (typeof document === "undefined") return
  const toLoad = options
    .filter((opt): opt is FontOption & { googleFamily: string } => Boolean(opt.googleFamily))
    .map(opt => ({ family: opt.googleFamily, weights: opt.weights === "400" ? "400" : "400;600" }))
  if (!toLoad.length) return
  // Google Fonts accepts batched family params in one lightweight CSS request
  injectStylesheet(`ade-gfont-preview-${groupKey}`, buildGoogleFontsHref(toLoad))
}
