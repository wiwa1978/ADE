/**
 * Regional formatting preferences (date format, time format, currency) and the helpers that apply
 * them. Like the active language, the preferences live in module state so plain helpers outside
 * React (e.g. `formatCost`) format consistently; `I18nProvider` keeps them in sync with Settings.
 */

export type DateFormatPreference = "auto" | "iso" | "dmy-dash" | "dmy-slash" | "dmy-dot" | "mdy-slash" | "d-mmm-y"
export type TimeFormatPreference = "auto" | "24h" | "12h"

export type FormatPreferences = {
  dateFormat: DateFormatPreference
  timeFormat: TimeFormatPreference
  /** ISO 4217 code of the preferred currency for money amounts. */
  currency: string
}

/** Date formats offered in Settings, in display order. `pattern` is a human hint, not a format string. */
export const DATE_FORMAT_OPTIONS: readonly { id: DateFormatPreference; pattern: string }[] = [
  { id: "auto", pattern: "" },
  { id: "iso", pattern: "YYYY-MM-DD" },
  { id: "dmy-dash", pattern: "DD-MM-YYYY" },
  { id: "dmy-slash", pattern: "DD/MM/YYYY" },
  { id: "dmy-dot", pattern: "DD.MM.YYYY" },
  { id: "mdy-slash", pattern: "MM/DD/YYYY" },
  { id: "d-mmm-y", pattern: "D MMM YYYY" },
]

export const TIME_FORMAT_OPTIONS: readonly TimeFormatPreference[] = ["auto", "24h", "12h"]

/** Currencies offered in Settings. Any valid ISO 4217 code is accepted by the helpers. */
export const CURRENCY_OPTIONS: readonly string[] = [
  "USD", "EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "CAD", "AUD", "NZD", "JPY", "CNY", "INR", "BRL",
]

export const DEFAULT_FORMAT_PREFERENCES: FormatPreferences = { dateFormat: "auto", timeFormat: "auto", currency: "USD" }

const DATE_FORMAT_IDS = new Set<string>(DATE_FORMAT_OPTIONS.map(option => option.id))

export function isDateFormatPreference(value: unknown): value is DateFormatPreference {
  return typeof value === "string" && DATE_FORMAT_IDS.has(value)
}

export function isTimeFormatPreference(value: unknown): value is TimeFormatPreference {
  return value === "auto" || value === "24h" || value === "12h"
}

/** True for a three-letter code that Intl accepts as a currency. */
export function isCurrencyCode(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) return false
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: value })
    return true
  } catch {
    return false
  }
}

let activePreferences: FormatPreferences = DEFAULT_FORMAT_PREFERENCES

export function getFormatPreferences(): FormatPreferences {
  return activePreferences
}

export function setFormatPreferences(preferences: Partial<FormatPreferences>): void {
  activePreferences = {
    dateFormat: isDateFormatPreference(preferences.dateFormat) ? preferences.dateFormat : activePreferences.dateFormat,
    timeFormat: isTimeFormatPreference(preferences.timeFormat) ? preferences.timeFormat : activePreferences.timeFormat,
    currency: isCurrencyCode(preferences.currency) ? preferences.currency : activePreferences.currency,
  }
}

const toDate = (value: Date | number | string) => value instanceof Date ? value : new Date(value)
const pad = (value: number) => String(value).padStart(2, "0")

/** A calendar date (no time) in the preferred format, e.g. 2026-11-24 or 24/11/2026. */
export function formatDateOnly(value: Date | number | string, locale: string, preferences: FormatPreferences = activePreferences): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ""
  const d = pad(date.getDate()), m = pad(date.getMonth() + 1), y = String(date.getFullYear())
  switch (preferences.dateFormat) {
    case "iso": return `${y}-${m}-${d}`
    case "dmy-dash": return `${d}-${m}-${y}`
    case "dmy-slash": return `${d}/${m}/${y}`
    case "dmy-dot": return `${d}.${m}.${y}`
    case "mdy-slash": return `${m}/${d}/${y}`
    case "d-mmm-y": return `${date.getDate()} ${new Intl.DateTimeFormat(locale, { month: "short" }).format(date).replace(/\.$/, "")} ${y}`
    default: return new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric" }).format(date)
  }
}

/** A time of day in the preferred 12/24-hour clock. */
export function formatTimeOnly(value: Date | number | string, locale: string, options: { seconds?: boolean } = {}, preferences: FormatPreferences = activePreferences): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ""
  const hourCycle = preferences.timeFormat === "24h" ? { hourCycle: "h23" as const } : preferences.timeFormat === "12h" ? { hourCycle: "h12" as const } : {}
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...(options.seconds ? { second: "2-digit" } : {}), ...hourCycle }).format(date)
}

/** Date and time, e.g. "24-11-2026 14:30". */
export function formatDateAndTime(value: Date | number | string, locale: string, options: { seconds?: boolean } = {}, preferences: FormatPreferences = activePreferences): string {
  const day = formatDateOnly(value, locale, preferences)
  return day ? `${day} ${formatTimeOnly(value, locale, options, preferences)}` : ""
}

/** A money amount in the given currency (the preferred one by default), with locale separators. */
export function formatMoney(amount: number, locale: string, currency: string = activePreferences.currency, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, ...options }).format(amount)
}
