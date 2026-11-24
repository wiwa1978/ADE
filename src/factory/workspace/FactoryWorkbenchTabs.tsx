import { useState } from "react"
import { Bot, Cpu, FileDiff, Globe, Terminal as TerminalIcon } from "lucide-react"
import { Badge, EmptyState } from "../../../components/ui/index.ts"
import type { BrowserState } from "../../../app-types"
import { TerminalPanel } from "../../../TerminalPanel"
import { BrowserPanel } from "../../panels/BrowserPanel"
import { DiffLines } from "../../panels/DiffLines"
import type { FactoryRunDetail } from "../types"

type WorkbenchTab = "subagents" | "diff" | "terminal" | "browser"

interface FactoryWorkbenchTabsProps {
  run: FactoryRunDetail
  environmentId: string
  terminalFontSize: number
  terminalScrollback: number
  browserState: BrowserState
  onBrowserStateChange: (state: BrowserState) => void
  onOpenExternal: (url: string) => Promise<void>
}

export function FactoryWorkbenchTabs({
  run,
  environmentId,
  terminalFontSize,
  terminalScrollback,
  browserState,
  onBrowserStateChange,
  onOpenExternal,
}: FactoryWorkbenchTabsProps) {
  const [tab, setTab] = useState<WorkbenchTab>("subagents")
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null)

  const selectedSubagent =
    run.subagents.find(s => s.id === selectedSubagentId) ??
    run.subagents[run.subagents.length - 1] ??
    null
  const terminalCwd = run.worktreePath || run.repoPath

  return (
    <div className="sf-pane-right">
      <div className="sf-tab-bar" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "subagents"} className={`sf-tab ${tab === "subagents" ? "is-active" : ""}`} onClick={() => setTab("subagents")}>
          <Bot className="size-3.5" /> Subagents ({run.subagents.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === "diff"} className={`sf-tab ${tab === "diff" ? "is-active" : ""}`} onClick={() => setTab("diff")}>
          <FileDiff className="size-3.5" /> Diff &amp; Telemetry
        </button>
        <button type="button" role="tab" aria-selected={tab === "terminal"} className={`sf-tab ${tab === "terminal" ? "is-active" : ""}`} onClick={() => setTab("terminal")}>
          <TerminalIcon className="size-3.5" /> Terminal
        </button>
        <button type="button" role="tab" aria-selected={tab === "browser"} className={`sf-tab ${tab === "browser" ? "is-active" : ""}`} onClick={() => setTab("browser")}>
          <Globe className="size-3.5" /> Browser
        </button>
      </div>

      {tab === "subagents" ? (
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {run.subagents.length === 0 ? (
            <EmptyState
              compact
              icon={<Bot className="size-5 opacity-60" />}
              title="No subagents have run yet"
              description={<>Click <strong>Auto-Run</strong> or <strong>Step</strong> to launch the Captain.</>}
            />
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
                      <Badge tone={selectedSubagent.contextIsolation === "goldfish" ? "accent" : "neutral"}>
                        {selectedSubagent.contextIsolation === "goldfish" ? "Zero-Memory Goldfish" : "Elephant Context"}
                      </Badge>
                      <Badge className="font-mono">{selectedSubagent.model}</Badge>
                      <Badge>{selectedSubagent.status}</Badge>
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
          {run.diff.trim() ? (
            <div className="flex-1 min-h-0 overflow-auto">
              <DiffLines diff={run.diff} path={null} />
            </div>
          ) : (
            <EmptyState
              compact
              icon={<FileDiff className="size-5 opacity-60" />}
              title="No workspace diff yet"
              description="The sandbox attaches lazily when entering the Implement stage."
            />
          )}
        </div>
      ) : null}

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
  )
}
