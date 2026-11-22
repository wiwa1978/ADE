import { useState } from "react"
import { Maximize2, Play, Send, Workflow, X } from "lucide-react"
import type { FactoryRunDetail } from "../factory/types"

export function LiveFactoryRunPane({
  detail,
  focused,
  onFocus,
  onMaximize,
  onClose,
  onAction,
}: {
  detail: FactoryRunDetail
  focused: boolean
  onFocus: () => void
  onMaximize: () => void
  onClose: () => void
  onAction: (runId: string, action: "step" | "approve" | "pause" | "steer", note?: string) => Promise<void>
}) {
  const [steerText, setSteerText] = useState("")
  const [busy, setBusy] = useState(false)
  const { run, subagents, blueprint: bp, taskPrompt } = detail
  const currentStage = run.stages[run.currentStageIndex]
  const currentStageId = currentStage?.stageId ?? bp.stages[0]?.id ?? "stage"

  return (
    <section
      className={`ade-stream-pane ${focused ? "is-focused" : ""}`}
      onClick={onFocus}
    >
      <header className="ade-stream-pane-head">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`ade-dot ade-dot-${
              run.status === "running"
                ? "running"
                : run.status === "completed"
                  ? "completed"
                  : run.status === "failed"
                    ? "failed"
                    : "waiting"
            }`}
          />
          <Workflow className="size-3.5 opacity-75 shrink-0" />
          <span className="text-[12.5px] font-semibold truncate">
            {run.issueRef?.number ? `#${run.issueRef.number} · ` : ""}
            {run.issueRef?.title || taskPrompt || run.runId.slice(0, 8)}
          </span>
          <span className="ade-pill ade-pill-accent !text-[10.5px]">{currentStageId}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className="ade-icon-btn !w-6 !h-6"
            title="Open full Factory Run workspace"
            onClick={e => { e.stopPropagation(); onMaximize() }}
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="ade-icon-btn !w-6 !h-6"
            title="Close pane"
            onClick={e => { e.stopPropagation(); onClose() }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="ade-stream-pane-body">
        {bp ? (
          <div className="flex flex-wrap items-center gap-1">
            {bp.stages.map(st => {
              const isCurrent = st.id === currentStageId
              return (
                <span
                  key={st.id}
                  className={`ade-pill !text-[10.5px] ${isCurrent ? "ade-pill-accent font-semibold" : ""}`}
                >
                  {st.name || st.id}
                </span>
              )
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-[11.5px] opacity-75">
          <span>Status: <strong className="opacity-100">{run.status}</strong></span>
          <span>·</span>
          <span>Subagents: <strong className="opacity-100">{subagents.length}</strong></span>
          {detail.diff ? (
            <>
              <span>·</span>
              <span className="font-mono text-[11px]">diff ready</span>
            </>
          ) : null}
        </div>

        {subagents.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {subagents.slice(0, 4).map(sa => (
              <div
                key={sa.id}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-[rgb(var(--border)/0.7)] bg-[rgb(var(--background)/0.55)] text-[11.5px]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`ade-dot ade-dot-${sa.status === "running" ? "running" : sa.status === "completed" ? "completed" : sa.status === "failed" ? "failed" : "waiting"}`} />
                  <span className="font-medium truncate">{sa.name}</span>
                </div>
                <span className="opacity-60 font-mono text-[10.5px] shrink-0">{sa.model}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 mt-auto pt-2">
          {run.status === "awaiting_approval" ? (
            <button
              type="button"
              className="sf-btn-primary !h-7 !text-[11.5px]"
              disabled={busy}
              onClick={async () => { setBusy(true); try { await onAction(run.runId, "approve") } finally { setBusy(false) } }}
            >
              Approve stage
            </button>
          ) : (
            <button
              type="button"
              className="sf-btn-secondary !h-7 !text-[11.5px]"
              disabled={busy || run.status === "completed"}
              onClick={async () => { setBusy(true); try { await onAction(run.runId, "step") } finally { setBusy(false) } }}
            >
              <Play className="size-3" /> Step
            </button>
          )}
          <button
            type="button"
            className="sf-btn-ghost !h-7 !text-[11.5px]"
            disabled={busy || run.status !== "running"}
            onClick={async () => { setBusy(true); try { await onAction(run.runId, "pause") } finally { setBusy(false) } }}
          >
            Pause
          </button>
        </div>
      </div>

      <form
        className="ade-stream-pane-composer"
        onSubmit={async e => {
          e.preventDefault()
          const text = steerText.trim()
          if (!text || busy) return
          setSteerText("")
          setBusy(true)
          try { await onAction(run.runId, "steer", text) } finally { setBusy(false) }
        }}
      >
        <input
          value={steerText}
          onChange={e => setSteerText(e.target.value)}
          placeholder="Steer Captain or give instruction…"
          disabled={busy}
        />
        <button type="submit" className="ade-icon-btn !w-7 !h-7" disabled={busy || !steerText.trim()}>
          <Send className="size-3.5" />
        </button>
      </form>
    </section>
  )
}
