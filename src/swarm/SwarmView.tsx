import { useEffect, useMemo, useState, type CSSProperties } from "react"
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileLock2,
  GitBranch,
  GitMerge,
  Loader2,
  PauseCircle,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Square,
  XCircle,
} from "lucide-react"
import { request } from "../../api"
import type { Conversation, ConversationTimelineSnapshot, SessionTaskItem, SubagentInfo, TimelineItem, TimelineToolCall } from "../../app-types"
import type { TeamView } from "../flow/team-types"
import { ago } from "../flow/run-model"
import { useAgentsWork, formatDuration, type AgentChanges } from "../agents/agent-summary"
import { SubagentPanel } from "../panels/SubagentPanel"
import { SwarmGraph } from "./SwarmGraph"
import { buildSwarmModel, type SwarmMember, type SwarmThreadView } from "./swarm-model"

type SwarmTab = "overview" | "board" | "members" | "graph"
type BoardFilter = "all" | "posts" | "tasks" | "plans" | "claims"

export type SwarmViewProps = {
  session: Conversation
  leadBusy: boolean
  leadItems: TimelineItem[]
  leadLiveTools?: TimelineToolCall[]
  subagents: SubagentInfo[]
  subagentTimelines: Record<string, ConversationTimelineSnapshot>
  tasks: SessionTaskItem[]
  queued?: string[]
  team?: TeamView | null
  onTeamChanged?: () => void
  onOpenAgent?: (subagentId: string) => void
  onMessageSubagent: (subagentId: string, message: string, mode: "steer" | "follow-up") => Promise<void>
  onStopSubagent: (subagentId: string) => Promise<void>
  onAskAgent?: (text: string) => Promise<void>
  onOpenFile?: (path: string) => void
  onOpenBrowser?: (url?: string) => void
  onOpenExternalBrowser?: (url: string) => void
}

const THREAD_DOT: Record<string, string> = {
  moving: "#3b82f6",
  done: "#22c55e",
  waiting: "#f5b941",
  blocked: "#ef4444",
  open: "#71717a",
}

const POST_KIND_COLOR: Record<string, string> = {
  question: "#f5b941",
  finding: "#38bdf8",
  answer: "#4ade80",
  update: "#a1a1aa",
}

function MemberBadge({ handle, color, onClick }: { handle: string; color: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="ade-swarm-member-glyph" style={{ "--member": color } as CSSProperties} aria-hidden="true">
        <Bot className="size-3" />
      </span>
      <span className="ade-truncate">{handle}</span>
    </>
  )
  if (onClick) {
    return (
      <button type="button" className="ade-swarm-member-pill is-clickable" onClick={e => { e.stopPropagation(); onClick() }}>
        {inner}
      </button>
    )
  }
  return <span className="ade-swarm-member-pill">{inner}</span>
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 7
  const c = 2 * Math.PI * r
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  return (
    <svg className="ade-swarm-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={r} className="ade-swarm-ring-track" strokeWidth="2" fill="none" />
      <circle
        cx="9"
        cy="9"
        r={r}
        className="ade-swarm-ring-fill"
        strokeWidth="2"
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - ratio)}
        transform="rotate(-90 9 9)"
      />
    </svg>
  )
}

