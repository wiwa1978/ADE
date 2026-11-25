import { useState } from "react"
import { Activity, RefreshCw, Square, Terminal } from "lucide-react"
import type { ManagedProcessSummary } from "../app-types"

export function ProcessesPanel({
  processes,
  onKill,
  onRefresh,
}: {
  processes: ManagedProcessSummary[]
  onKill: (id: string) => Promise<void>
  onRefresh: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const active = processes.find(p => p.id === selectedId) ?? processes[0] ?? null

  return (
    <div className="ade-pane-body">
      <div className="ade-pane-toolbar">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5" />
          <strong>Agent Processes ({processes.length})</strong>
        </div>
        <button type="button" className="ade-icon-btn" onClick={onRefresh} title="Refresh processes">
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {processes.length === 0 ? (
        <div className="ade-pane-empty">
          <Activity className="size-7 opacity-40" />
          <p>No agent commands have been run in this session yet.</p>
        </div>
      ) : (
        <div className="ade-diff-split">
          <div className="ade-diff-filelist">
            {processes.map(proc => (
              <div
                key={proc.id}
                className={`ade-diff-file-row ${active?.id === proc.id ? "is-selected" : ""}`}
                onClick={() => setSelectedId(proc.id)}
              >
                <div className="ade-diff-file-main">
                  <span className={`ade-dot ade-dot-${proc.status === "running" ? "running" : proc.exitCode === 0 ? "completed" : "failed"}`} />
                  <code className="ade-mono ade-truncate" title={proc.command}>{proc.command}</code>
                </div>
                <div className="ade-diff-file-meta">
                  <span className="ade-pill">{proc.status}{proc.exitCode != null ? ` (${proc.exitCode})` : ""}</span>
                  {proc.status === "running" ? (
                    <button
                      type="button"
                      className="ade-chip-btn ade-chip-danger"
                      onClick={e => {
                        e.stopPropagation()
                        void onKill(proc.id)
                      }}
                    >
                      <Square className="size-3" /> Stop
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {active ? (
            <div className="ade-diff-viewer">
              <div className="ade-diff-viewer-head">
                <code className="ade-mono ade-truncate">{active.command}</code>
                <span className="ade-muted ade-xs">{active.cwd}</span>
              </div>
              <pre className="ade-tool-output is-terminal flex-1 m-0 rounded-none border-0">
                {active.outputTail || "(no output yet)"}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
