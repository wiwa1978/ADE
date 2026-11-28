import { useCallback, useEffect, useState } from "react"
import type { AdePluginManifest, PluginCategory } from "@ade/protocol"
import { request, requestJson } from "../api"

export type MarketplaceSource = {
  id: string
  name: string
  url: string
  official: boolean
  lastFetchedAt: number | null
  lastError: string | null
  pluginCount: number
}

export type PluginSettingValues = Record<string, string | boolean>

export type PluginView = AdePluginManifest & {
  installed: boolean
  enabled: boolean
  sourceId: string
  installedAt: number | null
  settings: PluginSettingValues
  configuredSecrets?: string[]
  detected?: boolean
}

export type PluginsSnapshot = {
  corePlugins: PluginView[]
  installed: PluginView[]
  catalog: PluginView[]
  sources: MarketplaceSource[]
  enabledUiModules: string[]
}

export type { PluginCategory }

/** Shared hook for Core Plugin toggles and the Git-backed Community Marketplace. */
export function usePlugins() {
  const [snapshot, setSnapshot] = useState<PluginsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    try {
      const next = await request<PluginsSnapshot>("/api/plugins")
      setSnapshot(next)
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load plugins.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void request<PluginsSnapshot>("/api/plugins")
      .then(next => {
        if (!cancelled) {
          setSnapshot(next)
          setError("")
        }
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load plugins.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const mutate = useCallback(async (key: string, fn: () => Promise<PluginsSnapshot>) => {
    setBusyId(key)
    setError("")
    try {
      const next = await fn()
      setSnapshot(next)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.")
      return false
    } finally {
      setBusyId(null)
    }
  }, [])

  const togglePlugin = useCallback(
    (pluginId: string, enabled: boolean) =>
      mutate(`toggle:${pluginId}`, () =>
        requestJson<PluginsSnapshot>(`/api/plugins/${encodeURIComponent(pluginId)}/toggle`, "POST", { enabled }),
      ),
    [mutate],
  )

  const updatePluginSettings = useCallback(
    (pluginId: string, values: PluginSettingValues) =>
      mutate(`settings:${pluginId}`, () =>
        requestJson<PluginsSnapshot>(`/api/plugins/${encodeURIComponent(pluginId)}/settings`, "PUT", { values }),
      ),
    [mutate],
  )

  const testNotification = useCallback(async (pluginId: string) => {
    setBusyId(`test:${pluginId}`)
    setError("")
    try {
      const res = await requestJson<{ sent: string[] }>(`/api/plugins/${encodeURIComponent(pluginId)}/test-notification`, "POST", {})
      return { ok: true, sent: res.sent }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Test notification failed."
      setError(msg)
      return { ok: false, sent: [] as string[], error: msg }
    } finally {
      setBusyId(null)
    }
  }, [])

  const installPlugin = useCallback(
    (pluginId: string, sourceId?: string) =>
      mutate(`install:${pluginId}`, () =>
        requestJson<PluginsSnapshot>("/api/plugins/install", "POST", { pluginId, ...(sourceId ? { sourceId } : {}) }),
      ),
    [mutate],
  )

  const uninstallPlugin = useCallback(
    (pluginId: string) =>
      mutate(`uninstall:${pluginId}`, () =>
        request<PluginsSnapshot>(`/api/plugins/${encodeURIComponent(pluginId)}`, { method: "DELETE" }),
      ),
    [mutate],
  )

  const addSource = useCallback(
    (url: string, name?: string) =>
      mutate("add-source", () =>
        requestJson<PluginsSnapshot>("/api/plugins/sources", "POST", { url, ...(name?.trim() ? { name: name.trim() } : {}) }),
      ),
    [mutate],
  )

  const removeSource = useCallback(
    (sourceId: string) =>
      mutate(`remove-source:${sourceId}`, () =>
        request<PluginsSnapshot>(`/api/plugins/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" }),
      ),
    [mutate],
  )

  const refreshSources = useCallback(
    () =>
      mutate("refresh", () =>
        requestJson<PluginsSnapshot>("/api/plugins/refresh", "POST", {}),
      ),
    [mutate],
  )

  const isModuleEnabled = useCallback(
    (moduleId: string) => {
      if (!snapshot) return true
      return snapshot.enabledUiModules.includes(moduleId)
    },
    [snapshot],
  )

  return {
    snapshot,
    loading,
    busyId,
    error,
    reload,
    togglePlugin,
    updatePluginSettings,
    testNotification,
    installPlugin,
    uninstallPlugin,
    addSource,
    removeSource,
    refreshSources,
    isModuleEnabled,
  }
}
