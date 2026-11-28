import { useCallback, useEffect, useState } from "react"
import { request, requestJson } from "../api"
import type { ProviderCatalogEntry, ProviderTool, RuntimeHealth } from "../app-types"
import type { Settings } from "../useSettings"

function mergeCliToolsIntoCatalog(
  catalog: ProviderCatalogEntry[],
  tools: ProviderTool[],
): ProviderCatalogEntry[] {
  if (!tools.length) return catalog
  const seen = new Set(catalog.map(p => p.id))
  const merged = [...catalog]
  for (const tool of tools) {
    if (tool.kind !== "cli" || !tool.installed || !tool.enabled || seen.has(tool.id)) continue
    seen.add(tool.id)
    const toolModels = Array.isArray(tool.models) ? tool.models : []
    merged.push({
      id: tool.id,
      name: tool.name,
      kind: "cli",
      configured: true,
      enabled: true,
      defaultModel: toolModels[0]?.id ?? "default",
      setupMessage: "",
      models: toolModels,
    })
  }
  return merged
}

const API_HEALTH_PROVIDERS = new Set(["openai", "anthropic", "copilot", "radius", "compatible"])

async function fetchHealthSafe(provider: string | undefined): Promise<RuntimeHealth> {
  if (provider && API_HEALTH_PROVIDERS.has(provider)) {
    try {
      return await request<RuntimeHealth>(`/api/health?provider=${encodeURIComponent(provider)}`)
    } catch {
      // Remote servers or older runtimes may reject an unfamiliar provider ID; fall back to default health.
      return await request<RuntimeHealth>("/api/health")
    }
  }
  return await request<RuntimeHealth>("/api/health")
}

export function useModelSelection(params: {
  settings: Settings
  environmentVersion: number
  screen: string
}) {
  const { settings, environmentVersion, screen } = params
  const [runtime, setRuntime] = useState<RuntimeHealth | null>(null)
  const [modelCatalog, setModelCatalog] = useState<ProviderCatalogEntry[]>([])
  const [cliTools, setCliTools] = useState<ProviderTool[]>([])
  const [runtimeError, setRuntimeError] = useState("")

  const loadHealth = useCallback(async () => {
    try {
      const data = await fetchHealthSafe(settings.provider)
      setRuntime(data)
      setRuntimeError("")
    } catch (err) {
      setRuntime(null)
      setRuntimeError(err instanceof Error ? err.message : "Waiting for the ADE local runtime.")
    }
  }, [settings.provider])

  const loadModelCatalog = useCallback(async () => {
    try {
      const [catalog, tools] = await Promise.all([
        request<{ providers: ProviderCatalogEntry[] }>("/api/models/catalog"),
        requestJson<{ providers: ProviderTool[] }>("/api/provider-tools", "POST", { action: "status" }).catch(() => ({ providers: [] as ProviderTool[] })),
      ])
      if (Array.isArray(catalog?.providers)) setModelCatalog(catalog.providers)
      if (Array.isArray(tools?.providers)) setCliTools(tools.providers)
    } catch {
      // The runtime may still be starting; health polling surfaces connection errors.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchHealthSafe(settings.provider)
      .then(data => {
        if (cancelled) return
        setRuntime(data)
        setRuntimeError("")
      })
      .catch(err => {
        if (cancelled) return
        setRuntime(null)
        setRuntimeError(err instanceof Error ? err.message : "Waiting for the ADE local runtime.")
      })
    void request<{ providers: ProviderCatalogEntry[] }>("/api/models/catalog")
      .then(catalog => {
        if (!cancelled && Array.isArray(catalog?.providers)) setModelCatalog(catalog.providers)
      })
      .catch(() => undefined)
    void requestJson<{ providers: ProviderTool[] }>("/api/provider-tools", "POST", { action: "status" })
      .then(tools => {
        if (!cancelled && Array.isArray(tools?.providers)) setCliTools(tools.providers)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [settings.provider, environmentVersion])

  // Refresh provider list when returning from Settings so toggled providers appear immediately.
  useEffect(() => {
    if (screen !== "work") return
    let cancelled = false
    void request<{ providers: ProviderCatalogEntry[] }>("/api/models/catalog")
      .then(catalog => {
        if (!cancelled && Array.isArray(catalog?.providers)) setModelCatalog(catalog.providers)
      })
      .catch(() => undefined)
    void requestJson<{ providers: ProviderTool[] }>("/api/provider-tools", "POST", { action: "status" })
      .then(tools => {
        if (!cancelled && Array.isArray(tools?.providers)) setCliTools(tools.providers)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [screen])

  const matchingRuntime = runtime && (!settings.provider || runtime.provider === settings.provider) ? runtime : null
  const baseCatalog: ProviderCatalogEntry[] = (() => {
    if (modelCatalog.length > 0) return modelCatalog
    if (!runtime) return []
    return (runtime.providers?.length ? runtime.providers : [{ id: runtime.provider, name: runtime.provider }]).map(p => ({
      id: p.id,
      name: p.name,
      kind: "api" as const,
      configured: p.id === runtime.provider ? runtime.configured : false,
      enabled: true,
      defaultModel: p.id === runtime.provider ? runtime.defaultModel : "",
      setupMessage: p.id === runtime.provider ? runtime.message : "",
      models: p.id === runtime.provider ? runtime.models : [],
    }))
  })()
  const effectiveCatalog = mergeCliToolsIntoCatalog(baseCatalog, cliTools)

  // Prefer the saved provider if it's configured (or if nothing else is); otherwise pick the first configured provider.
  const savedEntry = settings.provider ? effectiveCatalog.find(p => p.id === settings.provider) : undefined
  const firstConfigured = effectiveCatalog.find(p => p.configured)
  const effectiveProvider =
    savedEntry && (savedEntry.configured || !firstConfigured)
      ? savedEntry.id
      : firstConfigured?.id || (settings.provider && !effectiveCatalog.length ? settings.provider : runtime?.provider || effectiveCatalog[0]?.id || "anthropic")
  const activeCatalogProvider = effectiveCatalog.find(p => p.id === effectiveProvider) ?? effectiveCatalog[0]
  const availableModels = activeCatalogProvider?.models?.length
    ? activeCatalogProvider.models
    : (matchingRuntime?.models ?? runtime?.models ?? [])
  const selectedModel = availableModels.some(m => m.id === settings.model)
    ? settings.model
    : (activeCatalogProvider?.defaultModel || settings.model || matchingRuntime?.defaultModel || runtime?.defaultModel || "")
  const modelReady = Boolean(activeCatalogProvider?.configured && selectedModel)
  const modelSetupMessage = activeCatalogProvider?.setupMessage || "Set up a model provider in Settings → Providers."
  const providerName =
    activeCatalogProvider?.name ?? runtime?.providers.find(p => p.id === effectiveProvider)?.name ?? effectiveProvider

  return {
    runtime,
    setRuntime,
    runtimeError,
    setRuntimeError,
    matchingRuntime,
    effectiveCatalog,
    effectiveProvider,
    availableModels,
    selectedModel,
    modelReady,
    modelSetupMessage,
    providerName,
    loadHealth,
    loadModelCatalog,
  }
}
