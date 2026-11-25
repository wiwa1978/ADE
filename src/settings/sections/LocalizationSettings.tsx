import { SettingsRow, SettingsSection } from "@/components/ui"
import type { Settings } from "../../useSettings"
import {
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  SUPPORTED_LANGUAGES,
  TIME_FORMAT_OPTIONS,
  type DateFormatPreference,
  type LanguageCode,
  type TimeFormatPreference,
} from "../../i18n"
import { formatDateOnly } from "../../i18n/formatting"
import { useI18n } from "../../i18n/I18nContext"

const SAMPLE_LOCALE_DATE = new Date(2026, 10, 24, 14, 30)

/** "Euro" for EUR, in the display language. */
function currencyName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code
  } catch {
    return code
  }
}

export function LocalizationSettings({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}) {
  const { t, meta, locale, preferences, formatNumber, formatDay, formatDateTime, formatCurrency } = useI18n()

  return (
    <>
      <SettingsSection
        title={t("settings.localization.languageSection")}
        description={t("settings.localization.moreLanguagesNote")}
      >
        <SettingsRow
          title={t("settings.localization.displayLanguage")}
          description={t("settings.localization.displayLanguageDesc")}
          htmlFor="st-language-select"
        >
          <select
            id="st-language-select"
            className="st-select"
            aria-label={t("settings.localization.displayLanguage")}
            value={settings.language}
            onChange={event => update({ language: event.target.value as LanguageCode })}
          >
            {SUPPORTED_LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeName === lang.name ? lang.nativeName : `${lang.nativeName} (${lang.name})`}
              </option>
            ))}
          </select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("settings.localization.regionalSection")}>
        <SettingsRow
          title={t("settings.localization.activeLocale")}
          description={t("settings.localization.activeLocaleDesc")}
        >
          <span className="st-value">{meta.nativeName} ({meta.bcp47})</span>
        </SettingsRow>
        <SettingsRow title={t("settings.localization.sampleNumber")}>
          <span className="st-value">{formatNumber(1234567.89)}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("settings.localization.formatsSection")}>
        <SettingsRow
          title={t("settings.localization.dateFormat")}
          description={t("settings.localization.dateFormatDesc")}
          htmlFor="st-date-format"
        >
          <select
            id="st-date-format"
            className="st-select"
            value={settings.dateFormat}
            onChange={event => update({ dateFormat: event.target.value as DateFormatPreference })}
          >
            {DATE_FORMAT_OPTIONS.map(option => (
              <option key={option.id} value={option.id}>
                {option.id === "auto"
                  ? t("settings.localization.dateFormatAuto")
                  : `${option.pattern} (${formatDateOnly(SAMPLE_LOCALE_DATE, locale, { ...preferences, dateFormat: option.id })})`}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow
          title={t("settings.localization.timeFormat")}
          description={t("settings.localization.timeFormatDesc")}
          htmlFor="st-time-format"
        >
          <select
            id="st-time-format"
            className="st-select"
            value={settings.timeFormat}
            onChange={event => update({ timeFormat: event.target.value as TimeFormatPreference })}
          >
            {TIME_FORMAT_OPTIONS.map(option => (
              <option key={option} value={option}>
                {option === "auto"
                  ? t("settings.localization.timeFormatAuto")
                  : option === "24h"
                    ? t("settings.localization.time24h")
                    : t("settings.localization.time12h")}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow
          title={t("settings.localization.currency")}
          description={t("settings.localization.currencyDesc")}
          htmlFor="st-currency"
        >
          <select
            id="st-currency"
            className="st-select"
            value={settings.currency}
            onChange={event => update({ currency: event.target.value })}
          >
            {(CURRENCY_OPTIONS.includes(settings.currency) ? CURRENCY_OPTIONS : [settings.currency, ...CURRENCY_OPTIONS]).map(code => (
              <option key={code} value={code}>{code} · {currencyName(code, locale)}</option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow title={t("settings.localization.previewDate")}><span className="st-value">{formatDay(SAMPLE_LOCALE_DATE)}</span></SettingsRow>
        <SettingsRow title={t("settings.localization.previewTime")}><span className="st-value">{formatDateTime(SAMPLE_LOCALE_DATE)}</span></SettingsRow>
        <SettingsRow title={t("settings.localization.previewMoney")}><span className="st-value">{formatCurrency(1234.5)}</span></SettingsRow>
      </SettingsSection>
    </>
  )
}
