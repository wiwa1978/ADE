import { useEffect, useMemo, useRef } from "react"
import { Activity, Bot, CircleDot, FileDiff, FileText, FolderTree, GitPullRequest, Globe, ListChecks, Play, ScrollText, Terminal, Users, Workflow } from "lucide-react"
import type {
  BrowserState, Conversation, ConversationTimelineSnapshot, ManagedProcessSummary,
  SessionArtifact, SessionBlueprintSummary, SessionTaskItem, SubagentInfo, WorkspaceGitSummary, WorkspaceTab,
} from "../../../app-types"
import type { SidePanelItem } from "../SidePanelMenu"
import { publishSessionTools } from "../../layout/session-tools"
import type { RunStatus } from "../../panels/RunPanel"
import type { PullRequestInfo } from "../../panels/PullRequestPanel"
import { formatShortcut, type KeybindingMap } from "../../keybindings"

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
    openTeam, openAgents, openProgress, openFiles, openDiff, openRun, openIssues,
    openPullRequest, openTerminal, openBrowser, openArtifact, openTranscript, openProcesses,
  } = params

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
      ...(hasWorkspace ? [{ id: "team", label: "Team", description: "Under the hood: who takes part, the data flow between them and the latest flows, live", icon: Users, onOpen: openTeam, live: isBusy || runningSubagentsCount > 0, active: is("team") }] : []),
      ...(subagents.length ? [{ id: "agents", label: "Agents", description: "Every agent side by side: what each is doing, thinking and changed", icon: Bot, onOpen: openAgents, badge: runningSubagentsCount || undefined, live: runningSubagentsCount > 0, active: is("agents") || is("subagent") }] : []),
      ...(subagents.length || progressTotal > 1 ? [{ id: "progress", label: "Progress", description: "A table of every agent and task and how far each is", icon: ListChecks, onOpen: openProgress, badge: `${progressDone}/${progressTotal}`, active: is("progress"), menuOnly: true }] : []),
      ...(blueprint ? [{ id: "stages", label: "Stages", description: `${blueprint.name.replace(/\s*\(.*\)$/, "")}: where the work is and what waits for you`, icon: Workflow, onOpen: () => { onCloseToolsTab(); onOpenStagesDrawer() }, badge: `${blueprint.done}/${blueprint.total}`, attention: blueprint.stage?.status === "awaiting_approval", active: stagesActive }] : []),
      ...(hasWorkspace ? [
        { id: "files", label: "Files", description: "Browse and open the workspace's files", icon: FolderTree, onOpen: openFiles, active: is("files") },
        { id: "changes", label: "Changes", description: "Review the agent's changes and the branch diff", icon: FileDiff, onOpen: openDiff, badge: gitSummary.files.length || undefined, active: is("diff") },
        { id: "run", label: "Run", description: "Start the app with the project's run script", icon: Play, onOpen: openRun, live: runStatus?.run === "running", active: is("run") },
        ...(session.projectId ? [{ id: "issues", label: "Issues", description: "The project's open GitHub issues; start a session on one", icon: CircleDot, onOpen: openIssues, active: is("issues") }] : []),
        ...(session.workspace?.kind !== "none" ? [{ id: "pr", label: pullRequest ? `Pull request #${pullRequest.number}` : "Pull request", description: "Push, open and merge a pull request", icon: GitPullRequest, onOpen: openPullRequest, active: is("pr") }] : []),
      ] : []),
      { id: "terminal", label: "Terminal", description: `A shell in the workspace (${terminalShortcut} opens it in the drawer)`, icon: Terminal, onOpen: openTerminal, active: is("terminal") },
      { id: "browser", label: "Browser", description: "The built-in browser the agent can drive", icon: Globe, onOpen: openBrowser, live: browserState.agentDriving, active: is("browser") },
      ...(artifacts.length || hasWorkspace ? [{ id: "artifacts", label: "Artefacts", description: "Session artefacts: files, plans and images", icon: FileText, onOpen: openArtifact, badge: artifacts.length || undefined, active: is("artifact") }] : []),
      { id: "transcript", label: "Transcript", description: "Step through what the agent did, or export the session", icon: ScrollText, onOpen: openTranscript, active: is("transcript") },
      ...(runningProcessesCount ? [{ id: "processes", label: "Processes", description: "Commands the agent left running", icon: Activity, onOpen: openProcesses, badge: runningProcessesCount, live: true, active: is("processes") }] : []),
    ]
  }, [
    activeKind, hasWorkspace, isBusy, runningSubagentsCount, subagents.length, progressDone, progressTotal,
    blueprint, stagesActive, gitSummary.files.length, runStatus?.run, session.projectId, session.workspace?.kind,
    pullRequest, terminalShortcut, browserState.agentDriving, artifacts.length, runningProcessesCount,
    openTeam, openAgents, openProgress, onCloseToolsTab, onOpenStagesDrawer, openFiles, openDiff,
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
