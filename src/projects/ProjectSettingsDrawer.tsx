import { useState, type FormEvent } from "react"
import { ArrowUpRight, PanelRight } from "lucide-react"
import { request } from "../../api"
import { Banner, Button, FolderPathInput, IconButton, Input, ModelProfileSelect } from "@/components/ui"
import { BUILTIN_BLUEPRINTS } from "../../packages/blueprints/index.ts"
import type { GitHubConnection, Project, ProjectInput } from "../../packages/protocol/index.ts"
import { useBlueprintOptions } from "../blueprints/blueprint-options"
import { GitHubRepositoryPicker, type SearchGitHubRepositories } from "./GitHubRepositoryPicker"
import { ProjectInstructionsSettings } from "./ProjectInstructionsSettings"
import { ProjectRunOnSettings } from "./ProjectRunOnSettings"
import { ProjectScriptsSettings } from "./ProjectScriptsSettings"
import { ProjectSecretsSettings } from "./ProjectSecretsSettings"

const repositoryName = (value: string) => value.replace(/^https:\/\/github\.com\//i, "")

export interface ProjectSettingsProps {
  /** Set by the project page's resizable right panel. */
  width?: number
  paneRef?: React.Ref<HTMLElement>
  project: Project
  open: boolean
  environmentName?: string
  onSave: (input: ProjectInput) => Promise<Project>
  onClose: () => void
  initialDraft?: ProjectInput
  githubConnection: GitHubConnection | null
  githubStatusError: string
  onOpenSettings: (draft: ProjectInput) => void
  onSearchRepositories: SearchGitHubRepositories
}

export function ProjectSettings({
  project,
  open,
  initialDraft,
  githubConnection,
  githubStatusError,
  environmentName,
  onSave,
  onClose,
  onOpenSettings,
  onSearchRepositories,
  width,
  paneRef,
}: ProjectSettingsProps) {
  const [name, setName] = useState(initialDraft?.name ?? project.name)
  const [githubUrl, setGithubUrl] = useState(repositoryName(initialDraft?.githubUrl ?? project.githubUrl ?? ""))
  const [repository, setRepository] = useState(initialDraft?.repository ?? project.repository ?? "")
  const [blueprintId, setBlueprintId] = useState(initialDraft?.blueprintId ?? project.blueprintId ?? "vibe")
  const [blueprintLocked, setBlueprintLocked] = useState(initialDraft?.blueprintLocked ?? project.blueprintLocked ?? false)
  const blueprintOptions = useBlueprintOptions()
  const [modelProfile, setModelProfile] = useState(initialDraft?.modelProfile ?? project.modelProfile ?? "balanced")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [saved, setSaved] = useState(false)

  const githubAccount = githubConnection?.login ?? null
  const dirty =
    name !== project.name ||
    githubUrl !== repositoryName(project.githubUrl ?? "") ||
    repository !== (project.repository ?? "") ||
    blueprintId !== (project.blueprintId ?? "vibe") ||
    blueprintLocked !== (project.blueprintLocked ?? false) ||
    modelProfile !== (project.modelProfile ?? "balanced")

  const openConnectionSettings = () =>
    onOpenSettings({ id: project.id, name, githubUrl, repository, blueprintId, blueprintLocked, modelProfile })
  const searchableAccount = githubStatusError ? null : githubAccount

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !dirty || !name.trim()) return
    setSaving(true)
    setSaveError("")
    try {
      const updated = await onSave({
        id: project.id,
        name: name.trim(),
        githubUrl: githubUrl.trim(),
        repository: repository.trim(),
        blueprintId,
        blueprintLocked,
        modelProfile,
      })
      setName(updated.name)
      setGithubUrl(repositoryName(updated.githubUrl ?? ""))
      setRepository(updated.repository ?? "")
      setBlueprintId(updated.blueprintId ?? "vibe")
      setBlueprintLocked(updated.blueprintLocked ?? false)
      setModelProfile(updated.modelProfile ?? "balanced")
      setSaved(true)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save this project.")
    } finally {
      setSaving(false)
    }
  }

  async function handlePickedFolder(pickedPath: string) {
    if (githubUrl.trim()) return
    try {
      const detected = await request<{ githubRepo: string | null }>("/api/projects/detect-git", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: pickedPath }),
      })
      if (detected.githubRepo) setGithubUrl(detected.githubRepo)
    } catch {
      // Non-git folder or no remote; keep folder path as-is.
    }
  }

  return (
    <aside
      ref={paneRef}
      id="project-settings"
      className="inspector project-settings"
      aria-labelledby="project-settings-title"
      hidden={!open}
      style={width ? { width } : undefined}
    >
      <div className="panel-title">
        <h2 id="project-settings-title">Project settings</h2>
        <IconButton aria-label="Close project settings" onClick={onClose}>
          <PanelRight size={16} />
        </IconButton>
      </div>

      <form className="project-form" onSubmit={save}>
        {!project.repository && !project.githubUrl ? (
          <Banner tone="info">
            Empty project — pick a local folder or link a GitHub repository below to finish setup.
          </Banner>
        ) : null}

        <div className="project-environment-label">
          <span>Environment</span>
          <strong>{environmentName ?? "This computer"}</strong>
          <small>New sessions inherit this project’s environment.</small>
        </div>

        <label>
          Project name
          <Input value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={saving} />
        </label>

        <div className="project-field">
          <label htmlFor="project-github-repo">GitHub repository <small>Optional</small></label>
          <GitHubRepositoryPicker
            key={`${searchableAccount ?? "none"}:${open}`}
            login={searchableAccount}
            value={githubUrl}
            disabled={saving}
            onChange={setGithubUrl}
            onOpenSettings={openConnectionSettings}
            onSearch={onSearchRepositories}
          />
          <p id="project-github-hint" className="hint">Search existing repositories, enter a URL, or create a new repository on GitHub.</p>
          {!githubConnection && !githubStatusError ? (
            <p className="hint" role="status">Checking GitHub connection…</p>
          ) : !githubAccount || githubStatusError ? (
            <>
              <p className="hint">{githubStatusError ? "GitHub connection is unavailable." : "Connect GitHub in Settings to search repositories."}</p>
              <button type="button" className="text-button project-link" disabled={saving} onClick={openConnectionSettings}>
                Open connection settings
              </button>
            </>
          ) : null}
          {project.githubUrl ? (
            <a className="text-button project-link" href={project.githubUrl} target="_blank" rel="noreferrer">
              Open on GitHub <ArrowUpRight size={13} />
            </a>
          ) : null}
        </div>

        <div className="project-field">
          <label htmlFor="project-local-checkout">Default local checkout <small>Optional</small></label>
          <FolderPathInput
            id="project-local-checkout"
            value={repository}
            onChange={setRepository}
            onPicked={handlePickedFolder}
            aria-describedby="project-checkout-hint"
            disabled={saving}
            className="mt-1.5"
          />
          <p id="project-checkout-hint" className="hint">Applies to new sessions.</p>
        </div>

        <div className="project-field">
          <label>
            Way of working
            <select
              className="sf-field mt-1.5"
              value={blueprintId}
              onChange={e => setBlueprintId(e.target.value)}
              disabled={saving}
            >
              {(blueprintOptions.length ? blueprintOptions : [{ id: "vibe", name: "Vibe coding" }, ...BUILTIN_BLUEPRINTS]).map(bp => (
                <option key={bp.id} value={bp.id}>{bp.name}</option>
              ))}
            </select>
          </label>
          <p className="hint">The default for new sessions in this project. Vibe coding has no stages; a blueprint takes each session through its stages, and you approve the gated ones.</p>
          <label className="project-check">
            <input type="checkbox" checked={blueprintLocked} onChange={e => setBlueprintLocked(e.target.checked)} disabled={saving} />
            Every session uses this way of working
          </label>
          <p className="hint">For team or regulated repositories: sessions can't pick another one (Vibe included).</p>
        </div>

        <div className="project-field">
          <label>
            Model Profile
            <ModelProfileSelect
              value={modelProfile}
              onChange={setModelProfile}
              disabled={saving}
              className="mt-1.5 w-full"
            />
          </label>
        </div>

        {saveError ? <Banner tone="error">{saveError}</Banner> : null}

        <div className="form-actions">
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty || !name.trim()}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {saved && !dirty ? <span className="hint" role="status">Saved</span> : null}
        </div>
      </form>

      <ProjectScriptsSettings projectId={project.id} />
      {project.repository ? <ProjectRunOnSettings projectId={project.id} /> : null}
      <ProjectSecretsSettings projectId={project.id} />
      {project.repository ? <ProjectInstructionsSettings projectId={project.id} /> : null}
    </aside>
  )
}
