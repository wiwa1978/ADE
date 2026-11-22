import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, ChevronRight, FolderOpen, FolderPlus, GitBranch, Link2, Sparkles, X } from "lucide-react"
import { request } from "../../api"
import type { ModelProfileId } from "../../app-types"
import { BUILTIN_BLUEPRINTS } from "../../packages/blueprints/index.ts"
import type { GitHubRepositoryPage, Project } from "../../ProjectsView"
import { AddProjectSourceFields, type DirBrowserState } from "./AddProjectForms"

export type AddProjectSource = "menu" | "github" | "url" | "local" | "scratch"

export function AddProjectWizard({
  open,
  initialSource = "menu",
  githubLogin,
  onClose,
  onCreated,
}: {
  open: boolean
  initialSource?: AddProjectSource
  githubLogin: string | null
  onClose: () => void
  onCreated: (project: Project) => void
}) {
  const [source, setSource] = useState<AddProjectSource>(initialSource)
  const [activeGhLogin, setActiveGhLogin] = useState<string | null>(githubLogin)
  const [projectName, setProjectName] = useState("")
  const [blueprintId, setBlueprintId] = useState("automated-factory")
  const [modelProfile, setModelProfile] = useState<ModelProfileId>("balanced")
  const [ghRepo, setGhRepo] = useState("")
  const [cloneLocally, setCloneLocally] = useState(true)
  const [cloneParentDir, setCloneParentDir] = useState("")
  const [gitUrl, setGitUrl] = useState("")
  const [localPath, setLocalPath] = useState("")
  const [detectedGh, setDetectedGh] = useState<string | null>(null)
  const [initGitIfMissing, setInitGitIfMissing] = useState(true)
  const [showBrowser, setShowBrowser] = useState(false)
  const [dirState, setDirState] = useState<DirBrowserState | null>(null)
  const [createOnGitHub, setCreateOnGitHub] = useState(true)
  const [visibility, setVisibility] = useState<"private" | "public">("private")
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setSource(initialSource)
      setActiveGhLogin(githubLogin)
      setError("")
      setStatusMsg("")
    }
  }, [open, initialSource, githubLogin])

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
    if (open && !cloneParentDir) void loadDirectory(undefined, true)
  }, [open, cloneParentDir, loadDirectory])

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

  if (!open) return null

  async function detectRemoteForPath(path: string) {
    try {
      const res = await request<{ repository: string; githubRepo: string | null }>("/api/projects/detect-git", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      })
      setDetectedGh(res.githubRepo)
    } catch {
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
          name: finalName || "New Project",
          repository: finalRepoPath,
          githubUrl: finalGithubUrl,
          blueprintId,
          modelProfile,
        }),
      })
      onCreated(saved.project)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add project.")
    } finally {
      setBusy(false)
      setStatusMsg("")
    }
  }

  return (
    <div className="sf-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="sf-modal !max-w-lg">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {source !== "menu" ? (
              <button type="button" className="sf-btn-ghost !px-1.5" onClick={() => { setSource("menu"); setError("") }} disabled={busy}>
                <ArrowLeft className="size-4" />
              </button>
            ) : null}
            <div>
              <h2 className="text-[15px] font-semibold">
                {source === "menu" ? "Add Project"
                  : source === "github" ? "Add from GitHub"
                    : source === "url" ? "Add from Git URL"
                      : source === "local" ? "Add Local Folder or Repository"
                        : "New Project from Scratch"}
              </h2>
              <p className="text-xs opacity-65 mt-0.5">
                {source === "menu"
                  ? "Choose how you want to bring a codebase into ADE."
                  : "Projects hold your repository, GitHub link, Blueprint, and default models."}
              </p>
            </div>
          </div>
          <button type="button" className="sf-btn-ghost" onClick={onClose} disabled={busy} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {error ? <div className="ade-banner-error">{error}</div> : null}

        {source === "menu" ? (
          <div className="grid gap-2">
            {[
              { id: "github" as const, icon: <GitBranch className="size-4 text-[rgb(var(--primary))]" />, title: "Add from GitHub", desc: "Search your public/private GitHub repos (or create a new one) and clone locally." },
              { id: "url" as const, icon: <Link2 className="size-4 text-sky-400" />, title: "Add from Git URL", desc: "Clone from Azure DevOps, GitLab, Bitbucket, GitHub HTTPS, or SSH URL." },
              { id: "local" as const, icon: <FolderOpen className="size-4 text-amber-400" />, title: "Add local folder or repository", desc: "Pick an existing folder on this device, auto-detect GitHub remote, or initialize Git." },
              { id: "scratch" as const, icon: <FolderPlus className="size-4 text-emerald-400" />, title: "Create brand-new project", desc: "Create a fresh local folder, run git init, and optionally create a GitHub repo." },
            ].map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSource(item.id)}
                className="flex items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:border-[rgb(var(--primary)/0.7)] hover:bg-[rgb(var(--surface-raised))] p-3.5 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 shrink-0">{item.icon}</div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold">{item.title}</div>
                    <div className="text-xs opacity-65 mt-0.5 leading-snug">{item.desc}</div>
                  </div>
                </div>
                <ChevronRight className="size-4 opacity-50 shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <div className="grid gap-3.5">
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
              onLocalPathChange={setLocalPath}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[rgb(var(--border)/0.75)]">
              <label className="sf-label">
                <span>Default Factory Blueprint</span>
                <select className="sf-field" value={blueprintId} onChange={e => setBlueprintId(e.target.value)}>
                  {BUILTIN_BLUEPRINTS.map(bp => (
                    <option key={bp.id} value={bp.id}>{bp.name}</option>
                  ))}
                </select>
              </label>
              <label className="sf-label">
                <span>Default Model Profile</span>
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

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[rgb(var(--border)/0.75)]">
              <span className="text-xs opacity-70">{statusMsg}</span>
              <div className="flex gap-2">
                <button type="button" className="sf-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="sf-btn-primary" onClick={() => void finishCreate()} disabled={busy}>
                  <Sparkles className="size-3.5" /> {busy ? "Setting up…" : "Add Project"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
