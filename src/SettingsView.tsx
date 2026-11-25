import { useEffect, useMemo, useState, type FormEvent } from "react"
import { ArrowLeft } from "lucide-react"
import { Banner, SearchInput, SettingsRow, SettingsSection } from "@/components/ui"
import { requestJson } from "./api"
import { UsageSettings } from "./usage/UsageSettings"
import { IntegrationsSettings } from "./integrations/IntegrationsSettings"
import { SubagentSettings } from "./subagents/SubagentSettings"
import { ProvidersPanel } from "./settings/ProvidersPanel"
import { MobilePairingSection } from "./settings/MobilePairingSection"
import { EuOnlySettings } from "./settings/EuOnlySettings"
import { SkillsToolsSettings } from "./settings/SkillsToolsSettings"
import { GeneralSettings } from "./settings/sections/GeneralSettings"
import { AppearanceSettings } from "./settings/sections/AppearanceSettings"
import { AgentsSettings } from "./settings/sections/AgentsSettings"
import { GitHubSettings } from "./settings/sections/GitHubSettings"
import { TerminalSettings } from "./settings/sections/TerminalSettings"
import { NotificationsSettings } from "./settings/sections/NotificationsSettings"
import { EnvironmentsSettingsSection } from "./settings/sections/EnvironmentsSettingsSection"
import {
  REASONING_LEVEL_IDS,
  SETTINGS_GROUP_SPECS,
  type SettingsCategory,
  type SettingsViewProps,
} from "./settings/sections/settings-nav"
import {
  CURRENCY_OPTIONS, DATE_FORMAT_OPTIONS, SUPPORTED_LANGUAGES, TIME_FORMAT_OPTIONS,
  type DateFormatPreference, type LanguageCode, type TimeFormatPreference, type TranslationKey,
} from "./i18n"
import { formatDateOnly } from "./i18n/formatting"
import { useI18n } from "./i18n/I18nContext"

export type { SettingsCategory }

const SAMPLE_LOCALE_DATE = new Date(2026, 10, 24, 14, 30)

/** "Euro" for EUR, in the display language. */
function currencyName(code: string, locale: string) {
  try { return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code } catch { return code }
}

