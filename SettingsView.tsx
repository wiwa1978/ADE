import { EuOnlySettings } from "./src/settings/EuOnlySettings"
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import {
  ArrowLeft, Bell, Blocks, Bot, Workflow, Check, Gauge, GitPullRequest, Globe, Palette, Pipette, Puzzle, Search, Server, Settings2, Smartphone, Sparkles, Terminal, X, type LucideIcon,
} from "lucide-react"
import { EnvironmentSettings } from "./EnvironmentSettings"
import {
  accentDisplayName, accentPresets, colorPalettes, contrastForegroundHex, lookPresets, normalizeHexColor, paletteVariables, resolveAccentHex, type Theme,
} from "./appearance-palettes"
import type { ApprovalPolicy, ApprovalRule, BrowserState, EnvironmentDirectory, McpServerStatus, ProviderCatalogEntry, RuntimeHealth, SkillsAndRulesCatalog } from "./app-types"
import type { Project } from "./ProjectsView"
import type { Settings } from "./useSettings"
import type { useConnections } from "./useConnections"
import { McpAndSecuritySettings } from "./src/panels/McpSettingsSection"
import { SkillsToolsSettings } from "./src/settings/SkillsToolsSettings"
import { request } from "./api"
import { UsageSettings } from "./src/usage/UsageSettings"
import { IntegrationsSettings } from "./src/integrations/IntegrationsSettings"
import { CODE_FONT_OPTIONS, INTERFACE_FONT_OPTIONS } from "./src/appearance/fonts"
import { FontPicker } from "./src/appearance/FontPicker"
import { SubagentSettings } from "./src/subagents/SubagentSettings"
import { ProvidersPanel } from "./src/settings/ProvidersPanel"
import { KeybindingsSection } from "./src/settings/KeybindingsSection"
import { MobilePairingSection } from "./src/settings/MobilePairingSection"
import { OvernightSettings } from "./src/subagents/OvernightSettings"
import {
  CURRENCY_OPTIONS, DATE_FORMAT_OPTIONS, SUPPORTED_LANGUAGES, TIME_FORMAT_OPTIONS,
  type DateFormatPreference, type LanguageCode, type TimeFormatPreference, type TranslationKey,
} from "./src/i18n"
import { formatDateOnly } from "./src/i18n/formatting"
import { useI18n } from "./src/i18n/I18nContext"

/** Settings categories. Every category here changes something real; nothing is a placeholder. */
export type SettingsCategory =
  | "general" | "appearance" | "localization" | "models" | "agents" | "skills" | "usage" | "subagents" | "integrations" | "github" | "terminal" | "notifications" | "environments" | "mobile"

type SettingsItemSpec = { id: SettingsCategory; labelKey: TranslationKey; icon: LucideIcon; descKey: TranslationKey; keywords: string }

const groupSpecs: { labelKey: TranslationKey; items: SettingsItemSpec[] }[] = [
  {
    labelKey: "settings.group.workspace",
    items: [
      { id: "general", labelKey: "settings.cat.general.label", icon: Settings2, descKey: "settings.cat.general.desc", keywords: "worktree checkout branch archive startup restore shortcuts keybindings keyboard hotkeys algemeen sneltoetsen archiveren" },
      { id: "terminal", labelKey: "settings.cat.terminal.label", icon: Terminal, descKey: "settings.cat.terminal.desc", keywords: "shell font scrollback auto start lettergrootte" },
      { id: "notifications", labelKey: "settings.cat.notifications.label", icon: Bell, descKey: "settings.cat.notifications.desc", keywords: "alert finished approval desktop meldingen notificaties" },
      { id: "integrations", labelKey: "settings.cat.integrations.label", icon: Blocks, descKey: "settings.cat.integrations.desc", keywords: "slack linear webhook notify issues jira integraties" },
    ],
  },
  {
    labelKey: "settings.group.ai",
    items: [
      { id: "models", labelKey: "settings.cat.models.label", icon: Sparkles, descKey: "settings.cat.models.desc", keywords: "openai anthropic claude copilot codex pi cursor opencode radius ollama compatible api key provider reasoning models" },
      { id: "agents", labelKey: "settings.cat.agents.label", icon: Bot, descKey: "settings.cat.agents.desc", keywords: "approval policy autopilot ask mcp skills rules permissions browser chrome limit cost budget overnight usage limit fallback queue concurrent rechten goedkeuringen" },
      { id: "skills", labelKey: "settings.cat.skills.label", icon: Puzzle, descKey: "settings.cat.skills.desc", keywords: "skill skills mcp tool server tools git repository import trust claude codex cursor gemini .mcp.json vaardigheden toolservers" },
      { id: "subagents", labelKey: "settings.cat.subagents.label", icon: Workflow, descKey: "settings.cat.subagents.desc", keywords: "harness claude code codex pi durable subagent model delegate" },
      { id: "usage", labelKey: "settings.cat.usage.label", icon: Gauge, descKey: "settings.cat.usage.desc", keywords: "cost spend tokens budget billing price money verbruik kosten" },
    ],
  },
  {
    labelKey: "settings.group.sourceControl",
    items: [
      { id: "github", labelKey: "settings.cat.github.label", icon: GitPullRequest, descKey: "settings.cat.github.desc", keywords: "gh cli pull request draft account" },
    ],
  },
  {
    labelKey: "settings.group.interface",
    items: [
      { id: "appearance", labelKey: "settings.cat.appearance.label", icon: Palette, descKey: "settings.cat.appearance.desc", keywords: "dark light theme accent color icon tint palette font size width syntax weergave thema kleur lettertype" },
      { id: "localization", labelKey: "settings.cat.localization.label", icon: Globe, descKey: "settings.cat.localization.desc", keywords: "language locale localization region translation english dutch nederlands engels taal lokalisatie regio vertaling date format time clock 12-hour 24-hour currency money euro dollar datum tijd klok valuta munteenheid" },
    ],
  },
  {
    labelKey: "settings.group.hosts",
    items: [
      { id: "environments", labelKey: "settings.cat.environments.label", icon: Server, descKey: "settings.cat.environments.desc", keywords: "ssh remote host diagnostics worktrees about version omgevingen diagnostiek" },
      { id: "mobile", labelKey: "settings.cat.mobile.label", icon: Smartphone, descKey: "settings.cat.mobile.desc", keywords: "iphone android phone mobile qr code pair remote tailscale tunnel pwa telefoon mobiel koppelen" },
    ],
  },
]

