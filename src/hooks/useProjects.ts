import { useCallback, useEffect, useState } from "react"
import { request } from "../api"
import type { Screen } from "../app-types"
import type { GitHubRepositoryPage, Project, ProjectActivity, ProjectInput } from "../ProjectsView"

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
}) {
  const { screen, selectedProjectId, environmentVersion, onClearSelectedProject } = params
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsError, setProjectsError] = useState("")
  const [projectDrafts, setProjectDrafts] = useState<Record<string, ProjectInput>>({})
  const [projectActivity, setProjectActivity] = useState<ProjectActivity | null>(null)
  const [projectActivityError, setProjectActivityError] = useState("")
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
    return () => { cancelled = true }
  }, [environmentVersion])

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

  return {
    projects,
    projectsError,
    setProjectsError,
    projectDrafts,
    setProjectDrafts,
    projectActivity,
    projectActivityError,
    openStreamIdsByProject,
    focusedStreamId,
    setFocusedStreamId,
    loadProjects,
    upsertProject,
    saveProject,
    deleteProject,
    openStreamPane,
    closeStreamPane,
  }
}
