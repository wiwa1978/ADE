import { useEffect, useState } from "react"
import { Bot, Brain, CheckCircle2, ChevronDown, ChevronRight, Clock, GitMerge, Loader2, Maximize2, Minimize2, PauseCircle, Pin, PinOff, XCircle } from "lucide-react"
import { request } from "../../api"
import type { ConversationTimelineSnapshot, SubagentInfo, TimelineItem, TimelineToolCall } from "../../app-types"
import { SubagentPanel } from "../panels/SubagentPanel"
import { clock, type SessionHold } from "../subagents/session-hold"
import { formatDuration, summarize, useAgentsWork, type AgentChanges } from "./agent-summary"

const harnessName: Record<string, string> = { pi: "Pi", "claude-code": "Claude Code", codex: "Codex" }
const LEAD = "lead"

type CardState = { tone: "working" | "waiting" | "done" | "failed" | "idle"; label: string }

function cardState(sub: SubagentInfo, busy: boolean, hold: SessionHold | undefined): CardState {
  const queued = hold?.queued.find(item => item.subagentId === sub.id)
  if (queued) return { tone: "waiting", label: `Queued #${queued.position}` }
  const wait = hold?.usageWaits.find(item => item.subagentId === sub.id)
  if (wait) return { tone: "waiting", label: `Usage limit · ${clock(wait.until)}` }
  if (busy || sub.status === "running") return { tone: "working", label: "Working" }
  if (sub.status === "waiting") return { tone: "waiting", label: "Waiting" }
  if (sub.status === "completed") return { tone: "done", label: "Done" }
  if (sub.status === "failed" || sub.status === "blocked") return { tone: "failed", label: sub.status === "blocked" ? "Blocked" : "Failed" }
  return { tone: "idle", label: "Not started" }
}

const stateIcon = { working: Loader2, waiting: PauseCircle, done: CheckCircle2, failed: XCircle, idle: Clock }

/**
 * Agents: every agent in the session side by side. A card per agent shows, live, what it's doing,
 * its latest reasoning, what it changed and what it cost; below, the selected (or pinned) agents
 * in full: their timeline, their changes with diffs, and steering.
 */
