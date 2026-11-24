import { useState, type FormEvent } from "react"
import { CheckCircle2, GitPullRequest, Send } from "lucide-react"
import { Badge, Banner, Button, Input } from "../../../components/ui/index.ts"
import type { FactoryRunDetail } from "../types"

interface FactoryCaptainFeedProps {
  run: FactoryRunDetail
  busy: boolean
  onAction: (action: "step" | "auto-run" | "approve" | "pause" | "takeover", body?: Record<string, unknown>) => Promise<void>
  onSteer: (note: string) => Promise<void>
}

export function FactoryCaptainFeed({ run, busy, onAction, onSteer }: FactoryCaptainFeedProps) {
  const [steerInput, setSteerInput] = useState("")

  async function handleSteerSubmit(e: FormEvent) {
    e.preventDefault()
    if (!steerInput.trim()) return
    const text = steerInput.trim()
    setSteerInput("")
    await onSteer(text)
  }

  return (
    <div className="sf-pane-left">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {run.lastError ? <Banner tone="error">{run.lastError}</Banner> : null}

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
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void onAction("approve", { decision: "approve", cardId: card.id })}>
                Approve &amp; Continue
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void onAction("approve", { decision: "request_changes", cardId: card.id })}>
                Request Changes
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onAction("approve", { decision: "cancel", cardId: card.id })}>
                Cancel Run
              </Button>
            </div>
          </div>
        ))}

        {run.prUrl ? (
          <Banner tone="ok" icon={<GitPullRequest className="size-4" />}>
            <span className="mr-1.5">Pull Request Ready:</span>
            <a href={run.prUrl} target="_blank" rel="noreferrer" className="underline font-mono break-all">
              {run.prUrl}
            </a>
          </Banner>
        ) : null}

        <div className="rounded-lg border border-[rgb(var(--border)/0.75)] bg-[rgb(var(--surface))] p-3 text-xs">
          <div className="sf-section-title mb-1.5">Issue / Objective</div>
          <div className="whitespace-pre-wrap leading-relaxed opacity-90">{run.taskPrompt}</div>
          <div className="mt-2 pt-2 border-t border-[rgb(var(--border)/0.6)] flex flex-wrap gap-3 text-[11px] opacity-65 font-mono">
            <span>branch: {run.workBranch}</span>
            <span>profile: {run.modelConfig.profile}</span>
            <span>auditor: {run.crossFamilyVerified ? "cross-family" : "same-family"}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="sf-section-title">Captain Activity Feed</div>
          <div className="rounded-lg border border-[rgb(var(--border)/0.75)] bg-[rgb(var(--surface))] divide-y divide-[rgb(var(--border)/0.5)]">
            {run.logs.map((entry, idx) => (
              <div key={idx} className="px-3 py-2 text-xs flex items-start gap-2.5">
                <Badge className="shrink-0">{entry.stageId}</Badge>
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

      <form
        onSubmit={e => void handleSteerSubmit(e)}
        className="p-3 border-t border-[rgb(var(--border)/0.8)] bg-[rgb(var(--nav)/0.7)] flex items-center gap-2"
      >
        <Input
          className="flex-1"
          placeholder="Steer the Captain (applies to next stage — never hunt through subagent tabs)…"
          value={steerInput}
          onChange={e => setSteerInput(e.target.value)}
        />
        <Button type="submit" variant="primary" size="md" disabled={busy || !steerInput.trim()}>
          <Send className="size-3.5" /> Steer
        </Button>
      </form>
    </div>
  )
}
