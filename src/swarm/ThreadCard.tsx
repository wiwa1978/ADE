import { CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, XCircle } from "lucide-react"
import { type SwarmThreadView } from "./swarm-model"
import { MemberBadge } from "./MemberBadge"

const THREAD_DOT: Record<string, string> = {
  moving: "#3b82f6",
  done: "#22c55e",
  waiting: "#f5b941",
  blocked: "#ef4444",
  open: "#71717a",
}

export function ThreadCard({
  thread,
  expanded,
  onToggle,
  onInspectMember,
}: {
  thread: SwarmThreadView
  expanded: boolean
  onToggle: () => void
  onInspectMember: (memberId: string) => void
}) {
  const color = THREAD_DOT[thread.status] ?? THREAD_DOT.open
  const pct = thread.total > 0 ? Math.round((thread.done / thread.total) * 100) : thread.status === "done" ? 100 : 0
  return (
    <article className={`ade-swarm-card ade-swarm-thread ${expanded ? "is-expanded" : ""}`}>
      <button type="button" className="ade-swarm-thread-main" onClick={onToggle} aria-expanded={expanded}>
        <div className="ade-swarm-thread-top">
          <span className="ade-swarm-thread-title-group min-w-0">
            <span className="ade-swarm-status-dot" style={{ background: color }} />
            <strong className="ade-truncate">{thread.title}</strong>
            <span className="ade-swarm-thread-status">{thread.statusLabel}</span>
          </span>
          <span className="ade-swarm-thread-meta">
            <span className="ade-swarm-mini-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(thread.status === "moving" ? 35 : 0, pct)}%`, background: color }} />
            </span>
            <span className="ade-swarm-thread-ratio">{thread.done}/{thread.total}</span>
            {expanded ? <ChevronDown className="size-3.5 ade-muted" /> : <ChevronRight className="size-3.5 ade-muted" />}
          </span>
        </div>
        {thread.summary ? <p className="ade-swarm-thread-summary">{thread.summary}</p> : null}
        {thread.now ? (
          <p className="ade-swarm-thread-now">
            <strong>Now</strong> <span>{thread.now}</span>
          </p>
        ) : null}
      </button>

      {expanded && thread.tasks.length > 0 ? (
        <ul className="ade-swarm-thread-tasks">
          {thread.tasks.map(task => (
            <li key={task.id} className={`is-${task.status}`}>
              <span className="ade-swarm-task-icon">
                {task.status === "done" ? <CheckCircle2 className="size-3.5 text-emerald-400" />
                  : task.status === "in_progress" ? <Loader2 className="size-3.5 animate-spin text-sky-400" />
                    : task.status === "blocked" ? <XCircle className="size-3.5 text-rose-400" />
                      : <Clock className="size-3.5 ade-muted" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="ade-swarm-task-title">{task.title}</span>
                {task.dependsOn.length ? <span className="ade-swarm-task-dep">waits for {task.dependsOn.join(", ")}</span> : null}
                {task.result && task.status === "done" ? <span className="ade-swarm-task-result">{task.result}</span> : null}
              </span>
              {task.ownerHandle ? (
                <MemberBadge
                  handle={task.ownerHandle}
                  color={task.ownerColor ?? "#8b5cf6"}
                  onClick={task.ownerId ? () => onInspectMember(task.ownerId!) : undefined}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}
