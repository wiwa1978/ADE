// "Under the hood": a session as a team at work. Who takes part, the parts of the work they read
// from and write to, and the latest flows between them, live. The layout of the data-flow diagram
// follows Ensemble for Orca's run report (MIT, github.com/DueGin/orca-ensemble).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Activity, Bot, ChevronRight, ClipboardCheck, ClipboardList, FileLock2, MessagesSquare, Crown, FileDiff, FileText, ListChecks, MessageSquareText, Send, User, Users, Workflow } from "lucide-react"
import type { Conversation, SessionTaskItem, SubagentInfo, TimelineItem } from "../../app-types"
import { request } from "../../api"
import type { TeamTask, TeamView } from "./team-types"
import { ago, buildEvents, linksOf, partsOf, summarizePart, LIVE_MS, type FlowEvent, type Part, type Party, type RunInput } from "./run-model"

const PART_INFO: Record<Part, { name: string; color: string; icon: typeof Bot; hint: string }> = {
  brief: { name: "Brief", color: "#a78bfa", icon: FileText, hint: "What you asked for, and the blueprint it follows." },
  handouts: { name: "Handouts", color: "#60a5fa", icon: Send, hint: "Work the main agent handed to subagents." },
  stages: { name: "Stages", color: "#c084fc", icon: Workflow, hint: "The blueprint's stages, and your approvals." },
  tasks: { name: "Task board", color: "#38bdf8", icon: ListChecks, hint: "The agent's task list and where each task is." },
  plans: { name: "Plan approval", color: "#f5b941", icon: ClipboardList, hint: "Members show their plan for a task before they work on it; the lead or you approve it or send it back." },
  board: { name: "Team board", color: "#2dd4bf", icon: MessagesSquare, hint: "Questions, findings and answers the agents (and you) post for each other." },
  claims: { name: "File claims", color: "#f472b6", icon: FileLock2, hint: "Files an agent claimed before editing; others are refused until it releases them." },
  changes: { name: "Changes", color: "#fb923c", icon: FileDiff, hint: "Files each agent wrote or edited." },
  reports: { name: "Reports", color: "#34d399", icon: ClipboardCheck, hint: "What subagents reported back to the main agent." },
  summary: { name: "Summary", color: "#facc15", icon: MessageSquareText, hint: "The main agent's answer to you." },
}

const HARNESS: Record<string, { name: string; mark: string; color: string }> = {
  pi: { name: "Pi", mark: "π", color: "#8b5cf6" },
  "claude-code": { name: "Claude Code", mark: "C", color: "#d97757" },
  codex: { name: "Codex", mark: "X", color: "#10a37f" },
}

type MemberTone = "working" | "idle" | "done" | "attention" | "failed" | "queued"
const TONE: Record<MemberTone, string> = { working: "#f5b941", idle: "#4ade80", done: "#60a5fa", attention: "#f87171", failed: "#f87171", queued: "#a1a1aa" }

export type FlowViewProps = {
  session: Conversation
  leadBusy: boolean
  leadItems: TimelineItem[]
  subagents: SubagentInfo[]
  subagentTimelines: Record<string, { items: TimelineItem[]; busy: boolean } | undefined>
  tasks: SessionTaskItem[]
  stageHistory: RunInput["stageHistory"]
  blueprintName?: string | null
  waitingStage?: string | null
  queued?: string[]
  cost?: number | null
  onOpenAgent?: (subagentId: string) => void
  onOpenPart?: (part: Part) => void
  /** The team board (shared tasks, plans, posts, claims), live. */
  team?: TeamView | null
  onTeamChanged?: () => void
}

function memberTone(sub: SubagentInfo, busy: boolean, queued: boolean): { tone: MemberTone; text: string } {
  if (queued) return { tone: "queued", text: "queued" }
  if (busy || sub.status === "running") return { tone: "working", text: "working" }
  if (sub.status === "waiting") return { tone: "attention", text: "waiting" }
  if (sub.status === "completed") return { tone: "done", text: "done" }
  if (sub.status === "failed" || sub.status === "blocked") return { tone: "failed", text: sub.status }
  return { tone: "idle", text: "idle" }
}

