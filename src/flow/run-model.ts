// The "under the hood" model of a session: who takes part (you, the main agent, its subagents),
// the parts of the work they read from and write to (brief, handouts, stages, tasks, changes,
// reports, summary), and the flows between them. Derived from what ADE already records: the main
// agent's and each subagent's timeline, the blueprint's stage history and the task checklist.
// The idea and the picture follow Ensemble for Orca's data-flow view (MIT, github.com/DueGin/orca-ensemble).
import type { SessionTaskItem, SubagentInfo, TimelineItem, TimelineToolCall } from "../app-types.ts"
import type { TeamView } from "./team-types.ts"

export const PARTS = ["brief", "handouts", "stages", "tasks", "plans", "board", "claims", "changes", "reports", "summary"] as const
export type Part = (typeof PARTS)[number]

/** Who acted or received: "user", "lead" (the main agent) or a subagent id. */
export type Party = string

export type FlowEvent = {
  id: string
  at: number
  part: Part
  /** "in": `from` wrote into the part. "out": the part handed something to `to`. */
  direction: "in" | "out"
  from: Party
  to: Party[]
  /** What it was about: a file, a stage, a subagent's name. */
  subject: string
  /** One line about it. */
  text: string
}

export type StageEntry = { at: number; stageId: string; stageName: string; event: "started" | "finished" | "approved" | "changes_requested" | "looped_back" | "escalated" | "checks_passed" | "checks_failed"; note?: string }

export type RunInput = {
  leadItems: TimelineItem[]
  subagents: SubagentInfo[]
  subagentItems: Record<string, TimelineItem[] | undefined>
  tasks: SessionTaskItem[]
  stageHistory: StageEntry[]
  /** The session's blueprint name, when it follows one. */
  blueprintName?: string | null
  /** The team board: shared tasks, plans, posts, claims and their events. */
  team?: TeamView | null
}

