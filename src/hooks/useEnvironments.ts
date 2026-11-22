import { useCallback, useEffect, useState } from "react"
import { request } from "../../api"
import type { EnvironmentDirectory } from "../../app-types"

export function useEnvironments() {
  const [environmentVersion, setEnvironmentVersion] = useState(0)
  const [activeEnvironmentId, setActiveEnvironmentId] = useState("local")
  const [activeEnvironmentName, setActiveEnvironmentName] = useState("This computer")
  const [environmentDirectory, setEnvironmentDirectory] = useState<EnvironmentDirectory>({
    activeId: "local",
    environments: [{ id: "local", name: "This computer", kind: "local", status: "connected", active: true }],
  })

  const loadEnvironments = useCallback(async () => {
    try {
      const dir = await request<EnvironmentDirectory>("/api/environments")
      setEnvironmentDirectory(dir)
      const active = dir.environments.find(e => e.id === dir.activeId) ?? dir.environments[0]
      if (active) {
        setActiveEnvironmentId(active.id)
        setActiveEnvironmentName(active.name)
      }
    } catch (err) {
      // Fall back to local environment label if environments endpoint is unreachable.
      console.warn("[ADE] Could not load environments:", err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void request<EnvironmentDirectory>("/api/environments")
      .then(dir => {
        if (cancelled) return
        setEnvironmentDirectory(dir)
        const active = dir.environments.find(e => e.id === dir.activeId) ?? dir.environments[0]
        if (active) {
          setActiveEnvironmentId(active.id)
          setActiveEnvironmentName(active.name)
        }
      })
      .catch(err => {
        if (!cancelled) console.warn("[ADE] Could not load environments:", err instanceof Error ? err.message : String(err))
      })
    return () => { cancelled = true }
  }, [environmentVersion])

  const selectEnvironment = useCallback(async (env: EnvironmentDirectory["environments"][number]) => {
    const dir = await request<EnvironmentDirectory>("/api/environments/active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: env.id }),
    })
    setEnvironmentDirectory(dir)
    setActiveEnvironmentId(dir.activeId)
    setActiveEnvironmentName(dir.environments.find(e => e.id === dir.activeId)?.name ?? env.name)
    setEnvironmentVersion(v => v + 1)
  }, [])

  const handleEnvironmentChanged = useCallback((id: string, name: string, dir: EnvironmentDirectory) => {
    setActiveEnvironmentId(id)
    setActiveEnvironmentName(name)
    setEnvironmentDirectory(dir)
    setEnvironmentVersion(v => v + 1)
  }, [])

  return {
    environmentVersion,
    activeEnvironmentId,
    activeEnvironmentName,
    environmentDirectory,
    loadEnvironments,
    selectEnvironment,
    handleEnvironmentChanged,
  }
}
