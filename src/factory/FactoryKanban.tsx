import { Bot, GitPullRequest, Play, Plus, ShieldCheck, Sparkles } from "lucide-react"
import { classifyKanbanColumn, KANBAN_COLUMNS, type FactoryRunDetail } from "./types"

export function FactoryKanban({
  runs,
  selectedRunId,
  onSelectRun,
  onAutoRun,
  onNewRun,
}: {
  runs: FactoryRunDetail[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  onAutoRun: (runId: string) => void
  onNewRun: () => void
}) {
  return (
    <div className="sf-kanban-wrap">
      {KANBAN_COLUMNS.map(col => {
        const items = runs.filter(r => classifyKanbanColumn(r) === col.id)
        return (
          <section key={col.id} className="sf-kanban-col" aria-label={col.title}>
            <div className="sf-kanban-col-head">
              <div>
                <div className="sf-kanban-col-title">{col.title}</div>
                <div className="sf-kanban-col-hint">{col.hint}</div>
              </div>
              <span className="sf-badge sf-badge-muted">{items.length}</span>
            </div>

            <div className="sf-kanban-list">
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[rgb(var(--border)/0.7)] px-3 py-6 text-center text-xs opacity-60">
                  {col.id === "triage" ? (
                    <button type="button" className="sf-btn-ghost mx-auto" onClick={onNewRun}>
                      <Plus className="size-3.5" /> Add issue
                    </button>
                  ) : (
                    "No active items"
                  )}
                </div>
              ) : (
                items.map(detail => {
                  const stage = detail.blueprint.stages[detail.run.currentStageIndex]
                  const activeSub = detail.subagents.find(s => s.status === "running")
                  const isSelected = detail.run.runId === selectedRunId
                  const title = detail.run.issueRef
                    ? `#${detail.run.issueRef.number} ${detail.run.issueRef.title}`
                    : detail.taskPrompt.split("\n")[0].slice(0, 72)

                  return (
                    <article
                      key={detail.run.runId}
                      onClick={() => onSelectRun(detail.run.runId)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onSelectRun(detail.run.runId) }}
                      className={`sf-kanban-card ${isSelected ? "is-selected" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[12.5px] font-semibold leading-snug line-clamp-2">{title}</div>
                        {detail.autoRunning || activeSub ? (
                          <span className="sf-pulse-dot shrink-0 mt-1" title="Running" />
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="sf-badge sf-badge-muted">{detail.blueprint.name}</span>
                        <span className={`sf-badge ${detail.sandboxMode === "detached" ? "sf-badge-ok" : "sf-badge-warn"}`}>
                          {detail.sandboxMode === "detached" ? "Brain $0" : detail.sandboxMode}
                        </span>
                        {detail.modelConfig.compliance.euOnlyMode ? (
                          <span className="sf-badge sf-badge-eu">
                            <ShieldCheck className="size-3" /> EU
                          </span>
                        ) : null}
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11.5px] opacity-80">
                        <span className="truncate flex items-center gap-1.5">
                          <Bot className="size-3.5 shrink-0 opacity-70" />
                          {activeSub ? activeSub.name : stage ? stage.name : "Completed"}
                        </span>
                        <span className="font-mono text-[10.5px] opacity-65 shrink-0">
                          {detail.subagents.length} run{detail.subagents.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      {detail.pendingEscalations.length > 0 ? (
                        <div className="rounded-md bg-[rgb(var(--primary)/0.14)] px-2.5 py-1.5 text-[11px] font-medium flex items-center gap-1.5 text-[rgb(var(--primary))]">
                          <Sparkles className="size-3 shrink-0" />
                          <span className="truncate">{detail.pendingEscalations[0].title}</span>
                        </div>
                      ) : null}

                      {detail.prUrl ? (
                        <div className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono truncate">
                          <GitPullRequest className="size-3.5 shrink-0" /> PR published
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between pt-2 border-t border-[rgb(var(--border)/0.65)] text-[11px]">
                        <span className="font-mono opacity-65">
                          ${detail.telemetry.actualUsd.toFixed(3)}
                        </span>
                        {detail.run.status !== "completed" && !detail.autoRunning && detail.run.status !== "awaiting_human" ? (
                          <button
                            type="button"
                            className="sf-btn-secondary !h-6 !px-2 !text-[11px]"
                            onClick={e => {
                              e.stopPropagation()
                              onAutoRun(detail.run.runId)
                            }}
                          >
                            <Play className="size-2.5" /> Auto-Run
                          </button>
                        ) : (
                          <span className="opacity-65">{detail.autoRunning ? "Working…" : "Open →"}</span>
                        )}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
