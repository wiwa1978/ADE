import { useCallback, useEffect, useState } from "react"
import { request } from "../../api"
import type { ProviderCatalogEntry, RuntimeHealth } from "../../app-types"
import type { Settings } from "../../useSettings"

export function useModelSelection(params: {
  settings: Settings
  environmentVersion: number
  screen: string
}) {
  const { settings, environmentVersion, screen } = params
  const [runtime, setRuntime] = useState<RuntimeHealth | null>(null)
  const [modelCatalog, setModelCatalog] = useState<ProviderCatalogEntry[]>([])
  const [runtimeError, setRuntimeError] = useState("")

  const loadHealth = useCallback(async () => {
    try {
      const qs = settings.provider ? `?provider=${encodeURIComponent(settings.provider)}` : ""
      const data = await request<RuntimeHealth>(`/api/health${qs}`)
      setRuntime(data)
      setRuntimeError("")
    } catch (err) {
      setRuntime(null)
      setRuntimeError(err instanceof Error ? err.message : "Waiting for the ADE local runtime.")
    }
  }, [settings.provider])

  const loadModelCatalog = useCallback(async () => {
    try {
      const catalog = await request<{ providers: ProviderCatalogEntry[] }>("/api/models/catalog")
      if (Array.isArray(catalog?.providers)) setModelCatalog(catalog.providers)
    } catch {
      // The runtime may still be starting; health polling surfaces connection errors.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const qs = settings.provider ? `?provider=${encodeURIComponent(settings.provider)}` : ""
    void request<RuntimeHealth>(`/api/health${qs}`)
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
    return () => { cancelled = true }
  }, [screen])

  const matchingRuntime = runtime && (!settings.provider || runtime.provider === settings.provider) ? runtime : null
  const effectiveCatalog: ProviderCatalogEntry[] = (() => {
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

  // A saved provider that the harness can no longer run (e.g. an old CLI-tool choice) falls back to the runtime default.
  const effectiveProvider =
    settings.provider && (!effectiveCatalog.length || effectiveCatalog.some(p => p.id === settings.provider))
      ? settings.provider
      : runtime?.provider || effectiveCatalog.find(p => p.configured)?.id || effectiveCatalog[0]?.id || "anthropic"
  const activeCatalogProvider = effectiveCatalog.find(p => p.id === effectiveProvider) ?? effectiveCatalog[0]
  const availableModels = activeCatalogProvider?.models?.length
    ? activeCatalogProvider.models
    : (matchingRuntime?.models ?? runtime?.models ?? [])
  const selectedModel = availableModels.some(m => m.id === settings.model)
    ? settings.model
    : (settings.model || activeCatalogProvider?.defaultModel || matchingRuntime?.defaultModel || runtime?.defaultModel || "")
  const modelReady = Boolean(activeCatalogProvider?.configured && selectedModel)
  const modelSetupMessage = activeCatalogProvider?.setupMessage || "Set up a model provider in Settings → Models."
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
