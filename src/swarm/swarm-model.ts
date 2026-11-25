import type { ConversationTimelineSnapshot, SessionTaskItem, SubagentInfo, TimelineItem, TimelineToolCall } from "../app-types.ts"
import type { TeamTask, TeamView, ThreadStatus } from "../flow/team-types.ts"

function describeTool(tool: TimelineToolCall) {
  const args = tool.arguments ?? {}
  const text = (key: string) => (typeof args[key] === "string" ? String(args[key]) : "")
  switch (tool.name) {
    case "run_command": return `Running ${text("command").split("\n")[0].slice(0, 80)}`
    case "manage_process": return "Managing a background process"
    case "read": return `Reading ${text("path")}`
    case "write": return `Writing ${text("path")}`
    case "edit": case "edit_files": return text("path") ? `Editing ${text("path")}` : "Editing files"
    case "list_files": return `Listing ${text("path") || "files"}`
    case "grep_search": case "find_files": return `Searching for ${text("query") || text("pattern")}`
    case "spawn_subagent": return `Starting subagent ${text("name")}`
    case "wait_subagent": return "Waiting for subagents"
    case "finish_stage": return `Finishing stage ${text("stageId")}`
    case "web_search": return `Searching the web for ${text("query")}`
    default: return tool.name.startsWith("browser_") ? `Browser: ${tool.name.slice(8).replace(/_/g, " ")}` : tool.name.replace(/_/g, " ")
  }
}

function summarizeTimeline(items: TimelineItem[] | undefined, busy: boolean, liveTools: TimelineToolCall[] = []) {
  const list = items ?? []
  const live = busy ? [...liveTools].reverse().find(tool => ["running", "pending", "waiting", "sleeping"].includes(tool.status)) : undefined
  let now = live ? describeTool(live) : ""
  let reasoning = ""
  let answer = ""
  let steps = 0
  for (const item of list) if (item.kind === "assistant") steps += item.toolCalls.length
  for (const item of [...list].reverse()) {
    if (item.kind === "error" && !now) now = item.message
    if (item.kind !== "assistant") continue
    if (!reasoning && item.thinking.trim()) reasoning = clip(item.thinking.split("\n\n").at(-1) ?? item.thinking, 220)
    if (!answer && item.text.trim()) answer = item.text.trim()
    if (!now && busy) {
      const running = [...item.toolCalls].reverse().find(tool => ["running", "pending", "waiting", "sleeping"].includes(tool.status))
      if (running) now = describeTool(running)
      else if (item.streaming && item.text) now = "Writing a reply"
      else if (item.streaming) now = "Thinking"
      else if (item.toolCalls.length) now = `Done: ${describeTool(item.toolCalls[item.toolCalls.length - 1])}`
    }
    if (reasoning && answer && (now || !busy)) break
  }
  return { now, reasoning, answer: answer ? clip(answer, 260) : "", steps }
}

export type SwarmMemberState = "working" | "waiting" | "done" | "failed" | "queued" | "idle"

export type SwarmMember = {
  id: string
  isLead: boolean
  name: string
  handle: string
  role: string
  harness: string
  model: string | null
  mode: "readonly" | "workspace" | "worktree" | "lead"
  branch: string | null
  state: SwarmMemberState
  stateLabel: string
  focus: string
  reasoning: string
  answer: string
  steps: number
  color: string
  createdAt: number | null
  subagent?: SubagentInfo
}

export type SwarmRunningItem = {
  id: string
  taskId: string | null
  threadId: string | null
  title: string
  focus: string
  memberId: string
  memberHandle: string
  memberColor: string
}

export type SwarmThreadTask = {
  id: string
  title: string
  status: "todo" | "in_progress" | "done" | "blocked"
  ownerId: string | null
  ownerHandle: string | null
  ownerColor: string | null
  dependsOn: string[]
  result: string
}