const reasoningLevelIds = ["none", "low", "medium", "high", "xhigh", "max"] as const
const SAMPLE_LOCALE_DATE = new Date(2026, 10, 24, 14, 30)

/** "Euro" for EUR, in the display language. */
function currencyName(code: string, locale: string) {
  try { return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code } catch { return code }
}

type SettingsViewProps = {
  settings: Settings
  resolved: Exclude<Theme, "system">
  error: string
  runtimeError: string
  runtime: RuntimeHealth | null
  matchingRuntime: RuntimeHealth | null
  providerName: string | undefined
  selectedModel: string
  selectedProvider: string
  modelCatalog: ProviderCatalogEntry[]
  sending: boolean
  credentialChangesBlocked: boolean
  connections: ReturnType<typeof useConnections>
  projects: Project[]
  /** Session names for the usage breakdown. */
  sessionLabels?: Record<string, string>
  activeEnvironmentName: string
  update: (patch: Partial<Settings>) => void
  onBack: () => void
  onOpenProjects: () => void
  onWorktreeDiagnostics: () => void
  onEnvironmentChanged: (activeId: string, activeName: string, directory: EnvironmentDirectory) => void
  onModelsChanged?: () => void
  mcpServers?: McpServerStatus[]
  approvalPolicy?: ApprovalPolicy
  approvalRules?: ApprovalRule[]
  browserState?: BrowserState
  skillsCatalog?: SkillsAndRulesCatalog
  onRefreshMcp?: () => void
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => Promise<void>
  onDeleteApprovalRule?: (id: string) => Promise<void>
  onAddApprovalRule?: (prefix: string, effect: "allow" | "deny") => Promise<void>
  initialCategory?: SettingsCategory
  autoOpenAddEnvironment?: boolean
}

// --- Building blocks -------------------------------------------------------------------------------

type TextDraft = { interfaceFont: string; codeFont: string; interfaceSize: string; contentSize: string; codeSize: string; contentWidth: string }

function textFromSettings(settings: Settings): TextDraft {
  return {
    interfaceFont: settings.interfaceFont, codeFont: settings.codeFont,
    interfaceSize: String(settings.interfaceSize), contentSize: String(settings.contentSize),
    codeSize: String(settings.codeSize), contentWidth: String(settings.contentWidth),
  }
}

function sameText(a: TextDraft, b: TextDraft) {
  return (Object.keys(a) as Array<keyof TextDraft>).every(key => a[key].trim() === b[key].trim())
}

function Section({ title, description, children, plain = false }: { title: string; description?: ReactNode; children: ReactNode; plain?: boolean }) {
  return <section className="st-section">
    <h2>{title}</h2>
    {description ? <p className="st-section-desc">{description}</p> : null}
    {plain ? children : <div className="st-card">{children}</div>}
  </section>
}

function Row({ title, description, children, htmlFor, stacked = false }: { title: ReactNode; description?: ReactNode; children?: ReactNode; htmlFor?: string; stacked?: boolean }) {
  return <div className={`st-row ${stacked ? "is-stacked" : ""}`}>
    <div className="st-row-text">
      {htmlFor ? <label htmlFor={htmlFor}>{title}</label> : <span className="st-row-title">{title}</span>}
      {description ? <p>{description}</p> : null}
    </div>
    {children ? <div className="st-row-control">{children}</div> : null}
  </div>
}

function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`st-switch ${checked ? "is-on" : ""}`} onClick={() => onChange(!checked)}><span /></button>
}

