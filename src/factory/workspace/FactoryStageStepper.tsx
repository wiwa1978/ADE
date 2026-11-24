import { Badge } from "../../../components/ui/index.ts"
import type { FactoryRunDetail } from "../types"

interface FactoryStageStepperProps {
  run: FactoryRunDetail
}

export function FactoryStageStepper({ run }: FactoryStageStepperProps) {
  return (
    <div className="sf-stepper">
      {run.blueprint.stages.map((stage, idx) => {
        const st = run.run.stages[idx]
        const isCurrent = idx === run.run.currentStageIndex && run.run.status !== "completed"
        const isDone = st?.status === "completed"
        return (
          <div
            key={stage.id}
            className={`sf-step-item ${isCurrent ? "is-current" : ""} ${isDone ? "is-done" : ""}`}
          >
            <div className="flex items-center justify-between gap-1 font-semibold">
              <span>{idx + 1}. {stage.name}</span>
              <span className="text-[10px] opacity-65 font-normal">{st?.status ?? "pending"}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge>{stage.requiresSandbox ? "Sandbox" : "Brain $0"}</Badge>
              {stage.contextIsolation === "goldfish" ? <Badge tone="accent">Goldfish</Badge> : null}
            </div>
            {st?.resolvedModel ? (
              <div className="font-mono text-[10px] opacity-65 truncate">
                {st.resolvedModel.ref.provider}/{st.resolvedModel.ref.model}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
