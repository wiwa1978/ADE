import { useEffect, useMemo, useState, type FormEvent } from "react"
import { ArrowLeft } from "lucide-react"
import { Banner, SearchInput } from "@/components/ui"
import { request } from "./api"
import { UsageSettings } from "./src/usage/UsageSettings"
import { IntegrationsSettings } from "./src/integrations/IntegrationsSettings"
import { SubagentSettings } from "./src/subagents/SubagentSettings"
import { ProvidersPanel } from "./src/settings/ProvidersPanel"
import { MobilePairingSection } from "./src/settings/MobilePairingSection"
import { GeneralSettings } from "./src/settings/sections/GeneralSettings"
import { AppearanceSettings } from "./src/settings/sections/AppearanceSettings"
import { AgentsSettings } from "./src/settings/sections/AgentsSettings"
import { GitHubSettings } from "./src/settings/sections/GitHubSettings"
import { TerminalSettings } from "./src/settings/sections/TerminalSettings"
import { NotificationsSettings } from "./src/settings/sections/NotificationsSettings"
import { EnvironmentsSettingsSection } from "./src/settings/sections/EnvironmentsSettingsSection"
import {
  ALL_SETTINGS_ITEMS,
  REASONING_LEVELS,
  SETTINGS_GROUPS,
  type SettingsCategory,
  type SettingsViewProps,
} from "./src/settings/sections/settings-nav"

export type { SettingsCategory }

export function SettingsView({
  settings, resolved, error, runtimeError, runtime, selectedModel, selectedProvider, modelCatalog,
  sending, credentialChangesBlocked, connections, activeEnvironmentName, update, onBack, onWorktreeDiagnostics,
  onEnvironmentChanged, onModelsChanged, mcpServers = [], approvalPolicy = "auto-safe", approvalRules = [], browserState,
  skillsCatalog, onRefreshMcp, onChangeApprovalPolicy, onDeleteApprovalRule, onAddApprovalRule, initialCategory, autoOpenAddEnvironment = false,
  projects, sessionLabels = {},
}: SettingsViewProps) {
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
    void request<{ compatible?: { url: string; model: string; fromEnvironment: boolean } }>("/api/model-credentials", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "status" }),
    }).then(result => {
      if (cancelled || !result.compatible) return
      setCompatible(result.compatible)
      setCompatibleDraft({ url: result.compatible.url, model: result.compatible.model })
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedCategory])

  const selected = ALL_SETTINGS_ITEMS.find(item => item.id === selectedCategory) ?? ALL_SETTINGS_ITEMS[0]
  const disabled = sending || credentialChangesBlocked || connections.authBusy || connections.githubConnectionBusy || Boolean(connections.modelCredentialBusy)

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SETTINGS_GROUPS
    return SETTINGS_GROUPS
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

  function renderCategory(category: SettingsCategory) {
    switch (category) {
      case "general": return <GeneralSettings settings={settings} update={update} />
      case "appearance": return <AppearanceSettings settings={settings} resolved={resolved} update={update} />
      case "models":
        return (
          <ProvidersPanel
            activeEnvironmentName={activeEnvironmentName}
            modelCatalog={modelCatalog}
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            reasoning={settings.reasoning}
            reasoningLevels={REASONING_LEVELS}
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
            mcpServers={mcpServers}
            approvalPolicy={approvalPolicy}
            approvalRules={approvalRules}
            onRefreshMcp={onRefreshMcp}
            onChangeApprovalPolicy={onChangeApprovalPolicy}
            onDeleteApprovalRule={onDeleteApprovalRule}
            onAddApprovalRule={onAddApprovalRule}
          />
        )
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
      <aside className="st-nav" aria-label="Settings navigation">
        <button type="button" className="st-back" onClick={onBack}><ArrowLeft size={14} /> Back to app</button>
        <SearchInput
          value={query}
          onValueChange={setQuery}
          onKeyDown={event => {
            if (event.key === "Enter" && visibleGroups[0]?.items[0]) setSelectedCategory(visibleGroups[0].items[0].id)
          }}
          placeholder="Search settings"
          aria-label="Search settings"
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
            {error ? <Banner tone="error">{error}</Banner> : null}
            {runtimeError && !runtime?.online ? <Banner tone="error">{runtimeError}</Banner> : null}
            {renderCategory(selectedCategory)}
          </div>
        </div>
      </section>
    </main>
  )
}
