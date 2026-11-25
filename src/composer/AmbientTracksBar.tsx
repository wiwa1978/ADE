import { useState } from "react"
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Columns2,
  FileDiff,
  FileText,
  GitBranch,
  ListChecks,
  Loader2,
  Shield,
  Square,
  Terminal,
} from "lucide-react"
import type {
  ApprovalPolicy,
  ManagedProcessSummary,
  PendingApproval,
  SessionArtifact,
  SessionTaskItem,
  SubagentInfo,
  WorkspaceGitSummary,
} from "../../app-types"
import { formatUsage } from "../usage/usage-data"
import { useI18n } from "../i18n/I18nContext"

export function AmbientTracksBar({
  subagents,
  gitSummary,
  tasks,
  artifacts,
  processes,
  approvals,
  approvalPolicy,
  hasWorkspace,
  onOpenSubagent,
  onStopSubagent,
  onOpenDiff,
  onOpenArtifact,
  onOpenProcesses,
  onChangeApprovalPolicy,
  usage,
  onOpenProgress,
}: {
  subagents: SubagentInfo[]
  gitSummary: WorkspaceGitSummary
  tasks: SessionTaskItem[]
  artifacts: SessionArtifact[]
  processes: ManagedProcessSummary[]
  approvals: PendingApproval[]
  approvalPolicy: ApprovalPolicy
  hasWorkspace: boolean
  onOpenSubagent: (id: string) => void
  onStopSubagent: (id: string) => void
  onOpenDiff: () => void
  onOpenArtifact: (id?: string) => void
  onOpenProcesses: () => void
  onChangeApprovalPolicy: (policy: ApprovalPolicy) => void
  /** This session's tokens and cost so far. */
  usage?: { inputTokens: number; outputTokens: number; totalCost?: number } | null
  /** Open the Progress panel (from the tasks pill). */
  onOpenProgress?: () => void
}) {
  const { t, formatNumber } = useI18n()
  const [expandedTrack, setExpandedTrack] = useState<"subagents" | "tasks" | null>(null)

  const runningSubagents = subagents.filter(s => s.status === "running" || s.status === "waiting")
  const runningProcesses = processes.filter(p => p.status === "running")
  const doneTasks = tasks.filter(t => t.status === "done").length
  const pendingArtifact = artifacts.find(a => a.status === "awaiting_approval")

  const nextPolicy: Record<ApprovalPolicy, ApprovalPolicy> = {
    "auto-safe": "ask",
    ask: "auto-all",
    "auto-all": "auto-safe",
  }
  const policyLabels: Record<ApprovalPolicy, string> = {
    "auto-safe": t("wsx.comp.policyAutoSafe"),
    ask: t("wsx.comp.policyAsk"),
    "auto-all": t("wsx.comp.policyAutoAll"),
  }

  return (
    <div className="ade-tracks-wrap">
      {expandedTrack === "subagents" && subagents.length > 0 ? (
        <div className="ade-track-drawer">
          <div className="ade-track-drawer-head">
            <span>{t("wsx.comp.subagentsCount", { count: subagents.length })}</span>
            <button type="button" className="ade-icon-btn" onClick={() => setExpandedTrack(null)} aria-label={t("wsx.comp.collapseSubagents")}>
              <ChevronDown className="size-3.5" />
            </button>
          </div>
          <div className="ade-subagent-strip">
            {subagents.map(sub => {
              const activeTool = sub.liveTools?.find(tool => tool.status === "running" || tool.status === "pending")
              return (
                <div key={sub.id} className={`ade-subagent-tile ${sub.status === "running" ? "is-running" : ""}`}>
                  <div className="ade-subagent-tile-top">
                    <span className={`ade-dot ade-dot-${sub.status}`} />
                    <strong className="ade-truncate">{sub.name}</strong>
                    <span className="ade-pill">{sub.mode ?? "readonly"}</span>
                    {sub.branch ? (
                      <span className="ade-pill ade-mono"><GitBranch className="size-2.5" /> {sub.branch}</span>
                    ) : null}
                  </div>
                  <div className="ade-subagent-tile-desc ade-truncate">
                    {activeTool
                      ? t("wsx.comp.runningTool", { name: activeTool.name })
                      : sub.assignment || sub.role || t("wsx.comp.assignedSubagent")}
                  </div>
                  <div className="ade-subagent-tile-actions">
                    <button type="button" className="ade-chip-btn" onClick={() => onOpenSubagent(sub.id)}>
                      <Columns2 className="size-3" /> {t("wsx.comp.inspectBeside")}
                    </button>
                    {sub.status === "running" || sub.status === "waiting" ? (
                      <button type="button" className="ade-chip-btn ade-chip-danger" onClick={() => onStopSubagent(sub.id)}>
                        <Square className="size-3" /> {t("wsx.comp.stop")}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {expandedTrack === "tasks" && tasks.length > 0 ? (
        <div className="ade-track-drawer">
          <div className="ade-track-drawer-head">
            <span>{t("wsx.comp.sessionChecklist", { done: doneTasks, total: tasks.length })}</span>
            <button type="button" className="ade-icon-btn" onClick={() => setExpandedTrack(null)} aria-label={t("wsx.comp.collapseChecklist")}>
              <ChevronDown className="size-3.5" />
            </button>
          </div>
          <ul className="ade-task-checklist">
            {tasks.map(task => (
              <li key={task.id} className={`ade-task-item is-${task.status}`}>
                {task.status === "done" ? <CheckCircle2 className="size-3.5 text-[var(--ok)]" />
                  : task.status === "in_progress" ? <Loader2 className="size-3.5 animate-spin text-[var(--accent)]" />
                  : <Circle className="size-3.5 opacity-50" />}
                <span>{task.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="ade-tracks-bar" role="toolbar" aria-label={t("wsx.comp.sessionContextTracks")}>
        {/* Subagents Track Pill */}
        {subagents.length > 0 ? (
          <button
            type="button"
            className={`ade-track-pill ${runningSubagents.length > 0 ? "is-active" : ""}`}
            onClick={() => setExpandedTrack(v => v === "subagents" ? null : "subagents")}
          >
            {runningSubagents.length > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
            <span>
              {runningSubagents.length > 0
                ? (subagents.length === 1
                  ? t("wsx.comp.runningSubagentsOne", { running: runningSubagents.length })
                  : t("wsx.comp.runningSubagentsMany", { running: runningSubagents.length, total: subagents.length }))
                : (subagents.length === 1
                  ? t("wsx.comp.subagentCountOne")
                  : t("wsx.comp.subagentCountMany", { count: subagents.length }))}
            </span>
            {expandedTrack === "subagents" ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
          </button>
        ) : null}

        {/* Git Diff Stat Pill (Paseo-inspired) */}
        {hasWorkspace && gitSummary.isGitRepo ? (
          <button type="button" className="ade-track-pill" onClick={onOpenDiff} title={t("wsx.comp.reviewGitChanges")}>
            <FileDiff className="size-3.5" />
            {gitSummary.files.length > 0 ? (
              <>
                <span className="ade-diff-add">+{gitSummary.additions}</span>
                <span className="ade-diff-del">-{gitSummary.deletions}</span>
                <span className="ade-muted">
                  {gitSummary.files.length === 1
                    ? t("wsx.comp.filesCountOne")
                    : t("wsx.comp.filesCountMany", { count: gitSummary.files.length })}
                </span>
              </>
            ) : (
              <span>{t("wsx.comp.cleanBranch", { branch: gitSummary.branch || "git" })}</span>
            )}
          </button>
        ) : null}

        {/* Checklist / Tasks Pill */}
        {tasks.length > 0 ? (
          <button
            type="button"
            className="ade-track-pill"
            onClick={() => (onOpenProgress ? onOpenProgress() : setExpandedTrack(v => v === "tasks" ? null : "tasks"))}
          >
            <ListChecks className="size-3.5" />
            <span>{t("wsx.comp.tasksProgress", { done: doneTasks, total: tasks.length })}</span>
          </button>
        ) : null}

        {/* Artifacts Pill */}
        {artifacts.length > 0 ? (
          <button
            type="button"
            className={`ade-track-pill ${pendingArtifact ? "is-warn" : ""}`}
            onClick={() => onOpenArtifact(pendingArtifact?.id ?? artifacts[0]?.id)}
          >
            <FileText className="size-3.5" />
            <span>
              {pendingArtifact
                ? t("wsx.comp.reviewArtifact", { title: pendingArtifact.title })
                : artifacts.length === 1
                  ? t("wsx.comp.artifactsCountOne")
                  : t("wsx.comp.artifactsCountMany", { count: artifacts.length })}
            </span>
          </button>
        ) : null}

        {/* Background Processes Pill */}
        {processes.length > 0 ? (
          <button
            type="button"
            className={`ade-track-pill ${runningProcesses.length > 0 ? "is-active" : ""}`}
            onClick={onOpenProcesses}
          >
            {runningProcesses.length > 0 ? <Activity className="size-3.5" /> : <Terminal className="size-3.5" />}
            <span>
              {runningProcesses.length > 0
                ? t("wsx.comp.runningCmdCount", { count: runningProcesses.length })
                : processes.length === 1
                  ? t("wsx.comp.cmdLogsOne")
                  : t("wsx.comp.cmdLogsMany", { count: processes.length })}
            </span>
          </button>
        ) : null}

        {/* Pending Approvals indicator */}
        {approvals.length > 0 ? (
          <span className="ade-track-pill is-warn">
            <Shield className="size-3.5" />{" "}
            {approvals.length === 1
              ? t("wsx.comp.approvalsWaitingOne")
              : t("wsx.comp.approvalsWaitingMany", { count: approvals.length })}
          </span>
        ) : null}

        {usage && (usage.inputTokens || usage.outputTokens) ? (
          <span
            className="ade-usage-chip ade-track-pill-right"
            title={t("wsx.comp.usageTooltip", { input: formatNumber(usage.inputTokens), output: formatNumber(usage.outputTokens) })}
          >
            {formatUsage({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: usage.totalCost ?? 0 })}
          </span>
        ) : null}

        {/* Approval Policy quick-cycle pill */}
        <button
          type="button"
          className="ade-track-pill ade-track-pill-right"
          onClick={() => onChangeApprovalPolicy(nextPolicy[approvalPolicy])}
          title={t("wsx.comp.cycleApprovalPolicy")}
        >
          <Shield className="size-3" />
          <span>{policyLabels[approvalPolicy]}</span>
        </button>
      </div>
    </div>
  )
}
