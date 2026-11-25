import { CheckCircle2, Clock, ExternalLink, GitBranch, GitMerge, Loader2, PauseCircle, Square, XCircle } from "lucide-react"
import type { ConversationTimelineSnapshot, SubagentInfo } from "../app-types"
import { useAgentsWork, formatDuration, type AgentChanges } from "../agents/agent-summary"
import { SubagentPanel } from "../panels/SubagentPanel"
import { buildSwarmModel, type SwarmMember } from "./swarm-model"
import { MemberBadge } from "./MemberBadge"
import { useMergeSubagent } from "../agents/useMergeSubagent"
import { useI18n } from "../i18n/I18nContext"

export function SwarmMembersTab({
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
  const { t } = useI18n()
  const { merge, merging, message } = useMergeSubagent(sessionId, sub)
  return (
    <button type="button" className="ade-chip-btn" disabled={merging} onClick={() => void merge()} title={message || t("ag.mergeFiles", { count: changes.files.length })}>
      <GitMerge className="size-3" /> {message ? message : merging ? t("ag.merging") : t("ag.mergeInto")}
    </button>
  )
}