function Avatar({ harness, size = 28 }: { harness?: string; size?: number }) {
  const info = harness ? HARNESS[harness] ?? HARNESS.pi : null
  return (
    <span className="ade-flow-avatar" style={{ width: size, height: size, "--mark": info?.color ?? "rgb(var(--primary))" } as CSSProperties} aria-hidden="true">
      {info ? info.mark : <Crown className="size-3.5" />}
    </span>
  )
}

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    // Without ResizeObserver (older webviews, tests), follow the window instead.
    if (typeof ResizeObserver === "undefined") {
      const update = () => setWidth(node.offsetWidth)
      update()
      window.addEventListener("resize", update)
      return () => window.removeEventListener("resize", update)
    }
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export function FlowView(props: FlowViewProps) {
  const { session, leadBusy, leadItems, subagents, subagentTimelines, tasks, stageHistory, blueprintName } = props
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])

  const input: RunInput = useMemo(() => ({
    leadItems,
    subagents,
    subagentItems: Object.fromEntries(subagents.map(sub => [sub.id, subagentTimelines[sub.id]?.items ?? sub.timeline])),
    tasks,
    stageHistory,
    blueprintName,
    team: props.team ?? null,
  }), [leadItems, subagents, subagentTimelines, tasks, stageHistory, blueprintName, props.team])
  const events = useMemo(() => buildEvents(input), [input])
  const parts = partsOf(input)
  const [selected, setSelected] = useState<Part | "all" | null>(null)
  const page = selected ?? (props.waitingStage ? "stages" : null)

  const busyOf = (sub: SubagentInfo) => Boolean(subagentTimelines[sub.id]?.busy) || sub.status === "running"
  const working = subagents.filter(busyOf).length + (leadBusy ? 1 : 0)
  const first = events[0]?.at ?? session.createdAt ?? null
  const last = events.at(-1)?.at ?? session.updatedAt ?? null
  const needsYou = (props.waitingStage ? 1 : 0) + subagents.filter(sub => sub.status === "failed").length
  const mode = subagents.length ? "Team" : "Solo"

  return (
    <div className="ade-flow">
      <header className="ade-flow-head">
        <span className="ade-flow-head-icon"><Users className="size-5" /></span>
        <div className="min-w-0">
          <h2 className="ade-truncate">{session.label}</h2>
          <div className="ade-flow-chips">
            <span className="ade-flow-chip is-mode">{blueprintName ? `${blueprintName} · ${mode}` : `${mode} · Vibe coding`}</span>
            <span className={`ade-flow-chip ${working ? "is-active" : ""}`}><span className="ade-flow-dot" />{working ? "Active" : "Idle"}</span>
            {props.waitingStage ? <span className="ade-flow-chip is-warn"><ClipboardCheck className="size-3" /> {props.waitingStage} needs your approval</span> : null}
            {needsYou && !props.waitingStage ? <span className="ade-flow-chip is-warn">{needsYou} need you</span> : null}
          </div>
        </div>
      </header>

      <dl className="ade-flow-stats">
        <div><dt>Lead</dt><dd><span className="ade-flow-dot" style={{ background: "#8b5cf6" }} />Main agent</dd></div>
        <div><dt>Way of working</dt><dd>{blueprintName ?? "Vibe coding"}</dd></div>
        <div><dt>Started</dt><dd>{first ? new Date(first).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</dd></div>
        <div><dt>Last change</dt><dd>{last ? ago(last, now) : "—"}</dd></div>
        <div><dt>Running for</dt><dd>{first && last ? duration((working ? now : last) - first) : "—"}</dd></div>
        {props.cost ? <div><dt>Cost</dt><dd>${props.cost.toFixed(2)}</dd></div> : null}
      </dl>

      <section className="ade-flow-members" aria-label="Members">
        <h3><Users className="size-3.5" /> Members <span>{subagents.length + 1}</span></h3>
        <div className="ade-flow-member-row">
          <div className="ade-flow-member">
            <Avatar />
            <div className="min-w-0">
              <strong>Main agent</strong>
              <span className="ade-mono">lead · Pi Durable</span>
            </div>
            <span className="ade-flow-member-state" style={{ color: leadBusy ? TONE.working : TONE.idle }}>{leadBusy ? "working" : "idle"}</span>
          </div>
          {subagents.map(sub => {
            const state = memberTone(sub, busyOf(sub), props.queued?.includes(sub.id) ?? false)
            return (
              <button type="button" key={sub.id} className={`ade-flow-member ${state.tone === "done" ? "is-done" : ""}`} onClick={() => props.onOpenAgent?.(sub.id)} title="Open this agent">
                <Avatar harness={sub.harness ?? "pi"} />
                <div className="min-w-0">
                  <strong className="ade-truncate">{sub.name || "Subagent"}</strong>
                  <span className="ade-mono ade-truncate">{[sub.role || "member", HARNESS[sub.harness ?? "pi"]?.name, sub.model && sub.model !== HARNESS[sub.harness ?? "pi"]?.name ? sub.model : ""].filter(Boolean).join(" · ")}</span>
                </div>
                <span className="ade-flow-member-state" style={{ color: TONE[state.tone] }}>{state.text}</span>
              </button>
            )
          })}
        </div>
      </section>

      <FlowDiagram
        events={events}
        parts={parts}
        input={input}
        now={now}
        leadBusy={leadBusy}
        subagents={subagents}
        busyOf={busyOf}
        selected={page === "all" ? null : page}
        onOpen={part => setSelected(current => current === part ? null : part)}
        aside={<LatestFlows events={events} subagents={subagents} now={now} onAll={() => setSelected("all")} />}
      />

      {page ? (
        <section className="ade-flow-page">
          <nav className="ade-flow-tabs" aria-label="Parts">
            {parts.map(part => {
              const info = PART_INFO[part]
              const Icon = info.icon
              const count = events.filter(event => event.part === part && event.direction === "in").length
              return (
                <button key={part} type="button" className={page === part ? "is-active" : ""} onClick={() => setSelected(part)} style={{ "--part": info.color } as CSSProperties}>
                  <Icon className="size-3.5" /> {info.name} {count ? <span>{count}</span> : null}
                </button>
              )
            })}
            <button type="button" className={page === "all" ? "is-active" : ""} onClick={() => setSelected("all")}>
              <Activity className="size-3.5" /> All flows <span>{events.length}</span>
            </button>
          </nav>
          {page === "all" ? <FlowList events={[...events].reverse()} subagents={subagents} now={now} />
            : <PartPage part={page} sessionId={session.id} input={input} events={events} now={now} onOpenAgent={props.onOpenAgent} onOpenPart={props.onOpenPart} onTeamChanged={props.onTeamChanged} />}
        </section>
      ) : null}
    </div>
  )
}

