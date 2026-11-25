import { Columns2, Terminal, Workflow, X } from "lucide-react"
import { TerminalPanel } from "../../../TerminalPanel"
import type { SessionBlueprintSummary } from "../../../app-types"
import { StagesPanel, WayOfWorkingSelect } from "../../blueprints/StagesPanel"
import { StageBar } from "../../blueprints/StageBar"
import type { SessionStages } from "../../blueprints/session-stages"

export function WorkspaceBottomDrawer({
  sessionId,
  environmentId,
  hasWorkspace,
  terminalCwd,
  isBusy,
  blueprint,
  blueprintLocked,
  stages,
  onStagesChange,
  mounted,
  open,
  height,
  showStagesTab,
  activeDrawerTab,
  terminalStarted,
  terminalAutoStart,
  terminalFontSize,
  terminalScrollback,
  onSelectTab,
  onStartResize,
  onOpenStagesDrawer,
  onOpenTerminalSidePane,
  onClose,
  onOpenFile,
  onOpenProgress,
}: {
  sessionId: string
  environmentId: string
  hasWorkspace: boolean
  terminalCwd: string
  isBusy: boolean
  blueprint: SessionBlueprintSummary | null
  blueprintLocked: boolean
  stages: SessionStages | null
  onStagesChange: (next: SessionStages) => void
  mounted: boolean
  open: boolean
  height: number
  showStagesTab: boolean
  activeDrawerTab: "stages" | "terminal"
  terminalStarted: boolean
  terminalAutoStart: boolean
  terminalFontSize: number
  terminalScrollback: number
  onSelectTab: (tab: "stages" | "terminal") => void
  onStartResize: () => void
  onOpenStagesDrawer: () => void
  onOpenTerminalSidePane: () => void
  onClose: () => void
  onOpenFile?: (path: string) => void
  onOpenProgress: () => void
}) {
  return (
    <>
      {mounted ? (
        <section
          className="ade-bottom-drawer"
          style={{ height: `${height}px` }}
          hidden={!open}
          aria-label="Stages and terminal"
        >
          <div
            className="ade-bottom-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            onPointerDown={onStartResize}
            title="Drag to resize terminal"
          />
          <div className="ade-bottom-drawer-head">
            <div className="flex items-center gap-1 min-w-0" role="tablist" aria-label="Drawer">
              {showStagesTab ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeDrawerTab === "stages"}
                  className={`ade-drawer-tab ${activeDrawerTab === "stages" ? "is-active" : ""}`}
                  onClick={() => onSelectTab("stages")}
                >
                  <Workflow className="size-3.5" /> Stages
                  {blueprint?.stage?.status === "awaiting_approval" ? (
                    <span className="ade-drawer-tab-dot" aria-label="Waiting for you" />
                  ) : null}
                </button>
              ) : null}
              <button
                type="button"
                role="tab"
                aria-selected={activeDrawerTab === "terminal"}
                className={`ade-drawer-tab ${activeDrawerTab === "terminal" ? "is-active" : ""}`}
                onClick={() => onSelectTab("terminal")}
              >
                <Terminal className="size-3.5" /> Terminal
              </button>
              {activeDrawerTab === "terminal" ? <span className="ade-pill ade-mono ade-truncate">{terminalCwd}</span> : null}
            </div>
            <div className="flex items-center gap-1.5">
              {!blueprint && stages && hasWorkspace ? (
                <WayOfWorkingSelect
                  sessionId={sessionId}
                  current={stages.blueprintId}
                  currentName={stages.name}
                  locked={blueprintLocked}
                  busy={isBusy}
                  onChanged={next => { onStagesChange(next); onSelectTab("stages") }}
                />
              ) : null}
              {activeDrawerTab === "terminal" ? (
                <button
                  type="button"
                  className="ade-chip-btn"
                  onClick={onOpenTerminalSidePane}
                  title="Open terminal in a side-by-side split pane"
                >
                  <Columns2 className="size-3" /> Side pane
                </button>
              ) : null}
              <button
                type="button"
                className="ade-icon-btn"
                onClick={onClose}
                aria-label="Close drawer"
                title="Close drawer (Cmd+J)"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          {activeDrawerTab === "stages" && stages ? (
            <div className="ade-drawer-body">
              <StagesPanel
                sessionId={sessionId}
                stages={stages}
                busy={isBusy}
                locked={blueprintLocked}
                onChanged={onStagesChange}
                onOpenFile={hasWorkspace ? onOpenFile : undefined}
                onOpenProgress={onOpenProgress}
              />
            </div>
          ) : null}
          {terminalStarted ? (
            <div className="ade-terminal-pane-wrap" hidden={activeDrawerTab !== "terminal"}>
              <TerminalPanel
                environmentId={environmentId}
                workspaceKey={`${sessionId}:bottom`}
                cwd={terminalCwd}
                visible={open && activeDrawerTab === "terminal"}
                autoStart={terminalAutoStart}
                fontSize={terminalFontSize}
                scrollback={terminalScrollback}
              />
            </div>
          ) : null}
        </section>
      ) : null}
      {/* When the drawer is closed, a blueprint session keeps its current stage in view. */}
      {blueprint && !open ? <StageBar blueprint={blueprint} onOpen={onOpenStagesDrawer} /> : null}
    </>
  )
}
