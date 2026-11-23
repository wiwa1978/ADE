import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Cloud,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Laptop,
  Link2,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import { request } from "../../api"
import type { EnvironmentSummary, ModelProfileId } from "../../app-types"
import { BUILTIN_BLUEPRINTS } from "../../packages/blueprints/index.ts"
import type { GitHubRepositoryPage, Project } from "../../ProjectsView"
import { AddProjectSourceFields, type DirBrowserState } from "./AddProjectForms"

export type AddProjectSource = "menu" | "github" | "url" | "local" | "scratch"
type WizardStep = "environment" | "source" | "configure"

type SourceChoice = {
  id: Exclude<AddProjectSource, "menu">
  title: string
  subtitle: string
  keywords: string
}

const SOURCE_CHOICES: SourceChoice[] = [
  {
    id: "scratch",
    title: "New project",
    subtitle: "Start a new Git repository from a name",
    keywords: "new scratch init git repository create",
  },
  {
    id: "local",
    title: "Local folder",
    subtitle: "Browse a folder on disk",
    keywords: "local folder disk directory browse existing path",
  },
  {
    id: "url",
    title: "Git URL",
    subtitle: "Clone from a remote URL",
    keywords: "git url clone ssh https gitlab bitbucket azure remote",
  },
  {
    id: "github",
    title: "GitHub repository",
    subtitle: "Clone GitHub owner/repo",
    keywords: "github repo repository clone owner",
  },
]

function nextEmptyProjectName(existingNames: string[]): string {
  const taken = new Set(existingNames.map(n => n.trim().toLowerCase()))
  let n = 1
  while (taken.has(`project ${n}`)) n += 1
  return `Project ${n}`
}

function sourceIcon(id: SourceChoice["id"]) {
  if (id === "scratch") return <FolderGit2 className="size-4 opacity-75 shrink-0" />
  if (id === "local") return <FolderPlus className="size-4 opacity-75 shrink-0" />
  if (id === "url") return <Link2 className="size-4 opacity-75 shrink-0" />
  return <GitBranch className="size-4 opacity-75 shrink-0" />
}

