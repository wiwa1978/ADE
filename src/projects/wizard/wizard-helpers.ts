import { request } from "../../../api"
import type { ModelProfileId } from "../../../app-types"
import type { Project } from "../../../ProjectsView"
import type { AddProjectSource } from "../AddProjectWizard"

export type ConcreteProjectSource = Exclude<AddProjectSource, "menu">

export interface SourceChoice {
  id: ConcreteProjectSource
  title: string
  subtitle: string
  keywords: string
}

export const SOURCE_CHOICES: readonly SourceChoice[] = [
  { id: "scratch", title: "New project", subtitle: "Start a new Git repository from a name", keywords: "new scratch init git repository create" },
  { id: "local", title: "Local folder", subtitle: "Browse a folder on disk", keywords: "local folder disk directory browse existing path" },
  { id: "url", title: "Git URL", subtitle: "Clone from a remote URL", keywords: "git url clone ssh https gitlab bitbucket azure remote" },
  { id: "github", title: "GitHub repository", subtitle: "Clone GitHub owner/repo", keywords: "github repo repository clone owner" },
]

export function sourceTitleFor(source: ConcreteProjectSource): string {
  return SOURCE_CHOICES.find(item => item.id === source)?.title ?? "GitHub repository"
}

export function nextEmptyProjectName(existingNames: string[]): string {
  const taken = new Set(existingNames.map(n => n.trim().toLowerCase()))
  let n = 1
  while (taken.has(`project ${n}`)) n += 1
  return `Project ${n}`
}

const postJson = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

export interface SubmitWizardProjectInput {
  source: ConcreteProjectSource
  projectName: string
  ghRepo: string
  cloneLocally: boolean
  cloneParentDir: string
  gitUrl: string
  localPath: string
  detectedGh: string | null
  initGitIfMissing: boolean
  createOnGitHub: boolean
  visibility: "private" | "public"
  blueprintId: string
  modelProfile: ModelProfileId
  existingProjectNames: string[]
  onStatus: (message: string) => void
}

export async function submitWizardProject(input: SubmitWizardProjectInput): Promise<Project> {
  let finalName = input.projectName.trim()
  let finalRepoPath = ""
  let finalGithubUrl = ""

  if (input.source === "github") {
    if (!input.ghRepo.trim()) throw new Error("Select or create a GitHub repository first.")
    const slug = input.ghRepo.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "")
    finalGithubUrl = slug
    if (!finalName) finalName = slug.split("/").pop() || slug
    if (input.cloneLocally) {
      input.onStatus(`Cloning ${slug}…`)
      const cloned = await postJson<{ repository: string; githubUrl: string | null; name: string }>("/api/projects/clone", {
        url: slug,
        destinationParent: input.cloneParentDir || undefined,
      })
      finalRepoPath = cloned.repository
      if (cloned.githubUrl) finalGithubUrl = cloned.githubUrl
      if (!finalName) finalName = cloned.name
    }
  } else if (input.source === "url") {
    if (!input.gitUrl.trim()) throw new Error("Enter a Git repository URL (HTTPS or SSH).")
    input.onStatus("Cloning repository…")
    const cloned = await postJson<{ repository: string; githubUrl: string | null; name: string }>("/api/projects/clone", {
      url: input.gitUrl.trim(),
      destinationParent: input.cloneParentDir || undefined,
    })
    finalRepoPath = cloned.repository
    finalGithubUrl = cloned.githubUrl ?? ""
    if (!finalName) finalName = cloned.name
  } else if (input.source === "local") {
    if (!input.localPath.trim()) throw new Error("Choose or enter a local folder path.")
    input.onStatus("Preparing local workspace…")
    const inited = await postJson<{ repository: string; githubUrl: string | null; name: string }>("/api/projects/init-local", {
      folderPath: input.localPath.trim(),
      initializeGit: input.initGitIfMissing,
    })
    finalRepoPath = inited.repository
    finalGithubUrl = input.detectedGh || inited.githubUrl || ""
    if (!finalName) finalName = inited.name
  } else if (input.source === "scratch") {
    if (!finalName) throw new Error("Enter a project name.")
    const safeSlug = finalName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "new-project"
    const targetFolder = `${(input.cloneParentDir || "").replace(/\/$/, "")}/${safeSlug}`
    input.onStatus(`Initializing ${targetFolder}…`)
    const inited = await postJson<{ repository: string }>("/api/projects/init-local", {
      folderPath: targetFolder,
      initializeGit: true,
    })
    finalRepoPath = inited.repository
    if (input.createOnGitHub) {
      input.onStatus(`Creating ${input.visibility} repository on GitHub…`)
      const created = await postJson<{ repository: { fullName: string; url: string } }>("/api/github/repositories/create", {
        name: safeSlug,
        visibility: input.visibility,
        addReadme: false,
      })
      finalGithubUrl = created.repository.fullName
    }
  }

  input.onStatus("Saving project…")
  const saved = await postJson<{ project: Project }>("/api/projects", {
    id: crypto.randomUUID(),
    name: finalName || nextEmptyProjectName(input.existingProjectNames),
    repository: finalRepoPath,
    githubUrl: finalGithubUrl,
    blueprintId: input.blueprintId,
    modelProfile: input.modelProfile,
  })
  return saved.project
}
