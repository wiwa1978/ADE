import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import {
  ArrowLeft, Bell, Bot, ChevronRight, GitPullRequest, History, Palette, Server, Settings2,
  Sparkles, Terminal, type LucideIcon,
} from "lucide-react"
import { EnvironmentSettings } from "./EnvironmentSettings"
import { colorPalettes, paletteVariables, type Theme } from "./appearance-palettes"
import type { ApprovalPolicy, ApprovalRule, BrowserState, EnvironmentDirectory, McpServerStatus, ProviderCatalogEntry, RuntimeHealth, SkillsAndRulesCatalog } from "./app-types"
import type { Project } from "./ProjectsView"
import type { Settings } from "./useSettings"
import { modelCredentialProviders, type useConnections } from "./useConnections"
import { Input } from "@/components/ui/input"
import { McpAndSecuritySettings } from "./src/panels/McpSettingsSection"
import { request } from "./api"

/** Settings categories. Every category here changes something real; nothing is a placeholder. */
export type SettingsCategory =
  | "general" | "appearance" | "models" | "agents" | "github" | "terminal" | "notifications" | "environments"

type SettingsItem = { id: SettingsCategory; label: string; icon: LucideIcon; description: string }

const items: SettingsItem[] = [
  { id: "general", label: "General", icon: Settings2, description: "Session defaults, archiving, and keyboard shortcuts." },
  { id: "appearance", label: "Appearance", icon: Palette, description: "Theme, color palette, fonts, and layout." },
  { id: "models", label: "Models", icon: Sparkles, description: "Model providers, API keys, and the default model for new messages." },
  { id: "agents", label: "Agents & permissions", icon: Bot, description: "Command approvals, MCP servers, and skills available to agents." },
  { id: "github", label: "Git & GitHub", icon: GitPullRequest, description: "GitHub account and pull request defaults." },
  { id: "terminal", label: "Terminal", icon: Terminal, description: "The interactive terminal in coding sessions." },
  { id: "notifications", label: "Notifications", icon: Bell, description: "Desktop notifications when agents need you." },
  { id: "environments", label: "Environments", icon: Server, description: "This computer and SSH hosts, runtime diagnostics, and version information." },
]

