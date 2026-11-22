import { useEffect, useState, type ReactNode } from "react"
import {
  ArrowLeft, Bell, Bot, ChevronRight, CircleHelp, Code2, FileText, FolderGit2, Gauge, Globe2, History,
  Keyboard, MessageSquare, Mic, Palette, PanelLeft, Plug, Search, Server, Settings2,
  Shield, Smartphone, Sparkles, Terminal, type LucideIcon,
} from "lucide-react"
import { EnvironmentSettings } from "./EnvironmentSettings"
import { colorPalettes, paletteVariables, type Theme } from "./appearance-palettes"
import type { ApprovalPolicy, ApprovalRule, BrowserState, EnvironmentDirectory, McpServerStatus, RuntimeHealth, SkillsAndRulesCatalog } from "./app-types"
import type { Project } from "./ProjectsView"
import type { Settings } from "./useSettings"
import { modelCredentialProviders, type useConnections } from "./useConnections"
import { Input } from "@/components/ui/input"
import { McpAndSecuritySettings } from "./src/panels/McpSettingsSection"

export type SettingsCategory =
  | "app-general" | "app-appearance" | "app-sidebar" | "app-chat" | "app-terminal" | "app-browser"
  | "app-editor" | "app-files" | "app-shortcuts" | "app-integrations" | "app-notifications"
  | "app-permissions" | "app-diagnostics" | "app-about"
  | "host-overview" | "host-projects" | "host-connections" | "host-pair-device" | "host-agents"
  | "host-metadata" | "host-voice" | "host-workspaces" | "host-providers" | "host-usage"
  | "host-terminals" | "host-plugins"

type SettingsItem = { id: SettingsCategory; label: string; icon: LucideIcon }

const appItems: SettingsItem[] = [
  { id: "app-general", label: "General", icon: Settings2 },
  { id: "app-appearance", label: "Appearance", icon: Palette },
  { id: "app-sidebar", label: "Sidebar", icon: PanelLeft },
  { id: "app-chat", label: "Chat", icon: MessageSquare },
  { id: "app-terminal", label: "Terminal", icon: Terminal },
  { id: "app-browser", label: "Browser", icon: Globe2 },
  { id: "app-editor", label: "Editor", icon: Code2 },
  { id: "app-files", label: "Files", icon: FileText },
  { id: "app-shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "app-integrations", label: "Integrations", icon: Plug },
  { id: "app-notifications", label: "Notifications", icon: Bell },
  { id: "app-permissions", label: "Permissions", icon: Shield },
  { id: "app-diagnostics", label: "Diagnostics", icon: History },
  { id: "app-about", label: "About", icon: CircleHelp },
]

const hostItems: SettingsItem[] = [
  { id: "host-overview", label: "Overview", icon: Server },
  { id: "host-projects", label: "Projects", icon: FolderGit2 },
  { id: "host-connections", label: "Connections", icon: Plug },
  { id: "host-pair-device", label: "Pair device", icon: Smartphone },
  { id: "host-agents", label: "Agents", icon: Bot },
  { id: "host-metadata", label: "Metadata", icon: FileText },
  { id: "host-voice", label: "Voice", icon: Mic },
  { id: "host-workspaces", label: "Workspaces", icon: FolderGit2 },
  { id: "host-providers", label: "Providers", icon: Sparkles },
  { id: "host-usage", label: "Usage", icon: Gauge },
  { id: "host-terminals", label: "Terminals", icon: Terminal },
  { id: "host-plugins", label: "Plugins", icon: Plug },
]

const categoryDescriptions: Record<SettingsCategory, string> = {
  "app-general": "ADE’s local app behavior and data boundaries.",
  "app-appearance": "Choose the visual theme and color palette.",
  "app-sidebar": "Navigation and sidebar preferences.",
  "app-chat": "Default model, harness, and reasoning options.",
  "app-terminal": "Terminal integration preferences.",
  "app-browser": "Browser integration preferences.",
  "app-editor": "Editor integration preferences.",
  "app-files": "File attachments and workspace file access.",
  "app-shortcuts": "Keyboard shortcuts available in ADE.",
  "app-integrations": "Accounts connected to the active ADE host.",
  "app-notifications": "Notification preferences.",
  "app-permissions": "Workspace and host security boundaries.",
  "app-diagnostics": "Runtime health and local worktree diagnostics.",
  "app-about": "ADE version and project information.",
  "host-overview": "Status and identity for the active environment.",
  "host-projects": "Projects stored on the active environment.",
  "host-connections": "Manage local and SSH-connected environments.",
  "host-pair-device": "Connect another device to this environment.",
  "host-agents": "Agent capabilities available on this host.",
  "host-metadata": "Project and session metadata conventions.",
  "host-voice": "Voice input and output for this host.",
  "host-workspaces": "Workspace setup and Git worktree diagnostics.",
  "host-providers": "Model providers and credentials for this host.",
  "host-usage": "Usage information for this host.",
  "host-terminals": "Terminal sessions on this host.",
  "host-plugins": "Plugins installed for this host.",
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
  sending: boolean
  credentialChangesBlocked: boolean
  connections: ReturnType<typeof useConnections>
  projects: Project[]
  activeEnvironmentName: string
  update: (patch: Partial<Settings>) => void
  onBack: () => void
  onOpenProjects: () => void
  onWorktreeDiagnostics: () => void
  onEnvironmentChanged: (activeId: string, activeName: string, directory: EnvironmentDirectory) => void
  mcpServers?: McpServerStatus[]
  approvalPolicy?: ApprovalPolicy
  approvalRules?: ApprovalRule[]
  browserState?: BrowserState
  skillsCatalog?: SkillsAndRulesCatalog
  onRefreshMcp?: () => void
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => Promise<void>
  onDeleteApprovalRule?: (id: string) => Promise<void>
  initialCategory?: SettingsCategory
  autoOpenAddEnvironment?: boolean
}

function InformationCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-card"><h2>{title}</h2>{children}</section>
}

