import { createContext, useContext } from "react"
import {
  DEFAULT_FORMAT_PREFERENCES,
  DEFAULT_LANGUAGE,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDay,
  formatNumber,
  formatRelativeTime,
  formatTime,
  getLanguageMeta,
  translate,
  type FormatPreferences,
  type LanguageCode,
  type LanguageMeta,
  type TranslationKey,
  type TranslationVars,
} from "./index"

export type I18nContextValue = {
  language: LanguageCode
  meta: LanguageMeta
  locale: string
  /** Date format, clock and currency chosen in Settings → Localization. */
  preferences: FormatPreferences
  setLanguage: (language: LanguageCode) => void
  t: (key: TranslationKey, vars?: TranslationVars) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  /** Raw Intl date formatting in the active locale; ignores the date-format preference. */
  formatDate: (date: Date | number, options?: Intl.DateTimeFormatOptions) => string
  /** A calendar date in the preferred date format. */
  formatDay: (date: Date | number | string) => string
  /** A time of day in the preferred clock. */
  formatTime: (date: Date | number | string, options?: { seconds?: boolean }) => string
  /** Date and time in the preferred formats. */
  formatDateTime: (date: Date | number | string, options?: { seconds?: boolean }) => string
  /** A money amount in the preferred currency, or in `currency` when given. */
  formatCurrency: (amount: number, currency?: string, options?: Intl.NumberFormatOptions) => string
  formatRelativeTime: (timestamp: number, now?: number) => string
}

/**
 * The helpers read the preferences from module state (set by I18nProvider before rendering);
 * `preferences` is part of the value so consumers re-render when they change.
 */
export function makeContextValue(
  language: LanguageCode,
  setLanguage: (language: LanguageCode) => void,
  preferences: FormatPreferences = DEFAULT_FORMAT_PREFERENCES,
): I18nContextValue {
  const meta = getLanguageMeta(language)
  return {
    language,
    meta,
    locale: meta.bcp47,
    preferences,
    setLanguage,
    t: (key, vars) => translate(language, key, vars),
    formatNumber: (value, options) => formatNumber(value, language, options),
    formatDate: (date, options) => formatDate(date, language, options),
    formatDay: date => formatDay(date, language),
    formatTime: (date, options) => formatTime(date, options, language),
    formatDateTime: (date, options) => formatDateTime(date, options, language),
    formatCurrency: (amount, currency, options) => formatCurrency(amount, currency, options, language),
    formatRelativeTime: (timestamp, now) => formatRelativeTime(timestamp, now, language),
  }
}

const defaultValue = makeContextValue(DEFAULT_LANGUAGE, () => undefined)

export const I18nContext = createContext<I18nContextValue>(defaultValue)

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
