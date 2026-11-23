import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import {
  ArrowLeft, Bell, Blocks, Bot, Workflow, Check, Gauge, GitPullRequest, Palette, Search, Server, Settings2, Sparkles, Terminal, X, type LucideIcon,
} from "lucide-react"
import { EnvironmentSettings } from "./EnvironmentSettings"
import { colorPalettes, lookPresets, paletteVariables, type Theme } from "./appearance-palettes"
import type { ApprovalPolicy, ApprovalRule, BrowserState, EnvironmentDirectory, McpServerStatus, ProviderCatalogEntry, RuntimeHealth, SkillsAndRulesCatalog } from "./app-types"
import type { Project } from "./ProjectsView"
import type { Settings } from "./useSettings"
import type { useConnections } from "./useConnections"
import { McpAndSecuritySettings } from "./src/panels/McpSettingsSection"
import { request } from "./api"
import { UsageSettings } from "./src/usage/UsageSettings"
import { IntegrationsSettings } from "./src/integrations/IntegrationsSettings"
import { CODE_FONT_OPTIONS, INTERFACE_FONT_OPTIONS } from "./src/appearance/fonts"
import { FontPicker } from "./src/appearance/FontPicker"
import { SubagentSettings } from "./src/subagents/SubagentSettings"
import { ProvidersPanel } from "./src/settings/ProvidersPanel"
import { KeybindingsSection } from "./src/settings/KeybindingsSection"
import { OvernightSettings } from "./src/subagents/OvernightSettings"

/** Settings categories. Every category here changes something real; nothing is a placeholder. */
export type SettingsCategory =
  | "general" | "appearance" | "models" | "agents" | "usage" | "subagents" | "integrations" | "github" | "terminal" | "notifications" | "environments"

type SettingsItem = { id: SettingsCategory; label: string; icon: LucideIcon; description: string; keywords: string }

const groups: { label: string; items: SettingsItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { id: "general", label: "General", icon: Settings2, description: "Session defaults, archiving, startup, and keyboard shortcuts.", keywords: "worktree checkout branch archive startup restore shortcuts keybindings keyboard hotkeys" },
      { id: "terminal", label: "Terminal", icon: Terminal, description: "The interactive terminal in coding sessions.", keywords: "shell font scrollback auto start" },
      { id: "notifications", label: "Notifications", icon: Bell, description: "Desktop notifications when agents need you.", keywords: "alert finished approval desktop" },
      { id: "integrations", label: "Integrations", icon: Blocks, description: "Slack notifications and Linear issues.", keywords: "slack linear webhook notify issues jira" },
    ],
  },
  {
    label: "AI",
    items: [
      { id: "models", label: "Providers", icon: Sparkles, description: "Model providers, CLI agents, API keys, and runtime settings.", keywords: "openai anthropic claude copilot codex pi cursor opencode radius ollama compatible api key provider reasoning models" },
      { id: "agents", label: "Agents & permissions", icon: Bot, description: "Ask or Autopilot, limits for unattended work, MCP servers, and skills.", keywords: "approval policy autopilot ask mcp skills rules permissions browser chrome limit cost budget overnight usage limit fallback queue concurrent" },
      { id: "subagents", label: "Subagents", icon: Workflow, description: "What subagents run on (Pi, Claude Code, Codex) and who picks.", keywords: "harness claude code codex pi durable subagent model delegate" },
      { id: "usage", label: "Usage", icon: Gauge, description: "Tokens and cost per project and session, and a monthly budget.", keywords: "cost spend tokens budget billing price money" },
    ],
  },
  {
    label: "Source control",
    items: [
      { id: "github", label: "Git & GitHub", icon: GitPullRequest, description: "GitHub account and pull request defaults.", keywords: "gh cli pull request draft account" },
    ],
  },
  {
    label: "Interface",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette, description: "Theme, color palette, fonts, and layout.", keywords: "dark light theme palette font size width syntax" },
    ],
  },
  {
    label: "Hosts",
    items: [
      { id: "environments", label: "Environments", icon: Server, description: "This computer and SSH hosts, diagnostics, and version information.", keywords: "ssh remote host diagnostics worktrees about version" },
    ],
  },
]
const allItems = groups.flatMap(group => group.items)

