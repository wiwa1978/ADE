import { ArrowLeft, ArrowUpRight, FolderGit2, GitBranch } from "lucide-react"
import { Banner, Button, EmptyState } from "@/components/ui"
import type { FeatureAgent } from "../FeatureAgents"
import type { Project } from "../../packages/protocol/index.ts"
import { useI18n } from "../i18n/I18nContext"

export type ProjectFeatureSummary = {
  id: string
  label: string
  status: string
  workspace?: { kind: string; branch: string | null; status: string }
}

export type ProjectActivity = {
  agents: (FeatureAgent & { sessionId: string; sessionName: string })[]
  errors: { sessionId: string; sessionName: string; message: string }[]
  observedAt: number
}

export interface ProjectsListViewProps {
  projects: Project[]
  project: Project | null
  features: ProjectFeatureSummary[]
  error: string
  activity: ProjectActivity | null
  activityError: string
  onSelect: (id: string) => void
  onBack: () => void
  onOpenFeature: (id: string) => void
  onOpenAgent: (sessionId: string, agent: FeatureAgent) => void
}

export function ProjectsListView({
  projects,
  project,
  features,
  error,
  activity,
  activityError,
  onSelect,
  onBack,
  onOpenFeature,
  onOpenAgent,
}: ProjectsListViewProps) {
  const { t, formatTime } = useI18n()

  return (
    <main className="projects-scroll">
      <div className="projects-page">
        {project ? (
          <Button variant="ghost" size="sm" className="project-back w-fit" onClick={onBack}>
            <ArrowLeft size={14} /> {t("prjx.list.allProjects")}
          </Button>
        ) : null}

        <header className="project-heading">
          <div>
            <h1>{project?.name ?? t("prjx.list.projects")}</h1>
            <p>{project ? t("prjx.list.projectSubtitle") : t("prjx.list.overviewSubtitle")}</p>
          </div>
        </header>

        {error ? <Banner tone="error">{error}</Banner> : null}

        {project ? (
          <section className="project-features">
            <div className="list-heading">
              <h2>{t("prjx.list.sessions")}</h2>
              <span>{features.length}</span>
            </div>
            {features.length ? (
              <div className="project-list">
                {features.map(feature => (
                  <button type="button" className="project-row" key={feature.id} onClick={() => onOpenFeature(feature.id)}>
                    <GitBranch size={18} />
                    <span className="project-row-copy">
                      <strong>{feature.label}</strong>
                      <small>{feature.workspace?.branch ?? (feature.workspace?.kind === "none" ? t("prjx.list.noWorkspace") : t("prjx.list.existingCheckout"))}</small>
                    </span>
                    <span className={`activity-label ${feature.workspace?.status === "attention" ? "blocked" : feature.status}`}>
                      <i />
                      {feature.workspace?.status === "attention" ? t("prjx.list.needsAttention") : feature.status === "working" ? t("prjx.list.working") : t("prjx.list.idle")}
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<GitBranch size={22} />}
                title={t("prjx.list.noSessionsTitle")}
                description={t("prjx.list.noSessionsDesc")}
              />
            )}

            <div className="list-heading">
              <h2>{t("prjx.list.subagentActivity")}</h2>
            </div>
            {activityError ? <Banner tone="error">{t("prjx.list.activityUnavailable", { error: activityError })}</Banner> : null}
            {!activity && !activityError ? <p className="hint" role="status">{t("prjx.list.loadingActivity")}</p> : null}
            {activity ? (
              <>
                <p className="hint">{t("prjx.list.lastChecked", { time: formatTime(activity.observedAt, { seconds: true }) })}{activityError ? t("prjx.list.staleSuffix") : ""}</p>
                {activity.errors.map(item => (
                  <Banner tone="error" key={item.sessionId}>{item.sessionName}: {item.message}</Banner>
                ))}
                {activity.agents.length ? (
                  <div className="agent-list">
                    {activity.agents.map(agent => (
                      <button type="button" className="agent-row" key={`${agent.sessionId}:${agent.id}`} onClick={() => onOpenAgent(agent.sessionId, agent)}>
                        <span>
                          <strong>{agent.name} · {agent.sessionName}</strong>
                          <small>{agent.assignment}</small>
                          <small>{agent.messages.filter(message => message.role === "assistant").at(-1)?.content ?? t("prjx.list.noReportYet")}</small>
                          <small>{t("prjx.list.agentIds", { sessionId: agent.sessionId, agentId: agent.id, assignmentId: agent.assignmentId })}</small>
                        </span>
                        <span className={`activity-label ${agent.status}`}>{agent.status}</span>
                      </button>
                    ))}
                  </div>
                ) : !activity.errors.length ? (
                  <p className="hint">{t("prjx.list.noDelegatedWork")}</p>
                ) : null}
              </>
            ) : null}
          </section>
        ) : projects.length ? (
          <div className="project-list">
            {projects.map(item => (
              <button type="button" className="project-row" key={item.id} onClick={() => onSelect(item.id)}>
                <FolderGit2 size={20} />
                <span className="project-row-copy">
                  <strong>{item.name}</strong>
                  <small>{item.githubUrl?.replace("https://github.com/", "") ?? t("prjx.list.localProjectNoGithub")}</small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FolderGit2 size={24} />}
            title={t("prjx.list.emptyTitle")}
            description={t("prjx.list.emptyDesc")}
          />
        )}
      </div>
    </main>
  )
}
