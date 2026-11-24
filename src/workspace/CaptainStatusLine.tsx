import { useState } from "react"
import { Bot, ChevronRight, Hand, Loader2, PauseCircle, Square } from "lucide-react"
import type { SessionBlueprintSummary, SubagentInfo } from "../../app-types"
import { requestJson } from "../../api"
import { useI18n } from "../i18n/I18nContext"
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
  const { t } = useI18n()
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
          <strong>{t("cap.captain")}</strong>
          <span className="ade-muted">{busy ? t("cap.isWorking") : t("cap.waitingAgents")}</span>
          {working.length ? (
            <button type="button" className="ade-captain-agents" onClick={onOpenAgents} title={t("cap.seeAgents")}>
              {working.length === 1 ? t("cap.oneSubagent") : t("cap.subagents", { count: working.length })} <ChevronRight className="size-3" />
            </button>
          ) : null}
          <span className="flex-1" />
          <button type="button" className="ade-chip-btn" onClick={onPause} title={t("cap.pauseTitle")}><Square className="size-3" /> {t("cap.pause")}</button>
          <button type="button" className="ade-chip-btn" onClick={onTakeOver} title={t("cap.takeOverTitle")}><Hand className="size-3" /> {t("cap.takeOver")}</button>
        </div>
      ) : null}
    </div>
  )
}

function GateCard({ sessionId, stageId, stageName }: { sessionId: string; stageId: string; stageName: string }) {
  const { t } = useI18n()
  const [asking, setAsking] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const decide = async (decision: "approve" | "request_changes") => {
    setWorking(true)
    setError("")
    try {
      await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/stages/decision`, "POST", { decision, feedback })
      setFeedback("")
      setAsking(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("stg.decisionError"))
    } finally {
      setWorking(false)
    }
  }
  return (
    <div className="ade-gate-card" key={stageId}>
      <div className="ade-gate-card-head">
        <PauseCircle className="size-4" aria-hidden="true" />
        <span><strong>{stageName}</strong>{t("cap.waitingForYou")}</span>
        <span className="flex-1" />
        {asking ? null : (
          <>
            <button type="button" className="ade-chip-btn" disabled={working} onClick={() => setAsking(true)}>{t("stg.requestChanges")}</button>
            <button type="button" className="ade-chip-btn is-primary" disabled={working} onClick={() => void decide("approve")}>{working ? t("stg.sending") : t("stg.approve")}</button>
          </>
        )}
      </div>
      {asking ? (
        <div className="ade-gate-card-ask">
          <textarea value={feedback} onChange={event => setFeedback(event.target.value)} placeholder={t("cap.whatChange")} rows={2} autoFocus />
          <div className="ade-gate-card-actions">
            <button type="button" className="ade-chip-btn" onClick={() => setAsking(false)}>{t("common.cancel")}</button>
            <button type="button" className="ade-chip-btn is-primary" disabled={working || !feedback.trim()} onClick={() => void decide("request_changes")}>{t("stg.sendBack")}</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="ade-gate-card-error">{error}</p> : null}
    </div>
  )
}