function Status({ tone, children }: { tone: "ok" | "off" | "warn" | "error"; children: ReactNode }) {
  return <span className={`st-status is-${tone}`}><i aria-hidden="true" />{children}</span>
}

function notificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission
}

// --- View ------------------------------------------------------------------------------------------

export function SettingsView({
  settings, resolved, error, runtimeError, runtime, selectedModel, selectedProvider, modelCatalog,
  sending, credentialChangesBlocked, connections, activeEnvironmentName, update, onBack, onWorktreeDiagnostics,
  onEnvironmentChanged, onModelsChanged, mcpServers = [], approvalPolicy = "auto-safe", approvalRules = [], browserState,
  skillsCatalog, onRefreshMcp, onChangeApprovalPolicy, onDeleteApprovalRule, onAddApprovalRule, initialCategory, autoOpenAddEnvironment = false,
  projects, sessionLabels = {},
}: SettingsViewProps) {
  const { t, meta, locale, preferences, formatNumber, formatDay, formatDateTime, formatCurrency } = useI18n()
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>(initialCategory ?? "general")
  const [query, setQuery] = useState("")
  // Text and layout settings are edited as a draft and applied together (Apply or Enter).
  const [textDraft, setTextDraft] = useState<TextDraft>(() => textFromSettings(settings))
  const [textBase, setTextBase] = useState<TextDraft>(() => textFromSettings(settings))
  const appliedText = textFromSettings(settings)
  if (!sameText(appliedText, textBase)) {
    // Changed elsewhere (a preset, another window): show the new values.
    setTextBase(appliedText)
    setTextDraft(appliedText)
  }
  const textDirty = !sameText(textDraft, appliedText)
  const [prevInitialCategory, setPrevInitialCategory] = useState(initialCategory)
  const [permission, setPermission] = useState(notificationPermission)
  const [compatible, setCompatible] = useState<{ url: string; model: string; fromEnvironment: boolean } | null>(null)
  const [compatibleDraft, setCompatibleDraft] = useState({ url: "", model: "" })
  const [compatibleBusy, setCompatibleBusy] = useState(false)
  const [compatibleMessage, setCompatibleMessage] = useState("")

  if (initialCategory !== prevInitialCategory) {
    setPrevInitialCategory(initialCategory)
    if (initialCategory) setSelectedCategory(initialCategory)
  }

  useEffect(() => {
    if (selectedCategory !== "models") return
    void request<{ compatible?: { url: string; model: string; fromEnvironment: boolean } }>("/api/model-credentials", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "status" }),
    }).then(result => {
      if (!result.compatible) return
      setCompatible(result.compatible)
      setCompatibleDraft({ url: result.compatible.url, model: result.compatible.model })
    }).catch(() => undefined)
  }, [selectedCategory])

  const {
    githubConnection, githubStatusError, githubCliError, githubActionError, githubConnectionBusy, changeGitHubConnection,
    authBusy, modelCredentialBusy,
  } = connections
  const groups = useMemo(() => groupSpecs.map(group => ({
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
  const reasoningLevels = useMemo(() => reasoningLevelIds.map(id => ({
    id,
    label: t(`settings.reasoning.${id}` as TranslationKey),
  })), [t])
  const selected = allItems.find(item => item.id === selectedCategory) ?? allItems[0]
  const disabled = sending || credentialChangesBlocked || authBusy || githubConnectionBusy || Boolean(modelCredentialBusy)

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
      const result = await request<{ compatible: { url: string; model: string; fromEnvironment: boolean } }>("/api/model-credentials", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "configure-compatible", url: compatibleDraft.url, model: compatibleDraft.model }),
      })
      setCompatible(result.compatible)
      setCompatibleMessage(t("common.saved"))
      onModelsChanged?.()
    } catch (cause) {
      setCompatibleMessage(cause instanceof Error ? cause.message : t("settings.compatible.saveError"))
    } finally {
      setCompatibleBusy(false)
    }
  }

  // --- General ---
  const general = <>
    <Section title={t("settings.general.newSessions")}>
      <Row title={t("settings.general.defaultWorkspace")} description={t("settings.general.defaultWorkspaceDesc")}>
        <select className="st-select" value={settings.defaultWorkspaceKind} onChange={event => update({ defaultWorkspaceKind: event.target.value as Settings["defaultWorkspaceKind"] })}>
          <option value="worktree">{t("settings.general.workspaceWorktree")}</option>
          <option value="checkout">{t("settings.general.workspaceCheckout")}</option>
          <option value="none">{t("settings.general.workspaceNone")}</option>
        </select>
      </Row>
    </Section>
    <Section title={t("settings.general.archiving")}>
      <Row title={t("settings.general.archiveRemovesWorktree")} description={t("settings.general.archiveRemovesWorktreeDesc")}>
        <Switch label={t("settings.general.archiveRemovesWorktree")} checked={settings.archiveRemovesWorktree} onChange={value => update({ archiveRemovesWorktree: value })} />
      </Row>
    </Section>
    <Section title={t("settings.general.startup")}>
      <Row title={t("settings.general.restoreLastView")} description={t("settings.general.restoreLastViewDesc")}>
        <Switch label={t("settings.general.restoreLastView")} checked={settings.restoreLastView} onChange={value => update({ restoreLastView: value })} />
      </Row>
    </Section>
    <KeybindingsSection
      overrides={settings.keybindings}
      customBindings={settings.customKeybindings}
      onChangeOverrides={next => update({ keybindings: next })}
      onChangeCustomBindings={next => update({ customKeybindings: next })}
    />
  </>

  // --- Localization ---
  const localization = <>
    <Section title={t("settings.localization.languageSection")} description={t("settings.localization.moreLanguagesNote")}>
      <Row title={t("settings.localization.displayLanguage")} description={t("settings.localization.displayLanguageDesc")} htmlFor="st-language-select">
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
      </Row>
    </Section>
    <Section title={t("settings.localization.regionalSection")}>
      <Row title={t("settings.localization.activeLocale")} description={t("settings.localization.activeLocaleDesc")}>
        <span className="st-value">{meta.nativeName} ({meta.bcp47})</span>
      </Row>
      <Row title={t("settings.localization.sampleNumber")}>
        <span className="st-value">{formatNumber(1234567.89)}</span>
      </Row>
    </Section>
    <Section title={t("settings.localization.formatsSection")}>
      <Row title={t("settings.localization.dateFormat")} description={t("settings.localization.dateFormatDesc")} htmlFor="st-date-format">
        <select id="st-date-format" className="st-select" value={settings.dateFormat} onChange={event => update({ dateFormat: event.target.value as DateFormatPreference })}>
          {DATE_FORMAT_OPTIONS.map(option => (
            <option key={option.id} value={option.id}>{option.id === "auto" ? t("settings.localization.dateFormatAuto") : `${option.pattern} (${formatDateOnly(SAMPLE_LOCALE_DATE, locale, { ...preferences, dateFormat: option.id })})`}</option>
          ))}
        </select>
      </Row>
      <Row title={t("settings.localization.timeFormat")} description={t("settings.localization.timeFormatDesc")} htmlFor="st-time-format">
        <select id="st-time-format" className="st-select" value={settings.timeFormat} onChange={event => update({ timeFormat: event.target.value as TimeFormatPreference })}>
          {TIME_FORMAT_OPTIONS.map(option => (
            <option key={option} value={option}>{option === "auto" ? t("settings.localization.timeFormatAuto") : option === "24h" ? t("settings.localization.time24h") : t("settings.localization.time12h")}</option>
          ))}
        </select>
      </Row>
      <Row title={t("settings.localization.currency")} description={t("settings.localization.currencyDesc")} htmlFor="st-currency">
        <select id="st-currency" className="st-select" value={settings.currency} onChange={event => update({ currency: event.target.value })}>
          {(CURRENCY_OPTIONS.includes(settings.currency) ? CURRENCY_OPTIONS : [settings.currency, ...CURRENCY_OPTIONS]).map(code => (
            <option key={code} value={code}>{code} · {currencyName(code, locale)}</option>
          ))}
        </select>
      </Row>
      <Row title={t("settings.localization.previewDate")}><span className="st-value">{formatDay(SAMPLE_LOCALE_DATE)}</span></Row>
      <Row title={t("settings.localization.previewTime")}><span className="st-value">{formatDateTime(SAMPLE_LOCALE_DATE)}</span></Row>
      <Row title={t("settings.localization.previewMoney")}><span className="st-value">{formatCurrency(1234.5)}</span></Row>
    </Section>
  </>

  // --- Appearance ---
  const textLimits: Record<keyof Omit<TextDraft, "interfaceFont" | "codeFont">, [number, number]> = {
    interfaceSize: [11, 20], contentSize: [12, 22], codeSize: [10, 18], contentWidth: [640, 1200],
  }
  const textInvalid = (key: keyof typeof textLimits) => {
    const value = Number(textDraft[key])
    return !textDraft[key].trim() || !Number.isFinite(value) || value < textLimits[key][0] || value > textLimits[key][1]
  }
  const textErrors = (Object.keys(textLimits) as Array<keyof typeof textLimits>).filter(textInvalid)
  const applyText = () => {
    if (textErrors.length) return
    update({
      interfaceFont: textDraft.interfaceFont.trim(),
      codeFont: textDraft.codeFont.trim(),
      interfaceSize: Math.round(Number(textDraft.interfaceSize)),
      contentSize: Math.round(Number(textDraft.contentSize)),
      codeSize: Math.round(Number(textDraft.codeSize)),
      contentWidth: Math.round(Number(textDraft.contentWidth)),
    })
  }
  const sizeSelect = (label: string, key: "interfaceSize" | "contentSize" | "codeSize") => {
    const [min, max] = textLimits[key]
    const sizes = Array.from({ length: max - min + 1 }, (_, index) => String(min + index))
    return (
      <select className="st-select is-narrow" aria-label={label} value={sizes.includes(textDraft[key]) ? textDraft[key] : ""}
        onChange={event => setTextDraft(current => ({ ...current, [key]: event.target.value }))}>
        {sizes.includes(textDraft[key]) ? null : <option value="" disabled>{t("common.choose")}</option>}
        {sizes.map(size => <option key={size} value={size}>{key === "interfaceSize" && size === "14" ? t("settings.appearance.sizeDefault", { size }) : t("settings.appearance.sizePx", { size })}</option>)}
      </select>
    )
  }
  const numberField = (label: string, key: keyof typeof textLimits) => (
    <span className={`st-number ${textInvalid(key) ? "is-invalid" : ""}`} title={`${textLimits[key][0]}–${textLimits[key][1]} px`}>
      <input aria-label={label} inputMode="numeric" value={textDraft[key]} aria-invalid={textInvalid(key)}
        onChange={event => setTextDraft(current => ({ ...current, [key]: event.target.value.replace(/[^0-9]/g, "") }))}
        onKeyDown={event => { if (event.key === "Enter") applyText() }} />
      <small>px</small>
    </span>
  )
  const activeAccentHex = resolveAccentHex(settings.accentColor, resolved)
  const isCustomAccent = Boolean(settings.accentColor) && !accentPresets.some(preset => preset.id === settings.accentColor)
  const activePreset = lookPresets.find(preset => preset.palette === settings.palette && preset.interfaceFont === settings.interfaceFont && preset.codeFont === settings.codeFont
    && preset.interfaceSize === settings.interfaceSize && preset.contentSize === settings.contentSize && preset.codeSize === settings.codeSize && preset.contentWidth === settings.contentWidth)
  const resolvedModeLabel = resolved === "dark" ? t("settings.appearance.mode.dark").toLowerCase() : t("settings.appearance.mode.light").toLowerCase()
  const appearance = <>
    <Section title={t("settings.appearance.theme")}>
      <Row title={t("settings.appearance.mode")} description={settings.theme === "system" ? t("settings.appearance.followingSystem", { resolved: resolvedModeLabel }) : undefined}>
        <div className="st-segmented" role="radiogroup" aria-label={t("settings.appearance.mode")}>
          {(["light", "system", "dark"] as const).map(value => <button type="button" role="radio" key={value} aria-checked={settings.theme === value} className={settings.theme === value ? "is-active" : ""} onClick={() => update({ theme: value })}>{t(`settings.appearance.mode.${value}` as TranslationKey)}</button>)}
        </div>
      </Row>
      <Row
        title={t("settings.appearance.accentColor")}
        description={t("settings.appearance.accentColorDesc")}
        stacked
      >
        <div className="st-accent-picker" role="group" aria-label={t("settings.appearance.accentColor")}>
          <button
            type="button"
            className={`st-accent-none ${!settings.accentColor ? "is-active" : ""}`}
            aria-pressed={!settings.accentColor}
            title={t("settings.appearance.accentDefaultTitle")}
            onClick={() => update({ accentColor: "" })}
          >
            <span className="st-accent-none-dot" aria-hidden="true" />
            <span>{t("common.default")}</span>
          </button>
          <div className="st-accent-swatches">
            {accentPresets.map(preset => {
              const hex = preset[resolved]
              const active = settings.accentColor === preset.id
              return (
                <button
                  type="button"
                  key={preset.id}
                  className={`st-accent-swatch ${active ? "is-active" : ""}`}
                  style={{ backgroundColor: hex, color: contrastForegroundHex(hex) }}
                  aria-label={preset.name}
                  aria-pressed={active}
                  title={preset.name}
                  onClick={() => update({ accentColor: preset.id })}
                >
                  {active ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
                </button>
              )
            })}
            <label
              className={`st-accent-swatch st-accent-custom ${isCustomAccent ? "is-active" : ""}`}
              style={isCustomAccent && activeAccentHex ? { backgroundColor: activeAccentHex, color: contrastForegroundHex(activeAccentHex) } : undefined}
              title={isCustomAccent ? t("settings.appearance.customWithHex", { hex: settings.accentColor.toUpperCase() }) : t("settings.appearance.customColor")}
            >
              <input
                type="color"
                className="st-accent-color-input"
                aria-label={t("settings.appearance.customAccentAria")}
                value={activeAccentHex ?? "#3b82f6"}
                onChange={event => {
                  const hex = normalizeHexColor(event.target.value)
                  if (hex) update({ accentColor: hex })
                }}
              />
              {isCustomAccent ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : <Pipette size={13} aria-hidden="true" />}
            </label>
          </div>
          <span className="st-accent-current">
            <strong>{settings.accentColor ? accentDisplayName(settings.accentColor) : t("common.default")}</strong>
            {activeAccentHex ? <code>{activeAccentHex.toUpperCase()}</code> : null}
          </span>
        </div>
      </Row>
      <Row title={t("settings.appearance.look")} description={t("settings.appearance.lookDesc")} stacked>
        <div className="st-looks">
          {lookPresets.map(preset => (
            <button type="button" key={preset.id} className={`st-look ${activePreset?.id === preset.id ? "is-active" : ""}`} aria-pressed={activePreset?.id === preset.id} title={preset.description}
              onClick={() => update({ palette: preset.palette, interfaceFont: preset.interfaceFont, codeFont: preset.codeFont, interfaceSize: preset.interfaceSize, contentSize: preset.contentSize, codeSize: preset.codeSize, contentWidth: preset.contentWidth })}>
              <span className="st-look-swatch" style={paletteVariables(preset.palette, resolved)} aria-hidden="true"><i /><i /><i /></span>
              <span className="st-look-text"><strong>{preset.name}</strong><small>{preset.description}</small></span>
            </button>
          ))}
        </div>
      </Row>
      <Row title={t("settings.appearance.colorPalette")} description={t("settings.appearance.colorPaletteDesc")} stacked>
        <div className="st-palettes">
          {colorPalettes.map(palette => {
            const variables = paletteVariables(palette.id, resolved)
            const active = settings.palette === palette.id
            return (
              <button
                type="button"
                key={palette.id}
                className={`st-palette-tile ${active ? "is-active" : ""}`}
                onClick={() => update({ palette: palette.id })}
                aria-pressed={active}
                title={palette.description}
              >
                <span className="st-tile-preview" style={variables} aria-hidden="true">
                  <span className="st-tile-sidebar">
                    <i className="is-dot" />
                    <i />
                    <i className="is-short" />
                  </span>
                  <span className="st-tile-canvas">
                    <span className="st-tile-line is-strong" />
                    <span className="st-tile-line is-muted" />
                    <span className="st-tile-card">
                      <span className="st-tile-line is-short" />
                      <span className="st-tile-accent" />
                    </span>
                  </span>
                </span>
                <span className="st-tile-meta">
                  <span className="st-tile-head">
                    <strong>{palette.name}</strong>
                    {active ? <Check size={13} className="st-tile-check" /> : null}
                  </span>
                  <small>{palette.description}</small>
                </span>
              </button>
            )
          })}
        </div>
      </Row>
    </Section>
    <Section title={t("settings.appearance.text")}>
      <Row title={t("settings.appearance.interfaceFont")} description={t("settings.appearance.interfaceFontDesc")}>
        <FontPicker
          label={t("settings.appearance.interfaceFont")}
          value={textDraft.interfaceFont}
          options={INTERFACE_FONT_OPTIONS}
          previewGroup="interface"
          sampleText="Aa"
          customPlaceholder="e.g. Avenir Next"
          onChange={next => setTextDraft(current => ({ ...current, interfaceFont: next }))}
          onCommit={applyText}
        />
      </Row>
      <Row title={t("settings.appearance.interfaceSize")} description={t("settings.appearance.interfaceSizeDesc")}>{sizeSelect(t("settings.appearance.interfaceSize"), "interfaceSize")}</Row>
      <Row title={t("settings.appearance.chatTextSize")} description={t("settings.appearance.chatTextSizeDesc")}>{sizeSelect(t("settings.appearance.chatTextSize"), "contentSize")}</Row>
      <Row title={t("settings.appearance.codeFont")} description={t("settings.appearance.codeFontDesc")}>
        <FontPicker
          label={t("settings.appearance.codeFont")}
          value={textDraft.codeFont}
          options={CODE_FONT_OPTIONS}
          previewGroup="code"
          sampleText="0O1l"
          customPlaceholder="e.g. Berkeley Mono"
          onChange={next => setTextDraft(current => ({ ...current, codeFont: next }))}
          onCommit={applyText}
        />
      </Row>
      <Row title={t("settings.appearance.codeSize")}>{sizeSelect(t("settings.appearance.codeSize"), "codeSize")}</Row>
    </Section>
    <Section title={t("settings.appearance.layout")}>
      <Row title={t("settings.appearance.conversationWidth")} description={t("settings.appearance.conversationWidthDesc")}>{numberField(t("settings.appearance.conversationWidth"), "contentWidth")}</Row>
      <Row title={t("settings.appearance.syntaxColors")}>
        <select className="st-select" aria-label={t("settings.appearance.syntaxColors")} value={settings.highlightTheme} onChange={event => update({ highlightTheme: event.target.value as "auto" | "github" | "monochrome" })}><option value="auto">{t("settings.appearance.syntaxAuto")}</option><option value="github">{t("settings.appearance.syntaxGithub")}</option><option value="monochrome">{t("settings.appearance.syntaxMonochrome")}</option></select>
      </Row>
    </Section>
    {textDirty ? (
      <div className="st-apply-bar" role="status">
        <span>{textErrors.length ? t("settings.appearance.invalidValues", { countLabel: textErrors.length === 1 ? t("settings.appearance.valueSingular") : t("settings.appearance.valuePlural"), iface: textLimits.interfaceSize.join("–"), chat: textLimits.contentSize.join("–"), code: textLimits.codeSize.join("–"), width: textLimits.contentWidth.join("–") }) : t("settings.appearance.unappliedText")}</span>
        <button type="button" className="st-button is-quiet" onClick={() => setTextDraft(textFromSettings(settings))}>{t("common.revert")}</button>
        <button type="button" className="st-button is-primary" disabled={textErrors.length > 0} onClick={applyText}>{t("common.apply")}</button>
      </div>
    ) : null}
  </>

  // --- Providers & Models ---
  const models = (
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

  // --- Agents & permissions ---
  const agents = <>
    <Section title={t("settings.agents.capabilities")} description={t("settings.agents.capabilitiesDesc")}>
      <Row title={t("settings.agents.builtinBrowser")}>{browserState?.available ? <Status tone="ok">{t("settings.agents.chromeFound")}</Status> : <Status tone="warn">{t("settings.agents.chromeNotFound")}</Status>}</Row>
      <Row title={t("settings.agents.skillsFound")}><span className="st-value">{skillsCatalog?.skills.length ?? 0}</span></Row>
      <Row title={t("settings.agents.rulesFiles")}><span className="st-value">{skillsCatalog?.rules.length ?? 0}</span></Row>
      <Row title={t("settings.agents.slashCommands")}><span className="st-value">{skillsCatalog?.commands.length ?? 0}</span></Row>
    </Section>
    {onChangeApprovalPolicy && onDeleteApprovalRule && onRefreshMcp ? (
      <Section title={t("settings.agents.approvalsAndMcp")} plain>
        <div className="st-embedded">
          <McpAndSecuritySettings approvalPolicy={approvalPolicy} approvalRules={approvalRules} onChangeApprovalPolicy={onChangeApprovalPolicy} onDeleteApprovalRule={onDeleteApprovalRule} onAddApprovalRule={onAddApprovalRule} />
        </div>
      </Section>
    ) : null}
    <OvernightSettings modelCatalog={modelCatalog} />
  </>

  // --- Skills & tools ---
  const skillsTools = <SkillsToolsSettings projects={projects} onRefreshMcp={onRefreshMcp} />

  // --- Git & GitHub ---
  const github = <>
    <Section title={t("settings.github.account")} description={t("settings.github.accountDesc")}>
      <Row title={githubConnection?.login ? t("settings.github.connectedAs", { login: githubConnection.login }) : t("settings.github.cli")} description={githubStatusError || (!githubConnection?.login ? (githubCliError || t("settings.github.signInHint")) : t("settings.github.disconnectHint"))}>
        {githubConnection?.login ? <Status tone="ok">{t("common.connected")}</Status> : <Status tone="off">{t("common.notConnected")}</Status>}
        <button type="button" className="st-button" disabled={githubConnectionBusy || !githubConnection || Boolean(githubStatusError)} onClick={() => void changeGitHubConnection("connect")}>{githubConnectionBusy ? t("common.working") : githubConnection?.login ? t("common.check") : t("common.connect")}</button>
        {githubConnection?.login ? <button type="button" className="st-button is-quiet" disabled={githubConnectionBusy} onClick={() => void changeGitHubConnection("disconnect")}>{t("common.disconnect")}</button> : null}
      </Row>
      {githubActionError ? <Row title={<span className="st-error">{githubActionError}</span>} /> : null}
    </Section>
    <Section title={t("settings.github.pullRequests")}>
      <Row title={t("settings.github.openAsDraft")} description={t("settings.github.openAsDraftDesc")}>
        <Switch label={t("settings.github.openAsDraftAria")} checked={settings.prDraft} onChange={value => update({ prDraft: value })} />
      </Row>
    </Section>
  </>

  // --- Terminal ---
  const terminal = <Section title={t("settings.terminal.title")} description={t("settings.terminal.desc")}>
    <Row title={t("settings.terminal.autoStart")} description={t("settings.terminal.autoStartDesc")}>
      <Switch label={t("settings.terminal.autoStart")} checked={settings.terminalAutoStart} onChange={value => update({ terminalAutoStart: value })} />
    </Row>
    <Row title={t("settings.terminal.fontSize")}>
      <select className="st-select" aria-label={t("settings.terminal.fontSizeAria")} value={settings.terminalFontSize} onChange={event => update({ terminalFontSize: Number(event.target.value) })}>{[11, 12, 13, 14, 15, 16, 18, 20].map(size => <option key={size} value={size}>{size}px</option>)}</select>
    </Row>
    <Row title={t("settings.terminal.scrollback")}>
      <select className="st-select" aria-label={t("settings.terminal.scrollbackAria")} value={settings.terminalScrollback} onChange={event => update({ terminalScrollback: Number(event.target.value) })}>{[1000, 5000, 10000, 20000].map(lines => <option key={lines} value={lines}>{t("common.linesCount", { count: formatNumber(lines) })}</option>)}</select>
    </Row>
  </Section>

  // --- Notifications ---
  const requestPermission = async () => {
    if (typeof Notification === "undefined") return
    setPermission(await Notification.requestPermission())
  }
  const notifications = <Section title={t("settings.notifications.title")} description={t("settings.notifications.desc")}>
    <Row title={t("settings.notifications.permission")} description={permission === "denied" ? t("settings.notifications.blockedDesc") : permission === "unsupported" ? t("settings.notifications.unsupportedDesc") : undefined}>
      {permission === "granted" ? <><Status tone="ok">{t("common.allowed")}</Status><button type="button" className="st-button is-quiet" onClick={() => new Notification("ADE", { body: t("settings.notifications.testBody") })}>{t("settings.notifications.sendTest")}</button></>
        : permission === "default" ? <button type="button" className="st-button" onClick={() => void requestPermission()}>{t("common.allow")}</button>
          : <Status tone="off">{permission === "denied" ? t("common.blocked") : t("common.unavailable")}</Status>}
    </Row>
    <Row title={t("settings.notifications.onFinish")}><Switch label={t("settings.notifications.onFinishAria")} checked={settings.notifyOnFinish} disabled={permission !== "granted"} onChange={value => update({ notifyOnFinish: value })} /></Row>
    <Row title={t("settings.notifications.onApproval")}><Switch label={t("settings.notifications.onApprovalAria")} checked={settings.notifyOnApproval} disabled={permission !== "granted"} onChange={value => update({ notifyOnApproval: value })} /></Row>
  </Section>

  // --- Environments ---
  const environments = <>
    <Section title={t("settings.environments.hosts")} plain>
      <div className="st-embedded"><EnvironmentSettings onEnvironmentChanged={onEnvironmentChanged} disabled={disabled} autoOpenAdd={autoOpenAddEnvironment} /></div>
    </Section>
    <Section title={t("settings.environments.diagnostics")}>
      <Row title={t("settings.environments.activeEnv")}><span className="st-value">{activeEnvironmentName}</span></Row>
      <Row title={t("settings.environments.runtime")}>{runtime?.online ? <Status tone="ok">{t("common.online")}</Status> : <Status tone="error">{runtimeError || t("common.waiting")}</Status>}</Row>
      <Row title={t("settings.environments.mcpConnected")}><span className="st-value">{mcpServers.filter(server => server.status === "connected").length}</span></Row>
      <Row title={t("settings.environments.gitWorktrees")} description={t("settings.environments.gitWorktreesDesc")}><button type="button" className="st-button" onClick={onWorktreeDiagnostics}>{t("common.inspect")}</button></Row>
    </Section>
    <Section title={t("settings.environments.about")}>
      <Row title="ADE" description={t("settings.environments.aboutDesc")} />
    </Section>
  </>

  const usage = <UsageSettings budget={settings.monthlyBudget} onBudgetChange={value => update({ monthlyBudget: value })} projects={projects} sessionLabels={sessionLabels} />
  const integrations = <IntegrationsSettings />
  const subagents = <SubagentSettings modelCatalog={modelCatalog} />
  const mobile = <MobilePairingSection />
  const content = { general, appearance, localization, models, agents, skills: skillsTools, usage, subagents, integrations, github, terminal, notifications, environments, mobile }[selectedCategory]

  return <main className="st-layout">
    <aside className="st-nav" aria-label={t("settings.navAria")}>
      <button type="button" className="st-back" onClick={onBack}><ArrowLeft size={14} /> {t("settings.backToApp")}</button>
      <div className="st-search">
        <Search size={13} aria-hidden="true" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && visibleGroups[0]?.items[0]) setSelectedCategory(visibleGroups[0].items[0].id)
            if (event.key === "Escape") setQuery("")
          }}
          placeholder={t("settings.searchPlaceholder")}
          aria-label={t("settings.searchPlaceholder")}
        />
        {query ? <button type="button" aria-label={t("common.clearSearch")} onClick={() => setQuery("")}><X size={12} /></button> : null}
      </div>
      <nav className="st-nav-groups">
        {visibleGroups.map(group => <div key={group.label} className="st-nav-group">
          <span className="st-nav-label">{group.label}</span>
          {group.items.map(item => {
            const Icon = item.icon
            return <button type="button" key={item.id} className={`st-nav-item ${selectedCategory === item.id ? "is-active" : ""}`} aria-current={selectedCategory === item.id ? "page" : undefined} onClick={() => setSelectedCategory(item.id)}><Icon size={15} /><span>{item.label}</span></button>
          })}
        </div>)}
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
          {error ? <p className="st-banner is-error" role="alert">{error}</p> : null}
          {runtimeError && !runtime?.online ? <p className="st-banner is-error" role="alert">{runtimeError}</p> : null}
          {selectedCategory === "models" ? <EuOnlySettings /> : null}
          {content}
        </div>
      </div>
    </section>
  </main>
}
