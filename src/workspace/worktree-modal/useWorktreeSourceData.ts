import { useEffect, useState } from "react"
import { request } from "../../../api"
import type { GitHubIssue, StartFrom, TaskStart } from "../../../app-types"
import type { RunTarget } from "../../run-targets"

export type EngineId = "pi" | "claude-code" | "codex"
export type CreateFromTab = "prompt" | "github" | "branch" | "name"

export type BranchItem = { name: string; current?: boolean }
export type OpenIssueItem = {
  number: number
  title: string
  body: string
  state: "open" | "closed"
  url: string
  repository: string
}
export type OpenPullItem = { number: number; title: string; headRefName?: string }

export interface WorktreeCreatePayload {
  projectId: string | null
  kind: TaskStart["kind"]
  repository: string
  prompt: string
  githubIssue?: GitHubIssue
  engine: EngineId
  startFrom?: StartFrom
  title?: string
  attempts?: EngineId[]
  runOn?: RunTarget
}

export function buildWorktreeCreatePayload({
  projectId,
  kind,
  effectiveRepo,
  fromTab,
  queryText,
  selectedBranch,
  selectedPr,
  selectedIssue,
  engine,
  runOn,
  attempts,
}: {
  projectId: string | null
  kind: TaskStart["kind"]
  effectiveRepo: string
  fromTab: CreateFromTab
  queryText: string
  selectedBranch: string
  selectedPr: OpenPullItem | null
  selectedIssue: OpenIssueItem | null
  engine: EngineId
  runOn: RunTarget
  attempts: number
}): WorktreeCreatePayload {
  const trimmed = queryText.trim()
  let startFrom: StartFrom | undefined
  let title: string | undefined
  let promptText = trimmed

  if (fromTab === "branch" && (selectedBranch || trimmed)) {
    const br = selectedBranch || trimmed
    startFrom = { branch: br }
    title = br
    promptText = ""
  } else if (fromTab === "github" && selectedPr) {
    startFrom = { pullRequest: selectedPr.number }
    title = `PR #${selectedPr.number}: ${selectedPr.title}`
    promptText = trimmed || `Review and work on pull request #${selectedPr.number}: ${selectedPr.title}`
  } else if (fromTab === "github" && selectedIssue) {
    title = `#${selectedIssue.number}: ${selectedIssue.title}`
    promptText = `Work on #${selectedIssue.number}: ${selectedIssue.title}\n\n${selectedIssue.body}`
  } else if (fromTab === "name" && trimmed) {
    title = trimmed
    promptText = `Set up workspace for: ${trimmed}`
  }

  return {
    projectId,
    kind,
    repository: kind === "none" ? "" : effectiveRepo,
    prompt: promptText,
    githubIssue: selectedIssue ? { ...selectedIssue, truncated: false } : undefined,
    engine,
    ...(startFrom ? { startFrom } : {}),
    ...(title ? { title } : {}),
    ...(kind !== "none" ? { runOn } : {}),
    ...(kind === "worktree" && !startFrom && attempts > 1 ? { attempts: Array.from({ length: attempts }, () => engine) } : {}),
  }
}

export function useWorktreeSourceData({
  projectId,
  activeRepo,
  activeGithubUrl,
  fromTab,
}: {
  projectId: string
  activeRepo: string
  activeGithubUrl: string
  fromTab: CreateFromTab
}) {
  const [baseBranch, setBaseBranch] = useState("origin/main")
  const [branches, setBranches] = useState<BranchItem[]>([])
  const [issues, setIssues] = useState<OpenIssueItem[]>([])
  const [pulls, setPulls] = useState<OpenPullItem[]>([])

  useEffect(() => {
    if (!projectId || !activeRepo) return
    const controller = new AbortController()
    let cancelled = false
    void request<{ branches?: (string | BranchItem)[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/branches`,
      { signal: controller.signal },
    )
      .then(res => {
        if (cancelled) return
        const normalized = (res.branches ?? []).map(b => (typeof b === "string" ? { name: b } : b))
        setBranches(normalized)
        const def = normalized.find(b => /^(origin\/)?(main|master)$/.test(b.name))
        if (def) setBaseBranch(def.name)
      })
      .catch(() => { if (!cancelled) setBranches([]) })
    return () => { cancelled = true; controller.abort() }
  }, [projectId, activeRepo])

  useEffect(() => {
    if (!projectId || !activeGithubUrl || fromTab !== "github") return
    const controller = new AbortController()
    let cancelled = false
    void Promise.all([
      request<{ issues?: OpenIssueItem[] }>(`/api/projects/${encodeURIComponent(projectId)}/issues?state=open`, { signal: controller.signal }).catch(() => ({ issues: [] })),
      request<{ pullRequests?: OpenPullItem[] }>(`/api/projects/${encodeURIComponent(projectId)}/pulls?state=open`, { signal: controller.signal }).catch(() => ({ pullRequests: [] })),
    ]).then(([issRes, prRes]) => {
      if (cancelled) return
      setIssues(issRes.issues ?? [])
      setPulls(prRes.pullRequests ?? [])
    })
    return () => { cancelled = true; controller.abort() }
  }, [projectId, activeGithubUrl, fromTab])

  return {
    branches: projectId && activeRepo ? branches : [],
    baseBranch,
    setBaseBranch,
    issues: projectId && activeGithubUrl ? issues : [],
    pulls: projectId && activeGithubUrl ? pulls : [],
  }
}
