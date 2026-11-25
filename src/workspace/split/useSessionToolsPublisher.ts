import { useEffect, useMemo, useRef } from "react"
import { Activity, Bot, CircleDot, FileDiff, FileText, FolderTree, GitPullRequest, Globe, ListChecks, Network, Play, ScrollText, Terminal, Users, Workflow } from "lucide-react"
import type {
  BrowserState, Conversation, ConversationTimelineSnapshot, ManagedProcessSummary,
  SessionArtifact, SessionBlueprintSummary, SessionTaskItem, SubagentInfo, WorkspaceGitSummary, WorkspaceTab,
} from "../../../app-types"
import type { SidePanelItem } from "../SidePanelMenu"
import { publishSessionTools } from "../../layout/session-tools"
import type { RunStatus } from "../../panels/RunPanel"
import type { PullRequestInfo } from "../../panels/PullRequestPanel"
import { formatShortcut, type KeybindingMap } from "../../keybindings"
import { useI18n } from "../../i18n/I18nContext"

export function useSessionToolsPublisher(params: {
  session: Conversation
  timeline: ConversationTimelineSnapshot | null
  subagents: SubagentInfo[]
  tasks: SessionTaskItem[]
  artifacts: SessionArtifact[]
  processes: ManagedProcessSummary[]
  gitSummary: WorkspaceGitSummary
  browserState: BrowserState
  blueprint: SessionBlueprintSummary | null
  runStatus: RunStatus | null
  pullRequest: PullRequestInfo | null
  hasWorkspace: boolean
  isBusy: boolean
  activeKind: WorkspaceTab["kind"] | null
  stagesActive: boolean
  keybindings: KeybindingMap
  onCloseBottomDrawer: () => void
  onHideBeside: () => void
  onOpenStagesDrawer: () => void
  onCloseToolsTab: () => void
  openSwarm: () => void
  openTeam: () => void
  openAgents: () => void
  openProgress: () => void
  openFiles: () => void
  openDiff: () => void
  openRun: () => void
  openIssues: () => void
  openPullRequest: () => void
  openTerminal: () => void
  openBrowser: () => void
  openArtifact: () => void
  openTranscript: () => void
  openProcesses: () => void
}): SidePanelItem[] {
  const {
    session, timeline, subagents, tasks, artifacts, processes, gitSummary, browserState,
    blueprint, runStatus, pullRequest, hasWorkspace, isBusy, activeKind, stagesActive,
    keybindings, onCloseBottomDrawer, onHideBeside, onOpenStagesDrawer, onCloseToolsTab,
    openSwarm, openTeam, openAgents, openProgress, openFiles, openDiff, openRun, openIssues,
    openPullRequest, openTerminal, openBrowser, openArtifact, openTranscript, openProcesses,
  } = params
  const { t } = useI18n()

  const progressDone = (timeline?.items.length && !isBusy && session.lastTurnStatus !== "failed" ? 1 : 0)
    + subagents.filter(sub => sub.status === "completed").length
    + tasks.filter(task => task.status === "done").length
  const progressTotal = 1 + subagents.length + tasks.length
  const runningSubagentsCount = subagents.filter(s => s.status === "running" || s.status === "waiting").length
  const runningProcessesCount = processes.filter(p => p.status === "running").length
  const terminalShortcut = keybindings.toggleTerminal ? formatShortcut(keybindings.toggleTerminal) : "⌘J"

  const sidePanelItems = useMemo<SidePanelItem[]>(() => {
    const is = (kind: WorkspaceTab["kind"]) => activeKind === kind
    return [
      ...(hasWorkspace ? [{ id: "swarm", label: t("tool.swarm.label"), description: t("tool.swarm.desc"), icon: Network, onOpen: openSwarm, badge: runningSubagentsCount || undefined, live: isBusy || runningSubagentsCount > 0, active: is("swarm") }] : []),
      ...(hasWorkspace ? [{ id: "team", label: t("tool.team.label"), description: t("tool.team.desc"), icon: Users, onOpen: openTeam, live: isBusy || runningSubagentsCount > 0, active: is("team") }] : []),
      ...(subagents.length ? [{ id: "agents", label: t("tool.agents.label"), description: t("tool.agents.desc"), icon: Bot, onOpen: openAgents, badge: runningSubagentsCount || undefined, live: runningSubagentsCount > 0, active: is("agents") || is("subagent") }] : []),
      ...(subagents.length || progressTotal > 1 ? [{ id: "progress", label: t("tool.progress.label"), description: t("tool.progress.desc"), icon: ListChecks, onOpen: openProgress, badge: `${progressDone}/${progressTotal}`, active: is("progress"), menuOnly: true }] : []),
      ...(blueprint ? [{ id: "stages", label: t("tool.stages.label"), description: t("tool.stages.desc", { name: blueprint.name.replace(/\s*\(.*\)$/, "") }), icon: Workflow, onOpen: () => { onCloseToolsTab(); onOpenStagesDrawer() }, badge: `${blueprint.done}/${blueprint.total}`, attention: blueprint.stage?.status === "awaiting_approval", active: stagesActive }] : []),
      ...(hasWorkspace ? [
        { id: "files", label: t("tool.files.label"), description: t("tool.files.desc"), icon: FolderTree, onOpen: openFiles, active: is("files") },
        { id: "changes", label: t("tool.changes.label"), description: t("tool.changes.desc"), icon: FileDiff, onOpen: openDiff, badge: gitSummary.files.length || undefined, active: is("diff") },
        { id: "run", label: t("tool.run.label"), description: t("tool.run.desc"), icon: Play, onOpen: openRun, live: runStatus?.run === "running", active: is("run") },
        ...(session.projectId ? [{ id: "issues", label: t("tool.issues.label"), description: t("tool.issues.desc"), icon: CircleDot, onOpen: openIssues, active: is("issues") }] : []),
        ...(session.workspace?.kind !== "none" ? [{ id: "pr", label: pullRequest ? t("tool.pr.labelNumber", { number: pullRequest.number }) : t("tool.pr.label"), description: t("tool.pr.desc"), icon: GitPullRequest, onOpen: openPullRequest, active: is("pr") }] : []),
      ] : []),
      { id: "terminal", label: t("tool.terminal.label"), description: t("tool.terminal.desc", { shortcut: terminalShortcut }), icon: Terminal, onOpen: openTerminal, active: is("terminal") },
      { id: "browser", label: t("tool.browser.label"), description: t("tool.browser.desc"), icon: Globe, onOpen: openBrowser, live: browserState.agentDriving, active: is("browser") },
      ...(artifacts.length || hasWorkspace ? [{ id: "artifacts", label: t("tool.artifacts.label"), description: t("tool.artifacts.desc"), icon: FileText, onOpen: openArtifact, badge: artifacts.length || undefined, active: is("artifact") }] : []),
      { id: "transcript", label: t("tool.transcript.label"), description: t("tool.transcript.desc"), icon: ScrollText, onOpen: openTranscript, active: is("transcript") },
      ...(runningProcessesCount ? [{ id: "processes", label: t("tool.processes.label"), description: t("tool.processes.desc"), icon: Activity, onOpen: openProcesses, badge: runningProcessesCount, live: true, active: is("processes") }] : []),
    ]
  }, [
    t, activeKind, hasWorkspace, isBusy, runningSubagentsCount, subagents.length, progressDone, progressTotal,
    blueprint, stagesActive, gitSummary.files.length, runStatus?.run, session.projectId, session.workspace?.kind,
    pullRequest, terminalShortcut, browserState.agentDriving, artifacts.length, runningProcessesCount,
    openSwarm, openTeam, openAgents, openProgress, onCloseToolsTab, onOpenStagesDrawer, openFiles, openDiff,
    openRun, openIssues, openPullRequest, openTerminal, openBrowser, openArtifact, openTranscript, openProcesses,
  ])

  const toolHandlersRef = useRef<Map<string, () => void>>(new Map())
  const latestItemsRef = useRef<SidePanelItem[]>(sidePanelItems)
  useEffect(() => {
    latestItemsRef.current = sidePanelItems
    const nextHandlers = new Map<string, () => void>()
    for (const item of sidePanelItems) {
      nextHandlers.set(
        item.id,
        item.active
          ? (item.id === "stages" ? onCloseBottomDrawer : onHideBeside)
          : item.onOpen,
      )
    }
    toolHandlersRef.current = nextHandlers
  })

  const toolsSignature = sidePanelItems
    .map(i => `${i.id}|${i.label}|${i.description}|${i.badge ?? ""}|${i.live ? 1 : 0}|${i.attention ? 1 : 0}|${i.active ? 1 : 0}|${i.menuOnly ? 1 : 0}`)
    .join(";")

  useEffect(() => {
    publishSessionTools(
      latestItemsRef.current.map(item => ({
        ...item,
        onOpen: () => toolHandlersRef.current.get(item.id)?.(),
      })),
    )
  }, [toolsSignature])

  useEffect(() => () => publishSessionTools([]), [])

  return sidePanelItems
}