export type SwarmThreadView = {
  id: string
  title: string
  summary: string
  status: ThreadStatus
  statusLabel: string
  now: string
  done: number
  total: number
  tasks: SwarmThreadTask[]
  memberIds: string[]
  synthetic: boolean
}

export type SwarmOverviewModel = {
  title: string
  live: boolean
  goal: { title: string; summary: string; explicit: boolean }
  members: SwarmMember[]
  membersById: Record<string, SwarmMember>
  running: SwarmRunningItem[]
  threads: SwarmThreadView[]
  tasksDone: number
  tasksTotal: number
  openThreads: number
  totalThreads: number
  boardBadge: number
  postsCount: number
  tasksCount: number
  plansWaiting: number
  claimsCount: number
}

export type SwarmInput = {
  sessionLabel: string
  leadBusy: boolean
  leadItems: TimelineItem[]
  leadLiveTools?: TimelineToolCall[]
  subagents: SubagentInfo[]
  subagentTimelines: Record<string, ConversationTimelineSnapshot | undefined>
  tasks: SessionTaskItem[]
  team?: TeamView | null
  queued?: string[]
}

const MEMBER_COLORS = ["#38bdf8", "#2dd4bf", "#818cf8", "#34d399", "#f472b6", "#fbbf24", "#fb923c", "#a78bfa"]

function memberColor(index: number) {
  return MEMBER_COLORS[index % MEMBER_COLORS.length]
}

function toHandle(name: string) {
  const cleaned = name.trim()
  if (!cleaned) return "worker"
  return cleaned
}