export function SwarmView(props: SwarmViewProps) {
  const { session, leadBusy, leadItems, leadLiveTools, subagents, subagentTimelines, tasks, queued, team, onTeamChanged } = props
  const [tab, setTab] = useState<SwarmTab>("overview")
  const [threadsOpen, setThreadsOpen] = useState(true)
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [editingGoal, setEditingGoal] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])

  const model = useMemo(() => buildSwarmModel({
    sessionLabel: session.label,
    leadBusy,
    leadItems,
    leadLiveTools,
    subagents,
    subagentTimelines,
    tasks,
    team,
    queued,
  }), [session.label, leadBusy, leadItems, leadLiveTools, subagents, subagentTimelines, tasks, team, queued])

  const refreshKey = subagents.map(sub => `${sub.id}:${sub.status}`).join(",")
  const agentsWork = useAgentsWork(tab === "members" ? session.id : null, refreshKey)

  const inspectMember = (memberId: string) => {
    setSelectedMemberId(memberId)
    setTab("members")
  }

  const inspectThread = (threadId: string) => {
    setExpandedThreadId(current => (current === threadId ? null : threadId))
    setThreadsOpen(true)
    setTab("overview")
  }

  const allDone = !model.live && model.tasksTotal > 0 && model.tasksDone === model.tasksTotal

  return (
    <div className="ade-swarm">
      <header className="ade-swarm-header">
        <div className="ade-swarm-title-row">
          <h2 className="ade-truncate" title={model.title}>{model.title}</h2>
          <span className={`ade-swarm-live-pill ${model.live ? "is-live" : allDone ? "is-done" : ""}`}>
            <span className="ade-swarm-live-dot" />
            {model.live ? "Live" : allDone ? "Done" : "Idle"}
          </span>
        </div>

        <nav className="ade-swarm-tabs" role="tablist" aria-label="Swarm views">
          <button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "is-active" : ""} onClick={() => setTab("overview")}>
            Overview
          </button>
          <button type="button" role="tab" aria-selected={tab === "board"} className={tab === "board" ? "is-active" : ""} onClick={() => setTab("board")}>
            Board {model.boardBadge > 0 ? <span className="ade-swarm-tab-count">{model.boardBadge}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === "members"} className={tab === "members" ? "is-active" : ""} onClick={() => setTab("members")}>
            Members <span className="ade-swarm-tab-count">{model.members.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "graph"} className={tab === "graph" ? "is-active" : ""} onClick={() => setTab("graph")}>
            Graph
          </button>
        </nav>
      </header>

      <div className="ade-swarm-body">
        {tab === "overview" ? (
          <div className="ade-swarm-overview">
            <GoalCard
              sessionId={session.id}
              swarmTitle={model.title}
              goalTitle={model.goal.title}
              goalSummary={model.goal.summary}
              editing={editingGoal}
              onToggleEdit={setEditingGoal}
              onSaved={() => { setEditingGoal(false); onTeamChanged?.() }}
            />

            {model.running.length > 0 ? (
              <section className="ade-swarm-card ade-swarm-running" aria-label="Running tasks">
                <div className="ade-swarm-running-head">
                  <span className="ade-swarm-status-dot is-moving" />
                  <strong>Running</strong>
                  <span className="ade-swarm-count">{model.running.length}</span>
                </div>
                <ul className="ade-swarm-running-list">
                  {model.running.map(item => (
                    <li key={item.id}>
                      <button type="button" className="ade-swarm-running-row" onClick={() => inspectMember(item.memberId)}>
                        <Loader2 className="ade-swarm-spinner size-4 animate-spin" />
                        <span className="ade-swarm-running-text min-w-0">
                          <strong className="ade-truncate">{item.title}</strong>
                          <span className="ade-truncate ade-muted">{item.focus}</span>
                        </span>
                        <MemberBadge handle={item.memberHandle} color={item.memberColor} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : model.tasksTotal === 0 && subagents.length === 0 ? (
              <section className="ade-swarm-card ade-swarm-empty">
                <div className="ade-swarm-empty-head">
                  <Sparkles className="size-4" />
                  <strong>Ready to launch a swarm</strong>
                </div>
                <p className="ade-muted">
                  Ask the coordinator to split work across parallel workers—or use <code>/swarm</code> in chat—to populate the Goal, live Running tasks, Threads, shared Board, and Graph.
                </p>
                {props.onAskAgent ? (
                  <div className="ade-swarm-empty-actions">
                    <button
                      type="button"
                      className="ade-chip-btn is-primary"
                      onClick={() => void props.onAskAgent?.("/swarm")}
                    >
                      <Sparkles className="size-3.5" /> Start Swarm in chat
                    </button>
                    <button type="button" className="ade-chip-btn" onClick={() => setEditingGoal(true)}>
                      <Pencil className="size-3.5" /> Set Goal
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {model.tasksTotal > 0 || model.totalThreads > 0 ? (
              <button
                type="button"
                className="ade-swarm-card ade-swarm-progress-bar"
                onClick={() => setThreadsOpen(value => !value)}
                aria-expanded={threadsOpen}
              >
                <span className="ade-swarm-progress-left">
                  <ProgressRing done={model.tasksDone} total={model.tasksTotal} />
                  <strong>{model.tasksDone} of {model.tasksTotal}</strong>
                  <span className="ade-muted">tasks done</span>
                </span>
                <span className="ade-swarm-progress-right">
                  <span className="ade-muted">
                    {model.openThreads} {model.openThreads === 1 ? "thread" : "threads"} open
                  </span>
                  {threadsOpen ? <ChevronDown className="size-4 ade-muted" /> : <ChevronRight className="size-4 ade-muted" />}
                </span>
              </button>
            ) : null}

            {threadsOpen && model.threads.length > 0 ? (
              <section className="ade-swarm-threads" aria-label="Threads">
                <h3 className="ade-swarm-section-title">Threads</h3>
                <div className="ade-swarm-thread-list">
                  {model.threads.map(thread => (
                    <ThreadCard
                      key={thread.id}
                      thread={thread}
                      expanded={expandedThreadId === thread.id}
                      onToggle={() => setExpandedThreadId(current => (current === thread.id ? null : thread.id))}
                      onInspectMember={inspectMember}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === "board" ? (
          <SwarmBoardTab
            sessionId={session.id}
            team={team ?? null}
            model={model}
            now={now}
            onChanged={onTeamChanged}
            onInspectMember={inspectMember}
          />
        ) : null}

        {tab === "members" ? (
          <SwarmMembersTab
            sessionId={session.id}
            model={model}
            subagentTimelines={subagentTimelines}
            agentsWork={agentsWork}
            selectedMemberId={selectedMemberId}
            onSelectMember={setSelectedMemberId}
            onOpenAgent={props.onOpenAgent}
            onMessage={props.onMessageSubagent}
            onStop={props.onStopSubagent}
            onOpenFile={props.onOpenFile}
            onOpenBrowser={props.onOpenBrowser}
            onOpenExternalBrowser={props.onOpenExternalBrowser}
            now={now}
          />
        ) : null}

        {tab === "graph" ? (
          <SwarmGraph
            model={model}
            onSelectMember={inspectMember}
            onSelectThread={inspectThread}
          />
        ) : null}
      </div>
    </div>
  )
}

function GoalCard({
  sessionId,
  swarmTitle,
  goalTitle,
  goalSummary,
  editing,
  onToggleEdit,
  onSaved,
}: {
  sessionId: string
  swarmTitle: string
  goalTitle: string
  goalSummary: string
  editing: boolean
  onToggleEdit: (open: boolean) => void
  onSaved: () => void
}) {
  if (editing) {
    return (
      <GoalEditor
        key={`${swarmTitle}|${goalTitle}|${goalSummary}`}
        sessionId={sessionId}
        initialTitle={swarmTitle}
        initialGoalTitle={goalTitle}
        initialGoalSummary={goalSummary}
        onCancel={() => onToggleEdit(false)}
        onSaved={onSaved}
      />
    )
  }

  return (
    <section className="ade-swarm-card ade-swarm-goal" aria-label="Swarm goal">
      <div className="ade-swarm-goal-head">
        <span className="ade-swarm-eyebrow">GOAL</span>
        <button type="button" className="ade-swarm-goal-edit" onClick={() => onToggleEdit(true)} title="Edit swarm title and goal" aria-label="Edit goal">
          <Pencil className="size-3" />
        </button>
      </div>
      <h3>{goalTitle}</h3>
      {goalSummary ? <p>{goalSummary}</p> : null}
    </section>
  )
}

function GoalEditor({
  sessionId,
  initialTitle,
  initialGoalTitle,
  initialGoalSummary,
  onCancel,
  onSaved,
}: {
  sessionId: string
  initialTitle: string
  initialGoalTitle: string
  initialGoalSummary: string
  onCancel: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [gTitle, setGTitle] = useState(initialGoalTitle)
  const [gSummary, setGSummary] = useState(initialGoalSummary)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    setSaving(true)
    setError("")
    try {
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/team/overview`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, goalTitle: gTitle, goalSummary: gSummary }),
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update goal.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ade-swarm-card ade-swarm-goal is-editing" aria-label="Edit swarm goal">
      <span className="ade-swarm-eyebrow">GOAL</span>
      <input className="ade-input-sm" value={title} onChange={e => setTitle(e.target.value)} placeholder="Swarm title" />
      <input className="ade-input-sm" value={gTitle} onChange={e => setGTitle(e.target.value)} placeholder="Goal headline" />
      <textarea className="ade-input-sm" rows={2} value={gSummary} onChange={e => setGSummary(e.target.value)} placeholder="Goal summary" />
      {error ? <p className="ade-error-text ade-xs" role="alert">{error}</p> : null}
      <div className="ade-swarm-goal-actions">
        <button type="button" className="ade-chip-btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="ade-chip-btn is-primary" onClick={() => void save()} disabled={saving}>
          <Check className="size-3.5" /> {saving ? "Saving…" : "Save goal"}
        </button>
      </div>
    </section>
  )
}

function ThreadCard({
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

function SwarmBoardTab({
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
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/team/posts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: postText, to: postTo === "all" ? [] : [postTo] }),
      })
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
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/team/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: newTaskTitle.trim(),
          owner: newTaskOwner || null,
          threadId: newTaskThread || null,
        }),
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
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/team/plans/${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note: planNotes[taskId] ?? "" }),
      })
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

function SwarmMembersTab({
  sessionId,
  model,
  subagentTimelines,
  agentsWork,
  selectedMemberId,
  onSelectMember,
  onOpenAgent,
  onMessage,
  onStop,
  onOpenFile,
  onOpenBrowser,
  onOpenExternalBrowser,
  now,
}: {
  sessionId: string
  model: ReturnType<typeof buildSwarmModel>
  subagentTimelines: Record<string, ConversationTimelineSnapshot>
  agentsWork: ReturnType<typeof useAgentsWork>
  selectedMemberId: string | null
  onSelectMember: (id: string) => void
  onOpenAgent?: (id: string) => void
  onMessage: (subagentId: string, message: string, mode: "steer" | "follow-up") => Promise<void>
  onStop: (subagentId: string) => Promise<void>
  onOpenFile?: (path: string) => void
  onOpenBrowser?: (url?: string) => void
  onOpenExternalBrowser?: (url: string) => void
  now: number
}) {
  const defaultSelected = model.members.find(m => !m.isLead && m.state === "working")?.id
    ?? model.members.find(m => !m.isLead)?.id
    ?? "lead"
  const activeId = selectedMemberId && model.membersById[selectedMemberId] ? selectedMemberId : defaultSelected
  const activeMember = model.membersById[activeId] ?? model.members[0]

  const stateIcon = (state: SwarmMember["state"]) => {
    switch (state) {
      case "working": return <Loader2 className="size-3 animate-spin" />
      case "done": return <CheckCircle2 className="size-3" />
      case "failed": return <XCircle className="size-3" />
      case "waiting":
      case "queued": return <PauseCircle className="size-3" />
      default: return <Clock className="size-3" />
    }
  }

  const activeWork = agentsWork?.agents.find(a => a.id === activeMember?.id)

  return (
    <div className="ade-swarm-members-tab">
      <div className="ade-swarm-member-grid" role="list">
        {model.members.map(member => {
          const work = member.isLead ? null : agentsWork?.agents.find(a => a.id === member.id)
          const cost = member.isLead ? agentsWork?.lead.cost ?? null : work?.cost ?? null
          const duration = member.createdAt ? (member.state === "working" ? now - member.createdAt : null) : null
          return (
            <button
              key={member.id}
              type="button"
              role="listitem"
              className={`ade-swarm-card ade-swarm-member-card ${activeId === member.id ? "is-selected" : ""} is-${member.state}`}
              onClick={() => onSelectMember(member.id)}
            >
              <div className="ade-swarm-member-card-top">
                <MemberBadge handle={member.handle} color={member.color} />
                <span className={`ade-swarm-member-state is-${member.state}`}>
                  {stateIcon(member.state)} {member.stateLabel}
                </span>
              </div>
              <div className="ade-swarm-member-meta">
                <span>{[member.role, member.harness, member.model].filter(Boolean).join(" · ")}</span>
                {member.branch ? <span className="ade-mono"><GitBranch className="size-3 inline" /> {member.branch}</span> : null}
              </div>
              {member.focus ? <p className="ade-swarm-member-focus">{member.focus}</p> : null}
              <div className="ade-swarm-member-foot">
                {work?.changes ? (
                  <span>
                    <span className="ade-plus">+{work.changes.added}</span>{" "}
                    <span className="ade-minus">−{work.changes.removed}</span> · {work.changes.files.length}f
                  </span>
                ) : null}
                {member.steps ? <span>{member.steps} steps</span> : null}
                {duration ? <span>{formatDuration(duration)}</span> : null}
                {cost ? <span>${cost.toFixed(2)}</span> : null}
              </div>
            </button>
          )
        })}
      </div>

      {activeMember ? (
        <section className="ade-swarm-card ade-swarm-member-detail">
          {activeMember.isLead ? (
            <div className="ade-swarm-lead-detail">
              <div className="ade-swarm-post-head">
                <MemberBadge handle={activeMember.handle} color={activeMember.color} />
                <span className="ade-muted ade-xs">Main coordinator · Pi Durable</span>
              </div>
              <p className="ade-muted ade-xs">
                The coordinator&apos;s full conversation is in the main chat pane on the left.
                {activeMember.focus ? ` Now: ${activeMember.focus}.` : ""}
              </p>
              {activeMember.reasoning ? <p className="ade-swarm-post-body">{activeMember.reasoning}</p> : null}
            </div>
          ) : activeMember.subagent ? (
            <>
              <div className="ade-swarm-member-detail-bar">
                <MemberBadge handle={activeMember.handle} color={activeMember.color} />
                {activeMember.branch ? <span className="ade-pill ade-mono"><GitBranch className="size-3" /> {activeMember.branch}</span> : null}
                <span className="flex-1" />
                {activeWork?.changes?.files.length && activeMember.state !== "working" ? (
                  <MergeBranchButton sessionId={sessionId} sub={activeMember.subagent} changes={activeWork.changes} />
                ) : null}
                {onOpenAgent ? (
                  <button type="button" className="ade-chip-btn" onClick={() => onOpenAgent(activeMember.id)}>
                    <ExternalLink className="size-3" /> Own tab
                  </button>
                ) : null}
                {activeMember.state === "working" ? (
                  <button type="button" className="ade-btn ade-btn-danger ade-btn-xs" onClick={() => void onStop(activeMember.id)}>
                    <Square className="size-3" /> Stop
                  </button>
                ) : null}
              </div>
              <div className="ade-swarm-member-timeline">
                <SubagentPanel
                  subagent={activeMember.subagent}
                  liveTimeline={subagentTimelines[activeMember.id]}
                  onMessage={onMessage}
                  onStop={onStop}
                  onOpenFile={onOpenFile}
                  onOpenBrowser={onOpenBrowser}
                  onOpenExternalBrowser={onOpenExternalBrowser}
                />
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function MergeBranchButton({ sessionId, sub, changes }: { sessionId: string; sub: SubagentInfo; changes: AgentChanges }) {
  const [merging, setMerging] = useState(false)
  const [status, setStatus] = useState("")
  const merge = async () => {
    if (!window.confirm(`Merge ${sub.name}'s branch (${sub.branch}) into the session's branch?`)) return
    setMerging(true)
    try {
      const result = await request<{ merged: boolean; message: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(sub.id)}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      setStatus(result.message)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Merge failed.")
    } finally {
      setMerging(false)
    }
  }
  return (
    <button type="button" className="ade-chip-btn" disabled={merging} onClick={() => void merge()} title={status || `Merge ${changes.files.length} changed files`}>
      <GitMerge className="size-3" /> {status ? status : merging ? "Merging…" : `Merge (${changes.files.length}f)`}
    </button>
  )
}
