import assert from "node:assert/strict"
import { test } from "node:test"
import {
  CATALOGS,
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  formatNumber,
  getCurrentLanguage,
  getLanguageMeta,
  isLanguageCode,
  setCurrentLanguage,
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