export function SettingsView({
  settings, resolved, error, runtimeError, runtime, selectedModel, selectedProvider, modelCatalog,
  sending, credentialChangesBlocked, connections, activeEnvironmentName, update, onBack, onWorktreeDiagnostics,
  onEnvironmentChanged, onModelsChanged, mcpServers = [], approvalPolicy = "auto-safe", approvalRules = [], browserState,
  skillsCatalog, onRefreshMcp, onChangeApprovalPolicy, onDeleteApprovalRule, onAddApprovalRule, initialCategory, autoOpenAddEnvironment = false,
  projects, sessionLabels = {},
}: SettingsViewProps) {
  const { t, meta, locale, preferences, formatNumber, formatDay, formatDateTime, formatCurrency } = useI18n()
  const [userSelection, setUserSelection] = useState<{ base: SettingsCategory | undefined; category: SettingsCategory } | null>(null)
  const selectedCategory: SettingsCategory =
    userSelection && userSelection.base === initialCategory ? userSelection.category : (initialCategory ?? "general")
  const setSelectedCategory = (category: SettingsCategory) => setUserSelection({ base: initialCategory, category })

  const [query, setQuery] = useState("")
  const [compatible, setCompatible] = useState<{ url: string; model: string; fromEnvironment: boolean } | null>(null)
  const [compatibleDraft, setCompatibleDraft] = useState({ url: "", model: "" })
  const [compatibleBusy, setCompatibleBusy] = useState(false)
  const [compatibleMessage, setCompatibleMessage] = useState("")

  useEffect(() => {
    if (selectedCategory !== "models") return
    let cancelled = false
    void requestJson<{ compatible?: { url: string; model: string; fromEnvironment: boolean } }>("/api/model-credentials", "POST", { action: "status" }).then(result => {
      if (cancelled || !result.compatible) return
      setCompatible(result.compatible)
      setCompatibleDraft({ url: result.compatible.url, model: result.compatible.model })
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedCategory])

  const groups = useMemo(() => SETTINGS_GROUP_SPECS.map(group => ({
    label: t(group.labelKey),
    items: group.items.map(item => ({
      id: item.id,
      label: t(item.labelKey),
      icon: item.icon,
      description: t(item.descKey),
      keywords: item.keywords,
    })),
  })), [t])
  const allItems = useMemo(() => groups.flatMap(group => group.items), [groups])
  const reasoningLevels = useMemo(() => REASONING_LEVEL_IDS.map(id => ({
    id,
    label: t(`settings.reasoning.${id}` as TranslationKey),
  })), [t])
  const selected = allItems.find(item => item.id === selectedCategory) ?? allItems[0]
  const disabled = sending || credentialChangesBlocked || connections.authBusy || connections.githubConnectionBusy || Boolean(connections.modelCredentialBusy)

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map(group => ({ ...group, items: group.items.filter(item => `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(q)) }))
      .filter(group => group.items.length)
  }, [groups, query])

  const saveCompatible = async (event: FormEvent) => {
    event.preventDefault()
    setCompatibleBusy(true)
    setCompatibleMessage("")
    try {
      const result = await requestJson<{ compatible: { url: string; model: string; fromEnvironment: boolean } }>("/api/model-credentials", "POST", { action: "configure-compatible", url: compatibleDraft.url, model: compatibleDraft.model })
      setCompatible(result.compatible)
      setCompatibleMessage(t("common.saved"))
      onModelsChanged?.()
    } catch (cause) {
      setCompatibleMessage(cause instanceof Error ? cause.message : t("settings.compatible.saveError"))
    } finally {
      setCompatibleBusy(false)
    }
  }

  function renderCategory(category: SettingsCategory) {
    switch (category) {
      case "general": return <GeneralSettings settings={settings} update={update} />
      case "appearance": return <AppearanceSettings settings={settings} resolved={resolved} update={update} />
      case "localization":
        return (
          <>
            <SettingsSection title={t("settings.localization.languageSection")} description={t("settings.localization.moreLanguagesNote")}>
              <SettingsRow title={t("settings.localization.displayLanguage")} description={t("settings.localization.displayLanguageDesc")} htmlFor="st-language-select">
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
              <SettingsRow title={t("settings.localization.activeLocale")} description={t("settings.localization.activeLocaleDesc")}>
                <span className="st-value">{meta.nativeName} ({meta.bcp47})</span>
              </SettingsRow>
              <SettingsRow title={t("settings.localization.sampleNumber")}>
                <span className="st-value">{formatNumber(1234567.89)}</span>
              </SettingsRow>
            </SettingsSection>
            <SettingsSection title={t("settings.localization.formatsSection")}>
              <SettingsRow title={t("settings.localization.dateFormat")} description={t("settings.localization.dateFormatDesc")} htmlFor="st-date-format">
                <select id="st-date-format" className="st-select" value={settings.dateFormat} onChange={event => update({ dateFormat: event.target.value as DateFormatPreference })}>
                  {DATE_FORMAT_OPTIONS.map(option => (
                    <option key={option.id} value={option.id}>{option.id === "auto" ? t("settings.localization.dateFormatAuto") : `${option.pattern} (${formatDateOnly(SAMPLE_LOCALE_DATE, locale, { ...preferences, dateFormat: option.id })})`}</option>
                  ))}
                </select>
              </SettingsRow>
              <SettingsRow title={t("settings.localization.timeFormat")} description={t("settings.localization.timeFormatDesc")} htmlFor="st-time-format">
                <select id="st-time-format" className="st-select" value={settings.timeFormat} onChange={event => update({ timeFormat: event.target.value as TimeFormatPreference })}>
                  {TIME_FORMAT_OPTIONS.map(option => (
                    <option key={option} value={option}>{option === "auto" ? t("settings.localization.timeFormatAuto") : option === "24h" ? t("settings.localization.time24h") : t("settings.localization.time12h")}</option>
                  ))}
                </select>
              </SettingsRow>
              <SettingsRow title={t("settings.localization.currency")} description={t("settings.localization.currencyDesc")} htmlFor="st-currency">
                <select id="st-currency" className="st-select" value={settings.currency} onChange={event => update({ currency: event.target.value })}>
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
      case "models":
        return (
          <ProvidersPanel
            activeEnvironmentName={activeEnvironmentName}
            modelCatalog={modelCatalog}
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            reasoning={settings.reasoning}
            reasoningLevels={reasoningLevels}
            runtime={runtime}
            connections={connections}
            sending={sending}
            credentialChangesBlocked={credentialChangesBlocked}
            compatible={compatible}
            compatibleDraft={compatibleDraft}
            compatibleBusy={compatibleBusy}
            compatibleMessage={compatibleMessage}
            onCompatibleDraftChange={setCompatibleDraft}
            onSaveCompatible={saveCompatible}
            onSelectDefaultProvider={providerId => update({ provider: providerId, model: "" })}
            onSelectDefaultModel={(providerId, modelId) => update({ provider: providerId, model: modelId })}
            onSelectReasoning={level => update({ reasoning: level })}
            onModelsChanged={onModelsChanged}
          />
        )
      case "agents":
        return (
          <AgentsSettings
            browserState={browserState}
            skillsCatalog={skillsCatalog}
            modelCatalog={modelCatalog}
            approvalPolicy={approvalPolicy}
            approvalRules={approvalRules}
            onRefreshMcp={onRefreshMcp}
            onChangeApprovalPolicy={onChangeApprovalPolicy}
            onDeleteApprovalRule={onDeleteApprovalRule}
            onAddApprovalRule={onAddApprovalRule}
          />
        )
      case "skills": return <SkillsToolsSettings projects={projects} activeEnvironmentName={activeEnvironmentName} onRefreshMcp={onRefreshMcp} />
      case "github": return <GitHubSettings settings={settings} connections={connections} update={update} />
      case "terminal": return <TerminalSettings settings={settings} update={update} />
      case "notifications": return <NotificationsSettings settings={settings} update={update} />
      case "environments":
        return (
          <EnvironmentsSettingsSection
            activeEnvironmentName={activeEnvironmentName}
            runtime={runtime}
            runtimeError={runtimeError}
            mcpServers={mcpServers}
            disabled={disabled}
            autoOpenAddEnvironment={autoOpenAddEnvironment}
            onEnvironmentChanged={onEnvironmentChanged}
            onWorktreeDiagnostics={onWorktreeDiagnostics}
          />
        )
      case "usage": return <UsageSettings budget={settings.monthlyBudget} onBudgetChange={value => update({ monthlyBudget: value })} projects={projects} sessionLabels={sessionLabels} />
      case "integrations": return <IntegrationsSettings />
      case "subagents": return <SubagentSettings modelCatalog={modelCatalog} />
      case "mobile": return <MobilePairingSection />
    }
  }

  return (
    <main className="st-layout">
      <aside className="st-nav" aria-label={t("settings.navAria")}>
        <button type="button" className="st-back" onClick={onBack}><ArrowLeft size={14} /> {t("settings.backToApp")}</button>
        <SearchInput
          value={query}
          onValueChange={setQuery}
          onKeyDown={event => {
            if (event.key === "Enter" && visibleGroups[0]?.items[0]) setSelectedCategory(visibleGroups[0].items[0].id)
          }}
          placeholder={t("settings.searchPlaceholder")}
          aria-label={t("settings.searchPlaceholder")}
        />
        <nav className="st-nav-groups">
          {visibleGroups.map(group => (
            <div key={group.label} className="st-nav-group">
              <span className="st-nav-label">{group.label}</span>
              {group.items.map(item => {
                const Icon = item.icon
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`st-nav-item ${selectedCategory === item.id ? "is-active" : ""}`}
                    aria-current={selectedCategory === item.id ? "page" : undefined}
                    onClick={() => setSelectedCategory(item.id)}
                  >
                    <Icon size={15} /><span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
          {!visibleGroups.length ? <p className="st-nav-empty">{t("settings.searchEmpty", { query })}</p> : null}
        </nav>
        <div className="st-nav-host"><span className={`st-dot ${runtime?.online ? "is-ok" : "is-off"}`} />{activeEnvironmentName}</div>
      </aside>
      <section className="st-main">
        <header className="st-topbar"><span>{t("settings.title")}</span><span aria-hidden="true">/</span><strong>{selected.label}</strong></header>
        <div className="st-scroll">
          <div className={`st-content ${selectedCategory === "models" ? "is-wide" : ""}`}>
            <h1>{selected.label}</h1>
            <p className="st-lede">{selected.description}</p>
            {error ? <Banner tone="error">{error}</Banner> : null}
            {runtimeError && !runtime?.online ? <Banner tone="error">{runtimeError}</Banner> : null}
            {selectedCategory === "models" ? <EuOnlySettings /> : null}
            {renderCategory(selectedCategory)}
          </div>
        </div>
      </section>
    </main>
  )
}
