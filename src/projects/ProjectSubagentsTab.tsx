import type { FeatureAgent } from "../../FeatureAgents"
import type { ProjectActivity } from "../../ProjectsView"

export function ProjectSubagentsTab({
  activity,
  activityError,
  onOpenAgent,
}: {
  activity: ProjectActivity | null
  activityError: string
  onOpenAgent: (sessionId: string, agent: FeatureAgent) => void
}) {
  return (
    <div className="flex-1 min-h-0 overflow-auto p-5 flex flex-col gap-5">
      {activityError ? (
        <div className="text-[12px] opacity-65">Session subagent polling: {activityError}</div>
      ) : null}

      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold m-0">Subagents</h2>
          <span className="ade-count-badge">{activity?.agents.length ?? 0}</span>
        </div>
        {!activity && !activityError ? (
          <div className="text-[12px] opacity-60">Loading subagent activity…</div>
        ) : activity && activity.agents.length > 0 ? (
          <div className="flex flex-col gap-2">
            {activity.agents.map(agent => (
              <button
                key={`${agent.sessionId}:${agent.id}`}
                type="button"
                className="w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:border-[rgb(var(--primary)/0.55)] text-left cursor-pointer"
                onClick={() => onOpenAgent(agent.sessionId, agent)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`ade-dot ade-dot-${agent.status === "running" ? "running" : agent.status === "completed" ? "completed" : "waiting"}`} />
                    <strong className="text-[13px] truncate">{agent.name} · {agent.sessionName}</strong>
                  </div>
                  <div className="text-[12px] opacity-65 truncate mt-1">{agent.assignment}</div>
                </div>
                <span className="ade-pill shrink-0 capitalize">{agent.status}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface)/0.5)] px-4 py-5 text-[12.5px] opacity-65">
            No subagents yet. When an agent hands out work, its subagents show here live.
          </div>
        )}
      </section>
    </div>
  )
}