const reasoningLevels = [
  { id: "none", label: "None" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
  { id: "max", label: "Max" },
]

const shortcuts: [string, string][] = [
  ["Search projects and sessions", "⌘ K"],
  ["Focus the message box", "⌥ L"],
  ["Send message", "Enter"],
  ["New line in a message", "Shift Enter"],
  ["Commit in Changes", "Enter in the commit message"],
  ["Session menu: pin, rename, fork, archive, delete", "P, R, F, A, D while the menu is open"],
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
  initialCategory?: SettingsCategory
  autoOpenAddEnvironment?: boolean
}

function Card({ title, children, description }: { title: string; description?: string; children: ReactNode }) {
  return <section className="settings-card">
    <h2>{title}</h2>
    {description ? <p className="hint">{description}</p> : null}
    {children}
  </section>
}

function Toggle({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="settings-toggle">
    <span><strong>{label}</strong>{description ? <small>{description}</small> : null}</span>
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`provider-toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span /></button>
  </label>
}

function notificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission
}

export function SettingsView({
  settings, resolved, error, runtimeError, runtime, providerName, selectedModel, selectedProvider, modelCatalog,
  sending, credentialChangesBlocked, connections, activeEnvironmentName, update, onBack, onWorktreeDiagnostics,
  onEnvironmentChanged, onModelsChanged, mcpServers = [], approvalPolicy = "auto-safe", approvalRules = [], browserState,
  skillsCatalog, onRefreshMcp, onChangeApprovalPolicy, onDeleteApprovalRule, initialCategory, autoOpenAddEnvironment = false,
}: SettingsViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>(initialCategory ?? "general")
  const [permission, setPermission] = useState(notificationPermission)
  const [compatible, setCompatible] = useState<{ url: string; model: string; fromEnvironment: boolean } | null>(null)
  const [compatibleDraft, setCompatibleDraft] = useState({ url: "", model: "" })
  const [compatibleBusy, setCompatibleBusy] = useState(false)
  const [compatibleMessage, setCompatibleMessage] = useState("")

  useEffect(() => {
    if (initialCategory) setSelectedCategory(initialCategory)
  }, [initialCategory])

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
    copilotHealth, copilotStatusError, copilotActionError, copilotSignIn, copilotWaiting, authBusy, changeCopilotAuth,
    modelCredentials, modelCredentialStatusError, modelCredentialActionError, modelCredentialBusy, saveModelCredential, changeModelCredential,
    providerTools,
  } = connections
  const selected = items.find(item => item.id === selectedCategory) ?? items[0]
  const disabled = sending || credentialChangesBlocked || authBusy || githubConnectionBusy || Boolean(modelCredentialBusy)

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
      setCompatibleMessage("Saved.")
      onModelsChanged?.()
    } catch (cause) {
      setCompatibleMessage(cause instanceof Error ? cause.message : "Could not save the endpoint.")
    } finally {
      setCompatibleBusy(false)
    }
  }

  const general = <>
    <Card title="New sessions" description="Used when you start a session in a project that has a local checkout.">
      <div className="settings-grid">
        <label>Default workspace
          <select value={settings.defaultWorkspaceKind} onChange={event => update({ defaultWorkspaceKind: event.target.value as Settings["defaultWorkspaceKind"] })}>
            <option value="worktree">Worktree — own branch, isolated (recommended)</option>
            <option value="checkout">Checkout — work directly in the project folder</option>
            <option value="none">Chat only — no files</option>
          </select>
          <small>Worktree sessions get a readable branch such as <code>ade/fix-login-1a2b3c4d</code>.</small>
        </label>
      </div>
    </Card>
    <Card title="Archiving">
      <Toggle
        label="Remove the worktree when a session is archived"
        description="Frees disk space. The branch and conversation are kept, and restoring recreates the worktree. Worktrees with uncommitted changes are never removed."
        checked={settings.archiveRemovesWorktree}
        onChange={value => update({ archiveRemovesWorktree: value })}
      />
    </Card>
    <Card title="Startup">
      <Toggle label="Reopen the last project or session" description="After a reload or restart, ADE returns to where you were." checked={settings.restoreLastView} onChange={value => update({ restoreLastView: value })} />
    </Card>
    <Card title="Keyboard shortcuts">
      <div className="settings-facts">{shortcuts.map(([label, keys]) => <><span key={`${label}-l`}>{label}</span><strong key={`${label}-k`}><kbd>{keys}</kbd></strong></>)}</div>
    </Card>
  </>

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

  const configuredProviders = modelCatalog.filter(provider => provider.configured)
  const activeProvider = modelCatalog.find(provider => provider.id === selectedProvider)
  const detectedAgents = (providerTools ?? []).filter(tool => tool.kind === "cli" && tool.installed)

  const models = <>
    <Card title="Default model" description="Used for new messages. You can also change the model per message in the composer.">
      <p className={`runtime-notice ${activeProvider?.configured ? "ready" : ""}`} role="status">
        {!runtime?.online ? runtimeError || "Waiting for the active ADE runtime."
          : activeProvider?.configured ? `Ready · ${providerName} · ${selectedModel}`
            : configuredProviders.length ? `${activeProvider?.name ?? selectedProvider} isn’t set up. Pick a provider that is ready, or add its key below.`
              : "No model provider is set up yet. Add an API key or sign in to GitHub Copilot below."}
      </p>
      <div className="settings-grid">
        <label>Provider
          <select value={selectedProvider} onChange={event => update({ provider: event.target.value, model: "" })}>
            {modelCatalog.map(provider => <option key={provider.id} value={provider.id}>{provider.name}{provider.configured ? "" : " — not set up"}</option>)}
          </select>
        </label>
        <label>Model
          <select value={activeProvider?.configured ? selectedModel : ""} disabled={!activeProvider?.configured} onChange={event => update({ model: event.target.value })}>
            {!activeProvider?.configured ? <option value="">Set up this provider first</option> : null}
            {activeProvider?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
        </label>
        <label>Reasoning
          <select value={settings.reasoning === "off" ? "none" : settings.reasoning} onChange={event => update({ reasoning: event.target.value })}>
            {reasoningLevels.map(level => <option key={level.id} value={level.id}>{level.label}</option>)}
          </select>
          <small>Support varies by model.</small>
        </label>
      </div>
      <p className="hint">Agents run on the Pi Durable harness, which keeps conversations durable across restarts.</p>
    </Card>

    <Card title="API keys" description="Stored on the active host, encrypted with the operating system’s keychain. A key is never shown again after it is saved.">
      {modelCredentialStatusError ? <p className="error" role="alert">Credential status unavailable: {modelCredentialStatusError}</p> : null}
      {modelCredentialActionError ? <p className="error" role="alert">{modelCredentialActionError}</p> : null}
      <div className="provider-credentials">{modelCredentialProviders.map(provider => {
        const source = modelCredentials?.find(item => item.provider === provider.id)?.source
        const working = modelCredentialBusy?.provider === provider.id
        const credentialDisabled = Boolean(modelCredentialBusy) || credentialChangesBlocked
        return <div className="provider-credential" key={provider.id}>
          <div className="provider-credential-heading"><strong>{provider.name}</strong><span role="status">{modelCredentialStatusError ? "Status unavailable" : !source ? "Checking…" : source === "saved" ? "Key saved" : source === "environment" ? "Using environment variable" : "No key"}</span></div>
          <form className="provider-key-form" onSubmit={async event => { await saveModelCredential(event, provider.id); onModelsChanged?.() }}>
            <label htmlFor={`api-key-${provider.id}`}>API key</label>
            <div className="provider-key-actions">
              <input id={`api-key-${provider.id}`} name="apiKey" type="password" autoComplete="new-password" maxLength={4096} placeholder={source === "saved" ? "Enter a new key to replace it" : "Paste an API key"} required disabled={credentialDisabled} />
              <button className="quiet-button" disabled={credentialDisabled}>{working && modelCredentialBusy?.action === "save" ? "Saving…" : "Save key"}</button>
              {source === "saved" ? <button type="button" className="quiet-button" disabled={credentialDisabled} onClick={async () => { await changeModelCredential("remove", provider.id); onModelsChanged?.() }}>{working && modelCredentialBusy?.action === "remove" ? "Removing…" : "Remove"}</button> : null}
            </div>
          </form>
          {provider.id === "compatible" ? (
            <form className="provider-key-form" onSubmit={event => void saveCompatible(event)}>
              <label htmlFor="compatible-url">Endpoint URL and model</label>
              <div className="provider-key-actions">
                <input id="compatible-url" value={compatibleDraft.url} onChange={event => setCompatibleDraft(draft => ({ ...draft, url: event.target.value }))} placeholder="http://127.0.0.1:11434/v1" disabled={compatible?.fromEnvironment || compatibleBusy} />
                <input aria-label="Compatible model" value={compatibleDraft.model} onChange={event => setCompatibleDraft(draft => ({ ...draft, model: event.target.value }))} placeholder="llama3.1" disabled={compatible?.fromEnvironment || compatibleBusy} />
                <button className="quiet-button" disabled={compatible?.fromEnvironment || compatibleBusy}>{compatibleBusy ? "Saving…" : "Save"}</button>
              </div>
              {compatible?.fromEnvironment ? <small className="hint">Set by ADE_COMPATIBLE_URL / ADE_COMPATIBLE_MODEL in the launch environment.</small> : null}
              {compatibleMessage ? <small className="hint" role="status">{compatibleMessage}</small> : null}
              <small className="hint">Local endpoints (127.0.0.1, localhost) don’t need a key. Remote endpoints must use HTTPS and a key.</small>
            </form>
          ) : null}
        </div>
      })}</div>
    </Card>

    <Card title="GitHub Copilot" description="Use your Copilot subscription’s models. This sign-in is separate from the GitHub CLI account used for repositories.">
      {copilotStatusError ? <p className="error" role="alert">Copilot status unavailable: {copilotStatusError}</p>
        : <p className="connection-status" role="status">{copilotHealth ? copilotHealth.copilotSignedIn ? "Signed in" : "Not signed in" : "Checking sign-in…"}</p>}
      {copilotWaiting ? <p className="hint" role="status">{copilotSignIn?.code && copilotSignIn.url
        ? <>Open <a href={copilotSignIn.url} target="_blank" rel="noreferrer">GitHub device verification</a> and enter <strong>{copilotSignIn.code}</strong>.</>
        : "Waiting for GitHub’s device code…"}</p> : null}
      {copilotSignIn?.message ? <p className="error" role="alert">{copilotSignIn.message}</p> : null}
      {copilotActionError ? <p className="error" role="alert">{copilotActionError}</p> : null}
      <div className="form-actions">
        <button type="button" className="quiet-button" disabled={authBusy || !copilotHealth || Boolean(copilotStatusError) || sending} onClick={() => void changeCopilotAuth(copilotWaiting ? "cancel" : "start")}>{copilotWaiting ? "Cancel sign-in" : copilotHealth?.copilotSignedIn ? "Reconnect" : "Sign in to GitHub Copilot"}</button>
        {!copilotWaiting && copilotHealth?.copilotSignedIn ? <button type="button" className="quiet-button" disabled={authBusy || sending} onClick={() => void changeCopilotAuth("sign-out")}>Sign out</button> : null}
      </div>
    </Card>

    {detectedAgents.length ? (
      <Card title="Coding agents found on this host" description="These CLI agents are installed here. ADE can’t run them as its agent harness yet, so they aren’t offered in the model picker.">
        <ul className="settings-project-list">{detectedAgents.map(agent => <li key={agent.id}><Sparkles size={14} /> {agent.name} <code>{agent.command}</code></li>)}</ul>
      </Card>
    ) : null}
  </>

  const agents = <>
    <Card title="What agents can do" description="Coding sessions with a workspace can read and edit files, search code, and run commands in their checkout or worktree. They can also start subagents, drive the built-in browser, and write plans and artifacts.">
      <div className="settings-facts">
        <span>Built-in browser</span><strong>{browserState?.available ? "Chrome found" : "Chrome not found — set ADE_CHROME_PATH"}</strong>
        <span>Skills found</span><strong>{skillsCatalog?.skills.length ?? 0}</strong>
        <span>Rules files</span><strong>{skillsCatalog?.rules.length ?? 0}</strong>
        <span>Slash commands</span><strong>{skillsCatalog?.commands.length ?? 0}</strong>
      </div>
    </Card>
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

  const github = <>
    <Card title="GitHub account" description="ADE uses the GitHub CLI (gh) on the active host for issues, pushes, and pull requests, with that account’s existing permissions. ADE saves the account name, not a token.">
      {githubStatusError ? <p className="error" role="alert">GitHub connection unavailable: {githubStatusError}</p>
        : <p className="connection-status" role="status">{githubConnection ? githubConnection.login ? `Connected as ${githubConnection.login}` : "Not connected" : "Checking connection…"}</p>}
      {githubActionError ? <p className="error" role="alert">{githubActionError}</p> : null}
      {!githubConnection?.login && githubCliError ? <p className="hint" role="status">{githubCliError}</p> : null}
      {!githubConnection?.login ? <p className="hint">If needed, install GitHub CLI and sign in first with <code>gh auth login --hostname github.com --web</code>.</p> : null}
      <div className="form-actions">
        <button type="button" className="quiet-button" disabled={githubConnectionBusy || !githubConnection || Boolean(githubStatusError)} onClick={() => void changeGitHubConnection("connect")}>{githubConnectionBusy ? "Working…" : githubConnection?.login ? "Check account" : "Connect GitHub CLI"}</button>
        {githubConnection?.login ? <button type="button" className="quiet-button" disabled={githubConnectionBusy} onClick={() => void changeGitHubConnection("disconnect")}>Disconnect</button> : null}
      </div>
      {githubConnection?.login ? <p className="hint">Disconnecting here doesn’t sign out of GitHub CLI.</p> : null}
    </Card>
    <Card title="Pull requests">
      <Toggle label="Open pull requests as drafts" description="You can still choose per pull request in the session’s Pull request panel." checked={settings.prDraft} onChange={value => update({ prDraft: value })} />
    </Card>
  </>

  const terminal = <Card title="Terminal">
    <Toggle label="Start a shell automatically" description="Opening the Terminal panel starts a shell in the session’s workspace right away." checked={settings.terminalAutoStart} onChange={value => update({ terminalAutoStart: value })} />
    <div className="settings-grid">
      <label>Font size<select value={settings.terminalFontSize} onChange={event => update({ terminalFontSize: Number(event.target.value) })}>{[11, 12, 13, 14, 15, 16, 18, 20].map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
      <label>Scrollback<select value={settings.terminalScrollback} onChange={event => update({ terminalScrollback: Number(event.target.value) })}>{[1000, 5000, 10000, 20000].map(lines => <option key={lines} value={lines}>{lines.toLocaleString()} lines</option>)}</select></label>
    </div>
    <p className="hint">Commands run as the active host’s OS user. The terminal is yours; agents run their own commands separately, subject to the approval policy.</p>
  </Card>

  const requestPermission = async () => {
    if (typeof Notification === "undefined") return
    setPermission(await Notification.requestPermission())
  }
  const notifications = <Card title="Desktop notifications" description="Get notified when you’re in another window or app.">
    {permission === "unsupported" ? <p className="hint">This window can’t show desktop notifications.</p>
      : permission === "denied" ? <p className="error">Notifications are blocked for ADE. Allow them in your system or browser settings.</p>
        : permission === "default" ? <div className="form-actions"><button type="button" className="quiet-button" onClick={() => void requestPermission()}>Allow notifications</button></div> : null}
    <Toggle label="When an agent finishes" description="A session goes from working to idle." checked={settings.notifyOnFinish} disabled={permission !== "granted"} onChange={value => update({ notifyOnFinish: value })} />
    <Toggle label="When an agent needs approval" description="A command is waiting for you to allow or deny it." checked={settings.notifyOnApproval} disabled={permission !== "granted"} onChange={value => update({ notifyOnApproval: value })} />
    {permission === "granted" ? <div className="form-actions"><button type="button" className="quiet-button" onClick={() => new Notification("ADE", { body: "Notifications are working." })}>Send a test notification</button></div> : null}
  </Card>

  const environments = <>
    <EnvironmentSettings onEnvironmentChanged={onEnvironmentChanged} disabled={disabled} autoOpenAdd={autoOpenAddEnvironment} />
    <Card title="Diagnostics">
      <div className="settings-facts">
        <span>Active environment</span><strong>{activeEnvironmentName}</strong>
        <span>Runtime</span><strong>{runtime?.online ? "Online" : runtimeError || "Waiting for runtime"}</strong>
        <span>Harness</span><strong>{runtime?.harness ?? "Pi Durable"}</strong>
        <span>MCP servers connected</span><strong>{mcpServers.filter(server => server.status === "connected").length}</strong>
      </div>
      <div className="form-actions"><button type="button" className="quiet-button" onClick={onWorktreeDiagnostics}><History size={14} /> Inspect Git worktrees</button></div>
    </Card>
    <Card title="About ADE">
      <p className="hint">ADE is an agentic development environment: projects, isolated agent sessions on their own branches, review, and pull requests in one app. Built with Tauri, React, and Pi Durable.</p>
    </Card>
  </>

  const content = {
    general, appearance, models, agents, github, terminal, notifications, environments,
  }[selectedCategory]

  return <main className="settings-layout">
    <aside className="settings-nav" aria-label="Settings navigation">
      <button type="button" className="settings-back" onClick={onBack}><ArrowLeft size={14} /> Back</button>
      <div className="settings-nav-group">
        <div className="settings-host-name"><span className={`status-dot ${runtime?.online ? "online" : "offline"}`} />{activeEnvironmentName}</div>
        {items.map(item => {
          const Icon = item.icon
          return <button type="button" key={item.id} className={`settings-nav-item${selectedCategory === item.id ? " active" : ""}`} aria-current={selectedCategory === item.id ? "page" : undefined} onClick={() => setSelectedCategory(item.id)}><Icon size={15} /><span>{item.label}</span><ChevronRight size={13} className="settings-nav-chevron" /></button>
        })}
      </div>
    </aside>
    <section className="settings-main">
      <header className="settings-heading"><h1>{selected.label}</h1><p>{selected.description}</p></header>
      {(error || runtimeError) ? <div className="settings-global-errors">{error ? <p className="error" role="alert">{error}</p> : null}{runtimeError && selectedCategory !== "environments" ? <p className="error" role="alert">{runtimeError}</p> : null}</div> : null}
      <div className="settings-content">{content}</div>
    </section>
  </main>
}
