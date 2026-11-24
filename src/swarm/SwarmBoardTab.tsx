import { useState } from "react"
import { FileLock2, Plus, Send } from "lucide-react"
import { requestJson } from "../../api"
import type { TeamView } from "../flow/team-types"
import { ago } from "../flow/run-model"
import { buildSwarmModel } from "./swarm-model"
import { MemberBadge } from "./MemberBadge"

type BoardFilter = "all" | "posts" | "tasks" | "plans" | "claims"

const POST_KIND_COLOR: Record<string, string> = {
  question: "#f5b941",
  finding: "#38bdf8",
  answer: "#4ade80",
  update: "#a1a1aa",
}

export function SwarmBoardTab({
  sessionId,
  team,
  model,
  now,
  onChanged,
  onInspectMember,
}: {
  sessionId: string
  team: TeamView | null
  model: ReturnType<typeof buildSwarmModel>
  now: number
  onChanged?: () => void
  onInspectMember: (memberId: string) => void
}) {
  const [filter, setFilter] = useState<BoardFilter>("all")
  const [postText, setPostText] = useState("")
  const [postTo, setPostTo] = useState("all")
  const [sendingPost, setSendingPost] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState("")
  const [newTaskOwner, setNewTaskOwner] = useState("")
  const [newTaskThread, setNewTaskThread] = useState("")
  const [planNotes, setPlanNotes] = useState<Record<string, string>>({})
  const [busyPlan, setBusyPlan] = useState<string | null>(null)
  const [error, setError] = useState("")

  const posts = team?.posts ?? []
  const tasks = (team?.tasks ?? []).filter(t => t.status !== "dropped")
  const plans = tasks.filter(t => t.plan)
  const claims = team?.claims ?? []

  const memberHandle = (party: string) => {
    if (party === "user") return "You"
    if (party === "lead") return "coordinator"
    return model.membersById[party]?.handle ?? party
  }
  const memberColor = (party: string) => {
    if (party === "user") return "#a1a1aa"
    return model.membersById[party]?.color ?? "#8b5cf6"
  }

  const sendPost = async () => {
    if (!postText.trim()) return
    setSendingPost(true)
    setError("")
    try {
      await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/team/posts`, "POST", { text: postText, to: postTo === "all" ? [] : [postTo] })
      setPostText("")
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post to the board.")
    } finally {
      setSendingPost(false)
    }
  }

  const createTask = async () => {
    if (!newTaskTitle.trim()) return
    setError("")
    try {
      await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/team/tasks`, "POST", {
          title: newTaskTitle.trim(),
          owner: newTaskOwner || null,
          threadId: newTaskThread || null,
        })
      setNewTaskTitle("")
      setAddingTask(false)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add task.")
    }
  }

  const decidePlan = async (taskId: string, decision: "approve" | "return") => {
    setBusyPlan(taskId)
    setError("")
    try {
      await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/team/plans/${encodeURIComponent(taskId)}`, "POST", { decision, note: planNotes[taskId] ?? "" })
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not decide on plan.")
    } finally {
      setBusyPlan(null)
    }
  }

  const showPosts = filter === "all" || filter === "posts"
  const showTasks = filter === "all" || filter === "tasks"
  const showPlans = filter === "plans" || (filter === "all" && plans.length > 0)
  const showClaims = filter === "claims" || (filter === "all" && claims.length > 0)

  return (
    <div className="ade-swarm-board-tab">
      <div className="ade-swarm-subbar">
        <div className="ade-swarm-filter-pills">
          <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All</button>
          <button type="button" className={filter === "posts" ? "is-active" : ""} onClick={() => setFilter("posts")}>Posts <span>{posts.length}</span></button>
          <button type="button" className={filter === "tasks" ? "is-active" : ""} onClick={() => setFilter("tasks")}>Tasks <span>{tasks.length}</span></button>
          <button type="button" className={filter === "plans" ? "is-active" : ""} onClick={() => setFilter("plans")}>Plans <span>{plans.length}</span></button>
          <button type="button" className={filter === "claims" ? "is-active" : ""} onClick={() => setFilter("claims")}>Claims <span>{claims.length}</span></button>
        </div>
        <button type="button" className="ade-chip-btn" onClick={() => setAddingTask(v => !v)}>
          <Plus className="size-3.5" /> Add task
        </button>
      </div>

      {error ? <p className="ade-error-text ade-xs" role="alert">{error}</p> : null}

      {addingTask ? (
        <div className="ade-swarm-card ade-swarm-add-task">
          <input
            className="ade-input-sm"
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            placeholder="Task title…"
            onKeyDown={e => { if (e.key === "Enter") void createTask() }}
          />
          <div className="ade-swarm-add-task-row">
            <select className="ade-input-sm" value={newTaskOwner} onChange={e => setNewTaskOwner(e.target.value)}>
              <option value="">Unassigned (anyone)</option>
              {model.members.map(m => <option key={m.id} value={m.id}>{m.handle}</option>)}
            </select>
            {(team?.threads?.length ?? 0) > 0 ? (
              <select className="ade-input-sm" value={newTaskThread} onChange={e => setNewTaskThread(e.target.value)}>
                <option value="">No thread</option>
                {(team?.threads ?? []).map(th => <option key={th.id} value={th.id}>{th.title}</option>)}
              </select>
            ) : null}
            <button type="button" className="ade-chip-btn is-primary" disabled={!newTaskTitle.trim()} onClick={() => void createTask()}>
              Add
            </button>
          </div>
        </div>
      ) : null}

      {showPosts ? (
        <section className="ade-swarm-section">
          <h3 className="ade-swarm-section-title">Message board</h3>
          <div className="ade-swarm-card ade-swarm-compose">
            <textarea
              value={postText}
              onChange={e => setPostText(e.target.value)}
              rows={2}
              placeholder="Post a directive, answer, or update to the swarm board…"
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendPost() }}
            />
            <div className="ade-swarm-compose-foot">
              <select className="ade-input-sm" value={postTo} onChange={e => setPostTo(e.target.value)} aria-label="Recipient">
                <option value="all">@all</option>
                {model.members.map(m => <option key={m.id} value={m.id}>@{m.handle}</option>)}
              </select>
              <button type="button" className="ade-chip-btn is-primary" disabled={sendingPost || !postText.trim()} onClick={() => void sendPost()}>
                <Send className="size-3" /> {sendingPost ? "Posting…" : "Post"}
              </button>
            </div>
          </div>

          {posts.length ? (
            <div className="ade-swarm-post-list">
              {[...posts].reverse().map(post => (
                <article key={post.seq} className={`ade-swarm-card ade-swarm-post ${post.author === "user" ? "is-you" : ""}`}>
                  <div className="ade-swarm-post-head">
                    <MemberBadge
                      handle={memberHandle(post.author)}
                      color={memberColor(post.author)}
                      onClick={post.author !== "user" ? () => onInspectMember(post.author) : undefined}
                    />
                    <span className="ade-swarm-post-kind" style={{ color: POST_KIND_COLOR[post.kind] ?? "#a1a1aa" }}>{post.kind}</span>
                    <span className="ade-muted ade-xs">
                      #{post.seq}
                      {post.re ? ` · re #${post.re}` : ""}
                      {post.to.length && !post.to.includes("all") ? ` · to ${post.to.map(memberHandle).join(", ")}` : ""}
                    </span>
                    <span className="ade-muted ade-xs ml-auto">{ago(post.at, now)}</span>
                  </div>
                  <p className="ade-swarm-post-body">{post.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="ade-muted ade-xs">No posts on the shared board yet.</p>
          )}
        </section>
      ) : null}

      {showPlans ? (
        <section className="ade-swarm-section">
          <h3 className="ade-swarm-section-title">Plan approvals</h3>
          {plans.length ? plans.map(task => (
            <div key={task.id} className="ade-swarm-card ade-swarm-plan-card">
              <div className="ade-swarm-post-head">
                <span className="ade-swarm-task-id">{task.id}</span>
                <strong>{task.title}</strong>
                <span className={`ade-flow-task-badge is-${task.plan!.status}`}>{task.plan!.status}</span>
              </div>
              <p className="ade-swarm-post-body">{task.plan!.text}</p>
              {task.plan!.status === "waiting" ? (
                <div className="ade-flow-plan-actions">
                  <input
                    value={planNotes[task.id] ?? ""}
                    onChange={e => setPlanNotes(prev => ({ ...prev, [task.id]: e.target.value }))}
                    placeholder="Optional note (required to return)"
                  />
                  <button type="button" className="ade-chip-btn" disabled={busyPlan === task.id || !(planNotes[task.id] ?? "").trim()} onClick={() => void decidePlan(task.id, "return")}>Return</button>
                  <button type="button" className="ade-chip-btn is-primary" disabled={busyPlan === task.id} onClick={() => void decidePlan(task.id, "approve")}>Approve</button>
                </div>
              ) : null}
            </div>
          )) : <p className="ade-muted ade-xs">No plans submitted yet.</p>}
        </section>
      ) : null}

      {showTasks ? (
        <section className="ade-swarm-section">
          <h3 className="ade-swarm-section-title">Shared tasks ({tasks.length})</h3>
          {tasks.length ? (
            <div className="ade-swarm-task-list">
              {tasks.map(task => {
                const owner = task.owner ? model.membersById[task.owner] : undefined
                return (
                  <div key={task.id} className="ade-swarm-card ade-swarm-task-row">
                    <span className="ade-swarm-task-id">{task.id}</span>
                    <span className="min-w-0 flex-1">
                      <strong>{task.title}</strong>
                      <span className="ade-swarm-task-sub">
                        <span className={`ade-swarm-status-pill is-${task.status}`}>{task.status.replace("_", " ")}</span>
                        {task.dependsOn.length ? <span>waits for {task.dependsOn.join(", ")}</span> : null}
                        {task.result && task.status === "done" ? <span className="ade-truncate">{task.result}</span> : null}
                      </span>
                    </span>
                    {owner ? (
                      <MemberBadge handle={owner.handle} color={owner.color} onClick={() => onInspectMember(owner.id)} />
                    ) : (
                      <span className="ade-muted ade-xs">unassigned</span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="ade-muted ade-xs">No shared tasks yet.</p>
          )}
        </section>
      ) : null}

      {showClaims ? (
        <section className="ade-swarm-section">
          <h3 className="ade-swarm-section-title">File claims ({claims.length})</h3>
          {claims.length ? (
            <div className="ade-swarm-card">
              <ul className="ade-flow-files">
                {claims.map(claim => (
                  <li key={`${claim.agent}:${claim.path}`}>
                    <span className="flex items-center gap-1.5"><FileLock2 className="size-3.5 ade-muted" /><code>{claim.path}</code></span>
                    <span className="ade-muted ade-xs">{memberHandle(claim.agent)} · {ago(claim.at, now)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="ade-muted ade-xs">No active file claims.</p>
          )}
        </section>
      ) : null}
    </div>
  )
}
