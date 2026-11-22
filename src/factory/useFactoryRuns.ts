import { useCallback, useEffect, useState } from "react"
import { getCaptainEndpoint, request, setCaptainEndpoint } from "../../api"
import type { FactoryBlueprint, ModelProfileId } from "../../app-types"
import type { Project } from "../../ProjectsView"
import { useEventStream, useEventStreamListener } from "../hooks/EventStreamContext"
import type { FactoryCapabilities, FactoryRunDetail } from "./types"

const DEFAULT_PROFILES: { id: ModelProfileId; name: string; euCompliantByDefault: boolean }[] = [
  { id: "balanced", name: "Balanced", euCompliantByDefault: false },
  { id: "max-quality", name: "Max Quality", euCompliantByDefault: false },
  { id: "budget", name: "Budget / Fast", euCompliantByDefault: false },
  { id: "eu-only", name: "EU Data Residency (GDPR)", euCompliantByDefault: true },
  { id: "eu-sovereign", name: "EU Sovereign (CLOUD-Act-Free)", euCompliantByDefault: true },
  { id: "local-ollama", name: "Local / Ollama ($0)", euCompliantByDefault: true },
]

export function useFactoryRuns(params: {
  activeProject: Project | null
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  onNeedProjectModal: (mode: "create" | "edit") => void
  onRunStarted: () => void
}) {
  const { activeProject, selectedRunId, onSelectRun, onNeedProjectModal, onRunStarted } = params
  const eventStream = useEventStream()

  const [caps, setCaps] = useState<FactoryCapabilities | null>(null)
  const [blueprints, setBlueprints] = useState<FactoryBlueprint[]>([])
  const [runs, setRuns] = useState<FactoryRunDetail[]>([])
  const [endpointFlavor, setEndpointFlavor] = useState<"local" | "remote">(() => getCaptainEndpoint().flavor)
  const [remoteUrl, setRemoteUrl] = useState(() => getCaptainEndpoint().baseUrl)
  const [remoteToken, setRemoteToken] = useState(() => getCaptainEndpoint().authToken ?? "")
  const [showRemoteConfig, setShowRemoteConfig] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    try {
      const [c, bps, r] = await Promise.all([
        request<FactoryCapabilities>("/api/factory/capabilities"),
        request<{ blueprints: FactoryBlueprint[] }>("/api/factory/blueprints"),
        request<{ runs: FactoryRunDetail[] }>("/api/factory/runs"),
      ])
      setCaps(c)
      setBlueprints(bps.blueprints)
      setRuns(r.runs)
      setError("")
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — restart \`npm run dev\` if the runtime server was started before Factory routes were added.`
          : "Could not load Factory runtime.",
      )
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      request<FactoryCapabilities>("/api/factory/capabilities"),
      request<{ blueprints: FactoryBlueprint[] }>("/api/factory/blueprints"),
      request<{ runs: FactoryRunDetail[] }>("/api/factory/runs"),
    ])
      .then(([c, bps, r]) => {
        if (cancelled) return
        setCaps(c)
        setBlueprints(bps.blueprints)
        setRuns(r.runs)
        setError("")
      })
      .catch(err => {
        if (cancelled) return
        setError(
          err instanceof Error
            ? `${err.message} — restart \`npm run dev\` if the runtime server was started before Factory routes were added.`
            : "Could not load Factory runtime.",
        )
      })
    return () => { cancelled = true }
  }, [])

  useEventStreamListener("factory.event", (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as { payload?: { type?: string; payload?: FactoryRunDetail } }
      const inner = parsed?.payload
      if (inner?.type === "run.updated" && inner.payload?.run?.runId) {
        const updated = inner.payload
        setRuns(prev => {
          const exists = prev.some(r => r.run.runId === updated.run.runId)
          return exists
            ? prev.map(r => (r.run.runId === updated.run.runId ? updated : r))
            : [...prev, updated]
        })
      }
    } catch (err) {
      console.warn("[ADE] Ignored malformed factory.event SSE frame:", err instanceof Error ? err.message : String(err))
    }
  })

  const projectRuns = activeProject ? runs.filter(r => r.run.projectId === activeProject.id) : runs
  const activeRun =
    runs.find(r => r.run.runId === selectedRunId) ??
    projectRuns[projectRuns.length - 1] ??
    runs[runs.length - 1] ??
    null

  function applyEndpoint(nextFlavor: "local" | "remote") {
    setEndpointFlavor(nextFlavor)
    if (nextFlavor === "local") {
      setShowRemoteConfig(false)
      setCaptainEndpoint({ flavor: "local", baseUrl: "", region: "local" })
      eventStream.reconnect()
      void refresh()
    } else {
      setShowRemoteConfig(true)
      if (remoteUrl.trim()) {
        setCaptainEndpoint({
          flavor: "remote",
          baseUrl: remoteUrl.trim(),
          authToken: remoteToken.trim() || undefined,
          region: "eu",
        })
        eventStream.reconnect()
        void refresh()
      }
    }
  }

  async function startRunForActiveProject(input: { issueNumber?: number; taskPrompt?: string; autoStart: boolean }) {
    if (!activeProject) {
      onNeedProjectModal("create")
      return
    }
    if (!activeProject.repository) {
      setError(`Link a local Git checkout path in "${activeProject.name}" Project Settings first.`)
      onNeedProjectModal("edit")
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await request<{ run: FactoryRunDetail }>("/api/factory/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.id,
          issueNumber: input.issueNumber,
          taskPrompt: input.taskPrompt,
          autoStart: input.autoStart,
        }),
      })
      setRuns(prev => {
        const exists = prev.some(r => r.run.runId === res.run.run.runId)
        return exists ? prev.map(r => (r.run.runId === res.run.run.runId ? res.run : r)) : [...prev, res.run]
      })
      onSelectRun(res.run.run.runId)
      onRunStarted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Factory run.")
    } finally {
      setBusy(false)
    }
  }

  async function runAction(
    runId: string,
    action: "step" | "auto-run" | "approve" | "pause" | "takeover",
    body: Record<string, unknown> = {},
  ) {
    setBusy(true)
    setError("")
    try {
      const res = await request<{ run: FactoryRunDetail }>(`/api/factory/runs/${encodeURIComponent(runId)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      setRuns(prev => prev.map(r => (r.run.runId === res.run.run.runId ? res.run : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : `Factory action "${action}" failed.`)
    } finally {
      setBusy(false)
    }
  }

  async function steerRun(runId: string, note: string) {
    setBusy(true)
    setError("")
    try {
      const res = await request<{ run: FactoryRunDetail }>(`/api/factory/runs/${encodeURIComponent(runId)}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      })
      setRuns(prev => prev.map(r => (r.run.runId === res.run.run.runId ? res.run : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send steering note.")
    } finally {
      setBusy(false)
    }
  }

  const activeBlueprintName =
    blueprints.find(b => b.id === (activeProject?.blueprintId ?? "automated-factory"))?.name ?? "Automated Factory"

  return {
    blueprints,
    projectRuns,
    activeRun,
    activeBlueprintName,
    profiles: caps?.modelProfiles ?? DEFAULT_PROFILES,
    endpointFlavor,
    remoteUrl,
    setRemoteUrl,
    remoteToken,
    setRemoteToken,
    showRemoteConfig,
    busy,
    error,
    refresh,
    applyEndpoint,
    startRunForActiveProject,
    runAction,
    steerRun,
  }
}