function duration(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function partyName(party: Party, subagents: SubagentInfo[]) {
  if (party === "user") return "You"
  if (party === "lead") return "Main agent"
  return subagents.find(sub => sub.id === party)?.name || "Subagent"
}

type Point = { x: number; top: number; bottom: number }
type Geometry = { width: number; height: number; parties: Record<string, Point>; cards: Record<string, Point> }

function FlowDiagram({ events, parts, input, now, leadBusy, subagents, busyOf, selected, onOpen, aside }: {
  events: FlowEvent[]
  parts: Part[]
  input: RunInput
  now: number
  leadBusy: boolean
  subagents: SubagentInfo[]
  busyOf: (sub: SubagentInfo) => boolean
  selected: Part | null
  onOpen: (part: Part) => void
  aside: ReactNode
}) {
  const outer = useRef<HTMLDivElement>(null)
  const width = useWidth(outer)
  const stacked = width > 0 && width < 560
  const withAside = width >= 1020
  const recent = events.slice(-24)
  const parties: Party[] = [
    ...(recent.some(event => event.from === "user" || event.to.includes("user")) ? ["user"] : []),
    "lead",
    ...subagents.map(sub => sub.id),
  ]
  const links = linksOf(recent, new Set(parties), now)
  const liveParts = new Set(links.filter(link => link.live).map(link => link.part))
  const [hot, setHot] = useState<string | null>(null)

  const grid = useRef<HTMLDivElement>(null)
  const partyNodes = useRef(new Map<string, HTMLElement>())
  const cardNodes = useRef(new Map<string, HTMLElement>())
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const measure = useCallback(() => {
    const box = grid.current
    if (!box) return
    const origin = box.getBoundingClientRect()
    // The app scales its interface with CSS zoom; measure in the grid's own units.
    const scale = box.offsetWidth ? origin.width / box.offsetWidth : 1
    const read = (nodes: Map<string, HTMLElement>, edge: "left" | "right") => {
      const points: Record<string, Point> = {}
      for (const [key, node] of nodes) {
        if (!node.isConnected) continue
        const rect = node.getBoundingClientRect()
        points[key] = { x: Math.round((rect[edge] - origin.left) / scale), top: Math.round((rect.top - origin.top) / scale), bottom: Math.round((rect.bottom - origin.top) / scale) }
      }
      return points
    }
    const next: Geometry = { width: box.offsetWidth, height: box.offsetHeight, parties: read(partyNodes.current, "right"), cards: read(cardNodes.current, "left") }
    setGeometry(current => (current && JSON.stringify(current) === JSON.stringify(next) ? current : next))
  }, [])
  useLayoutEffect(() => { if (!stacked) measure() })
  useLayoutEffect(() => {
    const box = grid.current
    if (stacked || !box) return
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }
    const observer = new ResizeObserver(() => measure())
    observer.observe(box)
    return () => observer.disconnect()
  }, [stacked, measure])

  const stateOf = (party: Party) => {
    if (party === "user") return { color: "#a1a1aa", text: "" }
    if (party === "lead") return { color: leadBusy ? TONE.working : TONE.idle, text: leadBusy ? "working" : "idle" }
    const sub = subagents.find(entry => entry.id === party)
    if (!sub) return { color: TONE.idle, text: "" }
    const state = memberTone(sub, busyOf(sub), false)
    return { color: TONE[state.tone], text: state.text }
  }

  const cards = parts.map(part => {
    const info = PART_INFO[part]
    const Icon = info.icon
    const summary = summarizePart(part, input, events)
    const latest = [...events].reverse().find(event => event.part === part)
    const dim = hot !== null && hot !== part && !links.some(link => link.part === part && link.party === hot)
    return (
      <button
        key={part}
        type="button"
        ref={node => { if (node) cardNodes.current.set(part, node); else cardNodes.current.delete(part) }}
        className={`ade-flow-card ${selected === part ? "is-selected" : ""} ${liveParts.has(part) ? "is-live" : ""} ${dim ? "is-dim" : ""}`}
        style={{ "--part": info.color } as CSSProperties}
        onClick={() => onOpen(part)}
        onMouseEnter={() => setHot(part)}
        onMouseLeave={() => setHot(null)}
        title={info.hint}
      >
        <span className="ade-flow-card-head">
          <span className="ade-flow-card-icon"><Icon className="size-4" /></span>
          <strong>{info.name}</strong>
          {liveParts.has(part) ? <span className="ade-flow-live-dot" /> : null}
          <ChevronRight className="size-4 ml-auto opacity-50" />
        </span>
        <span className="ade-flow-card-sub">{summary.headline}</span>
        {summary.progress && summary.progress.total ? <span className="ade-flow-progress"><span style={{ width: `${(summary.progress.done / summary.progress.total) * 100}%` }} /></span> : null}
        {latest ? (
          <span className="ade-flow-card-latest">
            <span className="ade-truncate">{latest.text}</span>
            <span className="ade-muted">{ago(latest.at, now)}</span>
          </span>
        ) : <span className="ade-flow-card-latest ade-muted">Nothing yet</span>}
      </button>
    )
  })

  const head = (
    <div className="ade-flow-diagram-head">
      <span className="ade-flow-label">Data flow</span>
      {liveParts.size ? <span className="ade-flow-live"><span className="ade-flow-live-dot" /> Live</span> : null}
    </div>
  )

  if (stacked) {
    return (
      <section ref={outer} className="ade-flow-diagram is-stacked">
        {head}
        <div className="ade-flow-chiprow">
          {parties.map(party => (
            <span key={party} className="ade-flow-party-chip">
              <span className="ade-flow-dot" style={{ background: stateOf(party).color }} /> {partyName(party, subagents)}
            </span>
          ))}
        </div>
        <div className="ade-flow-cards">{cards}</div>
      </section>
    )
  }

  const lines: { link: (typeof links)[number]; x1: number; y1: number; x2: number; y2: number }[] = []
  if (geometry) {
    const ready = links.filter(link => geometry.parties[link.party] && geometry.cards[link.part])
    const mid = (point: Point) => (point.top + point.bottom) / 2
    const spread = (point: Point, index: number, total: number) => {
      if (total <= 1) return mid(point)
      const pad = Math.min(12, (point.bottom - point.top) / 4)
      return point.top + pad + ((point.bottom - point.top - pad * 2) * index) / (total - 1)
    }
    const atParty = new Map<string, typeof ready>()
    const atCard = new Map<string, typeof ready>()
    for (const link of ready) {
      atParty.set(link.party, [...(atParty.get(link.party) ?? []), link])
      atCard.set(link.part, [...(atCard.get(link.part) ?? []), link])
    }
    for (const list of atParty.values()) list.sort((a, b) => mid(geometry.cards[a.part]) - mid(geometry.cards[b.part]) || a.direction.localeCompare(b.direction))
    for (const list of atCard.values()) list.sort((a, b) => mid(geometry.parties[a.party]) - mid(geometry.parties[b.party]) || a.direction.localeCompare(b.direction))
    for (const link of ready) {
      const party = geometry.parties[link.party]
      const card = geometry.cards[link.part]
      const fromList = atParty.get(link.party)!
      const toList = atCard.get(link.part)!
      lines.push({ link, x1: party.x + 6, y1: spread(party, fromList.indexOf(link), fromList.length), x2: card.x - 6, y2: spread(card, toList.indexOf(link), toList.length) })
    }
  }

  return (
    <section ref={outer} className="ade-flow-diagram">
      {head}
      <p className="ade-flow-hint">Left: who takes part. Right: the parts of the work. Lines show the latest flows; a moving dot means the last 30 seconds. Click a part for its details.</p>
      <div ref={grid} className={`ade-flow-grid ${withAside ? "with-aside" : ""}`}>
        <div className="ade-flow-parties">
          {parties.map(party => {
            const state = stateOf(party)
            const sub = subagents.find(entry => entry.id === party)
            const dim = hot !== null && hot !== party && !links.some(link => link.party === party && link.part === hot)
            return (
              <div
                key={party}
                ref={node => { if (node) partyNodes.current.set(party, node); else partyNodes.current.delete(party) }}
                className={`ade-flow-party ${party === "lead" ? "is-lead" : ""} ${dim ? "is-dim" : ""}`}
                onMouseEnter={() => setHot(party)}
                onMouseLeave={() => setHot(null)}
              >
                {party === "user" ? <span className="ade-flow-avatar is-user"><User className="size-3.5" /></span> : party === "lead" ? <Avatar /> : <Avatar harness={sub?.harness ?? "pi"} />}
                <span className="min-w-0">
                  <strong className="ade-truncate">{partyName(party, subagents)}</strong>
                  {state.text ? <span className="ade-flow-party-sub"><span className="ade-flow-dot" style={{ background: state.color }} />{sub?.role ? `${sub.role} · ` : ""}{state.text}</span> : null}
                </span>
              </div>
            )
          })}
        </div>
        <div className="ade-flow-gap" aria-hidden="true" />
        <div className="ade-flow-cards">{cards}</div>
        {withAside ? <div className="ade-flow-aside">{aside}</div> : null}
        {geometry ? (
          <svg className="ade-flow-svg" width={geometry.width} height={geometry.height} aria-hidden="true">
            {lines.map(({ link, x1, y1, x2, y2 }) => {
              const [sx, sy, ex, ey] = link.direction === "in" ? [x1, y1, x2, y2] : [x2, y2, x1, y1]
              const dir = Math.sign(ex - sx) || 1
              const endX = ex - 6 * dir
              const bend = (endX - sx) / 2
              const d = `M${sx},${sy} C${sx + bend},${sy} ${endX - bend},${ey} ${endX},${ey}`
              const headPath = `M${ex},${ey} L${ex - 7 * dir},${ey - 4} L${ex - 7 * dir},${ey + 4} Z`
              const isHot = hot !== null && (hot === link.party || hot === link.part)
              const dim = hot !== null && !isHot
              const color = PART_INFO[link.part].color
              return (
                <g key={`${link.party}|${link.part}|${link.direction}`} className={`ade-flow-line ${link.live ? "is-live" : ""} ${dim ? "is-dim" : ""} ${isHot ? "is-hot" : ""}`} style={{ color }}>
                  <path d={d} className="ade-flow-path" strokeWidth={Math.min(3.2, 1.2 + Math.log2(link.count) * 0.45)} />
                  <path d={headPath} className="ade-flow-arrow" />
                  {link.live ? (
                    <circle r="3.5" className="ade-flow-pulse">
                      <animateMotion dur="1.8s" repeatCount="indefinite" path={d} />
                    </circle>
                  ) : null}
                </g>
              )
            })}
          </svg>
        ) : null}
      </div>
      {!withAside ? <div className="ade-flow-aside is-below">{aside}</div> : null}
    </section>
  )
}