function clip(text: string, max = 160) {
  const clean = text.replace(/[#*`>_]/g, "").replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function threadStatusLabel(status: ThreadStatus): string {
  switch (status) {
    case "moving": return "Moving"
    case "done": return "Done"
    case "waiting": return "Waiting"
    case "blocked": return "Blocked"
    default: return "Open"
  }
}

function subagentState(sub: SubagentInfo, busy: boolean, queued: boolean): { state: SwarmMemberState; label: string } {
  if (queued) return { state: "queued", label: "Queued" }
  if (busy || sub.status === "running") return { state: "working", label: "Working" }
  if (sub.status === "waiting") return { state: "waiting", label: "Waiting" }
  if (sub.status === "completed") return { state: "done", label: "Done" }
  if (sub.status === "failed" || sub.status === "blocked") return { state: "failed", label: sub.status === "blocked" ? "Blocked" : "Failed" }
  return { state: "idle", label: "Idle" }
}

/** Build the complete Swarm Overview, Running list, Threads, and Members model from ADE session & team state. */
export function buildSwarmModel(input: SwarmInput): SwarmOverviewModel {
  const team = input.team ?? null
  const queuedSet = new Set(input.queued ?? [])
  const focusMap = team?.focus ?? {}

  const leadSummary = summarizeTimeline(input.leadItems, input.leadBusy, input.leadLiveTools ?? [])
  const leadFocus = focusMap.lead?.text || leadSummary.now || (input.leadBusy ? leadSummary.reasoning : "")
  const leadMember: SwarmMember = {
    id: "lead",
    isLead: true,
    name: "Main agent",
    handle: "coordinator",
    role: "coordinator",
    harness: "Pi Durable",
    model: null,
    mode: "lead",
    branch: null,
    state: input.leadBusy ? "working" : "idle",
    stateLabel: input.leadBusy ? "Working" : "Idle",
    focus: leadFocus,
    reasoning: leadSummary.reasoning,
    answer: leadSummary.answer,
    steps: leadSummary.steps,
    color: "#8b5cf6",
    createdAt: input.leadItems[0]?.createdAt ?? null,
  }

  const workerMembers: SwarmMember[] = input.subagents.map((sub, idx) => {
    const snap = input.subagentTimelines[sub.id]
    const busy = Boolean(snap?.busy) || sub.status === "running"
    const summary = summarizeTimeline(snap?.items ?? sub.timeline, busy, snap?.liveTools ?? sub.liveTools ?? [])
    const st = subagentState(sub, busy, queuedSet.has(sub.id))
    const explicitFocus = focusMap[sub.id]?.text ?? ""
    const focus = explicitFocus || summary.now || (busy ? summary.reasoning : "") || (sub.error ?? "")
    return {
      id: sub.id,
      isLead: false,
      name: sub.name || "Subagent",
      handle: toHandle(sub.name || `worker-${idx + 1}`),
      role: sub.role || "worker",
      harness: sub.harness === "claude-code" ? "Claude Code" : sub.harness === "codex" ? "Codex" : "Pi",
      model: sub.model,
      mode: sub.mode ?? "readonly",
      branch: sub.branch ?? null,
      state: st.state,
      stateLabel: st.label,
      focus,
      reasoning: summary.reasoning,
      answer: summary.answer,
      steps: summary.steps,
      color: memberColor(idx),
      createdAt: sub.createdAt ?? null,
      subagent: sub,
    }
  })

  const members = [leadMember, ...workerMembers]
  const membersById: Record<string, SwarmMember> = Object.fromEntries(members.map(member => [member.id, member]))

  const activeTeamTasks = (team?.tasks ?? []).filter(task => task.status !== "dropped")

  // Build the "Running N" items list:
  // 1) All in_progress team tasks
  // 2) Any working subagents that don't already own an in_progress team task
  // 3) Fallback to in_progress session checklist tasks if no team tasks or running workers exist
  const running: SwarmRunningItem[] = []
  const coveredMembers = new Set<string>()

  for (const task of activeTeamTasks) {
    if (task.status !== "in_progress") continue
    const owner = task.owner ? membersById[task.owner] : undefined
    if (owner) coveredMembers.add(owner.id)
    const fallbackFocus = owner?.focus || task.detail || "Working on task"
    running.push({
      id: `task:${task.id}`,
      taskId: task.id,
      threadId: task.threadId ?? null,
      title: task.title,
      focus: clip(fallbackFocus, 140),
      memberId: owner?.id ?? "lead",
      memberHandle: owner?.handle ?? "coordinator",
      memberColor: owner?.color ?? leadMember.color,
    })
  }

  for (const member of workerMembers) {
    if (member.state !== "working" || coveredMembers.has(member.id)) continue
    coveredMembers.add(member.id)
    running.push({
      id: `agent:${member.id}`,
      taskId: null,
      threadId: null,
      title: clip(member.subagent?.assignment || member.role || member.name, 120),
      focus: clip(member.focus || "Working on assignment", 140),
      memberId: member.id,
      memberHandle: member.handle,
      memberColor: member.color,
    })
  }

  if (!running.length && !activeTeamTasks.length) {
    for (const item of input.tasks) {
      if (item.status !== "in_progress") continue
      running.push({
        id: `checklist:${item.id}`,
        taskId: item.id,
        threadId: null,
        title: item.title,
        focus: clip(leadMember.focus || "In progress", 140),
        memberId: "lead",
        memberHandle: leadMember.handle,
        memberColor: leadMember.color,
      })
    }
  }

  const mapTeamTask = (task: TeamTask): SwarmThreadTask => {
    const owner = task.owner ? membersById[task.owner] : undefined
    return {
      id: task.id,
      title: task.title,
      status: task.status === "done" ? "done" : task.status === "in_progress" ? "in_progress" : "todo",
      ownerId: owner?.id ?? task.owner,
      ownerHandle: owner?.handle ?? task.owner,
      ownerColor: owner?.color ?? null,
      dependsOn: task.dependsOn,
      result: task.result,
    }
  }

  // Build Threads:
  // Case A: Explicit threads from team.threads
  // Case B: Synthesize from team.tasks (grouped by owner or individually)
  // Case C: Synthesize from subagents (each worker is a visible workstream thread)
  // Case D: Synthesize from session checklist tasks
  const threads: SwarmThreadView[] = []
  const explicitThreads = team?.threads ?? []

  if (explicitThreads.length > 0) {
    const assignedTaskIds = new Set<string>()
    for (const thread of explicitThreads) {
      const related = activeTeamTasks.filter(task => task.threadId === thread.id)
      for (const task of related) assignedTaskIds.add(task.id)
      const mapped = related.map(mapTeamTask)
      const done = mapped.filter(task => task.status === "done").length
      const total = mapped.length
      const activeTask = related.find(task => task.status === "in_progress")
      const activeOwner = activeTask?.owner ? membersById[activeTask.owner] : undefined
      const memberIds = [...new Set(mapped.map(task => task.ownerId).filter((id): id is string => Boolean(id)))]
      const anyWorking = Boolean(activeTask) || memberIds.some(id => membersById[id]?.state === "working")
      const computedStatus: ThreadStatus =
        total > 0 && done === total ? "done"
          : anyWorking ? "moving"
            : thread.status
      const now = activeOwner?.focus || thread.focus || ""
      threads.push({
        id: thread.id,
        title: thread.title,
        summary: thread.summary,
        status: computedStatus,
        statusLabel: threadStatusLabel(computedStatus),
        now: computedStatus === "done" ? "" : clip(now, 140),
        done,
        total,
        tasks: mapped,
        memberIds,
        synthetic: false,
      })
    }

    const ungrouped = activeTeamTasks.filter(task => !assignedTaskIds.has(task.id))
    if (ungrouped.length > 0) {
      const mapped = ungrouped.map(mapTeamTask)
      const done = mapped.filter(task => task.status === "done").length
      const activeTask = ungrouped.find(task => task.status === "in_progress")
      const activeOwner = activeTask?.owner ? membersById[activeTask.owner] : undefined
      const status: ThreadStatus = done === mapped.length ? "done" : activeTask ? "moving" : "open"
      threads.push({
        id: "ungrouped",
        title: "Additional tasks",
        summary: "Tasks on the shared board not assigned to a named thread.",
        status,
        statusLabel: threadStatusLabel(status),
        now: status === "done" ? "" : clip(activeOwner?.focus ?? "", 140),
        done,
        total: mapped.length,
        tasks: mapped,
        memberIds: [...new Set(mapped.map(task => task.ownerId).filter((id): id is string => Boolean(id)))],
        synthetic: true,
      })
    }
  } else if (activeTeamTasks.length > 0) {
    // Group team tasks by owner so each worker's stream renders as a Thread card
    const byGroup = new Map<string, TeamTask[]>()
    for (const task of activeTeamTasks) {
      const key = task.owner || task.id
      byGroup.set(key, [...(byGroup.get(key) ?? []), task])
    }
    for (const [key, list] of byGroup) {
      const owner = membersById[key]
      const mapped = list.map(mapTeamTask)
      const done = mapped.filter(task => task.status === "done").length
      const activeTask = list.find(task => task.status === "in_progress")
      const status: ThreadStatus =
        done === mapped.length ? "done"
          : activeTask || owner?.state === "working" ? "moving"
            : owner?.state === "failed" ? "blocked"
              : "open"
      const title = list.length === 1 ? list[0].title : owner ? `${owner.name} stream` : list[0].title
      const summary = list.length === 1
        ? (list[0].detail || (owner ? `Owned by ${owner.handle}` : "Shared board task"))
        : `${list.length} tasks owned by ${owner?.handle ?? "team"}`
      threads.push({
        id: `synth-${key}`,
        title: clip(title, 110),
        summary: clip(summary, 180),
        status,
        statusLabel: threadStatusLabel(status),
        now: status === "done" ? "" : clip(owner?.focus ?? "", 140),
        done,
        total: mapped.length,
        tasks: mapped,
        memberIds: owner ? [owner.id] : [],
        synthetic: true,
      })
    }
  } else if (workerMembers.length > 0) {
    for (const member of workerMembers) {
      const status: ThreadStatus =
        member.state === "done" ? "done"
          : member.state === "working" ? "moving"
            : member.state === "failed" ? "blocked"
              : member.state === "waiting" || member.state === "queued" ? "waiting"
                : "open"
      const taskStatus = member.state === "done" ? "done" : member.state === "working" ? "in_progress" : member.state === "failed" ? "blocked" : "todo"
      const assignment = member.subagent?.assignment || member.role
      threads.push({
        id: `agent-${member.id}`,
        title: member.role && member.role !== "worker" ? `${member.name} · ${member.role}` : member.name,
        summary: clip(assignment || `${member.harness} worker`, 180),
        status,
        statusLabel: threadStatusLabel(status),
        now: status === "done" ? "" : clip(member.focus, 140),
        done: member.state === "done" ? 1 : 0,
        total: 1,
        tasks: [{
          id: member.handle,
          title: clip(assignment || member.name, 120),
          status: taskStatus,
          ownerId: member.id,
          ownerHandle: member.handle,
          ownerColor: member.color,
          dependsOn: [],
          result: member.answer,
        }],
        memberIds: [member.id],
        synthetic: true,
      })
    }
  } else if (input.tasks.length > 0) {
    const mapped: SwarmThreadTask[] = input.tasks.map((item, idx) => ({
      id: `T${idx + 1}`,
      title: item.title,
      status: item.status === "done" ? "done" : item.status === "in_progress" ? "in_progress" : item.status === "blocked" ? "blocked" : "todo",
      ownerId: "lead",
      ownerHandle: leadMember.handle,
      ownerColor: leadMember.color,
      dependsOn: [],
      result: "",
    }))
    const done = mapped.filter(task => task.status === "done").length
    const status: ThreadStatus =
      done === mapped.length ? "done"
        : input.leadBusy || mapped.some(task => task.status === "in_progress") ? "moving"
          : "open"
    threads.push({
      id: "session-tasks",
      title: input.sessionLabel || "Session workstream",
      summary: "Tasks tracked by the main coordinator.",
      status,
      statusLabel: threadStatusLabel(status),
      now: status === "done" ? "" : clip(leadMember.focus, 140),
      done,
      total: mapped.length,
      tasks: mapped,
      memberIds: ["lead"],
      synthetic: true,
    })
  }

  // Task progress totals
  let tasksDone = 0
  let tasksTotal = 0
  if (activeTeamTasks.length > 0) {
    tasksTotal = activeTeamTasks.length
    tasksDone = activeTeamTasks.filter(task => task.status === "done").length
  } else if (workerMembers.length > 0) {
    tasksTotal = workerMembers.length
    tasksDone = workerMembers.filter(member => member.state === "done").length
  } else if (input.tasks.length > 0) {
    tasksTotal = input.tasks.length
    tasksDone = input.tasks.filter(task => task.status === "done").length
  }

  const openThreads = threads.filter(thread => thread.status !== "done").length
  const firstUserMessage = input.leadItems.find(item => item.kind === "user")
  const fallbackSummary = firstUserMessage && firstUserMessage.kind === "user" ? clip(firstUserMessage.content, 200) : "Coordinate parallel workers, shared tasks, and board updates."
  const goal = team?.goal
    ? { title: team.goal.title, summary: team.goal.summary, explicit: true }
    : { title: input.sessionLabel || "Swarm session", summary: fallbackSummary, explicit: false }

  const live = input.leadBusy || workerMembers.some(member => member.state === "working") || running.length > 0
  const postsCount = team?.posts.length ?? 0
  const tasksCount = activeTeamTasks.length
  const plansWaiting = activeTeamTasks.filter(task => task.plan?.status === "waiting").length
  const claimsCount = team?.claims.length ?? 0

  return {
    title: team?.title || input.sessionLabel || "Swarm",
    live,
    goal,
    members,
    membersById,
    running,
    threads,
    tasksDone,
    tasksTotal,
    openThreads,
    totalThreads: threads.length,
    boardBadge: postsCount > 0 ? postsCount : tasksCount,
    postsCount,
    tasksCount,
    plansWaiting,
    claimsCount,
  }
}
