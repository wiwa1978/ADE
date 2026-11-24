import { useMemo, useState, type FormEvent } from "react"
import { Plus, RefreshCw, RotateCcw } from "lucide-react"
import { Badge, Banner, Button, IconButton, Input, StatusPill } from "@/components/ui"
import type { ProviderCatalogEntry, RuntimeHealth } from "../../app-types"
import type { useConnections } from "../../useConnections"
import { ProviderAuthSection } from "./providers/ProviderAuthSection"
import { ProviderGlyph, ProviderMasterList } from "./providers/ProviderMasterList"
import { ProviderModelsSection } from "./providers/ProviderModelsSection"
import { ProviderRuntimeSection } from "./providers/ProviderRuntimeSection"
import {
  buildUnifiedProviderItems,
  loadOverrides,
  saveOverrides,
  type ProviderOverridesMap,
  type ProviderRuntimeOverride,
  type UnifiedProviderItem,
} from "./providers/provider-overrides"

export interface ProvidersPanelProps {
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
}

export function ProvidersPanel({
  activeEnvironmentName, modelCatalog, selectedProvider, selectedModel, reasoning, reasoningLevels,
  runtime, connections, sending, credentialChangesBlocked, compatible, compatibleDraft, compatibleBusy,
  compatibleMessage, onCompatibleDraftChange, onSaveCompatible, onSelectDefaultProvider,
  onSelectDefaultModel, onSelectReasoning, onModelsChanged,
}: ProvidersPanelProps) {
  const {
    copilotHealth, copilotStatusError, copilotActionError, copilotWaiting,
    modelCredentials, modelCredentialStatusError, modelCredentialActionError, modelCredentialBusy,
    providerTools, providerToolsError, providerToolsBusy, setProviderEnabled,
  } = connections

  const [overrides, setOverrides] = useState<ProviderOverridesMap>(loadOverrides)
  const [selectedId, setSelectedId] = useState<string>("")
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [rescanning, setRescanning] = useState(false)

  const items = useMemo(
    () => buildUnifiedProviderItems({
      providerTools, modelCatalog, modelCredentials, copilotHealth, copilotStatusError, copilotWaiting,
    }),
    [providerTools, modelCatalog, modelCredentials, copilotHealth, copilotStatusError, copilotWaiting],
  )

  const activeItem = items.find(i => i.id === selectedId) ?? items.find(i => i.id === selectedProvider) ?? items[0] ?? null
  const activeOverride = activeItem ? (overrides[activeItem.id] ?? {}) : {}
  const credentialDisabled = Boolean(modelCredentialBusy) || credentialChangesBlocked
  const activeCatalogProvider = activeItem ? modelCatalog.find(p => p.id === activeItem.id) : null
  const isDefaultProvider = Boolean(activeItem && selectedProvider === activeItem.id)
  const panelError = providerToolsError || modelCredentialStatusError || modelCredentialActionError || copilotActionError

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

  function handleRescan() {
    setRescanning(true)
    onModelsChanged?.()
    setTimeout(() => setRescanning(false), 350)
  }

  return (
    <div className="st-prov-wrap">
      <div className="st-prov-topbar">
        <div className="st-prov-topbar-left">
          <span className="st-prov-heading">Providers</span>
          <IconButton title="Add OpenAI-compatible provider" aria-label="Add provider" onClick={() => setSelectedId("compatible")}>
            <Plus className="size-3.5" />
          </IconButton>
          <Badge size="sm">on {activeEnvironmentName}</Badge>
        </div>
        <div className="st-prov-topbar-right">
          {runtime?.online ? (
            <span className="st-prov-active-chip">
              Default: <strong>{modelCatalog.find(p => p.id === selectedProvider)?.name ?? selectedProvider}</strong>
              {selectedModel ? <> · <code>{selectedModel}</code></> : null}
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={handleRescan} disabled={rescanning}>
            <RefreshCw className={`size-3.5 ${rescanning ? "animate-spin" : ""}`} /> Rescan
          </Button>
        </div>
      </div>

      {panelError ? <Banner tone="error">{panelError}</Banner> : null}

      <div className="st-prov-card">
        <ProviderMasterList
          items={items}
          activeId={activeItem?.id ?? null}
          overrides={overrides}
          busyProviderId={providerToolsBusy}
          onSelect={id => { setSelectedId(id); setEditingKey(null) }}
          onToggle={(item, enabled) => void handleToggleProvider(item, enabled)}
          onAddCompatible={() => { setSelectedId("compatible"); setEditingKey(null) }}
        />

        {activeItem ? (
          <div className="st-prov-detail">
            <div className="st-prov-detail-head">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="st-prov-detail-icon"><ProviderGlyph item={activeItem} /></span>
                <h3 className="st-prov-detail-title">{activeOverride.displayName || activeItem.name}</h3>
                {isDefaultProvider ? <Badge tone="accent">Default</Badge> : null}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeCatalogProvider?.configured && !isDefaultProvider ? (
                  <Button variant="secondary" size="sm" onClick={() => onSelectDefaultProvider(activeItem.id)}>
                    Use as default
                  </Button>
                ) : null}
                {Object.keys(activeOverride).length > 0 ? (
                  <IconButton title="Reset overrides to defaults" aria-label="Reset overrides" onClick={() => resetOverride(activeItem.id)}>
                    <RotateCcw className="size-3.5" />
                  </IconButton>
                ) : null}
              </div>
            </div>

            <div className="st-prov-block">
              <div className="st-prov-block-label">Status</div>
              <div className="st-prov-status-line">
                <StatusPill tone={activeItem.tone === "off" ? "neutral" : activeItem.tone}>
                  {activeItem.statusText}
                </StatusPill>
                {activeItem.installHint && activeItem.kind === "cli" && !activeItem.installed ? (
                  <span className="st-hint">{activeItem.installHint}</span>
                ) : null}
              </div>
            </div>

            <div className="st-prov-field-row">
              <div className="st-prov-field-text"><label htmlFor="prov-display-name">Display name</label></div>
              <Input
                id="prov-display-name"
                className="st-prov-field-input"
                value={activeOverride.displayName ?? activeItem.name}
                onChange={e => updateOverride(activeItem.id, { displayName: e.target.value })}
              />
            </div>

            <ProviderAuthSection
              item={activeItem} connections={connections} sending={sending}
              credentialDisabled={credentialDisabled} editingKey={editingKey} onEditingKeyChange={setEditingKey}
              compatible={compatible} compatibleDraft={compatibleDraft} compatibleBusy={compatibleBusy}
              compatibleMessage={compatibleMessage} onCompatibleDraftChange={onCompatibleDraftChange}
              onSaveCompatible={onSaveCompatible} onModelsChanged={onModelsChanged}
            />

            <ProviderModelsSection
              item={activeItem} selectedProvider={selectedProvider} selectedModel={selectedModel}
              isDefaultProvider={isDefaultProvider} reasoning={reasoning} reasoningLevels={reasoningLevels}
              onSelectDefaultModel={onSelectDefaultModel} onSelectReasoning={onSelectReasoning}
            />

            <ProviderRuntimeSection
              item={activeItem} override={activeOverride}
              onUpdateOverride={patch => updateOverride(activeItem.id, patch)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
