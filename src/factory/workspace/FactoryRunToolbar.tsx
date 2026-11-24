import { ArrowLeft, Hand, Pause, Play, StepForward } from "lucide-react"
import { Badge, Button } from "../../../components/ui/index.ts"
import type { FactoryRunDetail } from "../types"

interface FactoryRunToolbarProps {
  title: string
  run: FactoryRunDetail
  busy: boolean
  onBackToKanban: () => void
  onAction: (action: "step" | "auto-run" | "approve" | "pause" | "takeover", body?: Record<string, unknown>) => Promise<void>
}

export function FactoryRunToolbar({
  title,
  run,
  busy,
  onBackToKanban,
  onAction,
}: FactoryRunToolbarProps) {
  const canStep = !busy && !run.autoRunning && !run.pausedByHuman && run.run.status !== "completed" && run.run.status !== "awaiting_human"

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-[rgb(var(--border)/0.8)] bg-[rgb(var(--surface)/0.5)]">
      <div className="flex items-center gap-2.5 min-w-0">
        <Button variant="ghost" size="sm" onClick={onBackToKanban}>
          <ArrowLeft className="size-3.5" /> Kanban
        </Button>
        <span className="opacity-30">/</span>
        <span className="text-[13px] font-semibold truncate">{title}</span>
        <Badge tone="accent" size="sm">{run.run.status}</Badge>
        <Badge tone={run.sandboxMode === "detached" ? "ok" : "warn"} size="sm">
          {run.sandboxMode === "detached" ? "Brain $0" : `Sandbox: ${run.sandboxMode}`}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={!canStep} onClick={() => void onAction("auto-run")}>
          <Play className="size-3.5" /> {run.autoRunning ? "Auto-Running…" : "Auto-Run"}
        </Button>
        <Button variant="secondary" size="sm" disabled={!canStep} onClick={() => void onAction("step")}>
          <StepForward className="size-3.5" /> Step
        </Button>
        <Button variant="secondary" size="sm" disabled={busy || run.pausedByHuman} onClick={() => void onAction("pause")}>
          <Pause className="size-3.5" /> Pause
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void onAction("takeover", { enable: !run.humanTakeOver })}>
          <Hand className="size-3.5" /> {run.humanTakeOver ? "Release Takeover" : "Take Over"}
        </Button>
      </div>
    </div>
  )
}
