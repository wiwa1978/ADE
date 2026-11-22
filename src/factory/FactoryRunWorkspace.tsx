import { useState } from "react"
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Cpu,
  FileDiff,
  GitPullRequest,
  Globe,
  Hand,
  Pause,
  Play,
  Send,
  StepForward,
  Terminal as TerminalIcon,
} from "lucide-react"
import type { BrowserState } from "../../app-types"
import { TerminalPanel } from "../../TerminalPanel"
import { BrowserPanel } from "../panels/BrowserPanel"
import type { FactoryRunDetail } from "./types"

type WorkbenchTab = "subagents" | "diff" | "terminal" | "browser"

function DiffLines({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return (
      <div className="p-6 text-xs opacity-65">
        No workspace diff yet — the sandbox attaches lazily when entering the Implement stage.
      </div>
    )
  }
  return (
    <pre className="sf-diff-pre">
      {diff.split("\n").map((line, i) => {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          return <span key={i} className="sf-diff-add">{line}</span>
        }
        if (line.startsWith("-") && !line.startsWith("---")) {
          return <span key={i} className="sf-diff-del">{line}</span>
        }
        if (line.startsWith("@@") || line.startsWith("diff --git") || line.startsWith("# ")) {
          return <span key={i} className="sf-diff-hunk">{line}</span>
        }
        return <span key={i} className="block">{line}</span>
      })}
    </pre>
  )
}

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
  const [tab, setTab] = useState<WorkbenchTab>("subagents")
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null)
  const [steerInput, setSteerInput] = useState("")

  const title = run.run.issueRef
    ? `#${run.run.issueRef.number} ${run.run.issueRef.title}`
    : run.taskPrompt.split("\n")[0].slice(0, 80)

  const selectedSubagent =
    run.subagents.find(s => s.id === selectedSubagentId) ??
    run.subagents[run.subagents.length - 1] ??
    null

  const terminalCwd = run.worktreePath || run.repoPath

  async function handleSteerSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!steerInput.trim()) return
    const text = steerInput.trim()
    setSteerInput("")
    await onSteer(text)
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Run Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-[rgb(var(--border)/0.8)] bg-[rgb(var(--surface)/0.5)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <button type="button" className="sf-btn-ghost" onClick={onBackToKanban}>
            <ArrowLeft className="size-3.5" /> Kanban
          </button>
          <span className="opacity-30">/</span>
          <span className="text-[13px] font-semibold truncate">{title}</span>
          <span className="sf-badge sf-badge-accent">{run.run.status}</span>
          <span className={`sf-badge ${run.sandboxMode === "detached" ? "sf-badge-ok" : "sf-badge-warn"}`}>
            {run.sandboxMode === "detached" ? "Brain $0" : `Sandbox: ${run.sandboxMode}`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="sf-btn-primary"
            disabled={busy || run.autoRunning || run.pausedByHuman || run.run.status === "completed" || run.run.status === "awaiting_human"}
            onClick={() => void onAction("auto-run")}
          >
            <Play className="size-3.5" /> {run.autoRunning ? "Auto-Running…" : "Auto-Run"}
          </button>
          <button
            type="button"
            className="sf-btn-secondary"
            disabled={busy || run.autoRunning || run.pausedByHuman || run.run.status === "completed" || run.run.status === "awaiting_human"}
            onClick={() => void onAction("step")}
          >
            <StepForward className="size-3.5" /> Step
          </button>
          <button
            type="button"
            className="sf-btn-secondary"
            disabled={busy || run.pausedByHuman}
            onClick={() => void onAction("pause")}
          >
            <Pause className="size-3.5" /> Pause
          </button>
          <button
            type="button"
            className="sf-btn-secondary"
            disabled={busy}
            onClick={() => void onAction("takeover", { enable: !run.humanTakeOver })}
          >
            <Hand className="size-3.5" /> {run.humanTakeOver ? "Release Takeover" : "Take Over"}
          </button>
        </div>
      </div>

      {/* Horizontal Blueprint Stage Stepper */}
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
                <span className="sf-badge sf-badge-muted !h-4 !text-[9.5px] !px-1.5">
                  {stage.requiresSandbox ? "Sandbox" : "Brain $0"}
                </span>
                {stage.contextIsolation === "goldfish" ? (
                  <span className="sf-badge sf-badge-accent !h-4 !text-[9.5px] !px-1.5">Goldfish</span>
                ) : null}
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

      {/* Main Split: Left Single-Captain Feed | Right 4-Tab Workbench */}
      <div className="sf-workspace-split">
        {/* Left Pane: Single Captain Control & Steering */}
        <div className="sf-pane-left">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {run.lastError ? <div className="ade-banner-error">{run.lastError}</div> : null}

            {/* Human Approval Decision Cards */}
            {run.pendingEscalations.map(card => (
              <div
                key={card.id}
                className="rounded-xl border border-[rgb(var(--primary))] bg-[rgb(var(--primary)/0.1)] p-3.5 flex flex-col gap-2.5"
              >
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <CheckCircle2 className="size-4 text-[rgb(var(--primary))]" />
                  <span>Captain Gate · {card.title}</span>
                </div>
                <p className="text-xs opacity-85 whitespace-pre-wrap leading-relaxed">{card.summary}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="sf-btn-primary"
                    disabled={busy}
                    onClick={() => void onAction("approve", { decision: "approve", cardId: card.id })}
                  >
                    Approve &amp; Continue
                  </button>
                  <button
                    type="button"
                    className="sf-btn-secondary"
                    disabled={busy}
                    onClick={() => void onAction("approve", { decision: "request_changes", cardId: card.id })}
                  >
                    Request Changes
                  </button>
                  <button
                    type="button"
                    className="sf-btn-ghost"
                    disabled={busy}
                    onClick={() => void onAction("approve", { decision: "cancel", cardId: card.id })}
                  >
                    Cancel Run
                  </button>
                </div>
              </div>
            ))}

            {run.prUrl ? (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 flex items-center gap-2 text-xs">
                <GitPullRequest className="size-4 text-emerald-400 shrink-0" />
                <span>Pull Request Ready:</span>
                <a href={run.prUrl} target="_blank" rel="noreferrer" className="underline font-mono truncate">
                  {run.prUrl}
                </a>
              </div>
            ) : null}

            {/* Task Context */}
            <div className="rounded-lg border border-[rgb(var(--border)/0.75)] bg-[rgb(var(--surface))] p-3 text-xs">
              <div className="sf-section-title mb-1.5">Issue / Objective</div>
              <div className="whitespace-pre-wrap leading-relaxed opacity-90">{run.taskPrompt}</div>
              <div className="mt-2 pt-2 border-t border-[rgb(var(--border)/0.6)] flex flex-wrap gap-3 text-[11px] opacity-65 font-mono">
                <span>branch: {run.workBranch}</span>
                <span>profile: {run.modelConfig.profile}</span>
                <span>auditor: {run.crossFamilyVerified ? "cross-family" : "same-family"}</span>
              </div>
            </div>

            {/* Single-Captain Chronological Timeline */}
            <div className="flex flex-col gap-1.5">
              <div className="sf-section-title">Captain Activity Feed</div>
              <div className="rounded-lg border border-[rgb(var(--border)/0.75)] bg-[rgb(var(--surface))] divide-y divide-[rgb(var(--border)/0.5)]">
                {run.logs.map((entry, idx) => (
                  <div key={idx} className="px-3 py-2 text-xs flex items-start gap-2.5">
                    <span className="sf-badge sf-badge-muted !h-5 !text-[10px] shrink-0">{entry.stageId}</span>
                    <span
                      className={`leading-relaxed ${
                        entry.level === "error"
                          ? "text-rose-400"
                          : entry.level === "warn"
                            ? "text-amber-300"
                            : "opacity-90"
                      }`}
                    >
                      {entry.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Single-Captain Steering Composer */}
          <form
            onSubmit={handleSteerSubmit}
            className="p-3 border-t border-[rgb(var(--border)/0.8)] bg-[rgb(var(--nav)/0.7)] flex items-center gap-2"
          >
            <input
              className="sf-field flex-1"
              placeholder="Steer the Captain (applies to next stage — never hunt through subagent tabs)…"
              value={steerInput}
              onChange={e => setSteerInput(e.target.value)}
            />
            <button type="submit" className="sf-btn-primary" disabled={busy || !steerInput.trim()}>
              <Send className="size-3.5" /> Steer
            </button>
          </form>
        </div>

        {/* Right Pane: 4-Tab Integrated Workbench (Subagents | Diff | Terminal | Browser) */}
        <div className="sf-pane-right">
          <div className="sf-tab-bar" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "subagents"}
              className={`sf-tab ${tab === "subagents" ? "is-active" : ""}`}
              onClick={() => setTab("subagents")}
            >
              <Bot className="size-3.5" /> Subagents ({run.subagents.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "diff"}
              className={`sf-tab ${tab === "diff" ? "is-active" : ""}`}
              onClick={() => setTab("diff")}
            >
              <FileDiff className="size-3.5" /> Diff &amp; Telemetry
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "terminal"}
              className={`sf-tab ${tab === "terminal" ? "is-active" : ""}`}
              onClick={() => setTab("terminal")}
            >
              <TerminalIcon className="size-3.5" /> Terminal
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "browser"}
              className={`sf-tab ${tab === "browser" ? "is-active" : ""}`}
              onClick={() => setTab("browser")}
            >
              <Globe className="size-3.5" /> Browser
            </button>
          </div>

          {/* Tab 1: Subagents Glass Box */}
          {tab === "subagents" ? (
            <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
              {run.subagents.length === 0 ? (
                <div className="p-8 text-center text-xs opacity-65">
                  No subagents have run yet. Click <strong>Auto-Run</strong> or <strong>Step</strong> to launch the Captain.
                </div>
              ) : (
                <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
                  <div className="p-3 border-b border-[rgb(var(--border)/0.7)] flex gap-2 overflow-x-auto flex-none">
                    {run.subagents.map(sub => {
                      const active = selectedSubagent?.id === sub.id
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => setSelectedSubagentId(sub.id)}
                          className="rounded-lg border px-3 py-2 text-left text-xs shrink-0 cursor-pointer"
                          style={{
                            borderColor: active ? "rgb(var(--primary))" : "rgb(var(--border))",
                            background: active ? "rgb(var(--primary) / 0.12)" : "rgb(var(--surface-raised))",
                          }}
                        >
                          <div className="font-semibold flex items-center gap-1.5">
                            {sub.status === "running" ? <span className="sf-pulse-dot" /> : null}
                            <span>{sub.name}</span>
                          </div>
                          <div className="text-[10.5px] opacity-70 mt-0.5 flex items-center gap-1.5">
                            <span>{sub.contextIsolation === "goldfish" ? "Goldfish" : "Elephant"}</span>
                            <span>·</span>
                            <span className="font-mono">{sub.model}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  {selectedSubagent ? (
                    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-[13px]">{selectedSubagent.name}</div>
                        <div className="flex items-center gap-1.5">
                          <span className={`sf-badge ${selectedSubagent.contextIsolation === "goldfish" ? "sf-badge-accent" : "sf-badge-muted"}`}>
                            {selectedSubagent.contextIsolation === "goldfish" ? "Zero-Memory Goldfish" : "Elephant Context"}
                          </span>
                          <span className="sf-badge sf-badge-muted font-mono">{selectedSubagent.model}</span>
                          <span className="sf-badge">{selectedSubagent.status}</span>
                        </div>
                      </div>
                      <div className="rounded-lg border border-[rgb(var(--border)/0.8)] bg-[rgb(var(--background))] p-3.5 font-mono text-[11.5px] whitespace-pre-wrap leading-relaxed">
                        {selectedSubagent.output || selectedSubagent.summary}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {/* Tab 2: Live Diff + Honest Telemetry */}
          {tab === "diff" ? (
            <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[rgb(var(--border)/0.75)] flex flex-wrap items-center gap-4 text-xs bg-[rgb(var(--surface)/0.6)]">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Cpu className="size-3.5" /> Actual Telemetry:
                </span>
                <span className="font-mono">
                  {run.telemetry.actualInputTokens.toLocaleString()} in / {run.telemetry.actualOutputTokens.toLocaleString()} out
                </span>
                <span className="font-mono">${run.telemetry.actualUsd.toFixed(4)}</span>
                <span className="opacity-75">
                  Pruned schemas: {run.telemetry.toolSchemasPruned} · Audit loops: {run.run.auditLoopbacksUsed}
                </span>
              </div>
              <DiffLines diff={run.diff} />
            </div>
          ) : null}

          {/* Tab 3: Working Real Terminal inside Worktree */}
          <div className={`flex-1 min-h-0 flex-col ${tab === "terminal" ? "flex" : "hidden"}`}>
            <div className="px-3.5 py-1.5 text-[11px] font-mono opacity-70 border-b border-[rgb(var(--border)/0.6)]">
              cwd: {terminalCwd}
            </div>
            <div className="flex-1 min-h-0 flex">
              <TerminalPanel
                environmentId={environmentId}
                workspaceKey={`factory:${run.run.runId}`}
                cwd={terminalCwd}
                visible={tab === "terminal"}
                fontSize={terminalFontSize}
                scrollback={terminalScrollback}
              />
            </div>
          </div>

          {/* Tab 4: Working Built-In Browser */}
          {tab === "browser" ? (
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <BrowserPanel
                browserState={browserState}
                onStateChange={onBrowserStateChange}
                onOpenExternal={onOpenExternal}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