function LatestFlows({ events, subagents, now, onAll }: { events: FlowEvent[]; subagents: SubagentInfo[]; now: number; onAll: () => void }) {
  const latest = [...events].reverse().slice(0, 9)
  return (
    <div className="ade-flow-latest">
      <h4><Activity className="size-3.5" /> Latest flows</h4>
      {latest.length ? <FlowList events={latest} subagents={subagents} now={now} /> : <p className="ade-muted ade-xs">Nothing has happened yet.</p>}
      {events.length > latest.length ? <button type="button" className="ade-flow-all" onClick={onAll}>All flows ({events.length}) →</button> : null}
    </div>
  )
}

function FlowList({ events, subagents, now }: { events: FlowEvent[]; subagents: SubagentInfo[]; now: number }) {
  return (
    <ul className="ade-flow-list">
      {events.map(event => {
        const info = PART_INFO[event.part]
        const who = event.direction === "in" ? partyName(event.from, subagents) : event.to.map(party => partyName(party, subagents)).join(", ")
        return (
          <li key={event.id} style={{ "--part": info.color } as CSSProperties} className={now - event.at < LIVE_MS ? "is-live" : ""}>
            <div className="ade-flow-list-head">
              <span><strong>{info.name}</strong> · {event.direction === "in" ? who : `to ${who}`}</span>
              <span className="ade-muted">{ago(event.at, now)}</span>
            </div>
            <p>{event.text}</p>
          </li>
        )
      })}
    </ul>
  )
}

