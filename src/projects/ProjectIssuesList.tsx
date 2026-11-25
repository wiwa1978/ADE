import { useCallback, useEffect, useState } from "react"
import { ExternalLink, GitPullRequest, Play, RefreshCw, Settings2 } from "lucide-react"
import { request } from "../../api"
import type { Project } from "../../ProjectsView"
import { useI18n } from "../i18n/I18nContext"

export type ProjectGitHubIssue = {
  repository: string
  number: number
  title: string
  body: string
  state: "open" | "closed"
  url: string
  labels: string[]
  updatedAt: string
}

export function ProjectIssuesList({
  project,
  onOpenProjectSettings,
  onStartSessionFromIssue,
}: {
  project: Project | null
  onOpenProjectSettings: () => void
  /** Start an agent session (worktree + chat) for the issue. */
  onStartSessionFromIssue?: (issue: ProjectGitHubIssue) => Promise<void>
}) {
  const { t } = useI18n()
  const [issues, setIssues] = useState<ProjectGitHubIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [startingNumber, setStartingNumber] = useState<number | null>(null)
  const [error, setError] = useState("")
  const projectKey = `${project?.id ?? ""}:${project?.githubUrl ?? ""}`
  const [prevProjectKey, setPrevProjectKey] = useState(projectKey)

  if (projectKey !== prevProjectKey) {
    setPrevProjectKey(projectKey)
    setError("")
    if (!project || !project.githubUrl) {
      setIssues([])
      setLoading(false)
    } else {
      setLoading(true)
    }
  }

  const load = useCallback(async () => {
    if (!project || !project.githubUrl) {
      setIssues([])
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await request<{ issues: ProjectGitHubIssue[] }>(
        `/api/projects/${encodeURIComponent(project.id)}/issues?state=open`,
      )
      setIssues(res.issues)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("prjx.list.issues.loadError"))
    } finally {
      setLoading(false)
    }
  }, [project, t])

  useEffect(() => {
    if (!project || !project.githubUrl) return
    let cancelled = false
    void request<{ issues: ProjectGitHubIssue[] }>(
      `/api/projects/${encodeURIComponent(project.id)}/issues?state=open`,
    )
      .then(res => {
        if (!cancelled) {
          setIssues(res.issues)
          setError("")
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("prjx.list.issues.loadError"))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [project, t])

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm opacity-70">
        {t("prjx.list.issues.noProject")}
      </div>
    )
  }

  if (!project.githubUrl) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <GitPullRequest className="size-8 opacity-40" />
        <div className="text-sm font-semibold">{t("prjx.list.issues.noRepoTitle", { project: project.name })}</div>
        <p className="text-xs opacity-70 max-w-md">
          {t("prjx.list.issues.noRepoDesc")}
        </p>
        <button type="button" className="sf-btn-primary" onClick={onOpenProjectSettings}>
          <Settings2 className="size-3.5" /> {t("prjx.list.issues.linkRepo")}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[rgb(var(--border)/0.75)]">
        <div className="text-xs">
          <span className="font-semibold">{project.githubUrl.replace(/^https:\/\/github\.com\//i, "")}</span>
          <span className="opacity-65">{t("prjx.list.issues.openCount", { count: issues.length })}</span>
        </div>
        <button type="button" className="sf-btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> {t("prjx.list.issues.refresh")}
        </button>
      </div>

      {error ? <div className="m-4 ade-banner-error">{error}</div> : null}

      <div className="flex-1 overflow-y-auto divide-y divide-[rgb(var(--border)/0.65)]">
        {loading && issues.length === 0 ? (
          <div className="p-8 text-center text-xs opacity-65">{t("prjx.list.issues.loading")}</div>
        ) : issues.length === 0 ? (
          <div className="p-8 text-center text-xs opacity-65">{t("prjx.list.issues.empty")}</div>
        ) : (
          issues.map(issue => (
            <div
              key={issue.number}
              className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[rgb(var(--surface)/0.6)] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="font-mono text-xs opacity-60">#{issue.number}</span>
                  <span className="truncate">{issue.title}</span>
                  {issue.url ? (
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer"
                      className="opacity-50 hover:opacity-100"
                      title={t("prjx.list.issues.openOnGithub")}
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
                {issue.labels.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {issue.labels.map(label => (
                      <span key={label} className="sf-badge sf-badge-muted">{label}</span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 gap-2">
                {onStartSessionFromIssue ? (
                  <button
                    type="button"
                    className="sf-btn-primary"
                    disabled={startingNumber !== null}
                    onClick={async () => {
                      setStartingNumber(issue.number)
                      setError("")
                      try {
                        await onStartSessionFromIssue(issue)
                      } catch (err) {
                        setError(err instanceof Error ? err.message : t("prjx.list.issues.startError"))
                      } finally {
                        setStartingNumber(null)
                      }
                    }}
                  >
                    <Play className="size-3.5" />
                    {startingNumber === issue.number ? t("prjx.list.sessions.starting") : t("prjx.list.sessions.startSession")}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
