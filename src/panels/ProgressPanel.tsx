import { CheckCircle2, CircleDashed, CircleSlash, Loader2, PauseCircle, XCircle } from "lucide-react"
import type { ConversationTimelineSnapshot, SessionTaskItem, SubagentInfo, TimelineItem } from "../../app-types"

type Status = "done" | "working" | "waiting" | "failed" | "blocked" | "pending"

const statusInfo: Record<Status, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  done: { label: "Done", icon: CheckCircle2, tone: "ok" },
  working: { label: "Working", icon: Loader2, tone: "running" },
  waiting: { label: "Waiting", icon: PauseCircle, tone: "waiting" },
  failed: { label: "Failed", icon: XCircle, tone: "failed" },
  blocked: { label: "Blocked", icon: CircleSlash, tone: "failed" },
  pending: { label: "Not started", icon: CircleDashed, tone: "idle" },
}

function subagentStatus(status: SubagentInfo["status"]): Status {
  if (status === "completed") return "done"
  if (status === "running") return "working"
  if (status === "waiting") return "waiting"
  if (status === "failed") return "failed"
  if (status === "blocked") return "blocked"
  return "pending"
}

/** The last thing an agent said: its answer when done, or what it's doing now. */
function lastReply(items: TimelineItem[] | undefined) {
  for (const item of [...(items ?? [])].reverse()) {
    if (item.kind === "assistant" && item.text.trim()) return item.text.trim()
    if (item.kind === "error") return item.message
  }
  return ""
}

function firstLine(text: string, max = 220) {
  const line = text.replace(/[#*`>]/g, "").split("\n").map(part => part.trim()).find(Boolean) ?? ""
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function StatusCell({ status }: { status: Status }) {
  const info = statusInfo[status]
  const Icon = info.icon
  return <span className={`ade-progress-status is-${info.tone}`}><Icon className={`size-3.5 ${status === "working" ? "animate-spin" : ""}`} /> {info.label}</span>
}

/**
 * Progress: one table for everything a request set in motion — the lead agent and every subagent it
 * started, with their status and what each reported — plus the agent's task checklist.
 */
export function ProgressPanel({
  leadLabel,
  leadBusy,
  leadFailed,
  leadItems,
  subagents,
  subagentTimelines,
  tasks,
  onOpenSubagent,
}: {
  leadLabel: string
  leadBusy: boolean
  leadFailed: boolean
  leadItems: TimelineItem[]
  subagents: SubagentInfo[]
  subagentTimelines: Record<string, ConversationTimelineSnapshot>
  tasks: SessionTaskItem[]
  onOpenSubagent: (id: string) => void
}) {
  const leadAsked = [...leadItems].reverse().find(item => item.kind === "user")
  const rows = [
    {
      id: "lead",
      name: "Lead agent",
      role: "",
      asked: leadAsked && leadAsked.kind === "user" ? leadAsked.content : leadLabel,
      status: (leadBusy ? "working" : leadFailed ? "failed" : leadItems.length ? "done" : "pending") as Status,
      result: lastReply(leadItems),
      branch: null as string | null,
    },
    ...subagents.map(sub => ({
      id: sub.id,
      name: sub.name || "Subagent",
      role: sub.role ?? "",
      asked: sub.assignment,
      status: subagentStatus(sub.status),
      result: sub.error || lastReply(subagentTimelines[sub.id]?.items ?? sub.timeline) || [...sub.messages].reverse().find(message => message.role === "assistant")?.content || "",
      branch: sub.branch ?? null,
    })),
  ]
  const agentsDone = rows.filter(row => row.status === "done").length
  const tasksDone = tasks.filter(task => task.status === "done").length
  const total = rows.length + tasks.length
  const done = agentsDone + tasksDone
  const working = rows.filter(row => row.status === "working").length
  const failed = rows.filter(row => row.status === "failed" || row.status === "blocked").length

  return (
    <div className="ade-pane-body ade-progress">
      <header className="ade-progress-head">
        <div>
          <strong>{done} of {total} done</strong>
          <span className="ade-muted ade-xs">
            {[`${agentsDone}/${rows.length} agents`, tasks.length ? `${tasksDone}/${tasks.length} tasks` : "", working ? `${working} working` : "", failed ? `${failed} need attention` : ""].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="ade-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          {failed ? <span className="is-failed" style={{ width: `${(failed / total) * 100}%` }} /> : null}
        </div>
      </header>

      <section aria-label="Agents">
        <h3>Agents</h3>
        <table className="ade-progress-table">
          <thead><tr><th>Agent</th><th>Status</th><th>Asked to</th><th>Result</th></tr></thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className={row.id !== "lead" ? "is-clickable" : ""} onClick={row.id !== "lead" ? () => onOpenSubagent(row.id) : undefined}>
                <td>
                  <strong>{row.name}</strong>
                  {row.role ? <div className="ade-muted ade-xs">{row.role}</div> : null}
                  {row.branch ? <div className="ade-muted ade-xs ade-mono">{row.branch}</div> : null}
                </td>
                <td><StatusCell status={row.status} /></td>
                <td title={row.asked}><span className="ade-progress-clamp">{firstLine(row.asked, 160) || "—"}</span></td>
                <td title={row.result}><span className="ade-progress-clamp">{row.result ? firstLine(row.result) : <span className="ade-muted">{row.status === "working" ? "Working on it…" : "—"}</span>}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!subagents.length ? <p className="ade-muted ade-xs">This session has no subagents yet. Ask for parallel work (for example “use /subagent to research X and Y in parallel”) and each one shows up here.</p> : null}
      </section>

      {tasks.length ? (
        <section aria-label="Tasks">
          <h3>Tasks</h3>
          <table className="ade-progress-table">
            <thead><tr><th>#</th><th>Status</th><th>Task</th></tr></thead>
            <tbody>
              {tasks.map((task, index) => (
                <tr key={task.id}>
                  <td className="ade-muted">{index + 1}</td>
                  <td><StatusCell status={task.status === "done" ? "done" : task.status === "in_progress" ? "working" : task.status === "blocked" ? "blocked" : "pending"} /></td>
                  <td>{task.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  )
}
