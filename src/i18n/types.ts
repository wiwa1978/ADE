export type LanguageCode = "en" | "nl"

export type LanguageMeta = {
  code: LanguageCode
  /** English name of the language (e.g. "Dutch"). */
  name: string
  /** Native name of the language (e.g. "Nederlands"). */
  nativeName: string
  /** BCP 47 locale tag used for Intl formatting and <html lang>. */
  bcp47: string
}

export const SUPPORTED_LANGUAGES: readonly LanguageMeta[] = [
  { code: "en", name: "English", nativeName: "English", bcp47: "en-US" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", bcp47: "nl-NL" },
] as const

export const DEFAULT_LANGUAGE: LanguageCode = "en"

const SUPPORTED_CODES = new Set<string>(SUPPORTED_LANGUAGES.map(l => l.code))

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && SUPPORTED_CODES.has(value)
}

export function getLanguageMeta(code: LanguageCode): LanguageMeta {
  return SUPPORTED_LANGUAGES.find(l => l.code === code) ?? SUPPORTED_LANGUAGES[0]
}
