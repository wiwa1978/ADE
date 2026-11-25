import { useCallback, useEffect, useMemo, useState } from "react"
import { request } from "../../api"
import type { EnvironmentSummary, ModelProfileId } from "../../app-types"
import type { GitHubRepositoryPage, Project } from "../../ProjectsView"
import type { DirBrowserState } from "../AddProjectForms"
import type { AddProjectSource } from "../AddProjectWizard"
import type { EnvScopeFilter } from "./WizardEnvironmentStep"
import {
  nextEmptyProjectName,
  SOURCE_CHOICES,
  submitWizardProject,
  type ConcreteProjectSource,
} from "./wizard-helpers"

export type WizardStep = "environment" | "source" | "configure"

export interface UseAddProjectWizardArgs {
  initialSource: AddProjectSource
  githubLogin: string | null
  environments: EnvironmentSummary[]
  activeEnvironmentId: string
  existingProjectNames: string[]
  onSelectEnvironment?: (env: EnvironmentSummary) => Promise<void>
  onAddHost?: () => void
  onClose: () => void
  onCreated: (project: Project, options?: { openSettings?: boolean }) => void
}

export function useAddProjectWizard({
  initialSource, githubLogin, environments, activeEnvironmentId, existingProjectNames,
  onSelectEnvironment, onAddHost, onClose, onCreated,
}: UseAddProjectWizardArgs) {
  const defaultEnvs: EnvironmentSummary[] = useMemo(
    () =>
      environments.length > 0
        ? environments
        : [{ id: "local", name: "This computer", kind: "local", status: "connected", active: true }],
    [environments],
  )

  const [step, setStep] = useState<WizardStep>(initialSource !== "menu" ? "configure" : "environment")
  const [source, setSource] = useState<ConcreteProjectSource>(initialSource === "menu" ? "local" : initialSource)
  const [envFilter, setEnvFilter] = useState<EnvScopeFilter>("all")
  const [selectedEnvId, setSelectedEnvId] = useState<string>(activeEnvironmentId)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [activeGhLogin, setActiveGhLogin] = useState<string | null>(githubLogin)
  const [projectName, setProjectName] = useState("")
  const [blueprintId, setBlueprintId] = useState("vibe")
  const [modelProfile, setModelProfile] = useState<ModelProfileId>("balanced")
  const [ghRepo, setGhRepo] = useState("")
  const [cloneLocally, setCloneLocally] = useState(true)
  const [cloneParentDir, setCloneParentDir] = useState("")
  const [gitUrl, setGitUrl] = useState("")
  const [localPath, setLocalPath] = useState("")
  const [detectedGh, setDetectedGh] = useState<string | null>(null)
  const [localGitStatus, setLocalGitStatus] = useState<"unknown" | "git" | "no-git">("unknown")
  const [initGitIfMissing, setInitGitIfMissing] = useState(true)
  const [showBrowser, setShowBrowser] = useState(false)
  const [dirState, setDirState] = useState<DirBrowserState | null>(null)
  const [createOnGitHub, setCreateOnGitHub] = useState(true)
  const [visibility, setVisibility] = useState<"private" | "public">("private")
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (cloneParentDir) return
    let cancelled = false
    void request<DirBrowserState>("/api/system/browse-dirs")
      .then(res => {
        if (cancelled) return
        setDirState(res)
        setCloneParentDir(prev => prev || res.currentPath)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [cloneParentDir])

  const loadDirectory = useCallback(async (path?: string, silent = false) => {
    try {
      const qs = path ? `?path=${encodeURIComponent(path)}` : ""
      const res = await request<DirBrowserState>(`/api/system/browse-dirs${qs}`)
      setDirState(res)
      if (!cloneParentDir) setCloneParentDir(res.currentPath)
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Could not browse local folders.")
    }
  }, [cloneParentDir])

  const searchRepos = useCallback(
    (login: string, query: string, page: number, signal?: AbortSignal) =>
      request<GitHubRepositoryPage>("/api/github/repositories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login, query, page }),
        signal,
      }),
    [],
  )

  const quickConnectGh = useCallback(async () => {
    const res = await request<{ login: string | null }>("/api/github/connect", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    })
    setActiveGhLogin(res.login)
    return res.login
  }, [])

  const filteredEnvs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return defaultEnvs.filter(env => {
      if (envFilter === "local" && env.kind !== "local") return false
      if (envFilter === "remote" && env.kind === "local") return false
      if (!q) return true
      return env.name.toLowerCase().includes(q) || (env.sshHost ?? "").toLowerCase().includes(q)
        || env.id.toLowerCase().includes(q) || (env.kind === "local" && "this device computer mac".includes(q))
    })
  }, [defaultEnvs, envFilter, searchQuery])

  const filteredSources = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return q ? SOURCE_CHOICES.filter(item => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q) || item.keywords.includes(q)) : SOURCE_CHOICES
  }, [searchQuery])

  const selectedEnv = defaultEnvs.find(e => e.id === selectedEnvId) ?? defaultEnvs[0]
  const envTotalRows = filteredEnvs.length + (onAddHost ? 1 : 0)
  const safeEnvIndex = Math.min(activeIndex, Math.max(0, envTotalRows - 1))
  const safeSourceIndex = Math.min(activeIndex, Math.max(0, filteredSources.length - 1))

  async function detectRemoteForPath(path: string) {
    if (!path.trim()) { setDetectedGh(null); setLocalGitStatus("unknown"); return }
    try {
      const res = await request<{ isGitRepo?: boolean; repository: string; githubRepo: string | null }>("/api/projects/detect-git", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }),
      })
      const isGit = res.isGitRepo !== false
      setLocalGitStatus(isGit ? "git" : "no-git")
      setDetectedGh(isGit ? res.githubRepo : null)
    } catch {
      setLocalGitStatus("no-git"); setDetectedGh(null)
    }
  }

  async function pickFolderNative(target: "local" | "parent") {
    setError("")
    try {
      const res = await request<{ path: string | null }>("/api/system/pick-folder", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      })
      if (!res.path) return
      if (target === "parent") setCloneParentDir(res.path)
      else {
        setLocalPath(res.path)
        const folderName = res.path.split(/[\\/]/).filter(Boolean).pop() ?? ""
        if (!projectName.trim() && folderName) setProjectName(folderName)
        void detectRemoteForPath(res.path)
      }
    } catch {
      setShowBrowser(true)
      void loadDirectory(target === "parent" ? cloneParentDir : localPath || undefined)
    }
  }

  async function selectEnvironmentAndAdvance(env: EnvironmentSummary) {
    setError(""); setSelectedEnvId(env.id)
    if (onSelectEnvironment && env.id !== activeEnvironmentId) {
      setBusy(true); setStatusMsg(`Connecting to ${env.name}…`)
      try { await onSelectEnvironment(env) } catch (err) {
        setError(err instanceof Error ? err.message : `Could not connect to ${env.name}.`)
        setBusy(false); setStatusMsg(""); return
      }
      setBusy(false); setStatusMsg("")
    }
    setSearchQuery(""); setActiveIndex(0); setStep("source")
  }

  function selectSourceAndAdvance(nextSource: ConcreteProjectSource) {
    setError(""); setSource(nextSource); setSearchQuery(""); setActiveIndex(0); setStep("configure")
  }

  async function handleSkipCreateEmpty() {
    if (busy) return
    setBusy(true); setError(""); setStatusMsg("Creating empty project…")
    try {
      const emptyName = projectName.trim() || nextEmptyProjectName(existingProjectNames)
      const saved = await request<{ project: Project }>("/api/projects", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: crypto.randomUUID(), name: emptyName, repository: "", githubUrl: "", blueprintId, modelProfile }),
      })
      onCreated(saved.project, { openSettings: true }); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create empty project.")
    } finally { setBusy(false); setStatusMsg("") }
  }

  async function finishCreate() {
    setBusy(true); setError(""); setStatusMsg("")
    try {
      const project = await submitWizardProject({
        source, projectName, ghRepo, cloneLocally, cloneParentDir, gitUrl, localPath,
        detectedGh, initGitIfMissing, createOnGitHub, visibility, blueprintId, modelProfile,
        existingProjectNames, onStatus: setStatusMsg,
      })
      onCreated(project, { openSettings: false }); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add project.")
    } finally { setBusy(false); setStatusMsg("") }
  }

  const handleStepKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); return }
    if (step === "environment") {
      if (e.key === "ArrowDown" && envTotalRows > 0) { e.preventDefault(); setActiveIndex(i => (i + 1) % envTotalRows) }
      else if (e.key === "ArrowUp" && envTotalRows > 0) { e.preventDefault(); setActiveIndex(i => (i - 1 + envTotalRows) % envTotalRows) }
      else if (e.key === "Enter" && !busy) {
        e.preventDefault()
        if (safeEnvIndex < filteredEnvs.length && filteredEnvs[safeEnvIndex]) void selectEnvironmentAndAdvance(filteredEnvs[safeEnvIndex])
        else if (onAddHost) { onClose(); onAddHost() }
      }
    } else if (step === "source") {
      if (e.key === "ArrowDown" && filteredSources.length > 0) { e.preventDefault(); setActiveIndex(i => (i + 1) % filteredSources.length) }
      else if (e.key === "ArrowUp" && filteredSources.length > 0) { e.preventDefault(); setActiveIndex(i => (i - 1 + filteredSources.length) % filteredSources.length) }
      else if (e.key === "Enter" && !busy) {
        const picked = filteredSources[safeSourceIndex]
        if (picked) { e.preventDefault(); selectSourceAndAdvance(picked.id) }
      } else if (e.key === "Backspace" && !searchQuery) { e.preventDefault(); setStep("environment"); setActiveIndex(0) }
    }
  }

  return {
    step, setStep, source, envFilter, setEnvFilter, searchQuery, setSearchQuery,
    activeIndex, setActiveIndex, showAdvanced, setShowAdvanced, activeGhLogin,
    projectName, setProjectName, blueprintId, setBlueprintId, modelProfile, setModelProfile,
    ghRepo, setGhRepo, cloneLocally, setCloneLocally, cloneParentDir, setCloneParentDir,
    gitUrl, setGitUrl, localPath, setLocalPath, detectedGh, setDetectedGh,
    localGitStatus, setLocalGitStatus, initGitIfMissing, setInitGitIfMissing,
    showBrowser, setShowBrowser, dirState, createOnGitHub, setCreateOnGitHub,
    visibility, setVisibility, busy, statusMsg, error, setError,
    filteredEnvs, filteredSources, selectedEnv, safeEnvIndex, safeSourceIndex,
    loadDirectory, searchRepos, quickConnectGh, detectRemoteForPath, pickFolderNative,
    selectEnvironmentAndAdvance, selectSourceAndAdvance, handleSkipCreateEmpty, finishCreate, handleStepKeyDown,
  }
}
