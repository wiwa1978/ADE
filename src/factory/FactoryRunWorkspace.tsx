import type { BrowserState } from "../../app-types"
import type { FactoryRunDetail } from "./types"
import { FactoryCaptainFeed } from "./workspace/FactoryCaptainFeed"
import { FactoryRunToolbar } from "./workspace/FactoryRunToolbar"
import { FactoryStageStepper } from "./workspace/FactoryStageStepper"
import { FactoryWorkbenchTabs } from "./workspace/FactoryWorkbenchTabs"

export function FactoryRunWorkspace({
  run,
  environmentId,
  terminalFontSize,
  terminalScrollback,
  browserState,
  busy,
  onBackToKanban,
  onAction,
  onSteer,
  onBrowserStateChange,
  onOpenExternal,
}: {
  run: FactoryRunDetail
  environmentId: string
  terminalFontSize: number
  terminalScrollback: number
  browserState: BrowserState
  busy: boolean
  onBackToKanban: () => void
  onAction: (action: "step" | "auto-run" | "approve" | "pause" | "takeover", body?: Record<string, unknown>) => Promise<void>
  onSteer: (note: string) => Promise<void>
  onBrowserStateChange: (state: BrowserState) => void
  onOpenExternal: (url: string) => Promise<void>
}) {
  const title = run.run.issueRef
    ? `#${run.run.issueRef.number} ${run.run.issueRef.title}`
    : run.taskPrompt.split("\n")[0].slice(0, 80)

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <FactoryRunToolbar
        title={title}
        run={run}
        busy={busy}
        onBackToKanban={onBackToKanban}
        onAction={onAction}
      />

      <FactoryStageStepper run={run} />

      <div className="sf-workspace-split">
        <FactoryCaptainFeed
          run={run}
          busy={busy}
          onAction={onAction}
          onSteer={onSteer}
        />

        <FactoryWorkbenchTabs
          run={run}
          environmentId={environmentId}
          terminalFontSize={terminalFontSize}
          terminalScrollback={terminalScrollback}
          browserState={browserState}
          onBrowserStateChange={onBrowserStateChange}
          onOpenExternal={onOpenExternal}
        />
      </div>
    </div>
  )
}
