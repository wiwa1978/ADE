import { en, type TranslationKey } from "./locales/en.ts"
import { nl } from "./locales/nl.ts"
import { formatDateAndTime, formatDateOnly, formatMoney, formatTimeOnly } from "./formatting.ts"
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  getLanguageMeta,
  isLanguageCode,
  type LanguageCode,
  type LanguageMeta,
} from "./types.ts"

export {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  getLanguageMeta,
  isLanguageCode,
  type LanguageCode,
  type LanguageMeta,
  type TranslationKey,
}
export {
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  DEFAULT_FORMAT_PREFERENCES,
  TIME_FORMAT_OPTIONS,
  getFormatPreferences,
  isCurrencyCode,
  isDateFormatPreference,
  isTimeFormatPreference,
  setFormatPreferences,
  type DateFormatPreference,
  type FormatPreferences,
  type TimeFormatPreference,
} from "./formatting.ts"

export type TranslationVars = Record<string, string | number>

export const CATALOGS: Record<LanguageCode, Record<TranslationKey, string>> = {
  en,
  nl,
}

let activeLanguage: LanguageCode = DEFAULT_LANGUAGE

export function getCurrentLanguage(): LanguageCode {
  return activeLanguage
}

export function setCurrentLanguage(language: LanguageCode): void {
  activeLanguage = isLanguageCode(language) ? language : DEFAULT_LANGUAGE
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

/** Translate a key for a specific language with fallback to English. */
export function translate(language: LanguageCode, key: TranslationKey, vars?: TranslationVars): string {
  const catalog = CATALOGS[language] ?? CATALOGS[DEFAULT_LANGUAGE]
  const template = catalog[key] ?? en[key] ?? key
  return interpolate(template, vars)
}

/** Translate a key using the currently active language. */
export function t(key: TranslationKey, vars?: TranslationVars): string {
  return translate(activeLanguage, key, vars)
}

export function formatNumber(value: number, language: LanguageCode = activeLanguage, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLanguageMeta(language).bcp47, options).format(value)
}

export function formatDate(date: Date | number, language: LanguageCode = activeLanguage, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(getLanguageMeta(language).bcp47, options).format(typeof date === "number" ? new Date(date) : date)
}

export function formatRelativeTime(timestamp: number, now: number = Date.now(), language: LanguageCode = activeLanguage): string {
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (diffSec < 45) return translate(language, "common.justNow")
  if (diffSec < 3600) return translate(language, "common.minutesAgo", { count: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return translate(language, "common.hoursAgo", { count: Math.floor(diffSec / 3600) })
  return formatDay(timestamp, language)
}

// --- Preference-aware formatting (date format, 12/24-hour clock, currency from Settings) ---

/** A calendar date in the user's preferred date format. */
export function formatDay(date: Date | number | string, language: LanguageCode = activeLanguage): string {
  return formatDateOnly(date, getLanguageMeta(language).bcp47)
}

/** A time of day in the user's preferred clock. */
export function formatTime(date: Date | number | string, options?: { seconds?: boolean }, language: LanguageCode = activeLanguage): string {
  return formatTimeOnly(date, getLanguageMeta(language).bcp47, options)
}

/** Date and time in the user's preferred formats. */
export function formatDateTime(date: Date | number | string, options?: { seconds?: boolean }, language: LanguageCode = activeLanguage): string {
  return formatDateAndTime(date, getLanguageMeta(language).bcp47, options)
}

/** A money amount; uses the preferred currency unless `currency` is given (e.g. "USD" for provider costs). */
export function formatCurrency(amount: number, currency?: string, options?: Intl.NumberFormatOptions, language: LanguageCode = activeLanguage): string {
  return formatMoney(amount, getLanguageMeta(language).bcp47, currency, options)
}