function NotAvailable({ feature }: { feature: string }) {
  return <InformationCard title={`${feature} isn’t connected yet`}>
    <p className="hint">This category is reserved for the ADE settings layout. The corresponding {feature.toLowerCase()} functionality is not implemented in this app yet.</p>
  </InformationCard>
}

export function SettingsView({ settings, resolved, error, runtimeError, runtime, matchingRuntime, providerName, selectedModel, sending, credentialChangesBlocked, connections, projects, activeEnvironmentName, update, onBack, onOpenProjects, onWorktreeDiagnostics, onEnvironmentChanged, mcpServers = [], approvalPolicy = "auto-safe", approvalRules = [], browserState, skillsCatalog, onRefreshMcp, onChangeApprovalPolicy, onDeleteApprovalRule, initialCategory, autoOpenAddEnvironment = false }: SettingsViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>(initialCategory ?? "app-general")
  const [providerQuery, setProviderQuery] = useState("")

  useEffect(() => {
    if (initialCategory) setSelectedCategory(initialCategory)
  }, [initialCategory])
  const {
    githubConnection, githubStatusError, githubCliError, githubActionError, githubConnectionBusy, changeGitHubConnection,
    copilotHealth, copilotStatusError, copilotActionError, copilotSignIn, copilotWaiting, authBusy, changeCopilotAuth,
    modelCredentials, modelCredentialStatusError, modelCredentialActionError, modelCredentialBusy, saveModelCredential, changeModelCredential,
    providerTools, providerToolsError, providerToolsBusy, setProviderEnabled,
  } = connections
  const items = [...appItems, ...hostItems]
  const selected = items.find(item => item.id === selectedCategory) ?? appItems[0]
  const disabled = sending || credentialChangesBlocked || authBusy || githubConnectionBusy || Boolean(modelCredentialBusy)

  const appearance = <>
    <fieldset><legend>Display mode</legend><div className="segmented">
      {(["light", "system", "dark"] as const).map(value => <button type="button" key={value} className={settings.theme === value ? "active" : ""} aria-pressed={settings.theme === value} onClick={() => update({ theme: value })}>{value[0].toUpperCase() + value.slice(1)}</button>)}
    </div><p className="hint">{settings.theme === "system" ? `Following your system’s ${resolved} mode.` : `Using ${resolved} mode.`}</p></fieldset>
    <fieldset><legend>Color theme</legend><p className="hint">Choose a palette; every theme is available in light and dark.</p><div className="palette-grid">
      {colorPalettes.map(palette => {
        const variables = paletteVariables(palette.id, resolved)
        return <button type="button" key={palette.id} className={`palette ${settings.palette === palette.id ? "chosen" : ""}`} onClick={() => update({ palette: palette.id })} aria-pressed={settings.palette === palette.id}>
          <span className="swatch" style={variables}><i /><i /><i /></span><span><strong>{palette.id === "tokyo" ? (resolved === "dark" ? "Tokyo Night" : "Tokyo Day") : palette.name}</strong><small>{palette.description}</small></span>
        </button>
      })}
    </div></fieldset>
    <fieldset><legend>Fonts</legend>
      <div className="appearance-control-list">
        <label className="appearance-control"><span><strong>Interface font</strong><small>Used across navigation, controls, and labels. Leave empty for the system font.</small></span><Input value={settings.interfaceFont} onChange={event => update({ interfaceFont: event.target.value })} placeholder="system-ui, -apple-system, sans-serif" /></label>
        <label className="appearance-control"><span><strong>Interface size</strong><small>Used for navigation, controls, and labels.</small></span><span className="appearance-number"><Input aria-label="Interface size" type="number" min={11} max={20} value={settings.interfaceSize} onChange={event => update({ interfaceSize: Math.min(20, Math.max(11, Number(event.target.value) || 11)) })} /><small>px</small></span></label>
        <label className="appearance-control"><span><strong>Content size</strong><small>Used for chat text and rendered Markdown.</small></span><span className="appearance-number"><Input aria-label="Content size" type="number" min={12} max={22} value={settings.contentSize} onChange={event => update({ contentSize: Math.min(22, Math.max(12, Number(event.target.value) || 12)) })} /><small>px</small></span></label>
        <label className="appearance-control"><span><strong>Code font</strong><small>Used for code blocks, diffs, and terminal output.</small></span><Input value={settings.codeFont} onChange={event => update({ codeFont: event.target.value })} placeholder="SFMono-Regular, Menlo, Consolas, monospace" /></label>
        <label className="appearance-control"><span><strong>Code size</strong><small>Used for code, diffs, and terminal output.</small></span><span className="appearance-number"><Input aria-label="Code size" type="number" min={10} max={18} value={settings.codeSize} onChange={event => update({ codeSize: Math.min(18, Math.max(10, Number(event.target.value) || 10)) })} /><small>px</small></span></label>
      </div>
    </fieldset>
    <fieldset><legend>Layout</legend>
      <label className="appearance-control"><span><strong>Content width</strong><small>Maximum width of chat and Markdown on wide screens.</small></span><span className="appearance-number"><Input aria-label="Content width" type="number" min={640} max={1200} step={10} value={settings.contentWidth} onChange={event => update({ contentWidth: Math.min(1200, Math.max(640, Number(event.target.value) || 640)) })} /><small>px</small></span></label>
    </fieldset>
    <fieldset><legend>Syntax</legend>
      <label className="appearance-control"><span><strong>Highlight theme</strong><small>Colors used for code syntax, independent of the app theme.</small></span><select aria-label="Highlight theme" value={settings.highlightTheme} onChange={event => update({ highlightTheme: event.target.value as "auto" | "github" | "monochrome" })}><option value="auto">Automatic</option><option value="github">GitHub</option><option value="monochrome">Monochrome</option></select></label>
    </fieldset>
  </>

  const chatDefaults = <>
    <p className={`runtime-notice ${runtime?.configured ? "ready" : ""}`} role="status">
      {matchingRuntime?.online ? matchingRuntime.configured
        ? `Active host is ready with ${providerName}.`
        : matchingRuntime.message || "The runtime is online, but its model provider is not configured."
        : runtimeError || "Waiting for the active ADE runtime."}
    </p>
    <div className="settings-grid">
      <label>Harness<select value={settings.harness} onChange={event => update({ harness: event.target.value })}><option value="pi">Pi Durable · active</option><option value="copilot" disabled>GitHub Copilot SDK · not available yet</option></select><small>Pi Durable runs both conversations and coding sessions.</small></label>
      <label>Model provider<select value={settings.provider || runtime?.provider || ""} disabled={!runtime?.providers?.length} onChange={event => update({ provider: event.target.value, model: "" })}>{!runtime?.providers?.length && <option value={settings.provider || runtime?.provider || ""}>Waiting for runtime</option>}{runtime?.providers?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Model<select value={selectedModel} disabled={!matchingRuntime?.configured} onChange={event => update({ model: event.target.value })}>{!selectedModel && <option value="">No model available</option>}{matchingRuntime?.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Reasoning level<select value={settings.reasoning} onChange={event => update({ reasoning: event.target.value })}><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select><small>Support varies by model.</small></label>
    </div>
  </>

  const integrations = <div className="settings-card-list">
    <section className="connection-item">
      <h2>GitHub repositories</h2>
      <p className="hint">Uses the active host’s GitHub CLI account and existing permissions. ADE saves the selected account name, not its credential.</p>
      {githubStatusError ? <p className="error" role="alert">GitHub connection unavailable: {githubStatusError}</p>
        : <p className="connection-status" role="status">{githubConnection ? githubConnection.login ? `Linked account: ${githubConnection.login}` : "Not connected to ADE" : "Checking connection…"}</p>}
      {githubActionError && <p className="error" role="alert">{githubActionError}</p>}
      {!githubConnection?.login && githubCliError && <p className="hint" role="status">{githubCliError}</p>}
      {!githubConnection?.login && <p className="hint">If needed, install GitHub CLI and sign in first with <code>gh auth login --hostname github.com --web</code>.</p>}
      <div className="form-actions">
        <button type="button" className="quiet-button" disabled={githubConnectionBusy || !githubConnection || Boolean(githubStatusError)} onClick={() => void changeGitHubConnection("connect")}>{githubConnectionBusy ? "Working…" : githubConnection?.login ? "Check GitHub account" : "Connect GitHub CLI"}</button>
        {githubConnection?.login && <button type="button" className="quiet-button" disabled={githubConnectionBusy} onClick={() => void changeGitHubConnection("disconnect")}>Disconnect from ADE</button>}
      </div>
      {githubConnection?.login && <p className="hint">Disconnecting in ADE does not sign out of GitHub CLI.</p>}
    </section>
    <section className="connection-item">
      <h2>GitHub Copilot</h2>
      <p className="hint">Authorize the Pi model provider separately from GitHub CLI. Eligible models depend on your account and organization policy.</p>
      {copilotStatusError ? <p className="error" role="alert">Copilot status unavailable: {copilotStatusError}</p>
        : <p className="connection-status" role="status">{copilotHealth ? copilotHealth.copilotSignedIn ? "Signed in to ADE" : "Not signed in to ADE" : "Checking sign-in…"}</p>}
      {copilotWaiting && <p className="hint" role="status">{copilotSignIn?.code && copilotSignIn.url
        ? <>Open <a href={copilotSignIn.url} target="_blank" rel="noreferrer">GitHub device verification</a> and enter <strong>{copilotSignIn.code}</strong>.</>
        : "Waiting for GitHub’s device code…"}</p>}
      {copilotSignIn?.message && <p className="error" role="alert">{copilotSignIn.message}</p>}
      {copilotActionError && <p className="error" role="alert">{copilotActionError}</p>}
      <div className="form-actions">
        <button type="button" className="quiet-button" disabled={authBusy || !copilotHealth || Boolean(copilotStatusError) || sending} onClick={() => void changeCopilotAuth(copilotWaiting ? "cancel" : "start")}>{copilotWaiting ? "Cancel sign-in" : copilotHealth?.copilotSignedIn ? "Reconnect GitHub Copilot" : "Sign in to GitHub Copilot"}</button>
        {!copilotWaiting && copilotHealth?.copilotSignedIn && <button type="button" className="quiet-button" disabled={authBusy || sending} onClick={() => void changeCopilotAuth("sign-out")}>Sign out of ADE</button>}
      </div>
    </section>
    <section className="connection-item">
      <h2>Anthropic Claude</h2>
      <p className="hint">Connect Claude models through Anthropic. The API key is stored on the active host and is never shown after it is saved.</p>
      {modelCredentialStatusError ? <p className="error" role="alert">Anthropic credential status unavailable: {modelCredentialStatusError}</p>
        : <p className="connection-status" role="status">{modelCredentials?.find(item => item.provider === "anthropic")?.source === "saved" ? "API key saved on this host"
          : modelCredentials?.find(item => item.provider === "anthropic")?.source === "environment" ? "Using ANTHROPIC_API_KEY"
          : modelCredentials ? "No API key saved" : "Checking credential…"}</p>}
      {modelCredentialActionError && <p className="error" role="alert">{modelCredentialActionError}</p>}
      <form className="provider-key-form" onSubmit={event => saveModelCredential(event, "anthropic")}>
        <label htmlFor="api-key-anthropic-integration">Anthropic API key</label>
        <div className="provider-key-actions">
          <input id="api-key-anthropic-integration" name="apiKey" type="password" autoComplete="new-password" maxLength={4096} placeholder="sk-ant-..." required disabled={Boolean(modelCredentialBusy) || credentialChangesBlocked} />
          <button className="quiet-button" disabled={Boolean(modelCredentialBusy) || credentialChangesBlocked}>{modelCredentialBusy?.provider === "anthropic" && modelCredentialBusy.action === "save" ? "Saving…" : "Save key"}</button>
          {modelCredentials?.find(item => item.provider === "anthropic")?.source === "saved" && <button type="button" className="quiet-button" disabled={Boolean(modelCredentialBusy) || credentialChangesBlocked} onClick={() => void changeModelCredential("remove", "anthropic")}>{modelCredentialBusy?.provider === "anthropic" && modelCredentialBusy.action === "remove" ? "Removing…" : "Remove key"}</button>}
        </div>
      </form>
    </section>
  </div>

  const providers = <>
    <p className="hint">ADE scans this host for installed CLI tools and connected model providers.</p>
    {providerToolsError && <p className="error" role="alert">{providerToolsError}</p>}
    <div className="provider-search"><Search size={14} /><input aria-label="Search providers" placeholder="Search providers" value={providerQuery} onChange={event => setProviderQuery(event.target.value)} /></div>
    {!providerTools && <p className="hint" role="status">Scanning providers…</p>}
    {providerTools && <div className="provider-catalog">{providerTools.filter(provider => provider.name.toLowerCase().includes(providerQuery.trim().toLowerCase())).map(provider => <div className="provider-row" key={provider.id}>
      <details>
        <summary><ChevronRight className="provider-chevron" size={14} /><Sparkles size={14} /><strong>{provider.name}</strong><span className={provider.available ? "provider-state available" : "provider-state disabled"}>{provider.available ? provider.modelCount ? `Available · ${provider.modelCount} models` : "Available" : "Disabled"}</span></summary>
        <div className="provider-detail">
          {provider.kind === "cli"
            ? provider.installed
              ? <p>CLI <code>{provider.command}</code> is installed on this host.</p>
              : <p>{provider.install}. ADE will enable it after the CLI is available.</p>
            : <p>{provider.available ? "Connected through credentials or environment configuration." : "Add credentials below to enable this provider."}</p>}
        </div>
      </details>
      <button type="button" className={`provider-toggle ${provider.enabled ? "on" : ""}`} role="switch" aria-label={`${provider.enabled ? "Disable" : "Enable"} ${provider.name}`} aria-checked={provider.enabled} disabled={!provider.available || providerToolsBusy === provider.id} onClick={() => void setProviderEnabled(provider.id, !provider.enabled)}><span /></button>
    </div>)}</div>}

    <div className="provider-credentials-heading"><strong>API credentials</strong><span>Stored on this host</span></div>
    {modelCredentialStatusError && <p className="error" role="alert">Model credential status unavailable: {modelCredentialStatusError}</p>}
    {modelCredentialActionError && <p className="error" role="alert">{modelCredentialActionError}</p>}
    <div className="provider-credentials">{modelCredentialProviders.map(provider => {
      const source = modelCredentials?.find(item => item.provider === provider.id)?.source
      const working = modelCredentialBusy?.provider === provider.id
      const credentialDisabled = Boolean(modelCredentialBusy) || credentialChangesBlocked
      return <div className="provider-credential" key={provider.id}>
        <div className="provider-credential-heading"><strong>{provider.name}</strong><span role="status">{modelCredentialStatusError ? "Status unavailable" : !source ? "Checking…" : source === "saved" ? "Saved on this host" : source === "environment" ? "Using environment key" : "No key saved"}</span></div>
        <form className="provider-key-form" onSubmit={event => saveModelCredential(event, provider.id)}>
          <label htmlFor={`api-key-${provider.id}`}>API key</label>
          <div className="provider-key-actions">
            <input id={`api-key-${provider.id}`} name="apiKey" type="password" autoComplete="new-password" maxLength={4096} placeholder="Enter a new key" required disabled={credentialDisabled} />
            <button className="quiet-button" disabled={credentialDisabled}>{working && modelCredentialBusy?.action === "save" ? "Saving…" : "Save key"}</button>
            {(source === "saved" || Boolean(modelCredentialStatusError)) && <button type="button" className="quiet-button" disabled={credentialDisabled} onClick={() => void changeModelCredential("remove", provider.id)}>{working && modelCredentialBusy?.action === "remove" ? "Removing…" : "Remove saved key"}</button>}
          </div>
        </form>
      </div>
    })}</div>
  </>

  const content = (() => {
    switch (selectedCategory) {
      case "app-general":
        return <InformationCard title="ADE workspace">
          <p className="hint">ADE keeps each coding session, personal chat, and project conversation separate. Choose a host in the Host → Connections category to switch where new sessions and project data live.</p>
          <div className="settings-facts"><span>Active environment</span><strong>{activeEnvironmentName}</strong><span>Runtime</span><strong>{runtime?.online ? "Online" : "Waiting for runtime"}</strong></div>
        </InformationCard>
      case "app-appearance": return appearance
      case "app-chat": return chatDefaults
      case "app-terminal":
        return <><InformationCard title="Terminal preferences"><div className="settings-grid">
          <label>Font size<select value={settings.terminalFontSize} onChange={event => update({ terminalFontSize: Number(event.target.value) })}>{[11, 12, 13, 14, 15, 16, 18, 20].map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
          <label>Scrollback<select value={settings.terminalScrollback} onChange={event => update({ terminalScrollback: Number(event.target.value) })}>{[1000, 5000, 10000, 20000].map(lines => <option key={lines} value={lines}>{lines.toLocaleString()} lines</option>)}</select></label>
        </div></InformationCard><InformationCard title="Shell access"><p className="hint">A terminal starts only after you click Start terminal in a coding workspace. Commands run as the active host’s OS user. Terminal input is user-operated and is not exposed as an agent tool.</p></InformationCard></>
      case "app-integrations": return integrations
      case "app-files":
        return <InformationCard title="Attachments and workspace files">
          <p className="hint">Use the composer + or Inspector → Workspace → Add files to attach small UTF-8 text files to a message. Attachments are copied into the message; this does not connect a workspace or edit the original file.</p>
        </InformationCard>
      case "app-shortcuts":
        return <InformationCard title="Keyboard shortcuts"><div className="settings-facts"><span>Search projects and sessions</span><strong><kbd>⌘ K</kbd> / <kbd>Ctrl K</kbd></strong><span>More shortcuts</span><strong>Not customizable yet</strong></div></InformationCard>
      case "app-permissions":
        return <>
          <InformationCard title="Workspace & command boundaries"><p className="hint">Coding sessions can read/edit files, search code, and run shell commands in their bound checkout or worktree. Command approvals pause tool execution using durable Pi signals until you allow or deny them.</p></InformationCard>
          {onChangeApprovalPolicy && onDeleteApprovalRule && onRefreshMcp ? (
            <McpAndSecuritySettings
              mcpServers={mcpServers}
              approvalPolicy={approvalPolicy}
              approvalRules={approvalRules}
              onRefreshMcp={onRefreshMcp}
              onChangeApprovalPolicy={onChangeApprovalPolicy}
              onDeleteApprovalRule={onDeleteApprovalRule}
            />
          ) : null}
        </>
      case "app-browser":
        return <InformationCard title="Built-in & External Browser">
          <div className="settings-facts">
            <span>Chrome CDP engine</span><strong>{browserState?.available ? "Detected" : "Not detected (iframe & external available)"}</strong>
            <span>Binary path</span><strong>{browserState?.chromePath ?? "Set ADE_CHROME_PATH to override"}</strong>
            <span>External launch</span><strong>System default browser</strong>
          </div>
          <p className="hint">Open the Browser pane inside any session to preview localhost servers or external sites interactively, let agents drive the page via CDP, or click External to open in your default browser.</p>
        </InformationCard>
      case "app-diagnostics":
        return <><InformationCard title="Runtime status"><p className="connection-status" role="status">{runtime?.online ? runtime.configured ? `Online · ${providerName} · ${selectedModel || runtime.defaultModel}` : runtime.message || "Online · model setup required" : runtimeError || "Waiting for the active ADE runtime."}</p></InformationCard><InformationCard title="Workspace diagnostics"><p className="hint">Inspect registered Git worktrees when a workspace needs attention.</p><button className="quiet-button" onClick={onWorktreeDiagnostics}><History size={14} /> Open worktree diagnostics</button></InformationCard></>
      case "app-about":
        return <InformationCard title="ADE"><p className="hint">A Paseo-inspired Agentic Development Environment built on Tauri 2, React, and Pi Durable with split panes, multi-subagent orchestration, interactive approvals, built-in Chrome CDP browser, artifacts, skills, and MCP.</p></InformationCard>
      case "host-overview":
        return <><InformationCard title={activeEnvironmentName}><p className="connection-status" role="status"><span className={`status-dot ${runtime?.online ? "online" : "offline"}`} /> {runtime?.online ? runtime.configured ? `Online · ${providerName}` : "Online · model setup required" : runtimeError || "Waiting for host"}</p><p className="hint">Conversation and project data are stored on this environment. Switching environments changes the active host; it does not copy data between hosts.</p></InformationCard><InformationCard title="Runtime capabilities"><div className="settings-facts"><span>Harness</span><strong>{runtime?.harness ?? "Pi Durable"}</strong><span>Workspace tools</span><strong>Files, Search, Shell + Approvals</strong><span>Orchestration</span><strong>Multi-subagents (readonly, workspace, worktree)</strong><span>Browser &amp; MCP</span><strong>Chrome CDP + {mcpServers.filter(s => s.status === "connected").length} connected MCP</strong></div></InformationCard></>
      case "host-projects":
        return <InformationCard title="Projects on this host"><p className="hint">Project settings and default checkouts are managed from the Projects view.</p>{projects.length ? <ul className="settings-project-list">{projects.map(project => <li key={project.id}><FolderGit2 size={14} /> {project.name}</li>)}</ul> : <p className="hint">No projects on this environment yet.</p>}<button className="quiet-button" onClick={onOpenProjects}>Open projects</button></InformationCard>
      case "host-connections": return <EnvironmentSettings onEnvironmentChanged={onEnvironmentChanged} disabled={disabled} autoOpenAdd={autoOpenAddEnvironment} />
      case "host-agents":
        return <InformationCard title="Pi Durable multi-agent orchestration">
          <p className="hint">Session leads can spawn 1 or more parallel subagents (read-only, shared workspace, or isolated Git worktrees), steer or message them mid-run, write plans/artifacts, and load workspace/global skills.</p>
          {skillsCatalog ? (
            <div className="settings-facts">
              <span>Discovered skills</span><strong>{skillsCatalog.skills.length}</strong>
              <span>Rules files</span><strong>{skillsCatalog.rules.length}</strong>
              <span>Slash commands</span><strong>{skillsCatalog.commands.length}</strong>
            </div>
          ) : null}
        </InformationCard>
      case "host-workspaces":
        return <><InformationCard title="Coding workspaces"><p className="hint">Each coding session can use no workspace, a current checkout, or an isolated Git worktree. The selected host opens and edits its own filesystem paths.</p><button className="quiet-button" onClick={onWorktreeDiagnostics}><History size={14} /> Inspect Git worktrees</button></InformationCard></>
      case "host-providers": return providers
      case "app-sidebar": return <NotAvailable feature="Sidebar customization" />
      case "app-editor": return <InformationCard title="Workspace editor"><p className="hint">Open any file from the Files pane or tool call cards to view or edit it inline with Cmd+S save.</p></InformationCard>
      case "app-notifications": return <NotAvailable feature="Notifications" />
      case "host-pair-device": return <NotAvailable feature="Device pairing" />
      case "host-metadata": return <NotAvailable feature="Metadata rules" />
      case "host-voice": return <NotAvailable feature="Voice" />
      case "host-usage": return <NotAvailable feature="Usage reporting" />
      case "host-terminals": return <InformationCard title="Interactive & Agent terminals"><p className="hint">Open a user terminal pane in any coding session, or inspect agent-run background commands via the Processes pane.</p></InformationCard>
      case "host-plugins":
        return onChangeApprovalPolicy && onDeleteApprovalRule && onRefreshMcp ? (
          <McpAndSecuritySettings
            mcpServers={mcpServers}
            approvalPolicy={approvalPolicy}
            approvalRules={approvalRules}
            onRefreshMcp={onRefreshMcp}
            onChangeApprovalPolicy={onChangeApprovalPolicy}
            onDeleteApprovalRule={onDeleteApprovalRule}
          />
        ) : <NotAvailable feature="MCP & Plugins" />
    }
  })()

  return <main className="settings-layout">
    <aside className="settings-nav" aria-label="Settings navigation">
      <button type="button" className="settings-back" onClick={onBack}><ArrowLeft size={14} /> Back</button>
      <div className="settings-nav-group"><span className="settings-nav-label">App</span>{appItems.map(item => {
        const Icon = item.icon
        return <button type="button" key={item.id} className={`settings-nav-item${selectedCategory === item.id ? " active" : ""}`} aria-current={selectedCategory === item.id ? "page" : undefined} onClick={() => setSelectedCategory(item.id)}><Icon size={15} /><span>{item.label}</span></button>
      })}</div>
      <div className="settings-nav-group"><span className="settings-nav-label">Host</span><div className="settings-host-name"><span className={`status-dot ${runtime?.online ? "online" : "offline"}`} />{activeEnvironmentName}</div>{hostItems.map(item => {
        const Icon = item.icon
        return <button type="button" key={item.id} className={`settings-nav-item${selectedCategory === item.id ? " active" : ""}`} aria-current={selectedCategory === item.id ? "page" : undefined} onClick={() => setSelectedCategory(item.id)}><Icon size={15} /><span>{item.label}</span></button>
      })}</div>
    </aside>
    <section className="settings-main">
      <header className="settings-heading"><h1>{selected.label}</h1><p>{categoryDescriptions[selectedCategory]}</p></header>
      {(error || runtimeError) && <div className="settings-global-errors">{error && <p className="error" role="alert">{error}</p>}{runtimeError && selectedCategory !== "app-diagnostics" && <p className="error" role="alert">{runtimeError}</p>}</div>}
      <div className="settings-content">
        {content}
      </div>
    </section>
  </main>
}