const clip = (text: string, max = 140) => {
  const value = text.replace(/[#*`>]/g, "").replace(/\s+/g, " ").trim()
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

const EDIT_TOOLS = new Set(["write", "edit", "edit_files"])

function pathOf(tool: TimelineToolCall) {
  const value = tool.arguments?.path ?? tool.arguments?.file_path
  return typeof value === "string" ? value : ""
}

function subagentIdOf(tool: TimelineToolCall, subagents: SubagentInfo[]) {
  const details = (tool.details && typeof tool.details === "object" ? tool.details : {}) as Record<string, unknown>
  if (typeof details.conversationId === "string") return details.conversationId
  const name = typeof tool.arguments?.name === "string" ? tool.arguments.name : ""
  return subagents.find(sub => sub.name === name)?.id ?? null
}

/** Every flow in the session, oldest first. */
export function buildEvents(input: RunInput): FlowEvent[] {
  const events: FlowEvent[] = []
  let seq = 0
  const add = (event: Omit<FlowEvent, "id">) => events.push({ ...event, id: `${event.part}-${seq++}` })
  const nameOf = (id: string) => input.subagents.find(sub => sub.id === id)?.name || "a subagent"

  // The main agent's timeline: what you asked, what it handed out, what it changed, what it answered.
  let firstUser = true
  const lastAnswer = [...input.leadItems].reverse().find(item => item.kind === "assistant" && item.text.trim() && !item.streaming)
  for (const item of input.leadItems) {
    if (item.kind === "user") {
      if (firstUser) {
        add({ at: item.createdAt, part: "brief", direction: "in", from: "user", to: [], subject: "", text: clip(item.content) })
        add({ at: item.createdAt, part: "brief", direction: "out", from: "brief", to: ["lead"], subject: "", text: "brief to the main agent" })
        firstUser = false
      } else {
        add({ at: item.createdAt, part: "brief", direction: "in", from: "user", to: [], subject: "follow-up", text: clip(item.content) })
      }
      continue
    }
    if (item.kind !== "assistant") continue
    for (const tool of item.toolCalls) {
      if (tool.name === "spawn_subagent" || tool.name === "delegate") {
        const id = subagentIdOf(tool, input.subagents)
        const name = typeof tool.arguments?.name === "string" ? tool.arguments.name : id ? nameOf(id) : "a subagent"
        const task = typeof tool.arguments?.task === "string" ? tool.arguments.task : typeof tool.arguments?.assignment === "string" ? tool.arguments.assignment : ""
        add({ at: item.createdAt, part: "handouts", direction: "in", from: "lead", to: [], subject: name, text: clip(task || `handed work to ${name}`) })
        if (id) add({ at: item.createdAt, part: "handouts", direction: "out", from: "handouts", to: [id], subject: name, text: `assignment to ${name}` })
      } else if (tool.name === "message_subagent") {
        const id = subagentIdOf(tool, input.subagents)
        if (id) add({ at: item.createdAt, part: "handouts", direction: "out", from: "lead", to: [id], subject: nameOf(id), text: clip(String(tool.arguments?.message ?? "a message")) })
      } else if (tool.name === "wait_subagent" && tool.status === "done") {
        add({ at: item.createdAt, part: "reports", direction: "out", from: "reports", to: ["lead"], subject: "", text: "the main agent collected the reports" })
      } else if (tool.name === "update_tasks") {
        const items = Array.isArray(tool.arguments?.items) ? tool.arguments.items as Array<{ status?: string }> : []
        add({ at: item.createdAt, part: "tasks", direction: "in", from: "lead", to: [], subject: "", text: `${items.filter(entry => entry.status === "done").length} of ${items.length} done` })
      } else if (EDIT_TOOLS.has(tool.name) && pathOf(tool)) {
        add({ at: item.createdAt, part: "changes", direction: "in", from: "lead", to: [], subject: pathOf(tool), text: `${tool.name === "write" ? "wrote" : "edited"} ${pathOf(tool)}` })
      }
    }
  }
  if (lastAnswer && lastAnswer.kind === "assistant") {
    add({ at: lastAnswer.createdAt, part: "summary", direction: "in", from: "lead", to: [], subject: "", text: clip(lastAnswer.text) })
    add({ at: lastAnswer.createdAt, part: "summary", direction: "out", from: "summary", to: ["user"], subject: "", text: "answer to you" })
  }

  // Each subagent's own work: its edits and its report.
  for (const sub of input.subagents) {
    const items = input.subagentItems[sub.id] ?? sub.timeline ?? []
    for (const item of items) {
      if (item.kind !== "assistant") continue
      for (const tool of item.toolCalls) {
        if (EDIT_TOOLS.has(tool.name) && pathOf(tool)) add({ at: item.createdAt, part: "changes", direction: "in", from: sub.id, to: [], subject: pathOf(tool), text: `${sub.name} ${tool.name === "write" ? "wrote" : "edited"} ${pathOf(tool)}` })
        else if (tool.name === "run_command" && /\b(git\s+commit)\b/.test(String(tool.arguments?.command ?? ""))) add({ at: item.createdAt, part: "changes", direction: "in", from: sub.id, to: [], subject: "commit", text: `${sub.name} committed` })
      }
    }
    if (sub.status === "completed" || sub.status === "failed") {
      const answer = [...items].reverse().find(item => item.kind === "assistant" && item.text.trim())
      const at = items.at(-1)?.createdAt ?? sub.createdAt ?? 0
      add({ at, part: "reports", direction: "in", from: sub.id, to: ["lead"], subject: sub.name, text: sub.status === "failed" ? `${sub.name} failed${sub.error ? `: ${clip(sub.error, 100)}` : ""}` : clip(answer && answer.kind === "assistant" ? answer.text : `${sub.name} is done`) })
    }
  }

  // The blueprint's stages.
  for (const entry of input.stageHistory) {
    if (entry.event === "finished") add({ at: entry.at, part: "stages", direction: "in", from: "lead", to: [], subject: entry.stageName, text: entry.note ? `${entry.stageName}: ${clip(entry.note, 110)}` : `${entry.stageName} finished` })
    else if (entry.event === "approved") add({ at: entry.at, part: "stages", direction: "in", from: "user", to: [], subject: entry.stageName, text: `you approved ${entry.stageName}` })
    else if (entry.event === "changes_requested") add({ at: entry.at, part: "stages", direction: "in", from: "user", to: [], subject: entry.stageName, text: `you sent ${entry.stageName} back${entry.note ? `: ${clip(entry.note, 90)}` : ""}` })
    else if (entry.event === "started") add({ at: entry.at, part: "stages", direction: "out", from: "stages", to: ["lead"], subject: entry.stageName, text: `${entry.stageName} started` })
    else if (entry.event === "looped_back") add({ at: entry.at, part: "stages", direction: "out", from: "stages", to: ["lead"], subject: entry.stageName, text: `review sent it back to ${entry.stageName}` })
    else if (entry.event === "checks_failed" || entry.event === "checks_passed") add({ at: entry.at, part: "stages", direction: "out", from: "stages", to: ["lead"], subject: entry.stageName, text: entry.event === "checks_failed" ? `${entry.stageName}: ADE's checks failed` : `${entry.stageName}: ${entry.note ?? "checks passed"}` })
    else if (entry.event === "escalated") add({ at: entry.at, part: "stages", direction: "out", from: "stages", to: ["user"], subject: entry.stageName, text: `${entry.stageName} needs your decision` })
  }

  // The team board's own events: tasks, plans, posts and file claims, as they happened.
  const teamParts: Record<string, Part> = { tasks: "tasks", plans: "plans", board: "board", claims: "claims" }
  for (const event of input.team?.events ?? []) {
    add({ at: event.at, part: teamParts[event.part], direction: event.direction, from: event.from, to: event.to, subject: event.subject, text: event.count > 1 ? `${event.text} (${event.count}×)` : event.text })
  }

  return events.sort((a, b) => a.at - b.at)
}

/** The parts a session shows: stages only with a blueprint, handouts and reports only with subagents. */
export function partsOf(input: RunInput): Part[] {
  return PARTS.filter(part =>
    part === "stages" ? Boolean(input.blueprintName) || input.stageHistory.length > 0
      : part === "handouts" || part === "reports" ? input.subagents.length > 0
        : part === "tasks" ? input.tasks.length > 0 || Boolean(input.team?.tasks.length)
          : part === "plans" ? Boolean(input.team?.requirePlans) || Boolean(input.team?.tasks.some(task => task.plan))
            : part === "board" ? Boolean(input.team?.posts.length)
              : part === "claims" ? Boolean(input.team?.events.some(event => event.part === "claims"))
                : true)
}

export type PartSummary = { headline: string; progress?: { done: number; total: number } }

/** The line under each part's name: counts, like "2 in progress · 1 to do · 2 done". */
export function summarizePart(part: Part, input: RunInput, events: FlowEvent[]): PartSummary {
  const of = events.filter(event => event.part === part)
  switch (part) {
    case "brief": {
      const followUps = of.filter(event => event.subject === "follow-up").length
      return { headline: input.blueprintName ? `${input.blueprintName}${followUps ? ` · ${followUps} follow-ups` : ""}` : followUps ? `${followUps} follow-ups` : "your request" }
    }
    case "handouts": {
      const working = input.subagents.filter(sub => sub.status === "running" || sub.status === "waiting").length
      return { headline: `${input.subagents.length} ${input.subagents.length === 1 ? "subagent" : "subagents"}${working ? ` · ${working} working` : ""}` }
    }
    case "stages": {
      const finished = new Set(input.stageHistory.filter(entry => entry.event === "finished").map(entry => entry.stageId)).size
      const sentBack = input.stageHistory.filter(entry => entry.event === "changes_requested").length
      return { headline: `${finished} finished${sentBack ? ` · ${sentBack} sent back` : ""}` }
    }
    case "tasks": {
      const shared = input.team?.tasks.filter(task => task.status !== "dropped") ?? []
      if (shared.length) {
        const by = (status: string) => shared.filter(task => task.status === status).length
        return { headline: [by("in_progress") ? `${by("in_progress")} in progress` : "", by("todo") ? `${by("todo")} to do` : "", `${by("done")} done`].filter(Boolean).join(" · "), progress: { done: by("done"), total: shared.length } }
      }
      const count = (status: SessionTaskItem["status"]) => input.tasks.filter(task => task.status === status).length
      const parts = [count("in_progress") ? `${count("in_progress")} in progress` : "", count("pending") ? `${count("pending")} to do` : "", `${count("done")} done`, count("blocked") ? `${count("blocked")} blocked` : ""].filter(Boolean)
      return { headline: parts.join(" · "), progress: { done: count("done"), total: input.tasks.length } }
    }
    case "changes": {
      const files = new Set(of.filter(event => event.subject && event.subject !== "commit").map(event => event.subject)).size
      const agents = new Set(of.map(event => event.from)).size
      return { headline: files ? `${files} ${files === 1 ? "file" : "files"} · by ${agents} ${agents === 1 ? "agent" : "agents"}` : "no changes yet" }
    }
    case "reports": {
      const done = input.subagents.filter(sub => sub.status === "completed").length
      const failed = input.subagents.filter(sub => sub.status === "failed").length
      return { headline: `${done} of ${input.subagents.length} reported${failed ? ` · ${failed} failed` : ""}`, progress: { done: done + failed, total: input.subagents.length } }
    }
    case "summary":
      return { headline: of.length ? "answered" : "not yet" }
    case "plans": {
      const plans = (input.team?.tasks ?? []).map(task => task.plan).filter(Boolean)
      const by = (status: string) => plans.filter(plan => plan?.status === status).length
      return { headline: `${by("waiting")} waiting · ${by("approved")} approved · ${by("returned")} sent back` }
    }
    case "board": {
      const posts = input.team?.posts ?? []
      const questions = posts.filter(post => post.kind === "question").length
      return { headline: `${posts.length} ${posts.length === 1 ? "post" : "posts"}${questions ? ` · ${questions} ${questions === 1 ? "question" : "questions"}` : ""}` }
    }
    case "claims": {
      const held = input.team?.claims.length ?? 0
      const refused = of.filter(event => event.direction === "out").length
      return { headline: `${held} ${held === 1 ? "path" : "paths"} held${refused ? ` · ${refused} refused` : ""}` }
    }
  }
}

/** How long ago, in a few characters. */
export function ago(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

/** A flow counts as live for this long: a moving dot on its line. */
export const LIVE_MS = 30_000

export type Link = { party: Party; part: Part; direction: "in" | "out"; count: number; live: boolean }

/** The lines to draw: per party, part and direction, among the latest events. */
export function linksOf(events: FlowEvent[], parties: Set<Party>, now: number): Link[] {
  const links = new Map<string, Link>()
  for (const event of events) {
    const ends = event.direction === "in" ? [event.from] : event.to
    for (const party of ends.filter(end => parties.has(end))) {
      const key = `${party}|${event.part}|${event.direction}`
      const link = links.get(key)
      const live = now - event.at < LIVE_MS
      links.set(key, { party, part: event.part, direction: event.direction, count: (link?.count ?? 0) + 1, live: (link?.live ?? false) || live })
    }
  }
  return [...links.values()]
}