export function AddProjectWizard({
  open,
  initialSource = "menu",
  githubLogin,
  environments = [],
  activeEnvironmentId = "local",
  existingProjectNames = [],
  onSelectEnvironment,
  onAddHost,
  onClose,
  onCreated,
}: {
  open: boolean
  initialSource?: AddProjectSource
  githubLogin: string | null
  environments?: EnvironmentSummary[]
  activeEnvironmentId?: string
  existingProjectNames?: string[]
  onSelectEnvironment?: (env: EnvironmentSummary) => Promise<void>
  onAddHost?: () => void
  onClose: () => void
  onCreated: (project: Project, options?: { openSettings?: boolean }) => void
}) {
  const defaultEnvs: EnvironmentSummary[] = useMemo(
    () =>
      environments.length > 0
        ? environments
        : [{ id: "local", name: "This computer", kind: "local", status: "connected", active: true }],
    [environments],
  )

  const initialStep: WizardStep = initialSource !== "menu" ? "configure" : "environment"
  const [step, setStep] = useState<WizardStep>(initialStep)
  const [source, setSource] = useState<Exclude<AddProjectSource, "menu">>(
    initialSource === "menu" ? "local" : initialSource,
  )
  const [envFilter, setEnvFilter] = useState<"all" | "local" | "remote">("all")
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
  const [prevSyncKey, setPrevSyncKey] = useState(`${open}:${initialSource}:${githubLogin ?? ""}:${activeEnvironmentId}`)

  const searchInputRef = useRef<HTMLInputElement>(null)

  const syncKey = `${open}:${initialSource}:${githubLogin ?? ""}:${activeEnvironmentId}`
  if (syncKey !== prevSyncKey) {
    setPrevSyncKey(syncKey)
    if (open) {
      setStep(initialSource !== "menu" ? "configure" : "environment")
      setSource(initialSource === "menu" ? "local" : initialSource)
      setSelectedEnvId(activeEnvironmentId)
      setEnvFilter("all")
      setSearchQuery("")
      setActiveIndex(0)
      setShowAdvanced(false)
      setActiveGhLogin(githubLogin)
      setProjectName("")
      setGhRepo("")
      setGitUrl("")
      setLocalPath("")
      setDetectedGh(null)
      setLocalGitStatus("unknown")
      setShowBrowser(false)
      setError("")
      setStatusMsg("")
    }
  }

  useEffect(() => {
    if (!open) return
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onGlobalKeyDown)
    return () => window.removeEventListener("keydown", onGlobalKeyDown)
  }, [open, busy, onClose])

  useEffect(() => {
    if (!open) return
    if (step === "environment" || step === "source") {
      const id = setTimeout(() => searchInputRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  }, [open, step])

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

  useEffect(() => {
    if (!open || cloneParentDir) return
    let cancelled = false
    void request<DirBrowserState>("/api/system/browse-dirs")
      .then(res => {
        if (cancelled) return
        setDirState(res)
        setCloneParentDir(prev => prev || res.currentPath)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [open, cloneParentDir])

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
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
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
      return (
        env.name.toLowerCase().includes(q)
        || (env.sshHost ?? "").toLowerCase().includes(q)
        || env.id.toLowerCase().includes(q)
        || (env.kind === "local" && "this device computer mac".includes(q))
      )
    })
  }, [defaultEnvs, envFilter, searchQuery])

  const filteredSources = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return SOURCE_CHOICES
    return SOURCE_CHOICES.filter(
      item =>
        item.title.toLowerCase().includes(q)
        || item.subtitle.toLowerCase().includes(q)
        || item.keywords.includes(q),
    )
  }, [searchQuery])

  const selectedEnv = defaultEnvs.find(e => e.id === selectedEnvId) ?? defaultEnvs[0]

  if (!open) return null

  async function detectRemoteForPath(path: string) {
    if (!path.trim()) {
      setDetectedGh(null)
      setLocalGitStatus("unknown")
      return
    }
    try {
      const res = await request<{ isGitRepo?: boolean; repository: string; githubRepo: string | null }>("/api/projects/detect-git", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      })
      const isGit = res.isGitRepo !== false
      setLocalGitStatus(isGit ? "git" : "no-git")
      setDetectedGh(isGit ? res.githubRepo : null)
    } catch {
      setLocalGitStatus("no-git")
      setDetectedGh(null)
    }
  }

  async function pickFolderNative(target: "local" | "parent") {
    setError("")
    try {
      const res = await request<{ path: string | null }>("/api/system/pick-folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      if (!res.path) return
      if (target === "parent") {
        setCloneParentDir(res.path)
      } else {
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
    setError("")
    setSelectedEnvId(env.id)
    if (onSelectEnvironment && env.id !== activeEnvironmentId) {
      setBusy(true)
      setStatusMsg(`Connecting to ${env.name}…`)
      try {
        await onSelectEnvironment(env)
      } catch (err) {
        setError(err instanceof Error ? err.message : `Could not connect to ${env.name}.`)
        setBusy(false)
        setStatusMsg("")
        return
      }
      setBusy(false)
      setStatusMsg("")
    }
    setSearchQuery("")
    setActiveIndex(0)
    setStep("source")
  }

  function selectSourceAndAdvance(nextSource: Exclude<AddProjectSource, "menu">) {
    setError("")
    setSource(nextSource)
    setSearchQuery("")
    setActiveIndex(0)
    setStep("configure")
  }

  async function handleSkipCreateEmpty() {
    if (busy) return
    setBusy(true)
    setError("")
    setStatusMsg("Creating empty project…")
    try {
      const emptyName = projectName.trim() || nextEmptyProjectName(existingProjectNames)
      const saved = await request<{ project: Project }>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          name: emptyName,
          repository: "",
          githubUrl: "",
          blueprintId,
          modelProfile,
        }),
      })
      onCreated(saved.project, { openSettings: true })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create empty project.")
    } finally {
      setBusy(false)
      setStatusMsg("")
    }
  }

  async function finishCreate() {
    setBusy(true)
    setError("")
    setStatusMsg("")
    try {
      let finalName = projectName.trim()
      let finalRepoPath = ""
      let finalGithubUrl = ""

      if (source === "github") {
        if (!ghRepo.trim()) throw new Error("Select or create a GitHub repository first.")
        const slug = ghRepo.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "")
        finalGithubUrl = slug
        if (!finalName) finalName = slug.split("/").pop() || slug
        if (cloneLocally) {
          setStatusMsg(`Cloning ${slug}…`)
          const cloned = await request<{ repository: string; githubUrl: string | null; name: string }>("/api/projects/clone", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: slug, destinationParent: cloneParentDir || undefined }),
          })
          finalRepoPath = cloned.repository
          if (cloned.githubUrl) finalGithubUrl = cloned.githubUrl
          if (!finalName) finalName = cloned.name
        }
      } else if (source === "url") {
        if (!gitUrl.trim()) throw new Error("Enter a Git repository URL (HTTPS or SSH).")
        setStatusMsg("Cloning repository…")
        const cloned = await request<{ repository: string; githubUrl: string | null; name: string }>("/api/projects/clone", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: gitUrl.trim(), destinationParent: cloneParentDir || undefined }),
        })
        finalRepoPath = cloned.repository
        finalGithubUrl = cloned.githubUrl ?? ""
        if (!finalName) finalName = cloned.name
      } else if (source === "local") {
        if (!localPath.trim()) throw new Error("Choose or enter a local folder path.")
        setStatusMsg("Preparing local workspace…")
        const inited = await request<{ repository: string; githubUrl: string | null; name: string }>("/api/projects/init-local", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folderPath: localPath.trim(), initializeGit: initGitIfMissing }),
        })
        finalRepoPath = inited.repository
        finalGithubUrl = detectedGh || inited.githubUrl || ""
        if (!finalName) finalName = inited.name
      } else if (source === "scratch") {
        if (!finalName) throw new Error("Enter a project name.")
        const safeSlug = finalName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "new-project"
        const targetFolder = `${(cloneParentDir || "").replace(/\/$/, "")}/${safeSlug}`
        setStatusMsg(`Initializing ${targetFolder}…`)
        const inited = await request<{ repository: string }>("/api/projects/init-local", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folderPath: targetFolder, initializeGit: true }),
        })
        finalRepoPath = inited.repository
        if (createOnGitHub) {
          setStatusMsg(`Creating ${visibility} repository on GitHub…`)
          const created = await request<{ repository: { fullName: string; url: string } }>("/api/github/repositories/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: safeSlug, visibility, addReadme: false }),
          })
          finalGithubUrl = created.repository.fullName
        }
      }

      setStatusMsg("Saving project…")
      const saved = await request<{ project: Project }>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          name: finalName || nextEmptyProjectName(existingProjectNames),
          repository: finalRepoPath,
          githubUrl: finalGithubUrl,
          blueprintId,
          modelProfile,
        }),
      })
      onCreated(saved.project, { openSettings: false })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add project.")
    } finally {
      setBusy(false)
      setStatusMsg("")
    }
  }

  const envTotalRows = filteredEnvs.length + (onAddHost ? 1 : 0)
  const safeEnvIndex = Math.min(activeIndex, Math.max(0, envTotalRows - 1))
  const safeSourceIndex = Math.min(activeIndex, Math.max(0, filteredSources.length - 1))

  const handleStepKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !busy) {
      e.preventDefault()
      onClose()
      return
    }
    if (step === "environment") {
      if (e.key === "ArrowDown" && envTotalRows > 0) {
        e.preventDefault()
        setActiveIndex(i => (i + 1) % envTotalRows)
      } else if (e.key === "ArrowUp" && envTotalRows > 0) {
        e.preventDefault()
        setActiveIndex(i => (i - 1 + envTotalRows) % envTotalRows)
      } else if (e.key === "Enter" && !busy) {
        e.preventDefault()
        if (safeEnvIndex < filteredEnvs.length && filteredEnvs[safeEnvIndex]) {
          void selectEnvironmentAndAdvance(filteredEnvs[safeEnvIndex])
        } else if (onAddHost) {
          onClose()
          onAddHost()
        }
      }
    } else if (step === "source") {
      if (e.key === "ArrowDown" && filteredSources.length > 0) {
        e.preventDefault()
        setActiveIndex(i => (i + 1) % filteredSources.length)
      } else if (e.key === "ArrowUp" && filteredSources.length > 0) {
        e.preventDefault()
        setActiveIndex(i => (i - 1 + filteredSources.length) % filteredSources.length)
      } else if (e.key === "Enter" && !busy) {
        const picked = filteredSources[safeSourceIndex]
        if (picked) {
          e.preventDefault()
          selectSourceAndAdvance(picked.id)
        }
      } else if (e.key === "Backspace" && !searchQuery) {
        e.preventDefault()
        setStep("environment")
        setActiveIndex(0)
      }
    }
  }

  const sourceTitle =
    source === "scratch" ? "New project"
      : source === "local" ? "Local folder"
        : source === "url" ? "Git URL"
          : "GitHub repository"

  return (
    <div className="ade-cmd-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div
        className="ade-wizard-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create Project"
        onKeyDown={handleStepKeyDown}
      >
        {/* Top bar */}
        {step === "environment" || step === "source" ? (
          <div className="ade-wizard-search-row">
            {step === "source" ? (
              <button
                type="button"
                className="ade-wizard-icon-btn"
                onClick={() => { setStep("environment"); setSearchQuery(""); setActiveIndex(0) }}
                disabled={busy}
                aria-label="Back to environments"
                title="Back (Backspace)"
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : (
              <Search className="size-4 opacity-50 shrink-0" />
            )}
            <input
              ref={searchInputRef}
              type="text"
              className="ade-cmd-input"
              placeholder={step === "environment" ? "Search environments…" : "Search sources…"}
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setActiveIndex(0) }}
              disabled={busy}
            />
            {step === "source" && selectedEnv ? (
              <span className="ade-wizard-env-pill">
                {selectedEnv.kind === "local" ? <Laptop className="size-3" /> : <Cloud className="size-3" />}
                <span>{selectedEnv.name}</span>
              </span>
            ) : null}
            <button type="button" className="ade-wizard-icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div className="ade-wizard-header-row">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                className="ade-wizard-icon-btn"
                onClick={() => { setStep("source"); setError("") }}
                disabled={busy}
                aria-label="Back to sources"
              >
                <ArrowLeft className="size-4" />
              </button>
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold leading-tight truncate">{sourceTitle}</h2>
                <p className="text-[11.5px] opacity-60 truncate">
                  {selectedEnv ? `${selectedEnv.name} · ` : ""}Configure now or skip to set up on the right side
                </p>
              </div>
            </div>
            <button type="button" className="ade-wizard-icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        )}

        {error ? (
          <div className="px-4 pt-3">
            <div className="ade-banner-error">{error}</div>
          </div>
        ) : null}

        {/* Step 1: Environments */}
        {step === "environment" ? (
          <div className="ade-wizard-body">
            <div className="ade-wizard-scope-bar" role="tablist" aria-label="Environment location">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "local", label: "This Computer", icon: <Laptop className="size-3.5" /> },
                  { id: "remote", label: "Remote", icon: <Cloud className="size-3.5" /> },
                ] as const
              ).map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={envFilter === tab.id}
                  className={`ade-wizard-scope-btn ${envFilter === tab.id ? "is-active" : ""}`}
                  onClick={() => { setEnvFilter(tab.id); setActiveIndex(0) }}
                >
                  {"icon" in tab ? tab.icon : null}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            <div className="ade-wizard-section-label">Environments</div>
            <div className="ade-wizard-list" role="listbox" aria-label="Environments">
              {filteredEnvs.map((env, idx) => {
                const isLocal = env.kind === "local"
                const highlighted = idx === safeEnvIndex
                return (
                  <button
                    key={env.id}
                    type="button"
                    role="option"
                    aria-selected={highlighted}
                    className={`ade-wizard-item ${highlighted ? "is-active" : ""}`}
                    onMouseMove={() => setActiveIndex(idx)}
                    onClick={() => void selectEnvironmentAndAdvance(env)}
                    disabled={busy}
                  >
                    <span className="ade-wizard-item-icon">
                      {isLocal ? <Laptop className="size-4" /> : <Cloud className="size-4" />}
                    </span>
                    <span className="ade-wizard-item-copy">
                      <span className="ade-wizard-item-title">{env.name}</span>
                      <span className="ade-wizard-item-sub">
                        {isLocal ? "This device" : env.sshHost || env.id}
                      </span>
                    </span>
                    <span className="ade-wizard-item-meta">
                      {env.id === activeEnvironmentId ? <span className="ade-wizard-tag">Current</span> : null}
                      <ChevronRight className="size-3.5 opacity-45" />
                    </span>
                  </button>
                )
              })}

              {filteredEnvs.length === 0 ? (
                <div className="px-3 py-5 text-center text-xs opacity-60">
                  {envFilter === "remote"
                    ? "No remote hosts configured yet."
                    : `No environments match “${searchQuery}”.`}
                </div>
              ) : null}

              {onAddHost ? (
                <button
                  type="button"
                  className={`ade-wizard-item ${safeEnvIndex === filteredEnvs.length ? "is-active" : ""}`}
                  onMouseMove={() => setActiveIndex(filteredEnvs.length)}
                  onClick={() => { onClose(); onAddHost() }}
                  disabled={busy}
                >
                  <span className="ade-wizard-item-icon">
                    <Plus className="size-4" />
                  </span>
                  <span className="ade-wizard-item-copy">
                    <span className="ade-wizard-item-title">Add remote host</span>
                    <span className="ade-wizard-item-sub">Connect an SSH host or cloud workspace</span>
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Step 2: Sources */}
        {step === "source" ? (
          <div className="ade-wizard-body">
            <div className="ade-wizard-section-label">Sources</div>
            <div className="ade-wizard-list" role="listbox" aria-label="Project sources">
              {filteredSources.map((item, idx) => {
                const highlighted = idx === safeSourceIndex
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={highlighted}
                    className={`ade-wizard-item ${highlighted ? "is-active" : ""}`}
                    onMouseMove={() => setActiveIndex(idx)}
                    onClick={() => selectSourceAndAdvance(item.id)}
                    disabled={busy}
                  >
                    <span className="ade-wizard-item-icon">{sourceIcon(item.id)}</span>
                    <span className="ade-wizard-item-copy">
                      <span className="ade-wizard-item-title">{item.title}</span>
                      <span className="ade-wizard-item-sub">{item.subtitle}</span>
                    </span>
                    <ChevronRight className="size-3.5 opacity-45 shrink-0" />
                  </button>
                )
              })}

              {filteredSources.length === 0 ? (
                <div className="px-3 py-5 text-center text-xs opacity-60">
                  No sources match “{searchQuery}”.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Step 3: Configure Source */}
        {step === "configure" ? (
          <div className="ade-wizard-config-body">
            <AddProjectSourceFields
              source={source}
              busy={busy}
              activeGhLogin={activeGhLogin}
              ghRepo={ghRepo}
              cloneLocally={cloneLocally}
              cloneParentDir={cloneParentDir}
              gitUrl={gitUrl}
              localPath={localPath}
              detectedGh={detectedGh}
              showInitGit={Boolean(localPath.trim()) && localGitStatus === "no-git"}
              initGitIfMissing={initGitIfMissing}
              showBrowser={showBrowser}
              dirState={dirState}
              projectName={projectName}
              createOnGitHub={createOnGitHub}
              visibility={visibility}
              onGhRepoChange={setGhRepo}
              onCloneLocallyChange={setCloneLocally}
              onCloneParentDirChange={setCloneParentDir}
              onGitUrlChange={setGitUrl}
              onLocalPathChange={next => {
                setLocalPath(next)
                setLocalGitStatus("unknown")
                setDetectedGh(null)
              }}
              onProjectNameChange={setProjectName}
              onInitGitChange={setInitGitIfMissing}
              onToggleBrowser={() => {
                setShowBrowser(v => !v)
                if (!showBrowser) void loadDirectory(localPath || undefined)
              }}
              onCreateOnGitHubChange={setCreateOnGitHub}
              onVisibilityChange={setVisibility}
              onSearchRepos={searchRepos}
              onQuickConnectGh={quickConnectGh}
              onPickFolderNative={target => void pickFolderNative(target)}
              onDetectRemote={path => void detectRemoteForPath(path)}
              onLoadDirectory={path => void loadDirectory(path)}
              onUseBrowserFolder={path => {
                setLocalPath(path)
                const nm = path.split(/[\\/]/).filter(Boolean).pop() ?? ""
                if (!projectName.trim() && nm) setProjectName(nm)
                setShowBrowser(false)
                void detectRemoteForPath(path)
              }}
            />

            <div className="pt-1 border-t border-[rgb(var(--border)/0.65)]">
              <button
                type="button"
                className="flex items-center gap-1.5 text-[11.5px] opacity-65 hover:opacity-100 transition-opacity cursor-pointer bg-transparent border-0 p-0 text-inherit"
                onClick={() => setShowAdvanced(v => !v)}
              >
                {showAdvanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                <span>Way of working &amp; model defaults</span>
              </button>
              {showAdvanced ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
                  <label className="sf-label">
                    <span>Way of working</span>
                    <select className="sf-field" value={blueprintId} onChange={e => setBlueprintId(e.target.value)}>
                      {[{ id: "vibe", name: "Vibe coding" }, ...BUILTIN_BLUEPRINTS].map(bp => (
                        <option key={bp.id} value={bp.id}>{bp.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="sf-label">
                    <span>Model Profile</span>
                    <select className="sf-field" value={modelProfile} onChange={e => setModelProfile(e.target.value as ModelProfileId)}>
                      <option value="balanced">Balanced</option>
                      <option value="max-quality">Max Quality</option>
                      <option value="budget">Budget / Fast</option>
                      <option value="eu-only">EU Residency (GDPR)</option>
                      <option value="eu-sovereign">EU Sovereign (CLOUD-Act-Free)</option>
                      <option value="local-ollama">Local / Ollama ($0)</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div className="ade-wizard-footer">
          {step === "environment" || step === "source" ? (
            <>
              <div className="ade-wizard-hints">
                <span><kbd className="ade-kbd">↑</kbd> <kbd className="ade-kbd">↓</kbd> Navigate</span>
                <span><kbd className="ade-kbd">Enter</kbd> Select</span>
                {step === "source" ? <span><kbd className="ade-kbd">Backspace</kbd> Back</span> : null}
                <span><kbd className="ade-kbd">Esc</kbd> Close</span>
              </div>
              <button
                type="button"
                className="ade-wizard-skip-btn"
                onClick={() => void handleSkipCreateEmpty()}
                disabled={busy}
                title="Create an empty project and configure it in the right-side settings panel"
              >
                {busy ? statusMsg || "Creating…" : "Skip"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="ade-wizard-skip-btn"
                onClick={() => void handleSkipCreateEmpty()}
                disabled={busy}
                title="Create an empty project and configure it in the right-side settings panel"
              >
                Skip
              </button>
              <div className="flex items-center gap-2">
                {statusMsg ? <span className="text-[11.5px] opacity-65">{statusMsg}</span> : null}
                <button type="button" className="sf-btn-secondary !h-8" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="sf-btn-primary !h-8" onClick={() => void finishCreate()} disabled={busy}>
                  <Sparkles className="size-3.5" /> {busy ? "Creating…" : "Create Project"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
