import { useCallback, useEffect, useState } from "react"
import type { SessionArtifact, SubagentInfo, WorkspaceTab } from "../../../app-types"
import type { PullRequestInfo } from "../../panels/PullRequestPanel"
import { tabsForNextSession } from "../side-panel-tabs"

export function useBesideTabs(params: {
  sessionId: string
  hasWorkspace: boolean
  subagents: SubagentInfo[]
  artifacts: SessionArtifact[]
  externalOpenRequest: WorkspaceTab | null
  onClearExternalOpenRequest: () => void
  onCloseBottomDrawer: () => void
  onWidenForTeam: () => void
}) {
  const {
    sessionId,
    hasWorkspace,
    subagents,
    artifacts,
    externalOpenRequest,
    onClearExternalOpenRequest,
    onCloseBottomDrawer,
    onWidenForTeam,
  } = params

  const [besideTabs, setBesideTabs] = useState<WorkspaceTab[]>([])
  const [besideHidden, setBesideHidden] = useState(false)
  const [activeBesideId, setActiveBesideId] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<"working" | "branch" | "history">("working")
  const [pullRequest, setPullRequest] = useState<PullRequestInfo | null>(null)
  const [prevSessionId, setPrevSessionId] = useState(sessionId)
  const [prevExternalRequest, setPrevExternalRequest] = useState<WorkspaceTab | null>(null)
  const [prevSubCount, setPrevSubCount] = useState(subagents.length)

  // Switching sessions keeps the side panel open: the same tabs, now about the new session.
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId)
    const next = tabsForNextSession(besideTabs, activeBesideId, hasWorkspace)
    setBesideTabs(next.tabs)
    setActiveBesideId(next.activeId)
    setPullRequest(null)
  }

  if (externalOpenRequest && externalOpenRequest !== prevExternalRequest) {
    setPrevExternalRequest(externalOpenRequest)
    setBesideHidden(false)
    setBesideTabs(prev => {
      const existing = prev.find(t => t.id === externalOpenRequest.id)
      if (existing) return prev.map(t => (t.id === externalOpenRequest.id ? { ...t, ...externalOpenRequest } : t))
      return [...prev, { ...externalOpenRequest, closable: true }]
    })
    setActiveBesideId(externalOpenRequest.id)
  } else if (!externalOpenRequest && prevExternalRequest !== null) {
    setPrevExternalRequest(null)
  }

  useEffect(() => {
    if (!externalOpenRequest) return
    onClearExternalOpenRequest()
  }, [externalOpenRequest, onClearExternalOpenRequest])

  if (subagents.length !== prevSubCount) {
    const grew = subagents.length > prevSubCount
    setPrevSubCount(subagents.length)
    if (grew) {
      const newest = subagents[subagents.length - 1]
      if (newest && newest.status === "running" && besideTabs.length === 0) {
        const tab: WorkspaceTab = { id: "agents", kind: "agents", title: "Agents", closable: true }
        setBesideTabs([tab])
        setActiveBesideId(tab.id)
      }
    }
  }

  const openBeside = useCallback((tab: WorkspaceTab) => {
    setBesideHidden(false)
    setBesideTabs(prevTabs => {
      // Picking something from the menu replaces the menu tab.
      const prev = tab.kind === "tools" ? prevTabs : prevTabs.filter(t => t.kind !== "tools")
      const existing = prev.find(t => t.id === tab.id)
      if (existing) return prev.map(t => (t.id === tab.id ? { ...t, ...tab } : t))
      return [...prev, { ...tab, closable: true }]
    })
    setActiveBesideId(tab.id)
  }, [])

  const closeBesideTab = useCallback((id: string) => {
    setBesideTabs(prev => {
      const idx = prev.findIndex(t => t.id === id)
      const next = prev.filter(t => t.id !== id)
      setActiveBesideId(curr => {
        if (curr !== id) return curr
        if (next.length === 0) return null
        return next[Math.min(idx, next.length - 1)].id
      })
      return next
    })
  }, [])

  const closeAllBeside = useCallback(() => {
    setBesideTabs([])
    setActiveBesideId(null)
  }, [])

  const openSubagent = useCallback((subagentId: string) => {
    const found = subagents.find(s => s.id === subagentId)
    openBeside({ id: `subagent:${subagentId}`, kind: "subagent", title: found?.name || "Subagent", subagentId })
  }, [subagents, openBeside])

  const openFile = useCallback((filePath: string) => {
    const shortName = filePath.split("/").pop() || filePath
    openBeside({ id: `file:${filePath}`, kind: "file", title: shortName, filePath })
  }, [openBeside])

  const openFiles = useCallback(() => openBeside({ id: "files", kind: "files", title: "Files" }), [openBeside])
  const openDiff = useCallback((mode: "working" | "branch" | "history" = "working") => {
    setDiffMode(mode)
    openBeside({ id: "diff", kind: "diff", title: "Changes" })
  }, [openBeside])
  const openRun = useCallback(() => openBeside({ id: "run", kind: "run", title: "Run" }), [openBeside])
  const openTranscript = useCallback(() => openBeside({ id: "transcript", kind: "transcript", title: "Transcript" }), [openBeside])
  const openProgress = useCallback(() => openBeside({ id: "progress", kind: "progress", title: "Progress" }), [openBeside])
  const openAgents = useCallback(() => openBeside({ id: "agents", kind: "agents", title: "Agents" }), [openBeside])
  const openTeam = useCallback(() => {
    openBeside({ id: "team", kind: "team", title: "Team" })
    onWidenForTeam()
  }, [openBeside, onWidenForTeam])
  const openIssues = useCallback(() => openBeside({ id: "issues", kind: "issues", title: "Issues" }), [openBeside])
  const openSideMenu = useCallback(() => openBeside({ id: "tools", kind: "tools", title: "Open…" }), [openBeside])
  const openBrowser = useCallback((url?: string) => {
    openBeside({ id: "browser", kind: "browser", title: "Browser", ...(url ? { initialUrl: url } : {}) })
  }, [openBeside])
  const openArtifact = useCallback((artifactId?: string) => {
    const art = artifactId ? artifacts.find(a => a.id === artifactId) : undefined
    openBeside({ id: "artifact", kind: "artifact", title: art?.title || "Artefacts", artifactId: art?.id })
  }, [artifacts, openBeside])
  const openTerminal = useCallback((another = false) => {
    onCloseBottomDrawer()
    if (!another) {
      const existing = [...besideTabs].reverse().find(t => t.kind === "terminal")
      openBeside(existing ?? { id: "terminal", kind: "terminal", title: "Terminal" })
      return
    }
    const count = besideTabs.filter(t => t.kind === "terminal").length
    openBeside({ id: `terminal:${Date.now()}`, kind: "terminal", title: `Terminal ${count + 1}` })
  }, [besideTabs, openBeside, onCloseBottomDrawer])
  const openPullRequest = useCallback(() => openBeside({ id: "pr", kind: "pr", title: "Pull request" }), [openBeside])
  const openProcesses = useCallback(() => openBeside({ id: "processes", kind: "processes", title: "Processes" }), [openBeside])

  const activeBesideTab = besideTabs.find(t => t.id === activeBesideId) ?? null
  const showBeside = besideTabs.length > 0 && activeBesideTab !== null && !besideHidden

  return {
    besideTabs,
    activeBesideTab,
    showBeside,
    diffMode,
    pullRequest,
    setPullRequest,
    setBesideHidden,
    setActiveBesideId,
    openBeside,
    closeBesideTab,
    closeAllBeside,
    openSubagent,
    openFile,
    openFiles,
    openDiff,
    openRun,
    openTranscript,
    openProgress,
    openAgents,
    openTeam,
    openIssues,
    openSideMenu,
    openBrowser,
    openArtifact,
    openTerminal,
    openPullRequest,
    openProcesses,
  }
}
