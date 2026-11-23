import { useMemo, useState, type FormEvent } from "react"
import {
  Bot,
  Check,
  Cpu,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react"
import type {
  ModelCredential,
  ModelCredentialProvider,
  ProviderCatalogEntry,
  ProviderTool,
  RuntimeHealth,
} from "../../app-types"
import type { useConnections } from "../../useConnections"
import { modelCredentialProviders } from "../../useConnections"

type EnvVarRow = { key: string; value: string }
type ProviderRuntimeOverride = {
  displayName?: string
  binaryPath?: string
  homePath?: string
  launchArgs?: string
  envVars?: EnvVarRow[]
}

const RUNTIME_OVERRIDES_KEY = "ade-provider-overrides-v1"

function loadOverrides(): Record<string, ProviderRuntimeOverride> {
  try {
    const raw = localStorage.getItem(RUNTIME_OVERRIDES_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function saveOverrides(next: Record<string, ProviderRuntimeOverride>): void {
  try {
    localStorage.setItem(RUNTIME_OVERRIDES_KEY, JSON.stringify(next))
  } catch {
    // Ignore storage quota errors.
  }
}

const DEFAULT_HOME_PATHS: Record<string, string> = {
  codex: "~/.codex",
  claude: "~/.claude",
  copilot: "~/.config/github-copilot",
  opencode: "~/.config/opencode",
  pi: "~/.pi",
  "oh-my-pi": "~/.omp",
  cursor: "~/.cursor",
  antigravity: "~/.gemini/antigravity",
  "muse-code": "~/.muse",
  hermes: "~/.hermes",
  devin: "~/.devin",
}

type UnifiedProviderItem = {
  id: string
  name: string
  kind: "cli" | "api" | "copilot"
  command?: string | null
  installed?: boolean
  available: boolean
  enabled: boolean
  canToggle: boolean
  statusText: string
  tone: "ok" | "off" | "warn"
  modelCount: number | null
  models: { id: string; name: string }[]
  credentialProvider?: ModelCredentialProvider
  credentialSource?: ModelCredential["source"]
  installHint?: string | null
}

function providerGlyph(item: UnifiedProviderItem) {
  if (item.kind === "copilot") return <Sparkles className="size-4 shrink-0" />
  if (item.kind === "api") {
    return item.id === "compatible" ? <Server className="size-4 shrink-0" /> : <KeyRound className="size-4 shrink-0" />
  }
  if (item.id === "claude" || item.id === "codex") return <Bot className="size-4 shrink-0" />
  if (item.id === "pi" || item.id === "oh-my-pi") return <Cpu className="size-4 shrink-0" />
  return <Terminal className="size-4 shrink-0" />
}

export function ProvidersPanel({
  activeEnvironmentName,
  modelCatalog,
  selectedProvider,
  selectedModel,
  reasoning,
  reasoningLevels,
  runtime,
  connections,
  sending,
  credentialChangesBlocked,
  compatible,
  compatibleDraft,
  compatibleBusy,
  compatibleMessage,
  onCompatibleDraftChange,
  onSaveCompatible,
  onSelectDefaultProvider,
  onSelectDefaultModel,
  onSelectReasoning,
  onModelsChanged,
}: {
  activeEnvironmentName: string
  modelCatalog: ProviderCatalogEntry[]
  selectedProvider: string
  selectedModel: string
  reasoning: string
  reasoningLevels: { id: string; label: string }[]
  runtime: RuntimeHealth | null
  connections: ReturnType<typeof useConnections>
  sending: boolean
  credentialChangesBlocked: boolean
  compatible: { url: string; model: string; fromEnvironment: boolean } | null
  compatibleDraft: { url: string; model: string }
  compatibleBusy: boolean
  compatibleMessage: string
  onCompatibleDraftChange: (next: { url: string; model: string }) => void
  onSaveCompatible: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onSelectDefaultProvider: (providerId: string) => void
  onSelectDefaultModel: (providerId: string, modelId: string) => void
  onSelectReasoning: (level: string) => void
  onModelsChanged?: () => void
}) {
  const {
    copilotHealth,
    copilotStatusError,
    copilotActionError,
    copilotSignIn,
    copilotWaiting,
    authBusy,
    changeCopilotAuth,
    modelCredentials,
    modelCredentialStatusError,
    modelCredentialActionError,
    modelCredentialBusy,
    saveModelCredential,
    changeModelCredential,
    providerTools,
    providerToolsError,
    providerToolsBusy,
    setProviderEnabled,
  } = connections

  const [overrides, setOverrides] = useState<Record<string, ProviderRuntimeOverride>>(loadOverrides)
  const [selectedId, setSelectedId] = useState<string>("")
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [rescanning, setRescanning] = useState(false)

  const items: UnifiedProviderItem[] = useMemo(() => {
    const credMap = new Map((modelCredentials ?? []).map(c => [c.provider, c.source]))
    const catalogMap = new Map(modelCatalog.map(c => [c.id, c]))
    const toolMap = new Map((providerTools ?? []).map(t => [t.id, t]))
    const list: UnifiedProviderItem[] = []
    const seen = new Set<string>()

    // 1. CLI & detected tools from /api/provider-tools (excluding API duplicates handled below)
    for (const tool of providerTools ?? []) {
      if (tool.kind === "api") continue
      seen.add(tool.id)
      const cat = catalogMap.get(tool.id)
      const models = cat?.models?.length ? cat.models : (tool.models ?? [])
      const count = models.length || tool.modelCount || null
      const enabled = tool.enabled
      const statusText = !enabled
        ? "Disabled"
        : tool.installed
          ? (count ? `Available · ${count} model${count === 1 ? "" : "s"}` : "Available")
          : "Not installed"
      list.push({
        id: tool.id,
        name: tool.name,
        kind: "cli",
        command: tool.command,
        installed: tool.installed,
        available: tool.installed && enabled,
        enabled,
        canToggle: true,
        statusText,
        tone: !enabled ? "off" : tool.installed ? "ok" : "warn",
        modelCount: count,
        models,
        installHint: tool.install,
      })
    }

    // 2. GitHub Copilot subscription provider
    const copilotCat = catalogMap.get("github-copilot")
    const copilotTool = toolMap.get("github-copilot")
    const copilotSignedIn = Boolean(copilotHealth?.copilotSignedIn)
    const copilotEnabled = copilotTool ? copilotTool.enabled : copilotSignedIn
    list.push({
      id: "github-copilot",
      name: "GitHub Copilot",
      kind: "copilot",
      available: copilotSignedIn,
      enabled: copilotEnabled,
      canToggle: Boolean(copilotTool),
      statusText: copilotStatusError
        ? "Unavailable"
        : copilotSignedIn
          ? "Authenticated · Subscription"
          : copilotWaiting
            ? "Waiting for sign-in"
            : "Not signed in",
      tone: copilotStatusError ? "warn" : copilotSignedIn ? "ok" : "off",
      modelCount: copilotCat?.models.length || null,
      models: copilotCat?.models ?? [],
    })
    seen.add("github-copilot")

    // 3. API credential providers (OpenAI, Anthropic, Radius (Pi), OpenAI-compatible)
    for (const cred of modelCredentialProviders) {
      if (seen.has(cred.id)) continue
      seen.add(cred.id)
      const source = credMap.get(cred.id)
      const cat = catalogMap.get(cred.id)
      const tool: ProviderTool | undefined = toolMap.get(cred.id)
      const configured = Boolean(cat?.configured || source === "saved" || source === "environment")
      const enabled = tool ? tool.enabled : configured
      const statusText = !enabled && tool
        ? "Disabled"
        : source === "saved"
          ? "Authenticated · Key saved"
          : source === "environment"
            ? "Authenticated · Environment"
            : configured
              ? "Configured"
              : "Not set up"
      list.push({
        id: cred.id,
        name: cred.name,
        kind: "api",
        available: configured && enabled,
        enabled,
        canToggle: Boolean(tool),
        statusText,
        tone: configured && enabled ? "ok" : "off",
        modelCount: cat?.models.length || null,
        models: cat?.models ?? [],
        credentialProvider: cred.id,
        credentialSource: source,
      })
    }

    return list
  }, [providerTools, modelCatalog, modelCredentials, copilotHealth, copilotStatusError, copilotWaiting])

  const activeItem = items.find(i => i.id === selectedId)
    ?? items.find(i => i.id === selectedProvider)
    ?? items[0]
    ?? null

  const activeOverride = activeItem ? (overrides[activeItem.id] ?? {}) : {}
  const credentialDisabled = Boolean(modelCredentialBusy) || credentialChangesBlocked

  function updateOverride(id: string, patch: Partial<ProviderRuntimeOverride>) {
    setOverrides(prev => {
      const next = { ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }
      saveOverrides(next)
      return next
    })
  }

  function resetOverride(id: string) {
    setOverrides(prev => {
      const next = { ...prev }
      delete next[id]
      saveOverrides(next)
      return next
    })
  }

  async function handleToggleProvider(item: UnifiedProviderItem, nextEnabled: boolean) {
    if (!item.canToggle) return
    await setProviderEnabled(item.id, nextEnabled)
    onModelsChanged?.()
  }

  async function handleRescan() {
    setRescanning(true)
    try {
      onModelsChanged?.()
    } finally {
      setTimeout(() => setRescanning(false), 350)
    }
  }

  const activeCatalogProvider = activeItem ? modelCatalog.find(p => p.id === activeItem.id) : null
  const isDefaultProvider = Boolean(activeItem && selectedProvider === activeItem.id)

  return (
    <div className="st-prov-wrap">
      {/* Compact Scope + Toolbar Row */}
      <div className="st-prov-topbar">
        <div className="st-prov-topbar-left">
          <span className="st-prov-heading">Providers</span>
          <button
            type="button"
            className="st-prov-icon-btn"
            title="Add OpenAI-compatible provider"
            aria-label="Add provider"
            onClick={() => setSelectedId("compatible")}
          >
            <Plus className="size-3.5" />
          </button>
          <span className="st-prov-scope-pill">on {activeEnvironmentName}</span>
        </div>
        <div className="st-prov-topbar-right">
          {runtime?.online ? (
            <span className="st-prov-active-chip">
              Default: <strong>{modelCatalog.find(p => p.id === selectedProvider)?.name ?? selectedProvider}</strong>
              {selectedModel ? <> · <code>{selectedModel}</code></> : null}
            </span>
          ) : null}
          <button
            type="button"
            className="st-button is-quiet"
            onClick={() => void handleRescan()}
            disabled={rescanning}
          >
            <RefreshCw className={`size-3.5 inline mr-1 ${rescanning ? "animate-spin" : ""}`} />
            Rescan
          </button>
        </div>
      </div>

      {providerToolsError || modelCredentialStatusError || modelCredentialActionError || copilotActionError ? (
        <div className="st-banner is-error">
          {providerToolsError || modelCredentialStatusError || modelCredentialActionError || copilotActionError}
        </div>
      ) : null}

      {/* Master-Detail Split Card */}
      <div className="st-prov-card">
        {/* Left Master List */}
        <div className="st-prov-list" role="listbox" aria-label="Model providers">
          <div className="st-prov-list-items">
            {items.map(item => {
              const selected = activeItem?.id === item.id
              const busyToggle = providerToolsBusy === item.id
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={selected}
                  tabIndex={0}
                  className={`st-prov-row ${selected ? "is-active" : ""}`}
                  onClick={() => { setSelectedId(item.id); setEditingKey(null) }}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(item.id); setEditingKey(null) } }}
                >
                  <span className="st-prov-row-icon">{providerGlyph(item)}</span>
                  <span className="st-prov-row-copy">
                    <span className="st-prov-row-head">
                      <span className="st-prov-row-name">{overrides[item.id]?.displayName || item.name}</span>
                      {item.command ? <code className="st-prov-row-ver">{item.command}</code> : null}
                    </span>
                    <span className={`st-prov-row-status is-${item.tone}`}>
                      {item.statusText}
                    </span>
                  </span>
                  {item.canToggle ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.enabled}
                      aria-label={`Enable ${item.name}`}
                      className={`st-switch ${item.enabled ? "is-on" : ""}`}
                      disabled={busyToggle}
                      onClick={e => {
                        e.stopPropagation()
                        void handleToggleProvider(item, !item.enabled)
                      }}
                    >
                      <span />
                    </button>
                  ) : (
                    <span className={`st-dot ${item.available ? "is-ok" : ""}`} title={item.statusText} />
                  )}
                </div>
              )
            })}
          </div>

          <button
            type="button"
            className="st-prov-add-row"
            onClick={() => { setSelectedId("compatible"); setEditingKey(null) }}
          >
            <Plus className="size-3.5" />
            <span>Add provider</span>
          </button>
        </div>

        {/* Right Detail Inspector */}
        {activeItem ? (
          <div className="st-prov-detail">
            <div className="st-prov-detail-head">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="st-prov-detail-icon">{providerGlyph(activeItem)}</span>
                <h3 className="st-prov-detail-title">{activeOverride.displayName || activeItem.name}</h3>
                {isDefaultProvider ? <span className="st-prov-default-tag">Default</span> : null}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeCatalogProvider?.configured && !isDefaultProvider ? (
                  <button
                    type="button"
                    className="st-button"
                    onClick={() => onSelectDefaultProvider(activeItem.id)}
                  >
                    Use as default
                  </button>
                ) : null}
                {Object.keys(activeOverride).length > 0 ? (
                  <button
                    type="button"
                    className="st-prov-icon-btn"
                    title="Reset overrides to defaults"
                    aria-label="Reset overrides"
                    onClick={() => resetOverride(activeItem.id)}
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Status Block */}
            <div className="st-prov-block">
              <div className="st-prov-block-label">Status</div>
              <div className="st-prov-status-line">
                <span className={`st-status is-${activeItem.tone}`}>
                  <i /> {activeItem.statusText}
                </span>
                {activeItem.installHint && activeItem.kind === "cli" && !activeItem.installed ? (
                  <span className="st-hint">{activeItem.installHint}</span>
                ) : null}
              </div>
            </div>

            {/* Display Name */}
            <div className="st-prov-field-row">
              <div className="st-prov-field-text">
                <label htmlFor="prov-display-name">Display name</label>
              </div>
              <input
                id="prov-display-name"
                className="st-input st-prov-field-input"
                value={activeOverride.displayName ?? activeItem.name}
                onChange={e => updateOverride(activeItem.id, { displayName: e.target.value })}
              />
            </div>

            {/* API Credentials / Copilot Auth Section */}
            {activeItem.kind === "copilot" ? (
              <div className="st-prov-section">
                <div className="st-prov-section-title">Authentication</div>
                <div className="st-prov-field-row">
                  <div className="st-prov-field-text">
                    <label>GitHub Copilot subscription</label>
                    <p>
                      {copilotWaiting && copilotSignIn?.code && copilotSignIn.url ? (
                        <>Open <a href={copilotSignIn.url} target="_blank" rel="noreferrer">github.com/login/device</a> and enter <strong>{copilotSignIn.code}</strong></>
                      ) : (
                        "Uses your Copilot subscription models. Separate from the GitHub CLI account."
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="st-button is-primary"
                      disabled={authBusy || !copilotHealth || Boolean(copilotStatusError) || sending}
                      onClick={() => void changeCopilotAuth(copilotWaiting ? "cancel" : "start")}
                    >
                      {copilotWaiting ? "Cancel" : copilotHealth?.copilotSignedIn ? "Reconnect" : "Sign in"}
                    </button>
                    {!copilotWaiting && copilotHealth?.copilotSignedIn ? (
                      <button
                        type="button"
                        className="st-button is-quiet"
                        disabled={authBusy || sending}
                        onClick={() => void changeCopilotAuth("sign-out")}
                      >
                        Sign out
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {activeItem.credentialProvider ? (
              <div className="st-prov-section">
                <div className="st-prov-section-title">Authentication</div>
                <div className="st-prov-field-row">
                  <div className="st-prov-field-text">
                    <label>API key</label>
                    <p>Stored securely in this host’s system keychain and never shown again.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {editingKey !== activeItem.credentialProvider ? (
                      <button
                        type="button"
                        className="st-button"
                        disabled={credentialDisabled}
                        onClick={() => setEditingKey(activeItem.credentialProvider!)}
                      >
                        {activeItem.credentialSource === "saved" ? "Replace key" : "Add key"}
                      </button>
                    ) : null}
                    {activeItem.credentialSource === "saved" && editingKey !== activeItem.credentialProvider ? (
                      <button
                        type="button"
                        className="st-button is-quiet"
                        disabled={credentialDisabled}
                        onClick={async () => {
                          await changeModelCredential("remove", activeItem.credentialProvider!)
                          onModelsChanged?.()
                        }}
                      >
                        {modelCredentialBusy?.provider === activeItem.credentialProvider && modelCredentialBusy.action === "remove" ? "Removing…" : "Remove"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {editingKey === activeItem.credentialProvider ? (
                  <form
                    className="flex items-center gap-2 mt-2"
                    onSubmit={async event => {
                      await saveModelCredential(event, activeItem.credentialProvider!)
                      setEditingKey(null)
                      onModelsChanged?.()
                    }}
                  >
                    <input
                      name="apiKey"
                      type="password"
                      className="st-input flex-1 !w-auto"
                      autoFocus
                      autoComplete="new-password"
                      maxLength={4096}
                      placeholder={`${activeItem.name} API key`}
                      required
                      disabled={credentialDisabled}
                      aria-label={`${activeItem.name} API key`}
                    />
                    <button className="st-button is-primary" disabled={credentialDisabled}>
                      {modelCredentialBusy?.provider === activeItem.credentialProvider && modelCredentialBusy.action === "save" ? "Saving…" : "Save"}
                    </button>
                    <button type="button" className="st-button is-quiet" onClick={() => setEditingKey(null)}>
                      Cancel
                    </button>
                  </form>
                ) : null}

                {activeItem.credentialProvider === "compatible" ? (
                  <form className="flex flex-col gap-3 mt-3 pt-3 border-t border-[rgb(var(--border)/0.7)]" onSubmit={event => void onSaveCompatible(event)}>
                    <div className="st-prov-field-row">
                      <div className="st-prov-field-text">
                        <label htmlFor="compat-url">Endpoint URL</label>
                        <p>Any OpenAI-compatible server, e.g. Ollama or LM Studio.</p>
                      </div>
                      <input
                        id="compat-url"
                        className="st-input st-prov-field-input"
                        value={compatibleDraft.url}
                        onChange={e => onCompatibleDraftChange({ ...compatibleDraft, url: e.target.value })}
                        placeholder="http://127.0.0.1:11434/v1"
                        disabled={compatible?.fromEnvironment || compatibleBusy}
                      />
                    </div>
                    <div className="st-prov-field-row">
                      <div className="st-prov-field-text">
                        <label htmlFor="compat-model">Default model ID</label>
                        <p>Model name served by your endpoint.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          id="compat-model"
                          className="st-input !w-[165px]"
                          value={compatibleDraft.model}
                          onChange={e => onCompatibleDraftChange({ ...compatibleDraft, model: e.target.value })}
                          placeholder="llama3.2"
                          disabled={compatible?.fromEnvironment || compatibleBusy}
                        />
                        <button className="st-button is-primary" disabled={compatible?.fromEnvironment || compatibleBusy}>
                          {compatibleBusy ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                    {compatibleMessage ? <span className="st-hint" role="status">{compatibleMessage}</span> : null}
                  </form>
                ) : null}
              </div>
            ) : null}

            {/* Runtime Section (for CLI providers, matching screenshot!) */}
            {activeItem.kind === "cli" ? (
              <div className="st-prov-section">
                <div className="st-prov-section-title">Runtime</div>
                <div className="st-prov-field-row">
                  <div className="st-prov-field-text">
                    <label htmlFor="prov-bin-path">Binary path</label>
                    <p>Path to the {activeItem.name} binary used by this instance.</p>
                  </div>
                  <input
                    id="prov-bin-path"
                    className="st-input st-prov-field-input font-mono !text-[12px]"
                    value={activeOverride.binaryPath ?? activeItem.command ?? ""}
                    placeholder={activeItem.command ?? activeItem.id}
                    onChange={e => updateOverride(activeItem.id, { binaryPath: e.target.value })}
                  />
                </div>
                <div className="st-prov-field-row">
                  <div className="st-prov-field-text">
                    <label htmlFor="prov-home-path">Config home path</label>
                    <p>Custom home and config directory for {activeItem.name}.</p>
                  </div>
                  <input
                    id="prov-home-path"
                    className="st-input st-prov-field-input font-mono !text-[12px]"
                    value={activeOverride.homePath ?? DEFAULT_HOME_PATHS[activeItem.id] ?? `~/.${activeItem.id}`}
                    onChange={e => updateOverride(activeItem.id, { homePath: e.target.value })}
                  />
                </div>
                <div className="st-prov-field-row">
                  <div className="st-prov-field-text">
                    <label htmlFor="prov-launch-args">Launch arguments</label>
                    <p>Additional CLI arguments passed on session start.</p>
                  </div>
                  <input
                    id="prov-launch-args"
                    className="st-input st-prov-field-input font-mono !text-[12px]"
                    value={activeOverride.launchArgs ?? ""}
                    placeholder="Optional flags"
                    onChange={e => updateOverride(activeItem.id, { launchArgs: e.target.value })}
                  />
                </div>
              </div>
            ) : null}

            {/* Models & Reasoning Section */}
            {activeItem.models.length > 0 ? (
              <div className="st-prov-section">
                <div className="st-prov-section-title">Models</div>
                <div className="st-prov-models-grid">
                  {activeItem.models.map(m => {
                    const isSelected = selectedProvider === activeItem.id && selectedModel === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`st-prov-model-chip ${isSelected ? "is-active" : ""}`}
                        onClick={() => onSelectDefaultModel(activeItem.id, m.id)}
                      >
                        <span className="truncate">{m.name}</span>
                        {isSelected ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
                      </button>
                    )
                  })}
                </div>
                {isDefaultProvider ? (
                  <div className="st-prov-field-row mt-2">
                    <div className="st-prov-field-text">
                      <label htmlFor="prov-reasoning">Reasoning effort</label>
                      <p>How much the model thinks before answering.</p>
                    </div>
                    <select
                      id="prov-reasoning"
                      className="st-select"
                      aria-label="Reasoning"
                      value={reasoning === "off" ? "none" : reasoning}
                      onChange={e => onSelectReasoning(e.target.value)}
                    >
                      {reasoningLevels.map(level => (
                        <option key={level.id} value={level.id}>{level.label}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Environment Variables Section (matching screenshot!) */}
            <div className="st-prov-section">
              <div className="st-prov-section-title">Environment</div>
              <div className="st-prov-field-row">
                <div className="st-prov-field-text">
                  <label>Variables</label>
                  <p>API keys, base URLs, and other per-instance settings.</p>
                </div>
                <button
                  type="button"
                  className="st-button"
                  onClick={() =>
                    updateOverride(activeItem.id, {
                      envVars: [...(activeOverride.envVars ?? []), { key: "", value: "" }],
                    })
                  }
                >
                  <Plus className="size-3.5 inline mr-1" /> Add variable
                </button>
              </div>
              {(activeOverride.envVars ?? []).length > 0 ? (
                <div className="flex flex-col gap-2 mt-2">
                  {(activeOverride.envVars ?? []).map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        className="st-input !w-[160px] font-mono !text-[12px]"
                        placeholder="ENV_KEY"
                        value={row.key}
                        onChange={e => {
                          const next = [...(activeOverride.envVars ?? [])]
                          next[idx] = { ...next[idx], key: e.target.value }
                          updateOverride(activeItem.id, { envVars: next })
                        }}
                      />
                      <input
                        className="st-input flex-1 !w-auto font-mono !text-[12px]"
                        placeholder="value"
                        value={row.value}
                        onChange={e => {
                          const next = [...(activeOverride.envVars ?? [])]
                          next[idx] = { ...next[idx], value: e.target.value }
                          updateOverride(activeItem.id, { envVars: next })
                        }}
                      />
                      <button
                        type="button"
                        className="st-prov-icon-btn"
                        aria-label="Remove variable"
                        onClick={() => {
                          const next = (activeOverride.envVars ?? []).filter((_, i) => i !== idx)
                          updateOverride(activeItem.id, { envVars: next })
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