const reasoningLevels = [
  { id: "none", label: "None" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
  { id: "max", label: "Max" },
]

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
  const selected = allItems.find(item => item.id === selectedCategory) ?? allItems[0]
  const disabled = sending || credentialChangesBlocked || authBusy || githubConnectionBusy || Boolean(modelCredentialBusy)

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map(group => ({ ...group, items: group.items.filter(item => `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(q)) }))
      .filter(group => group.items.length)
  }, [query])

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
      setCompatibleMessage("Saved")
      onModelsChanged?.()
    } catch (cause) {
      setCompatibleMessage(cause instanceof Error ? cause.message : "Could not save the endpoint.")
    } finally {
      setCompatibleBusy(false)
    }
  }

  // --- General ---
  const general = <>
    <Section title="New sessions">
      <Row title="Default workspace" description="Used when a project has a local checkout. Worktree sessions get their own branch, like ade/fix-login-1a2b3c4d.">
        <select className="st-select" value={settings.defaultWorkspaceKind} onChange={event => update({ defaultWorkspaceKind: event.target.value as Settings["defaultWorkspaceKind"] })}>
          <option value="worktree">Worktree</option>
          <option value="checkout">Project folder</option>
          <option value="none">Chat only</option>
        </select>
      </Row>
    </Section>
    <Section title="Archiving">
      <Row title="Remove the worktree when archiving" description="Frees disk space. The branch and conversation are kept; restoring recreates the worktree. Worktrees with uncommitted changes are never removed.">
        <Switch label="Remove the worktree when archiving" checked={settings.archiveRemovesWorktree} onChange={value => update({ archiveRemovesWorktree: value })} />
      </Row>
    </Section>
    <Section title="Startup">
      <Row title="Reopen the last view" description="After a reload or restart, return to the project or session you had open.">
        <Switch label="Reopen the last view" checked={settings.restoreLastView} onChange={value => update({ restoreLastView: value })} />
      </Row>
    </Section>
    <KeybindingsSection
      overrides={settings.keybindings}
      customBindings={settings.customKeybindings}
      onChangeOverrides={next => update({ keybindings: next })}
      onChangeCustomBindings={next => update({ customKeybindings: next })}
    />
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
        {sizes.includes(textDraft[key]) ? null : <option value="" disabled>Choose</option>}
        {sizes.map(size => <option key={size} value={size}>{size} px{key === "interfaceSize" && size === "14" ? " (default)" : ""}</option>)}
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
  const activePreset = lookPresets.find(preset => preset.palette === settings.palette && preset.interfaceFont === settings.interfaceFont && preset.codeFont === settings.codeFont
    && preset.interfaceSize === settings.interfaceSize && preset.contentSize === settings.contentSize && preset.codeSize === settings.codeSize && preset.contentWidth === settings.contentWidth)
  const appearance = <>
    <Section title="Theme">
      <Row title="Mode" description={settings.theme === "system" ? `Following your system (${resolved}).` : undefined}>
        <div className="st-segmented" role="radiogroup" aria-label="Mode">
          {(["light", "system", "dark"] as const).map(value => <button type="button" role="radio" key={value} aria-checked={settings.theme === value} className={settings.theme === value ? "is-active" : ""} onClick={() => update({ theme: value })}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
      </Row>
      <Row title="Look" description="A palette, fonts, sizes and width in one click, in the style of familiar tools. Fine-tune below." stacked>
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
      <Row title="Color palette" description="Nine quiet themes tuned for both light and dark mode." stacked>
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
    <Section title="Text">
      <Row title="Interface font" description="Google Fonts load automatically when online; offline falls back to the system font.">
        <FontPicker
          label="Interface font"
          value={textDraft.interfaceFont}
          options={INTERFACE_FONT_OPTIONS}
          previewGroup="interface"
          sampleText="Aa"
          customPlaceholder="e.g. Avenir Next"
          onChange={next => setTextDraft(current => ({ ...current, interfaceFont: next }))}
          onCommit={applyText}
        />
      </Row>
      <Row title="Interface size" description="Scales the whole app, like zooming.">{sizeSelect("Interface size", "interfaceSize")}</Row>
      <Row title="Chat text size" description="Messages in the conversation.">{sizeSelect("Chat text size", "contentSize")}</Row>
      <Row title="Code font" description="Code blocks, diffs, and the terminal.">
        <FontPicker
          label="Code font"
          value={textDraft.codeFont}
          options={CODE_FONT_OPTIONS}
          previewGroup="code"
          sampleText="0O1l"
          customPlaceholder="e.g. Berkeley Mono"
          onChange={next => setTextDraft(current => ({ ...current, codeFont: next }))}
          onCommit={applyText}
        />
      </Row>
      <Row title="Code size">{sizeSelect("Code size", "codeSize")}</Row>
    </Section>
    <Section title="Layout">
      <Row title="Conversation width" description="Maximum width of chat on wide screens.">{numberField("Conversation width", "contentWidth")}</Row>
      <Row title="Syntax colors">
        <select className="st-select" aria-label="Syntax colors" value={settings.highlightTheme} onChange={event => update({ highlightTheme: event.target.value as "auto" | "github" | "monochrome" })}><option value="auto">Automatic</option><option value="github">GitHub</option><option value="monochrome">Monochrome</option></select>
      </Row>
    </Section>
    {textDirty ? (
      <div className="st-apply-bar" role="status">
        <span>{textErrors.length ? `Check the highlighted ${textErrors.length === 1 ? "value" : "values"}: interface ${textLimits.interfaceSize.join("–")}, chat ${textLimits.contentSize.join("–")}, code ${textLimits.codeSize.join("–")}, width ${textLimits.contentWidth.join("–")} px.` : "Text and layout changes aren’t applied yet."}</span>
        <button type="button" className="st-button is-quiet" onClick={() => setTextDraft(textFromSettings(settings))}>Revert</button>
        <button type="button" className="st-button is-primary" disabled={textErrors.length > 0} onClick={applyText}>Apply</button>
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
    <Section title="Capabilities" description="Sessions with a workspace can read and edit files, search, and run commands in their branch, start subagents, and drive the built-in browser.">
      <Row title="Built-in browser">{browserState?.available ? <Status tone="ok">Chrome found</Status> : <Status tone="warn">Chrome not found — set ADE_CHROME_PATH</Status>}</Row>
      <Row title="Skills found"><span className="st-value">{skillsCatalog?.skills.length ?? 0}</span></Row>
      <Row title="Rules files"><span className="st-value">{skillsCatalog?.rules.length ?? 0}</span></Row>
      <Row title="Slash commands"><span className="st-value">{skillsCatalog?.commands.length ?? 0}</span></Row>
    </Section>
    {onChangeApprovalPolicy && onDeleteApprovalRule && onRefreshMcp ? (
      <Section title="Approvals and MCP servers" plain>
        <div className="st-embedded">
          <McpAndSecuritySettings mcpServers={mcpServers} approvalPolicy={approvalPolicy} approvalRules={approvalRules} onRefreshMcp={onRefreshMcp} onChangeApprovalPolicy={onChangeApprovalPolicy} onDeleteApprovalRule={onDeleteApprovalRule} onAddApprovalRule={onAddApprovalRule} />
        </div>
      </Section>
    ) : null}
    <OvernightSettings modelCatalog={modelCatalog} />
  </>

  // --- Git & GitHub ---
  const github = <>
    <Section title="GitHub account" description="Issues, pushes, and pull requests go through the GitHub CLI (gh) on this host, with that account’s permissions. ADE never stores a token.">
      <Row title={githubConnection?.login ? `Connected as ${githubConnection.login}` : "GitHub CLI"} description={githubStatusError || (!githubConnection?.login ? (githubCliError || "Sign in first with gh auth login --hostname github.com --web") : "Disconnecting here doesn’t sign out of the GitHub CLI.")}>
        {githubConnection?.login ? <Status tone="ok">Connected</Status> : <Status tone="off">Not connected</Status>}
        <button type="button" className="st-button" disabled={githubConnectionBusy || !githubConnection || Boolean(githubStatusError)} onClick={() => void changeGitHubConnection("connect")}>{githubConnectionBusy ? "Working…" : githubConnection?.login ? "Check" : "Connect"}</button>
        {githubConnection?.login ? <button type="button" className="st-button is-quiet" disabled={githubConnectionBusy} onClick={() => void changeGitHubConnection("disconnect")}>Disconnect</button> : null}
      </Row>
      {githubActionError ? <Row title={<span className="st-error">{githubActionError}</span>} /> : null}
    </Section>
    <Section title="Pull requests">
      <Row title="Open as draft" description="You can still choose for each pull request.">
        <Switch label="Open pull requests as drafts" checked={settings.prDraft} onChange={value => update({ prDraft: value })} />
      </Row>
    </Section>
  </>

  // --- Terminal ---
  const terminal = <Section title="Terminal" description="Commands run as this host’s user. Agents run their own commands separately, subject to approvals.">
    <Row title="Start a shell automatically" description="Opening the Terminal panel starts a shell in the session’s workspace.">
      <Switch label="Start a shell automatically" checked={settings.terminalAutoStart} onChange={value => update({ terminalAutoStart: value })} />
    </Row>
    <Row title="Font size">
      <select className="st-select" aria-label="Terminal font size" value={settings.terminalFontSize} onChange={event => update({ terminalFontSize: Number(event.target.value) })}>{[11, 12, 13, 14, 15, 16, 18, 20].map(size => <option key={size} value={size}>{size}px</option>)}</select>
    </Row>
    <Row title="Scrollback">
      <select className="st-select" aria-label="Terminal scrollback" value={settings.terminalScrollback} onChange={event => update({ terminalScrollback: Number(event.target.value) })}>{[1000, 5000, 10000, 20000].map(lines => <option key={lines} value={lines}>{lines.toLocaleString()} lines</option>)}</select>
    </Row>
  </Section>

  // --- Notifications ---
  const requestPermission = async () => {
    if (typeof Notification === "undefined") return
    setPermission(await Notification.requestPermission())
  }
  const notifications = <Section title="Desktop notifications" description="Shown only when ADE isn’t the window you’re using.">
    <Row title="Permission" description={permission === "denied" ? "Blocked. Allow notifications for ADE in your system settings." : permission === "unsupported" ? "This window can’t show notifications." : undefined}>
      {permission === "granted" ? <><Status tone="ok">Allowed</Status><button type="button" className="st-button is-quiet" onClick={() => new Notification("ADE", { body: "Notifications are working." })}>Send test</button></>
        : permission === "default" ? <button type="button" className="st-button" onClick={() => void requestPermission()}>Allow</button>
          : <Status tone="off">{permission === "denied" ? "Blocked" : "Unavailable"}</Status>}
    </Row>
    <Row title="When an agent finishes"><Switch label="Notify when an agent finishes" checked={settings.notifyOnFinish} disabled={permission !== "granted"} onChange={value => update({ notifyOnFinish: value })} /></Row>
    <Row title="When an agent needs approval"><Switch label="Notify when an agent needs approval" checked={settings.notifyOnApproval} disabled={permission !== "granted"} onChange={value => update({ notifyOnApproval: value })} /></Row>
  </Section>

  // --- Environments ---
  const environments = <>
    <Section title="Hosts" plain>
      <div className="st-embedded"><EnvironmentSettings onEnvironmentChanged={onEnvironmentChanged} disabled={disabled} autoOpenAdd={autoOpenAddEnvironment} /></div>
    </Section>
    <Section title="Diagnostics">
      <Row title="Active environment"><span className="st-value">{activeEnvironmentName}</span></Row>
      <Row title="Runtime">{runtime?.online ? <Status tone="ok">Online</Status> : <Status tone="error">{runtimeError || "Waiting"}</Status>}</Row>
      <Row title="MCP servers connected"><span className="st-value">{mcpServers.filter(server => server.status === "connected").length}</span></Row>
      <Row title="Git worktrees" description="Inspect worktrees registered for a repository."><button type="button" className="st-button" onClick={onWorktreeDiagnostics}>Inspect</button></Row>
    </Section>
    <Section title="About">
      <Row title="ADE" description="Projects, isolated agent sessions on their own branches, review, and pull requests in one app." />
    </Section>
  </>

  const usage = <UsageSettings budget={settings.monthlyBudget} onBudgetChange={value => update({ monthlyBudget: value })} projects={projects} sessionLabels={sessionLabels} />
  const integrations = <IntegrationsSettings />
  const subagents = <SubagentSettings modelCatalog={modelCatalog} />
  const content = { general, appearance, models, agents, usage, subagents, integrations, github, terminal, notifications, environments }[selectedCategory]

  return <main className="st-layout">
    <aside className="st-nav" aria-label="Settings navigation">
      <button type="button" className="st-back" onClick={onBack}><ArrowLeft size={14} /> Back to app</button>
      <div className="st-search">
        <Search size={13} aria-hidden="true" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && visibleGroups[0]?.items[0]) setSelectedCategory(visibleGroups[0].items[0].id)
            if (event.key === "Escape") setQuery("")
          }}
          placeholder="Search settings"
          aria-label="Search settings"
        />
        {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={12} /></button> : null}
      </div>
      <nav className="st-nav-groups">
        {visibleGroups.map(group => <div key={group.label} className="st-nav-group">
          <span className="st-nav-label">{group.label}</span>
          {group.items.map(item => {
            const Icon = item.icon
            return <button type="button" key={item.id} className={`st-nav-item ${selectedCategory === item.id ? "is-active" : ""}`} aria-current={selectedCategory === item.id ? "page" : undefined} onClick={() => setSelectedCategory(item.id)}><Icon size={15} /><span>{item.label}</span></button>
          })}
        </div>)}
        {!visibleGroups.length ? <p className="st-nav-empty">No settings match “{query}”.</p> : null}
      </nav>
      <div className="st-nav-host"><span className={`st-dot ${runtime?.online ? "is-ok" : "is-off"}`} />{activeEnvironmentName}</div>
    </aside>
    <section className="st-main">
      <header className="st-topbar"><span>Settings</span><span aria-hidden="true">/</span><strong>{selected.label}</strong></header>
      <div className="st-scroll">
        <div className={`st-content ${selectedCategory === "models" ? "is-wide" : ""}`}>
          <h1>{selected.label}</h1>
          <p className="st-lede">{selected.description}</p>
          {error ? <p className="st-banner is-error" role="alert">{error}</p> : null}
          {runtimeError && !runtime?.online ? <p className="st-banner is-error" role="alert">{runtimeError}</p> : null}
          {content}
        </div>
      </div>
    </section>
  </main>
}
