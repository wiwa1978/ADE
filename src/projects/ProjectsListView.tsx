import { ArrowLeft, ArrowUpRight, FolderGit2, GitBranch } from "lucide-react"
import { Banner, Button, EmptyState } from "@/components/ui"
import type { FeatureAgent } from "../../FeatureAgents"
import type { Project } from "../../packages/protocol/index.ts"

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
  return (
    <main className="projects-scroll">
      <div className="projects-page">
        {project ? (
          <Button variant="ghost" size="sm" className="project-back w-fit" onClick={onBack}>
            <ArrowLeft size={14} /> All projects
          </Button>
        ) : null}

        <header className="project-heading">
          <div>
            <h1>{project?.name ?? "Projects"}</h1>
            <p>{project ? "Sessions and their delegated work." : "Keep related sessions and their agents together. GitHub is optional."}</p>
          </div>
        </header>

        {error ? <Banner tone="error">{error}</Banner> : null}

        {project ? (
          <section className="project-features">
            <div className="list-heading">
              <h2>Sessions</h2>
              <span>{features.length}</span>
            </div>
            {features.length ? (
              <div className="project-list">
                {features.map(feature => (
                  <button type="button" className="project-row" key={feature.id} onClick={() => onOpenFeature(feature.id)}>
                    <GitBranch size={18} />
                    <span className="project-row-copy">
                      <strong>{feature.label}</strong>
                      <small>{feature.workspace?.branch ?? (feature.workspace?.kind === "none" ? "No workspace" : "Existing checkout")}</small>
                    </span>
                    <span className={`activity-label ${feature.workspace?.status === "attention" ? "blocked" : feature.status}`}>
                      <i />
                      {feature.workspace?.status === "attention" ? "Needs attention" : feature.status === "working" ? "Working" : "Idle"}
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<GitBranch size={22} />}
                title="No sessions yet"
                description="Use the plus beside this project in the left pane to start a session."
              />
            )}

            <div className="list-heading">
              <h2>Subagent activity</h2>
            </div>
            {activityError ? <Banner tone="error">Activity unavailable: {activityError}</Banner> : null}
            {!activity && !activityError ? <p className="hint" role="status">Loading subagent activity...</p> : null}
            {activity ? (
              <>
                <p className="hint">Last checked {new Date(activity.observedAt).toLocaleTimeString()}{activityError ? " · stale" : ""}</p>
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
                          <small>{agent.messages.filter(message => message.role === "assistant").at(-1)?.content ?? "No report yet"}</small>
                          <small>Session ID: {agent.sessionId} · Subagent ID: {agent.id} · Assignment ID: {agent.assignmentId}</small>
                        </span>
                        <span className={`activity-label ${agent.status}`}>{agent.status}</span>
                      </button>
                    ))}
                  </div>
                ) : !activity.errors.length ? (
                  <p className="hint">No delegated work yet.</p>
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
                  <small>{item.githubUrl?.replace("https://github.com/", "") ?? "Local project - no GitHub link"}</small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FolderGit2 size={24} />}
            title="A home for your sessions"
            description="Use the plus beside Projects in the left pane to create a project."
          />
        )}
      </div>
    </main>
  )
}
