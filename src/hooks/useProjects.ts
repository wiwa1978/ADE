import { useCallback, useEffect, useState } from "react"
import { request } from "../../api"
import type { Screen } from "../../app-types"
import type { GitHubRepositoryPage, Project, ProjectActivity, ProjectInput } from "../../ProjectsView"
import type { FactoryRunDetail } from "../factory/types"
import { useEventStreamListener } from "./useEventStream"

export function searchGitHubRepositories(login: string, query: string, page: number, signal?: AbortSignal) {
  return request<GitHubRepositoryPage>("/api/github/repositories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, query, page }),
    signal,
  })
}

export function useProjects(params: {
  screen: Screen
  selectedProjectId: string | null
  environmentVersion: number
  onClearSelectedProject: () => void
  onError: (msg: string) => void
}) {
  const { screen, selectedProjectId, environmentVersion, onClearSelectedProject, onError } = params
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsError, setProjectsError] = useState("")
  const [projectDrafts, setProjectDrafts] = useState<Record<string, ProjectInput>>({})
  const [projectActivity, setProjectActivity] = useState<ProjectActivity | null>(null)
  const [projectActivityError, setProjectActivityError] = useState("")
  const [factoryRuns, setFactoryRuns] = useState<FactoryRunDetail[]>([])
  const [openStreamIdsByProject, setOpenStreamIdsByProject] = useState<Record<string, string[]>>({})
  const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null)
  const activityKey = screen === "project" && selectedProjectId ? `${selectedProjectId}:${environmentVersion}` : ""
  const [prevActivityKey, setPrevActivityKey] = useState(activityKey)

  if (activityKey !== prevActivityKey) {
    setPrevActivityKey(activityKey)
    if (activityKey) {
      setProjectActivity(null)
      setProjectActivityError("")
    }
  }

  const loadProjects = useCallback(async () => {
    try {
      const data = await request<{ projects: Project[] }>("/api/projects")
      setProjects(data.projects ?? [])
      setProjectsError("")
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Could not load projects.")
    }
  }, [])

  const loadFactoryRuns = useCallback(async () => {
    try {
      const data = await request<{ runs: FactoryRunDetail[] }>("/api/factory/runs")
      if (Array.isArray(data?.runs)) setFactoryRuns(data.runs)
    } catch {
      // Optional when factory routes are unavailable in minimal test fixtures.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void request<{ projects: Project[] }>("/api/projects")
      .then(data => {
        if (!cancelled) {
          setProjects(data.projects ?? [])
          setProjectsError("")
        }
      })
      .catch(err => {
        if (!cancelled) setProjectsError(err instanceof Error ? err.message : "Could not load projects.")
      })
    void request<{ runs: FactoryRunDetail[] }>("/api/factory/runs")
      .then(data => {
        if (!cancelled && Array.isArray(data?.runs)) setFactoryRuns(data.runs)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [environmentVersion])

  useEventStreamListener("factory.event", (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as { payload?: { type?: string; payload?: FactoryRunDetail } }
      const inner = parsed?.payload
      if (inner?.type === "run.updated" && inner.payload?.run?.runId) {
        const updated = inner.payload
        setFactoryRuns(prev => {
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

  // Load project activity when viewing a project.
  useEffect(() => {
    if (screen !== "project" || !selectedProjectId) return
    let cancelled = false
    void request<ProjectActivity>(`/api/projects/${encodeURIComponent(selectedProjectId)}/agents`)
      .then(data => { if (!cancelled) setProjectActivity(data) })
      .catch(err => { if (!cancelled) setProjectActivityError(err?.message || "Unavailable") })
    return () => { cancelled = true }
  }, [screen, selectedProjectId, environmentVersion])

  const upsertProject = useCallback((saved: Project) => {
    setProjects(prev => (prev.some(p => p.id === saved.id) ? prev.map(p => (p.id === saved.id ? saved : p)) : [...prev, saved]))
  }, [])

  const saveProject = useCallback(async (input: ProjectInput, existingId?: string) => {
    const endpoint = existingId ? `/api/projects/${encodeURIComponent(existingId)}` : "/api/projects"
    const res = await request<{ project: Project }>(endpoint, {
      method: existingId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    await loadProjects()
    return res.project
  }, [loadProjects])

  const deleteProject = useCallback(async (project: Project) => {
    try {
      await request(`/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" })
      setProjects(prev => prev.filter(p => p.id !== project.id))
      if (selectedProjectId === project.id) onClearSelectedProject()
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Could not delete project.")
    }
  }, [selectedProjectId, onClearSelectedProject])

  const openStreamPane = useCallback((projectId: string, streamId: string) => {
    setOpenStreamIdsByProject(prev => {
      const existing = prev[projectId] ?? []
      const nextList = existing.includes(streamId) ? existing : [...existing, streamId]
      return { ...prev, [projectId]: nextList }
    })
    setFocusedStreamId(streamId)
  }, [])

  const closeStreamPane = useCallback((projectId: string, streamId: string) => {
    setOpenStreamIdsByProject(prev => {
      const existing = prev[projectId] ?? []
      return { ...prev, [projectId]: existing.filter(id => id !== streamId) }
    })
  }, [])

  const startFactoryRunForProject = useCallback(async (
    project: Project,
    opts?: { issueNumber?: number; issueTitle?: string; issueBody?: string },
  ) => {
    try {
      const res = await request<{ run: FactoryRunDetail }>("/api/factory/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          repoPath: project.repository || undefined,
          githubRepo: project.githubUrl?.replace(/^https:\/\/github\.com\//i, "") || undefined,
          blueprintId: project.blueprintId || "automated-factory",
          modelProfile: project.modelProfile || "balanced",
          euOnlyMode: project.euOnlyMode ?? false,
          cloudActFree: project.cloudActFree ?? false,
          issueNumber: opts?.issueNumber,
          issueTitle: opts?.issueTitle,
          issueBody: opts?.issueBody,
        }),
      })
      if (res?.run?.run?.runId) {
        await loadFactoryRuns()
        openStreamPane(project.id, `factory:${res.run.run.runId}`)
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not start Software Factory run.")
    }
  }, [loadFactoryRuns, openStreamPane, onError])

  const factoryRunAction = useCallback(async (
    runId: string,
    action: "step" | "approve" | "pause" | "steer",
    note?: string,
  ) => {
    const path =
      action === "step"
        ? `/api/factory/runs/${encodeURIComponent(runId)}/step`
        : action === "approve"
          ? `/api/factory/runs/${encodeURIComponent(runId)}/approve`
          : action === "pause"
            ? `/api/factory/runs/${encodeURIComponent(runId)}/pause`
            : `/api/factory/runs/${encodeURIComponent(runId)}/steer`
    await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(note ? { note, message: note } : {}),
    })
    await loadFactoryRuns()
  }, [loadFactoryRuns])

  return {
    projects,
    projectsError,
    setProjectsError,
    projectDrafts,
    setProjectDrafts,
    projectActivity,
    projectActivityError,
    factoryRuns,
    openStreamIdsByProject,
    focusedStreamId,
    setFocusedStreamId,
    loadProjects,
    loadFactoryRuns,
    upsertProject,
    saveProject,
    deleteProject,
    openStreamPane,
    closeStreamPane,
    startFactoryRunForProject,
    factoryRunAction,
  }
}
