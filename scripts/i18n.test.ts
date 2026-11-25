import assert from "node:assert/strict"
import { test } from "node:test"
import {
  CATALOGS,
  CURRENCY_OPTIONS,
  DEFAULT_FORMAT_PREFERENCES,
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  formatCurrency,
  formatDateTime,
  formatDay,
  formatNumber,
  formatRelativeTime,
  formatTime,
  getCurrentLanguage,
  getFormatPreferences,
  getLanguageMeta,
  isCurrencyCode,
  isDateFormatPreference,
  isLanguageCode,
  isTimeFormatPreference,
  setCurrentLanguage,
  setFormatPreferences,
  t,
  translate,
  type TranslationKey,
} from "../src/i18n/index.ts"

function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{([a-zA-Z0-9_]+)\}/g) ?? []
  return [...new Set(matches)].sort()
}

test("every supported language has a complete catalog matching English keys and placeholders", () => {
  const enKeys = Object.keys(CATALOGS.en).sort() as TranslationKey[]
  assert.ok(enKeys.length > 100, "Expected substantial English translation catalog")

  for (const meta of SUPPORTED_LANGUAGES) {
    const catalog = CATALOGS[meta.code]
    assert.ok(catalog, `Missing catalog for language ${meta.code}`)
    const keys = Object.keys(catalog).sort() as TranslationKey[]
    assert.deepEqual(keys, enKeys, `Key mismatch for language ${meta.code}`)

    for (const key of enKeys) {
      const value = catalog[key]
      assert.equal(typeof value, "string", `Expected string for ${meta.code}.${key}`)
      assert.ok(value.trim().length > 0, `Empty translation for ${meta.code}.${key}`)

      const enPlaceholders = extractPlaceholders(CATALOGS.en[key])
      const langPlaceholders = extractPlaceholders(value)
      assert.deepEqual(
        langPlaceholders,
        enPlaceholders,
        `Placeholder mismatch for ${meta.code}.${key}: expected ${enPlaceholders.join(", ")}, got ${langPlaceholders.join(", ")}`,
      )
    }
  }
})

test("English and Dutch translations resolve and interpolate correctly", () => {
  assert.equal(isLanguageCode("en"), true)
  assert.equal(isLanguageCode("nl"), true)
  assert.equal(isLanguageCode("fr"), false)
  assert.equal(getLanguageMeta("nl").bcp47, "nl-NL")
  assert.equal(getLanguageMeta("en").bcp47, "en-US")

  assert.equal(translate("en", "settings.cat.localization.label"), "Localization")
  assert.equal(translate("nl", "settings.cat.localization.label"), "Lokalisatie")
  assert.equal(translate("en", "settings.searchEmpty", { query: "theme" }), "No settings match “theme”.")
  assert.equal(translate("nl", "settings.searchEmpty", { query: "thema" }), "Geen instellingen gevonden voor “thema”.")

  setCurrentLanguage("nl")
  assert.equal(getCurrentLanguage(), "nl")
  assert.equal(t("settings.title"), "Instellingen")
  assert.equal(t("sidebar.projects"), "Projecten")

  setCurrentLanguage(DEFAULT_LANGUAGE)
  assert.equal(getCurrentLanguage(), "en")
  assert.equal(t("settings.title"), "Settings")
})

test("number formatting respects active locale", () => {
  assert.equal(formatNumber(1234.5, "en"), "1,234.5")
  assert.equal(formatNumber(1234.5, "nl"), "1.234,5")
})

test("date, time, and currency formatting preferences validate and format consistently", () => {
  try {
    assert.equal(isDateFormatPreference("iso"), true)
    assert.equal(isDateFormatPreference("dmy-dash"), true)
    assert.equal(isDateFormatPreference("invalid"), false)
    assert.equal(isTimeFormatPreference("24h"), true)
    assert.equal(isTimeFormatPreference("12h"), true)
    assert.equal(isTimeFormatPreference("25h"), false)

    for (const code of CURRENCY_OPTIONS) {
      assert.equal(isCurrencyCode(code), true, `Expected valid currency code: ${code}`)
    }
    assert.equal(isCurrencyCode("usd"), false)
    assert.equal(isCurrencyCode("US"), false)
    assert.equal(isCurrencyCode("ZZZ1"), false)

    const sample = new Date(2026, 10, 24, 14, 5, 9) // 2026-11-24 14:05:09 local time

    setFormatPreferences({ dateFormat: "iso", timeFormat: "24h", currency: "EUR" })
    assert.deepEqual(getFormatPreferences(), { dateFormat: "iso", timeFormat: "24h", currency: "EUR" })
    assert.equal(formatDay(sample, "en"), "2026-11-24")
    assert.equal(formatTime(sample, undefined, "en"), "14:05")
    assert.equal(formatTime(sample, { seconds: true }, "en"), "14:05:09")
    assert.equal(formatDateTime(sample, undefined, "en"), "2026-11-24 14:05")

    setFormatPreferences({ dateFormat: "dmy-dash" })
    assert.equal(formatDay(sample, "en"), "24-11-2026")

    setFormatPreferences({ dateFormat: "dmy-slash" })
    assert.equal(formatDay(sample, "en"), "24/11/2026")

    setFormatPreferences({ dateFormat: "dmy-dot" })
    assert.equal(formatDay(sample, "en"), "24.11.2026")

    setFormatPreferences({ dateFormat: "mdy-slash" })
    assert.equal(formatDay(sample, "en"), "11/24/2026")

    setFormatPreferences({ dateFormat: "d-mmm-y" })
    assert.equal(formatDay(sample, "en"), "24 Nov 2026")
    assert.equal(formatDay(sample, "nl").toLowerCase(), "24 nov 2026")

    setFormatPreferences({ timeFormat: "12h" })
    assert.match(formatTime(sample, undefined, "en"), /0?2:05\s*PM/i)

    // Invalid preference updates are ignored without corrupting state
    setFormatPreferences({ dateFormat: "nope" as never, timeFormat: "nope" as never, currency: "bad" })
    assert.equal(getFormatPreferences().currency, "EUR")
    assert.equal(formatDay("not-a-date", "en"), "")

    // Currency formatting follows preferred currency by default and accepts explicit overrides
    const eurEn = formatCurrency(1234.5, undefined, undefined, "en")
    const eurNl = formatCurrency(1234.5, undefined, undefined, "nl")
    assert.ok(eurEn.includes("€") && eurEn.includes("1,234.50"), `Unexpected EN EUR format: ${eurEn}`)
    assert.ok(eurNl.includes("€") && eurNl.includes("1.234,50"), `Unexpected NL EUR format: ${eurNl}`)

    const usdOverride = formatCurrency(42, "USD", undefined, "en")
    assert.ok(usdOverride.includes("$") && usdOverride.includes("42.00"), `Unexpected USD override: ${usdOverride}`)

    // Relative time older than 24h uses preferred date format
    setFormatPreferences({ dateFormat: "iso" })
    const twoDaysLater = sample.getTime() + 2 * 86_400_000
    assert.equal(formatRelativeTime(sample.getTime(), twoDaysLater, "en"), "2026-11-24")
  } finally {
    setFormatPreferences(DEFAULT_FORMAT_PREFERENCES)
    setCurrentLanguage(DEFAULT_LANGUAGE)
  }
})