export function AgentsView({
  sessionId,
  leadBusy,
  leadItems,
  leadLiveTools = [],
  subagents,
  subagentTimelines,
  hold,
  wide,
  onToggleWide,
  onMessage,
  onStop,
  onOpenFile,
  onOpenBrowser,
  onOpenExternalBrowser,
}: {
  sessionId: string
  leadBusy: boolean
  leadItems: TimelineItem[]
  leadLiveTools?: TimelineToolCall[]
  subagents: SubagentInfo[]
  subagentTimelines: Record<string, ConversationTimelineSnapshot>
  hold?: SessionHold
  wide: boolean
  onToggleWide: () => void
  onMessage: (subagentId: string, message: string, mode: "steer" | "follow-up") => Promise<void>
  onStop: (subagentId: string) => Promise<void>
  onOpenFile?: (path: string) => void
  onOpenBrowser?: (url?: string) => void
  onOpenExternalBrowser?: (url: string) => void
}) {
  const busyOf = (sub: SubagentInfo) => Boolean(subagentTimelines[sub.id]?.busy) || sub.status === "running"
  const refreshKey = subagents.map(sub => `${sub.id}:${sub.status}`).join(",")
  const work = useAgentsWork(sessionId, refreshKey)
  const [selected, setSelected] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string[]>([])
  // "Now", for how long working agents have been running; ticks every 30 seconds.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const firstWorking = subagents.find(busyOf)?.id ?? subagents.at(-1)?.id ?? LEAD
  const focus = selected && (selected === LEAD || subagents.some(sub => sub.id === selected)) ? selected : firstWorking
  const shownIds = pinned.length ? [...pinned, ...(pinned.includes(focus) ? [] : [focus])].slice(0, 3) : [focus]
  const togglePin = (id: string) => setPinned(list => list.includes(id) ? list.filter(item => item !== id) : [...list, id].slice(-3))

  const working = subagents.filter(busyOf).length + (leadBusy ? 1 : 0)
  const done = subagents.filter(sub => sub.status === "completed").length
  const lead = summarize(leadItems, leadBusy, leadLiveTools)

  return (
    <div className="ade-agents">
      <header className="ade-agents-head">
        <strong>Agents</strong>
        <span className="ade-muted">{[`${subagents.length + 1} in this session`, working ? `${working} working` : "", done ? `${done} done` : ""].filter(Boolean).join(" · ")}</span>
        <span className="flex-1" />
        <button type="button" className="ade-icon-btn" onClick={onToggleWide} title={wide ? "Narrower: more room for the chat" : "Wider: more room for the agents"} aria-label={wide ? "Make the Agents view narrower" : "Make the Agents view wider"}>
          {wide ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </header>

      <div className="ade-agent-cards" role="list">
        <AgentCard
          id={LEAD}
          name="Main agent"
          meta="Pi Durable · leads the session"
          state={leadBusy ? { tone: "working", label: "Working" } : { tone: leadItems.length ? "done" : "idle", label: leadItems.length ? "Idle" : "Not started" }}
          now={lead.now}
          reasoning={lead.reasoning}
          answer={lead.answer}
          steps={lead.steps}
          cost={work?.lead.cost ?? null}
          selected={focus === LEAD}
          pinned={pinned.includes(LEAD)}
          onSelect={() => setSelected(LEAD)}
          onPin={() => togglePin(LEAD)}
        />
        {subagents.map(sub => {
          const busy = busyOf(sub)
          const summary = summarize(subagentTimelines[sub.id]?.items ?? sub.timeline, busy, subagentTimelines[sub.id]?.liveTools ?? sub.liveTools ?? [])
          const agentWork = work?.agents.find(item => item.id === sub.id)
          const started = sub.createdAt ?? null
          const lastItem = (subagentTimelines[sub.id]?.items ?? sub.timeline ?? []).at(-1)
          const ended = busy ? now : lastItem?.createdAt ?? started
          return (
            <AgentCard
              key={sub.id}
              id={sub.id}
              name={sub.name || "Subagent"}
              meta={[sub.role, harnessName[sub.harness ?? "pi"], sub.mode === "worktree" ? "own branch" : sub.mode === "workspace" ? "shared workspace" : "read-only"].filter(Boolean).join(" · ")}
              state={cardState(sub, busy, hold)}
              now={summary.now || (sub.error ?? "")}
              reasoning={summary.reasoning}
              answer={summary.answer || (!busy && !summary.now ? sub.assignment : "")}
              steps={summary.steps}
              cost={agentWork?.cost ?? null}
              duration={started && ended ? ended - started : null}
              changes={agentWork?.changes ?? null}
              selected={focus === sub.id}
              pinned={pinned.includes(sub.id)}
              onSelect={() => setSelected(sub.id)}
              onPin={() => togglePin(sub.id)}
            />
          )
        })}
      </div>

      {!subagents.length ? <p className="ade-muted ade-xs ade-agents-empty">No subagents yet. When the main agent hands out work (or you ask it to, e.g. “use subagents to research X and Y in parallel”), each one appears here with its own live card.</p> : null}

      <div className={`ade-agent-details ${shownIds.length > 1 ? "is-split" : ""}`}>
        {shownIds.map(id => {
          if (id === LEAD) {
            return (
              <section key={id} className="ade-agent-detail">
                <div className="ade-agent-detail-lead">
                  <Bot className="size-4" />
                  <div>
                    <strong>Main agent</strong>
                    <p className="ade-muted ade-xs">Its full conversation is the chat on the left: reasoning, tool calls and answers. {lead.now ? `Now: ${lead.now}.` : ""}</p>
                    {lead.reasoning ? <p className="ade-agent-reasoning"><Brain className="size-3.5" /> {lead.reasoning}</p> : null}
                  </div>
                </div>
              </section>
            )
          }
          const sub = subagents.find(item => item.id === id)
          if (!sub) return null
          const changes = work?.agents.find(item => item.id === id)?.changes ?? null
          return (
            <section key={id} className="ade-agent-detail">
              {changes ? <AgentChangesStrip sessionId={sessionId} sub={sub} changes={changes} busy={busyOf(sub)} /> : null}
              <div className="ade-agent-detail-timeline">
                <SubagentPanel
                  subagent={sub}
                  liveTimeline={subagentTimelines[sub.id]}
                  onMessage={onMessage}
                  onStop={onStop}
                  onOpenFile={onOpenFile}
                  onOpenBrowser={onOpenBrowser}
                  onOpenExternalBrowser={onOpenExternalBrowser}
                />
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function AgentCard(props: {
  id: string
  name: string
  meta: string
  state: CardState
  now: string
  reasoning: string
  answer: string
  steps: number
  cost: number | null
  duration?: number | null
  changes?: AgentChanges | null
  selected: boolean
  pinned: boolean
  onSelect: () => void
  onPin: () => void
}) {
  const Icon = stateIcon[props.state.tone]
  return (
    <div role="listitem" className={`ade-agent-card is-${props.state.tone} ${props.selected ? "is-selected" : ""}`}>
      <button type="button" className="ade-agent-card-main" onClick={props.onSelect} aria-pressed={props.selected}>
        <span className="ade-agent-card-head">
          <span className="ade-agent-card-name">{props.name}</span>
          <span className={`ade-agent-state is-${props.state.tone}`}><Icon className={`size-3 ${props.state.tone === "working" ? "animate-spin" : ""}`} /> {props.state.label}</span>
        </span>
        <span className="ade-agent-card-meta">{props.meta}</span>
        {props.now ? <span className="ade-agent-now">{props.now}</span> : null}
        {props.reasoning ? <span className="ade-agent-reasoning"><Brain className="size-3 shrink-0" /> <span>{props.reasoning}</span></span> : null}
        {props.answer && !props.reasoning ? <span className="ade-agent-answer">{props.answer}</span> : null}
        <span className="ade-agent-card-foot">
          {props.changes ? (
            <span title={`${props.changes.files.length} files changed, ${props.changes.commits} commits`}>
              <span className="ade-plus">+{props.changes.added}</span> <span className="ade-minus">−{props.changes.removed}</span> · {props.changes.files.length} {props.changes.files.length === 1 ? "file" : "files"}
            </span>
          ) : null}
          {props.steps ? <span>{props.steps} {props.steps === 1 ? "step" : "steps"}</span> : null}
          {props.duration ? <span>{formatDuration(props.duration)}</span> : null}
          {props.cost ? <span>${props.cost.toFixed(2)}</span> : null}
        </span>
      </button>
      <button type="button" className={`ade-agent-pin ${props.pinned ? "is-on" : ""}`} onClick={props.onPin} title={props.pinned ? "Unpin" : "Pin: keep it open next to others (up to 3)"} aria-label={props.pinned ? `Unpin ${props.name}` : `Pin ${props.name}`}>
        {props.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
      </button>
    </div>
  )
}

/** A worktree subagent's changes on its branch: the files, each file's diff, and merging into the session. */
function AgentChangesStrip({ sessionId, sub, changes, busy }: { sessionId: string; sub: SubagentInfo; changes: AgentChanges; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [diff, setDiff] = useState("")
  const [merging, setMerging] = useState(false)
  const [message, setMessage] = useState("")

  const showDiff = async (path: string) => {
    if (openFile === path) { setOpenFile(null); return }
    setOpenFile(path)
    setDiff("Loading…")
    try {
      const result = await request<{ diff: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(sub.id)}/diff?file=${encodeURIComponent(path)}`)
      setDiff(result.diff || "No differences.")
    } catch (err) {
      setDiff(err instanceof Error ? err.message : "Could not load the diff.")
    }
  }

  const merge = async () => {
    if (!window.confirm(`Merge ${sub.name}'s branch (${sub.branch}) into the session's branch?`)) return
    setMerging(true)
    try {
      const result = await request<{ merged: boolean; message: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(sub.id)}/merge`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      setMessage(result.message)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not merge.")
    } finally {
      setMerging(false)
    }
  }

  return (
    <div className="ade-agent-changes">
      <div className="ade-agent-changes-head">
        <button type="button" className="ade-agent-changes-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <strong>Changes on {sub.branch}</strong>
          <span className="ade-muted"><span className="ade-plus">+{changes.added}</span> <span className="ade-minus">−{changes.removed}</span> · {changes.files.length} {changes.files.length === 1 ? "file" : "files"}{changes.commits ? ` · ${changes.commits} ${changes.commits === 1 ? "commit" : "commits"}` : ""}</span>
        </button>
        <span className="flex-1" />
        {changes.files.length && !busy ? (
          <button type="button" className="ade-chip-btn" disabled={merging} onClick={() => void merge()} title="Bring this subagent's work into the session's branch">
            <GitMerge className="size-3" /> {merging ? "Merging…" : "Merge into session"}
          </button>
        ) : null}
      </div>
      {message ? <p className="ade-agent-changes-message ade-xs" role="status">{message}</p> : null}
      {open ? (
        <ul className="ade-agent-files">
          {changes.files.map(file => (
            <li key={file.path}>
              <button type="button" className={`ade-agent-file ${openFile === file.path ? "is-open" : ""}`} onClick={() => void showDiff(file.path)}>
                <span className={`ade-agent-file-status is-${file.status}`}>{file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M"}</span>
                <span className="ade-mono ade-truncate flex-1">{file.path}</span>
                <span className="ade-plus">+{file.added}</span> <span className="ade-minus">−{file.removed}</span>
              </button>
              {openFile === file.path ? (
                <div className="ade-agent-diff">
                  <pre>{diff.split("\n").map((line, index) => <span key={index} className={line.startsWith("+") && !line.startsWith("+++") ? "is-add" : line.startsWith("-") && !line.startsWith("---") ? "is-del" : line.startsWith("@@") ? "is-hunk" : ""}>{line}{"\n"}</span>)}</pre>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
