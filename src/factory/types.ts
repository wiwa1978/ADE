import type {
  EscalationCard,
  FactoryBlueprint,
  ModelProfileId,
  ModelRoutingConfig,
} from "../../app-types"

export type FactoryStageLog = {
  timestamp: number
  stageId: string
  level: "info" | "warn" | "error"
  message: string
}

export type FactorySubagentRecord = {
  id: string
  stageId: string
  name: string
  role: string
  contextIsolation: "elephant" | "goldfish"
  model: string
  status: "running" | "completed" | "changes_requested" | "failed"
  startedAt: number
  endedAt?: number
  summary: string
  output: string
}

export type FactoryRunDetail = {
  run: {
    runId: string
    projectId: string
    blueprintId: string
    issueRef?: { repository: string; number: number; title: string; url: string }
    status: string
    currentStageIndex: number
    stages: {
      stageId: string
      status: string
      attempt: number
      sandboxAttached: boolean
      resolvedModel?: { ref: { provider: string; model: string }; euCompliant: boolean }
      verdict?: { outcome: string; summary: string }
    }[]
    auditLoopbacksUsed: number
  }
  blueprint: FactoryBlueprint
  repoPath: string
  worktreePath: string | null
  githubRepo?: string
  baseBranch: string
  workBranch: string
  taskPrompt: string
  modelConfig: ModelRoutingConfig
  sandboxMode: "docker" | "worktree" | "detached"
  sandboxId: string | null
  autoRunning: boolean
  pausedByHuman: boolean
  humanTakeOver: boolean
  diff: string
  prUrl: string | null
  steeringNotes: string[]
  subagents: FactorySubagentRecord[]
  pendingEscalations: EscalationCard[]
  logs: FactoryStageLog[]
  telemetry: {
    actualInputTokens: number
    actualOutputTokens: number
    actualUsd: number
    toolSchemasPruned: number
    loopInterventions: number
  }
  crossFamilyVerified: boolean
  lastError: string | null
}

export type FactoryCapabilities = {
  flavor: "local" | "remote"
  captainHost: string
  region: string
  blueprints: { id: string; name: string; bestFor: string }[]
  modelProfiles: { id: ModelProfileId; name: string; euCompliantByDefault: boolean }[]
}

export type KanbanColumnId =
  | "triage"
  | "plan"
  | "build"
  | "audit"
  | "approval"
  | "done"

export const KANBAN_COLUMNS: { id: KanbanColumnId; title: string; hint: string }[] = [
  { id: "triage", title: "Triage & Spec", hint: "Brain-only ($0 VM)" },
  { id: "plan", title: "Plan & Design", hint: "Architecture & DAG" },
  { id: "build", title: "Building", hint: "Subagents in sandbox" },
  { id: "audit", title: "Verify & Goldfish", hint: "Tests + independent review" },
  { id: "approval", title: "Needs Approval / PR", hint: "Human checkpoint" },
  { id: "done", title: "Done", hint: "PR published" },
]

export function classifyKanbanColumn(detail: FactoryRunDetail): KanbanColumnId {
  const status = detail.run.status
  if (status === "completed") return "done"
  if (status === "awaiting_human" || detail.pendingEscalations.length > 0) return "approval"

  const currentStage = detail.blueprint.stages[detail.run.currentStageIndex]
  const id = currentStage?.id ?? ""

  if (["publish_pr", "archive_and_pr", "scribe_and_pr"].includes(id)) return "approval"
  if (["verify", "tester_verify", "review", "drift_audit", "quality_audit"].includes(id)) return "audit"
  if (["implement", "specialist_build"].includes(id)) return "build"
  if (["plan", "tasks", "spec_audit", "draft"].includes(id)) return "plan"
  return "triage"
}
