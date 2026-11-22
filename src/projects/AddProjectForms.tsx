import { Folder, FolderGit2, FolderOpen } from "lucide-react"
import { GitHubRepositoryPicker, type GitHubRepositoryPage } from "../../ProjectsView"

export type DirBrowserState = {
  currentPath: string
  parentPath: string | null
  isGitRepo: boolean
  entries: { name: string; path: string; isGitRepo: boolean }[]
}

export function AddProjectSourceFields({
  source,
  busy,
  activeGhLogin,
  ghRepo,
  cloneLocally,
  cloneParentDir,
  gitUrl,
  localPath,
  detectedGh,
  initGitIfMissing,
  showBrowser,
  dirState,
  projectName,
  createOnGitHub,
  visibility,
  onGhRepoChange,
  onCloneLocallyChange,
  onCloneParentDirChange,
  onGitUrlChange,
  onLocalPathChange,
  onProjectNameChange,
  onInitGitChange,
  onToggleBrowser,
  onCreateOnGitHubChange,
  onVisibilityChange,
  onSearchRepos,
  onQuickConnectGh,
  onPickFolderNative,
  onDetectRemote,
  onLoadDirectory,
  onUseBrowserFolder,
}: {
  source: "github" | "url" | "local" | "scratch"
  busy: boolean
  activeGhLogin: string | null
  ghRepo: string
  cloneLocally: boolean
  cloneParentDir: string
  gitUrl: string
  localPath: string
  detectedGh: string | null
  initGitIfMissing: boolean
  showBrowser: boolean
  dirState: DirBrowserState | null
  projectName: string
  createOnGitHub: boolean
  visibility: "private" | "public"
  onGhRepoChange: (val: string) => void
  onCloneLocallyChange: (val: boolean) => void
  onCloneParentDirChange: (val: string) => void
  onGitUrlChange: (val: string) => void
  onLocalPathChange: (val: string) => void
  onProjectNameChange: (val: string) => void
  onInitGitChange: (val: boolean) => void
  onToggleBrowser: () => void
  onCreateOnGitHubChange: (val: boolean) => void
  onVisibilityChange: (val: "private" | "public") => void
  onSearchRepos: (login: string, query: string, page: number, signal?: AbortSignal) => Promise<GitHubRepositoryPage>
  onQuickConnectGh: () => Promise<string | null>
  onPickFolderNative: (target: "local" | "parent") => void
  onDetectRemote: (path: string) => void
  onLoadDirectory: (path?: string) => void
  onUseBrowserFolder: (path: string) => void
}) {
  return (
    <>
      {source === "github" ? (
        <>
          <div className="sf-label">
            <span>GitHub Repository</span>
            <GitHubRepositoryPicker
              inputId="wizard-github-repo"
              login={activeGhLogin}
              value={ghRepo}
              disabled={busy}
              onChange={val => {
                onGhRepoChange(val)
                if (!projectName.trim() && val.includes("/")) {
                  onProjectNameChange(val.split("/").pop() || "")
                }
              }}
              onSearch={onSearchRepos}
              onQuickConnect={onQuickConnectGh}
            />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={cloneLocally} onChange={e => onCloneLocallyChange(e.target.checked)} />
            <span>Clone repository locally into workspace folder</span>
          </label>
          {cloneLocally ? (
            <div className="sf-label">
              <span>Clone into parent folder</span>
              <div className="flex gap-2">
                <input className="sf-field flex-1" value={cloneParentDir} onChange={e => onCloneParentDirChange(e.target.value)} placeholder="/Users/you/Code" />
                <button type="button" className="sf-btn-secondary" onClick={() => onPickFolderNative("parent")}>
                  <Folder className="size-3.5" /> Browse…
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {source === "url" ? (
        <>
          <label className="sf-label">
            <span>Git Repository URL (GitHub, Azure DevOps, GitLab, SSH)</span>
            <input
              className="sf-field"
              placeholder="https://dev.azure.com/org/proj/_git/repo  or  git@github.com:org/repo.git"
              value={gitUrl}
              onChange={e => {
                onGitUrlChange(e.target.value)
                const tail = e.target.value.trim().replace(/\/+$/, "").replace(/\.git$/i, "").split(/[/:]/).pop()
                if (!projectName.trim() && tail && /^[a-z0-9._-]+$/i.test(tail)) onProjectNameChange(tail)
              }}
              autoFocus
            />
          </label>
          <div className="sf-label">
            <span>Clone into parent folder</span>
            <div className="flex gap-2">
              <input className="sf-field flex-1" value={cloneParentDir} onChange={e => onCloneParentDirChange(e.target.value)} placeholder="/Users/you/Code" />
              <button type="button" className="sf-btn-secondary" onClick={() => onPickFolderNative("parent")}>
                <Folder className="size-3.5" /> Browse…
              </button>
            </div>
          </div>
        </>
      ) : null}

      {source === "local" ? (
        <>
          <div className="sf-label">
            <span>Local Folder or Repository</span>
            <div className="flex gap-2">
              <input
                className="sf-field flex-1"
                placeholder="/Users/you/Code/my-project"
                value={localPath}
                onChange={e => onLocalPathChange(e.target.value)}
                onBlur={() => { if (localPath.trim()) onDetectRemote(localPath.trim()) }}
                autoFocus
              />
              <button type="button" className="sf-btn-secondary" onClick={() => onPickFolderNative("local")}>
                <FolderOpen className="size-3.5" /> Browse…
              </button>
              <button type="button" className="sf-btn-ghost" onClick={onToggleBrowser}>Tree</button>
            </div>
            {detectedGh ? (
              <span className="text-[11px] text-emerald-400">
                Detected GitHub remote: <code>{detectedGh}</code>
              </span>
            ) : null}
          </div>

          {showBrowser && dirState ? (
            <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] overflow-hidden text-xs">
              <div className="px-3 py-2 border-b border-[rgb(var(--border)/0.7)] flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className="truncate">{dirState.currentPath}</span>
                <div className="flex gap-1.5 shrink-0">
                  {dirState.parentPath ? (
                    <button type="button" className="sf-btn-ghost !h-6 !px-2 !text-[11px]" onClick={() => onLoadDirectory(dirState.parentPath!)}>Up</button>
                  ) : null}
                  <button type="button" className="sf-btn-primary !h-6 !px-2 !text-[11px]" onClick={() => onUseBrowserFolder(dirState.currentPath)}>
                    Use This Folder
                  </button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto divide-y divide-[rgb(var(--border)/0.45)]">
                {dirState.entries.map(entry => (
                  <button
                    key={entry.path}
                    type="button"
                    className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-[rgb(var(--surface-raised))]"
                    onClick={() => onLoadDirectory(entry.path)}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {entry.isGitRepo ? <FolderGit2 className="size-3.5 text-[rgb(var(--primary))]" /> : <Folder className="size-3.5 opacity-60" />}
                      <span>{entry.name}</span>
                    </span>
                    {entry.isGitRepo ? <span className="sf-badge sf-badge-ok">Git</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={initGitIfMissing} onChange={e => onInitGitChange(e.target.checked)} />
            <span>Run <code>git init</code> automatically if this folder is not a Git repository yet</span>
          </label>
        </>
      ) : null}

      {source === "scratch" ? (
        <>
          <label className="sf-label">
            <span>Project Name *</span>
            <input className="sf-field" placeholder="my-awesome-service" value={projectName} onChange={e => onProjectNameChange(e.target.value)} autoFocus />
          </label>
          <div className="sf-label">
            <span>Create inside folder</span>
            <div className="flex gap-2">
              <input className="sf-field flex-1" value={cloneParentDir} onChange={e => onCloneParentDirChange(e.target.value)} />
              <button type="button" className="sf-btn-secondary" onClick={() => onPickFolderNative("parent")}>
                <Folder className="size-3.5" /> Browse…
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={createOnGitHub} onChange={e => onCreateOnGitHubChange(e.target.checked)} />
              <span>Also create repository on GitHub</span>
            </label>
            {createOnGitHub ? (
              <div className="sf-segmented">
                <button type="button" className={`sf-seg-btn !h-6 !text-[11px] ${visibility === "private" ? "is-active" : ""}`} onClick={() => onVisibilityChange("private")}>Private</button>
                <button type="button" className={`sf-seg-btn !h-6 !text-[11px] ${visibility === "public" ? "is-active" : ""}`} onClick={() => onVisibilityChange("public")}>Public</button>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <label className="sf-label">
          <span>Project Display Name</span>
          <input className="sf-field" placeholder="Auto-filled from repository name" value={projectName} onChange={e => onProjectNameChange(e.target.value)} />
        </label>
      )}
    </>
  )
}
