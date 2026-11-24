import { useState, type FormEvent } from "react"
import { request, requestJson } from "./api"

type Worktree = {
  path: string
  head: string | null
  branch: string | null
  detached: boolean
  bare: boolean
  locked: boolean
  prunable: boolean
}

type WorktreeOperation = {
  id: string
  repository: string
  branch: string
  base: string
  commitHash: string
  target: string
  status: "running" | "completed" | "attention"
  message: string
  createdAt: number
  filters: string
}

export function useWorktrees() {
  const [repository, setRepository] = useState("")
  const [inspectedRepository, setInspectedRepository] = useState("")
  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [worktreeOperations, setWorktreeOperations] = useState<WorktreeOperation[]>([])
  const [worktreeError, setWorktreeError] = useState("")
  const [inspecting, setInspecting] = useState(false)

  async function inspectRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInspecting(true)
    setWorktreeError("")
    try {
      const result = await requestJson<{ worktrees: Worktree[] }>("/api/worktrees/inspect", "POST", { repository: repository.trim() })
      setInspectedRepository(repository.trim())
      setWorktrees(result.worktrees)
      const operations = await request<{ operations: WorktreeOperation[] }>("/api/worktree-operations")
      setWorktreeOperations(operations.operations)
    } catch (cause) {
      setWorktreeError(cause instanceof Error ? cause.message : "Could not inspect the repository.")
    } finally {
      setInspecting(false)
    }
  }

  return { repository, setRepository, inspectedRepository, worktrees, worktreeOperations, worktreeError, inspecting, inspectRepository }
}