const COLUMNS: { status: SessionTaskItem["status"]; name: string; color: string }[] = [
  { status: "pending", name: "To do", color: "#60a5fa" },
  { status: "in_progress", name: "In progress", color: "#f5b941" },
  { status: "done", name: "Done", color: "#4ade80" },
  { status: "blocked", name: "Blocked", color: "#f87171" },
]

function PartPage({ part, sessionId, input, events, now, onOpenAgent, onOpenPart, onTeamChanged }: { part: Part; sessionId: string; input: RunInput; events: FlowEvent[]; now: number; onOpenAgent?: (id: string) => void; onOpenPart?: (part: Part) => void; onTeamChanged?: () => void }) {
  const info = PART_INFO[part]
  const of = events.filter(event => event.part === part)
  const intro = <p className="ade-flow-page-intro" style={{ "--part": info.color } as CSSProperties}>{info.hint}</p>
  const team = input.team
  if (part === "tasks" && team?.tasks.length) return <div>{intro}<SharedTaskBoard team={team} subagents={input.subagents} now={now} /></div>
  if (part === "plans" && team) return <div>{intro}<PlansPage sessionId={sessionId} team={team} subagents={input.subagents} now={now} onChanged={onTeamChanged} /></div>
  if (part === "board" && team) return <div>{intro}<BoardPage sessionId={sessionId} team={team} subagents={input.subagents} now={now} onChanged={onTeamChanged} /></div>
  if (part === "claims" && team) {
    return (
      <div>
        {intro}
        <ul className="ade-flow-files">
          {team.claims.map(claim => <li key={`${claim.agent}:${claim.path}`}><code>{claim.path}</code><span className="ade-muted ade-xs">held by {partyName(claim.agent, input.subagents)} · {ago(claim.at, now)}</span></li>)}
          {!team.claims.length ? <li className="ade-muted">No files are claimed right now.</li> : null}
        </ul>
        <FlowList events={[...of].reverse()} subagents={input.subagents} now={now} />
      </div>
    )
  }
  if (part === "tasks") {
    const done = input.tasks.filter(task => task.status === "done").length
    return (
      <div>
        {intro}
        <div className="ade-flow-board-progress"><strong>{done} of {input.tasks.length} done</strong><span className="ade-flow-progress"><span style={{ width: `${input.tasks.length ? (done / input.tasks.length) * 100 : 0}%` }} /></span></div>
        <div className="ade-flow-board">
          {COLUMNS.map(column => {
            const tasks = input.tasks.filter(task => task.status === column.status)
            return (
              <div key={column.status} className="ade-flow-column" style={{ "--col": column.color } as CSSProperties}>
                <h5><span className="ade-flow-dot" style={{ background: column.color }} /> {column.name} <span>{tasks.length}</span></h5>
                {tasks.map((task, index) => (
                  <div key={task.id || index} className="ade-flow-task">
                    <span className="ade-flow-task-id">T{input.tasks.indexOf(task) + 1}</span>
                    <p>{task.title}</p>
                  </div>
                ))}
                {!tasks.length ? <p className="ade-muted ade-xs">—</p> : null}
              </div>
            )
          })}
        </div>
      </div>
    )
  }
  if (part === "handouts" || part === "reports") {
    return (
      <div>
        {intro}
        <ul className="ade-flow-handouts">
          {input.subagents.map(sub => {
            const report = part === "reports" ? of.find(event => event.from === sub.id) : of.find(event => event.direction === "in" && event.subject === sub.name)
            return (
              <li key={sub.id}>
                <button type="button" onClick={() => onOpenAgent?.(sub.id)}>
                  <Avatar harness={sub.harness ?? "pi"} size={24} />
                  <span className="min-w-0">
                    <strong>{sub.name}</strong>
                    <span className="ade-muted ade-xs">{part === "reports" ? (report ? ago(report.at, now) : sub.status === "running" ? "still working" : sub.status) : sub.assignment ? "assignment" : ""}</span>
                    <p>{part === "reports" ? report?.text ?? "No report yet." : sub.assignment || report?.text || ""}</p>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }
  if (part === "changes") {
    const files = new Map<string, { agents: Set<string>; at: number }>()
    for (const event of of) {
      if (!event.subject || event.subject === "commit") continue
      const entry = files.get(event.subject) ?? { agents: new Set<string>(), at: 0 }
      entry.agents.add(event.from)
      entry.at = Math.max(entry.at, event.at)
      files.set(event.subject, entry)
    }
    return (
      <div>
        {intro}
        <ul className="ade-flow-files">
          {[...files].sort((a, b) => b[1].at - a[1].at).map(([path, entry]) => (
            <li key={path}><code>{path}</code><span className="ade-muted ade-xs">{[...entry.agents].map(party => partyName(party, input.subagents)).join(", ")} · {ago(entry.at, now)}</span></li>
          ))}
        </ul>
        {onOpenPart ? <button type="button" className="ade-chip-btn" onClick={() => onOpenPart("changes")}>Review the diff</button> : null}
      </div>
    )
  }
  if (part === "stages" && onOpenPart) {
    return (
      <div>
        {intro}
        <FlowList events={[...of].reverse()} subagents={input.subagents} now={now} />
        <button type="button" className="ade-chip-btn" onClick={() => onOpenPart("stages")}>Open Stages</button>
      </div>
    )
  }
  return (
    <div>
      {intro}
      {of.length ? <FlowList events={[...of].reverse()} subagents={input.subagents} now={now} /> : <p className="ade-muted ade-xs">Nothing yet.</p>}
    </div>
  )
}

const TEAM_COLUMNS: { status: TeamTask["status"]; name: string; color: string }[] = [
  { status: "todo", name: "To do", color: "#60a5fa" },
  { status: "in_progress", name: "In progress", color: "#f5b941" },
  { status: "done", name: "Done", color: "#4ade80" },
  { status: "dropped", name: "Dropped", color: "#a1a1aa" },
]

/** The shared task board as a kanban: owner, what a task waits for, its plan, sent back. */
function SharedTaskBoard({ team, subagents, now }: { team: TeamView; subagents: SubagentInfo[]; now: number }) {
  const [filter, setFilter] = useState<string>("all")
  const owners = [...new Set(team.tasks.map(task => task.owner ?? "anyone"))]
  const shown = team.tasks.filter(task => filter === "all" || (task.owner ?? "anyone") === filter)
  const live = team.tasks.filter(task => task.status !== "dropped")
  const done = live.filter(task => task.status === "done").length
  const doneIds = new Set(team.tasks.filter(task => task.status === "done").map(task => task.id))
  return (
    <>
      <div className="ade-flow-board-progress">
        <strong>{done} of {live.length} done</strong>
        <span className="ade-flow-progress" style={{ "--part": "#4ade80" } as CSSProperties}><span style={{ width: `${live.length ? (done / live.length) * 100 : 0}%` }} /></span>
        <span className="flex-1" />
        <div className="ade-flow-filter">
          {["all", ...owners].map(owner => <button key={owner} type="button" className={filter === owner ? "is-active" : ""} onClick={() => setFilter(owner)}>{owner === "all" ? "All" : owner === "anyone" ? "anyone" : partyName(owner, subagents)}</button>)}
        </div>
      </div>
      <div className="ade-flow-board">
        {TEAM_COLUMNS.map(column => {
          const tasks = shown.filter(task => task.status === column.status)
          return (
            <div key={column.status} className="ade-flow-column" style={{ "--col": column.color } as CSSProperties}>
              <h5><span className="ade-flow-dot" style={{ background: column.color }} /> {column.name} <span>{tasks.length}</span></h5>
              {tasks.map(task => {
                const waits = task.status === "todo" ? task.dependsOn.filter(dep => !doneIds.has(dep)) : []
                return (
                  <div key={task.id} className={`ade-flow-task ${task.status === "dropped" ? "is-dropped" : ""}`} title={task.detail || task.title}>
                    <div className="ade-flow-task-head">
                      <span className="ade-flow-task-id">{task.id}</span>
                      <span className="ade-flow-task-owner">{task.owner ? partyName(task.owner, subagents) : "anyone"}</span>
                      {task.plan ? <span className={`ade-flow-task-badge is-${task.plan.status}`}>{task.plan.status === "waiting" ? "plan awaiting approval" : task.plan.status === "approved" ? "plan approved" : "plan returned"}</span> : null}
                    </div>
                    <p>{task.title}</p>
                    {waits.length ? <span className="ade-flow-task-badge is-waits">⧗ waits for {waits.join(", ")}</span> : null}
                    {task.returnedNote && task.status === "in_progress" ? <span className="ade-flow-task-badge is-returned">↩ sent back</span> : null}
                    {task.result && task.status === "done" ? <span className="ade-flow-task-result">{task.result}</span> : null}
                    <span className="ade-muted ade-xs">Updated {ago(task.updatedAt, now)}{task.dependsOn.length ? ` · ✓ ${task.dependsOn.join(", ")}` : ""}</span>
                  </div>
                )
              })}
              {!tasks.length ? <p className="ade-muted ade-xs">—</p> : null}
            </div>
          )
        })}
      </div>
    </>
  )
}

/** Plans waiting for a decision; you can approve or return them yourself. */
function PlansPage({ sessionId, team, subagents, now, onChanged }: { sessionId: string; team: TeamView; subagents: SubagentInfo[]; now: number; onChanged?: () => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const withPlans = team.tasks.filter(task => task.plan).sort((a, b) => Number(b.plan?.status === "waiting") - Number(a.plan?.status === "waiting") || (b.plan?.at ?? 0) - (a.plan?.at ?? 0))
  const decide = async (taskId: string, decision: "approve" | "return") => {
    setBusy(taskId)
    setError("")
    try {
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/team/plans/${encodeURIComponent(taskId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, note: notes[taskId] ?? "" }) })
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the decision.")
    } finally {
      setBusy(null)
    }
  }
  const toggle = async () => {
    try {
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/team/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ requirePlans: !team.requirePlans }) })
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the setting.")
    }
  }
  return (
    <div className="ade-flow-plans">
      <label className="ade-flow-toggle"><input type="checkbox" checked={team.requirePlans} onChange={() => void toggle()} /> Members show a plan and wait for approval before they work on a task</label>
      {error ? <p className="ade-error-text ade-xs" role="alert">{error}</p> : null}
      {!withPlans.length ? <p className="ade-muted ade-xs">No plans yet.</p> : null}
      {withPlans.map(task => (
        <div key={task.id} className={`ade-flow-plan is-${task.plan!.status}`}>
          <div className="ade-flow-task-head">
            <span className="ade-flow-task-id">{task.id}</span>
            <strong>{task.title}</strong>
            <span className="ade-muted ade-xs">{task.owner ? partyName(task.owner, subagents) : ""} · {ago(task.plan!.at, now)}</span>
            <span className={`ade-flow-task-badge is-${task.plan!.status}`}>{task.plan!.status === "waiting" ? "waiting" : task.plan!.status}</span>
          </div>
          <p className="ade-flow-plan-text">{task.plan!.text}</p>
          {task.plan!.note ? <p className="ade-muted ade-xs">Note: {task.plan!.note}</p> : null}
          {task.plan!.status === "waiting" ? (
            <div className="ade-flow-plan-actions">
              <input value={notes[task.id] ?? ""} onChange={event => setNotes(current => ({ ...current, [task.id]: event.target.value }))} placeholder="A note for the agent (optional; needed to return it)" />
              <button type="button" className="ade-chip-btn" disabled={busy === task.id || !(notes[task.id] ?? "").trim()} onClick={() => void decide(task.id, "return")}>Return</button>
              <button type="button" className="ade-chip-btn is-primary" disabled={busy === task.id} onClick={() => void decide(task.id, "approve")}>Approve</button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** The team board as a conversation; you can post too (an agent reads it with team_read). */
function BoardPage({ sessionId, team, subagents, now, onChanged }: { sessionId: string; team: TeamView; subagents: SubagentInfo[]; now: number; onChanged?: () => void }) {
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (!text.trim()) return
    setSending(true)
    setError("")
    try {
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/team/posts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) })
      setText("")
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post.")
    } finally {
      setSending(false)
    }
  }
  const kindColor: Record<string, string> = { question: "#f5b941", finding: "#60a5fa", answer: "#4ade80", update: "#a1a1aa" }
  return (
    <div className="ade-flow-posts">
      {!team.posts.length ? <p className="ade-muted ade-xs">No posts yet.</p> : null}
      {team.posts.map(post => (
        <div key={post.seq} className={`ade-flow-post ${post.author === "user" ? "is-you" : ""}`}>
          <div className="ade-flow-post-head">
            <strong>{partyName(post.author, subagents)}</strong>
            <span className="ade-flow-post-kind" style={{ color: kindColor[post.kind] }}>{post.kind}</span>
            <span className="ade-muted ade-xs">#{post.seq}{post.re ? ` · re #${post.re}` : ""}{post.to.length && !post.to.includes("all") ? ` · to ${post.to.map(party => partyName(party, subagents)).join(", ")}` : ""}</span>
            <span className="ade-muted ade-xs ml-auto">{ago(post.at, now)}</span>
          </div>
          <p>{post.text}</p>
        </div>
      ))}
      <div className="ade-flow-post-compose">
        <textarea value={text} onChange={event => setText(event.target.value)} rows={2} placeholder="Post on the team board as you, e.g. to answer a question" onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send() }} />
        <button type="button" className="ade-chip-btn is-primary" disabled={sending || !text.trim()} onClick={() => void send()}>{sending ? "Posting…" : "Post"}</button>
      </div>
      {error ? <p className="ade-error-text ade-xs" role="alert">{error}</p> : null}
    </div>
  )
}
