import { useCallback, useEffect, useState } from "react"
import { Play, RefreshCw } from "lucide-react"
import { request } from "../api"
import type { Project } from "../ProjectsView"

export type AgentTaskItem = {
  path: string
  title: string
  status: string
  priority: string
  ready: boolean
  blockedBy: string[]
  openChildren: string[]
  canFinish: boolean
  claimedSession: string | null
  depth: number
  statePreview: string
}

type Overview = { exists: boolean; tasks: AgentTaskItem[] }

export function ProjectAgentTasks({
  project,
  onOpen,
}: {
  project: Project
  onOpen: (task: AgentTaskItem, prompt: string) => Promise<void>
}) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setOverview(await request<Overview>(`/api/projects/${encodeURIComponent(project.id)}/agent-tasks`))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load .tasks/")
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    let cancelled = false
    void request<Overview>(`/api/projects/${encodeURIComponent(project.id)}/agent-tasks`)
      .then(res => { if (!cancelled) { setOverview(res); setError("") } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load .tasks/") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project.id])

  if (!overview?.exists && !loading) {
    return <div className="p-8 text-center text-xs opacity-65">This project has no .tasks/ directory.</div>
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[rgb(var(--border)/0.75)]">
        <span className="text-xs font-semibold">.tasks/</span>
        <button type="button" className="sf-btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {error ? <div className="m-4 ade-banner-error">{error}</div> : null}
      <div className="flex-1 overflow-y-auto divide-y divide-[rgb(var(--border)/0.65)]">
        {loading && !overview ? (
          <div className="p-8 text-center text-xs opacity-65">Loading tasks…</div>
        ) : (overview?.tasks ?? []).map(task => (
          <button
            key={task.path}
            type="button"
            className="w-full px-5 py-3.5 text-left hover:bg-[rgb(var(--surface)/0.6)] disabled:opacity-50"
            style={{ paddingLeft: `${1.25 + task.depth * 1.1}rem` }}
            disabled={opening !== null || (!task.ready && task.status !== "IN_PROGRESS" && task.status !== "PAUSED")}
            onClick={async () => {
              setOpening(task.path)
              setError("")
              try {
                const detail = await request<{ prompt: string }>(`/api/projects/${encodeURIComponent(project.id)}/agent-tasks/detail?path=${encodeURIComponent(task.path)}`)
                await onOpen(task, detail.prompt)
                await load()
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not open the task.")
              } finally {
                setOpening(null)
              }
            }}
          >
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Play className="size-3.5 opacity-60" />
              <span className="font-mono text-xs opacity-60">{task.path}</span>
              <span className="truncate">{task.title}</span>
              <span className="sf-badge sf-badge-muted">{task.status}</span>
            </div>
            {task.blockedBy.length > 0 ? (
              <div className="mt-1 text-xs opacity-65">Waiting on {task.blockedBy.join(", ")}</div>
            ) : null}
            {task.openChildren.length > 0 ? (
              <div className="mt-1 text-xs opacity-65">Open children: {task.openChildren.join(", ")}</div>
            ) : null}
            {task.statePreview ? <div className="mt-1 text-xs opacity-65 truncate">{task.statePreview}</div> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
