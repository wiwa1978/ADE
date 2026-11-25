import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Loader2, Pencil, Sparkles } from "lucide-react"
import type { Conversation, ConversationTimelineSnapshot, SessionTaskItem, SubagentInfo, TimelineItem, TimelineToolCall } from "../../app-types"
import type { TeamView } from "../flow/team-types"
import { useAgentsWork } from "../agents/agent-summary"
import { SwarmGraph } from "./SwarmGraph"
import { buildSwarmModel } from "./swarm-model"
import { MemberBadge } from "./MemberBadge"
import { GoalCard } from "./GoalCard"
import { ThreadCard } from "./ThreadCard"
import { SwarmBoardTab } from "./SwarmBoardTab"
import { SwarmMembersTab } from "./SwarmMembersTab"
import { useI18n } from "../i18n/I18nContext"

type SwarmTab = "overview" | "board" | "members" | "graph"

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
  const { t } = useI18n()
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
            {model.live ? t("swx.swarm.view.live") : allDone ? t("swx.swarm.view.done") : t("swx.swarm.view.idle")}
          </span>
        </div>

        <nav className="ade-swarm-tabs" role="tablist" aria-label={t("swx.swarm.view.tabsAria")}>
          <button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "is-active" : ""} onClick={() => setTab("overview")}>
            {t("swx.swarm.view.tabOverview")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "board"} className={tab === "board" ? "is-active" : ""} onClick={() => setTab("board")}>
            {t("swx.swarm.view.tabBoard")} {model.boardBadge > 0 ? <span className="ade-swarm-tab-count">{model.boardBadge}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === "members"} className={tab === "members" ? "is-active" : ""} onClick={() => setTab("members")}>
            {t("swx.swarm.view.tabMembers")} <span className="ade-swarm-tab-count">{model.members.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "graph"} className={tab === "graph" ? "is-active" : ""} onClick={() => setTab("graph")}>
            {t("swx.swarm.view.tabGraph")}
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
              <section className="ade-swarm-card ade-swarm-running" aria-label={t("swx.swarm.view.runningAria")}>
                <div className="ade-swarm-running-head">
                  <span className="ade-swarm-status-dot is-moving" />
                  <strong>{t("swx.swarm.view.running")}</strong>
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
                  <strong>{t("swx.swarm.view.emptyTitle")}</strong>
                </div>
                <p className="ade-muted">
                  {t("swx.swarm.view.emptyBodyBefore")}<code>/swarm</code>{t("swx.swarm.view.emptyBodyAfter")}
                </p>
                {props.onAskAgent ? (
                  <div className="ade-swarm-empty-actions">
                    <button
                      type="button"
                      className="ade-chip-btn is-primary"
                      onClick={() => void props.onAskAgent?.("/swarm")}
                    >
                      <Sparkles className="size-3.5" /> {t("swx.swarm.view.startInChat")}
                    </button>
                    <button type="button" className="ade-chip-btn" onClick={() => setEditingGoal(true)}>
                      <Pencil className="size-3.5" /> {t("swx.swarm.view.setGoal")}
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
                  <strong>{t("swx.swarm.view.tasksOfTotal", { done: model.tasksDone, total: model.tasksTotal })}</strong>
                  <span className="ade-muted">{t("swx.swarm.view.tasksDone")}</span>
                </span>
                <span className="ade-swarm-progress-right">
                  <span className="ade-muted">
                    {model.openThreads === 1
                      ? t("swx.swarm.view.openThreadsOne", { count: model.openThreads })
                      : t("swx.swarm.view.openThreadsOther", { count: model.openThreads })}
                  </span>
                  {threadsOpen ? <ChevronDown className="size-4 ade-muted" /> : <ChevronRight className="size-4 ade-muted" />}
                </span>
              </button>
            ) : null}

            {threadsOpen && model.threads.length > 0 ? (
              <section className="ade-swarm-threads" aria-label={t("swx.swarm.view.threads")}>
                <h3 className="ade-swarm-section-title">{t("swx.swarm.view.threads")}</h3>
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
