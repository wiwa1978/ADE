import { useState } from "react"
import { Bot, ChevronRight, Hand, Loader2, PauseCircle, Square } from "lucide-react"
import type { SessionBlueprintSummary, SubagentInfo } from "../../app-types"
import { request } from "../../api"
import "./captain-status.css"

/**
 * Simple view's only extra line above the composer: what the Captain is doing, how many subagents
 * are working for it (click to see them), Pause and Take over, and, when a stage waits for you,
 * the decision right here.
 */
export function CaptainStatusLine({ sessionId, busy, subagents, blueprint, onOpenAgents, onPause, onTakeOver }: {
  sessionId: string
  busy: boolean
  subagents: SubagentInfo[]
  blueprint: SessionBlueprintSummary | null
  onOpenAgents: () => void
  /** Stops the Captain's turn and every running subagent. */
  onPause: () => void
  /** Pauses, then puts the cursor in the message box. */
  onTakeOver: () => void
}) {
  const working = subagents.filter(sub => sub.status === "running" || sub.status === "waiting")
  const stage = blueprint?.stage
  const gate = stage?.status === "awaiting_approval" ? stage : null
  if (!busy && !working.length && !gate) return null
  return (
    <div className="ade-captain-status">
      {gate ? <GateCard sessionId={sessionId} stageName={gate.name} stageId={gate.id} /> : null}
      {busy || working.length ? (
        <div className="ade-captain-line" role="status">
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Bot className="size-3.5" aria-hidden="true" />}
          <strong>Captain</strong>
          <span className="ade-muted">{busy ? "is working" : "is waiting for the agents"}</span>
          {working.length ? (
            <button type="button" className="ade-captain-agents" onClick={onOpenAgents} title="See what each agent is doing">
              {working.length} {working.length === 1 ? "subagent" : "subagents"} working <ChevronRight className="size-3" />
            </button>
          ) : null}
          <span className="flex-1" />
          <button type="button" className="ade-chip-btn" onClick={onPause} title="Stop the Captain and its subagents"><Square className="size-3" /> Pause</button>
          <button type="button" className="ade-chip-btn" onClick={onTakeOver} title="Pause and write to the Captain yourself"><Hand className="size-3" /> Take over</button>
        </div>
      ) : null}
    </div>
  )
}

function GateCard({ sessionId, stageId, stageName }: { sessionId: string; stageId: string; stageName: string }) {
  const [asking, setAsking] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const decide = async (decision: "approve" | "request_changes") => {
    setWorking(true)
    setError("")
    try {
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/stages/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, feedback }),
      })
      setFeedback("")
      setAsking(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your decision.")
    } finally {
      setWorking(false)
    }
  }
  return (
    <div className="ade-gate-card" key={stageId}>
      <div className="ade-gate-card-head">
        <PauseCircle className="size-4" aria-hidden="true" />
        <span><strong>{stageName}</strong> is waiting for you</span>
        <span className="flex-1" />
        {asking ? null : (
          <>
            <button type="button" className="ade-chip-btn" disabled={working} onClick={() => setAsking(true)}>Request changes</button>
            <button type="button" className="ade-chip-btn is-primary" disabled={working} onClick={() => void decide("approve")}>{working ? "Sending…" : "Approve"}</button>
          </>
        )}
      </div>
      {asking ? (
        <div className="ade-gate-card-ask">
          <textarea value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="What should change?" rows={2} autoFocus />
          <div className="ade-gate-card-actions">
            <button type="button" className="ade-chip-btn" onClick={() => setAsking(false)}>Cancel</button>
            <button type="button" className="ade-chip-btn is-primary" disabled={working || !feedback.trim()} onClick={() => void decide("request_changes")}>Send back</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="ade-gate-card-error">{error}</p> : null}
    </div>
  )
}
