import { useEffect, useMemo, type ReactNode } from "react"
import { getLanguageMeta, setCurrentLanguage, setFormatPreferences, type DateFormatPreference, type LanguageCode, type TimeFormatPreference } from "./index"
import { I18nContext, makeContextValue } from "./I18nContext"

export function I18nProvider({
  language,
  dateFormat,
  timeFormat,
  currency,
  onChangeLanguage,
  children,
}: {
  language: LanguageCode
  dateFormat: DateFormatPreference
  timeFormat: TimeFormatPreference
  currency: string
  onChangeLanguage: (language: LanguageCode) => void
  children: ReactNode
}) {
  // Set synchronously so plain (non-hook) helpers format correctly during this render.
  setCurrentLanguage(language)
  setFormatPreferences({ dateFormat, timeFormat, currency })

  useEffect(() => {
    setCurrentLanguage(language)
    if (typeof document !== "undefined") {
      document.documentElement.lang = getLanguageMeta(language).bcp47
    }
  }, [language])

  const value = useMemo(
    () => makeContextValue(language, onChangeLanguage, { dateFormat, timeFormat, currency }),
    [language, onChangeLanguage, dateFormat, timeFormat, currency],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
