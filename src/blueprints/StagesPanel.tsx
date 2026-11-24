import { useState } from "react"
import { Check, CircleDashed, CircleSlash, Eye, Loader2, PauseCircle, RotateCcw, Users, XCircle } from "lucide-react"
import { request } from "../../api"
import "./stage-checks.css"
import { shortBlueprintName, useBlueprintOptions, VIBE_ID } from "./blueprint-options"
import { stageStatusLabel, type SessionStages, type StageStatus, type StageView } from "./session-stages"

const icons: Record<StageStatus, typeof Check> = {
  completed: Check,
  running: Loader2,
  awaiting_approval: PauseCircle,
  changes_requested: RotateCcw,
  failed: XCircle,
  skipped: CircleSlash,
  pending: CircleDashed,
}

/**
 * The Stages tab in the bottom drawer: the session's blueprint as a row of stage cards, the
 * selected stage's details, and Approve / Request changes on a stage that waits for you.
 */
export function StagesPanel({
  sessionId,
  stages,
  busy,
  locked,
  onChanged,
  onOpenFile,
  onOpenProgress,
}: {
  sessionId: string
  stages: SessionStages
  busy: boolean
  /** The project locks the way of working. */
  locked: boolean
  onChanged: (next: SessionStages) => void
  onOpenFile?: (path: string) => void
  onOpenProgress?: () => void
}) {
  const current = stages.summary?.stage?.id ?? null
  const [selected, setSelected] = useState<string | null>(null)
  const [feedback, setFeedback] = useState("")
  const [asking, setAsking] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const shown = stages.stages.find(stage => stage.id === (selected ?? current)) ?? stages.stages.at(-1) ?? null

  const decide = async (decision: "approve" | "request_changes") => {
    setWorking(true)
    setError("")
    try {
      const next = await request<SessionStages>(`/api/sessions/${encodeURIComponent(sessionId)}/stages/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, feedback }),
      })
      setFeedback("")
      setAsking(false)
      setSelected(null)
      setNotice(next.notice ?? "")
      onChanged(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your decision.")
    } finally {
      setWorking(false)
    }
  }

  const summary = stages.summary
  return (
    <div className="ade-stages">
      <div className="ade-stages-head">
        <strong>{shortBlueprintName(stages.name)}</strong>
        <span className="ade-muted">
          {summary ? (summary.status === "completed" ? "All stages done" : `${summary.done} of ${summary.total} done`) : "No stages"}
        </span>
        <span className="flex-1" />
        <WayOfWorkingSelect sessionId={sessionId} current={stages.blueprintId} currentName={stages.name} locked={locked} busy={busy || working} onChanged={next => { setSelected(null); onChanged(next) }} />
        {onOpenProgress ? <button type="button" className="ade-chip-btn" onClick={onOpenProgress}>Open in Progress</button> : null}
      </div>

      {stages.stages.length ? (
        <ol className="ade-stage-track" aria-label="Stages">
          {stages.stages.map((stage, index) => {
            const Icon = icons[stage.status]
            const isCurrent = stage.id === current
            const done = stage.status === "completed" || stage.status === "skipped"
            return (
              <li key={stage.id} className={`ade-stage is-${stage.status} ${isCurrent ? "is-current" : ""} ${shown?.id === stage.id ? "is-selected" : ""}`}>
                {index > 0 ? <span className={`ade-stage-line ${done || isCurrent ? "is-filled" : ""}`} aria-hidden="true" /> : null}
                <button type="button" className="ade-stage-card" onClick={() => setSelected(stage.id)} aria-current={isCurrent ? "step" : undefined} title={stage.description}>
                  <span className="ade-stage-icon"><Icon className={`size-3.5 ${stage.status === "running" ? "animate-spin" : ""}`} /></span>
                  <span className="ade-stage-name">{stage.name}</span>
                  <span className="ade-stage-meta">
                    {stage.status === "awaiting_approval" ? (stage.attempt === 0 ? "Approve to start" : "Approve") : stageStatusLabel[stage.status]}
                    {stage.gate !== "never" && stage.status !== "awaiting_approval" ? " · gate" : ""}
                    {stage.checks && !stage.checks.ok ? " · checks failed" : ""}
                    {stage.attempt > 1 ? ` · round ${stage.attempt}` : ""}
                  </span>
                  {stage.executor === "parallel_subagents" ? <Users className="ade-stage-badge size-3" aria-label="Runs in parallel subagents" /> : stage.goldfish ? <Eye className="ade-stage-badge size-3" aria-label="Independent review" /> : null}
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="ade-muted ade-xs ade-stages-empty">Vibe coding has no stages: you and the agent decide the work as you go. Pick a blueprint above to work through stages.</p>
      )}

      {shown && shown.status === "awaiting_approval" ? (
        <div className="ade-stage-gate">
          {asking ? (
            <>
              <textarea value={feedback} onChange={event => setFeedback(event.target.value)} placeholder={`What should change in “${shown.name}”?`} rows={3} autoFocus />
              <div className="flex gap-2">
                <button type="button" className="ade-chip-btn is-primary" disabled={working || busy || !feedback.trim()} onClick={() => void decide("request_changes")}>Send back</button>
                <button type="button" className="ade-chip-btn" disabled={working} onClick={() => setAsking(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <span className="ade-muted">{shown.attempt === 0 ? `“${shown.name}” starts after you approve it.` : `“${shown.name}” is ready for your review.`}</span>
              <span className="flex-1" />
              <button type="button" className="ade-chip-btn" disabled={working || busy} onClick={() => setAsking(true)}>Request changes</button>
              <button type="button" className="ade-chip-btn is-primary" disabled={working || busy} onClick={() => void decide("approve")}>{working ? "Sending…" : "Approve"}</button>
            </>
          )}
        </div>
      ) : null}
      {notice ? <p className="ade-stage-notice ade-xs" role="status">{notice}</p> : null}
      {shown ? <StageDetail stage={shown} onOpenFile={onOpenFile} /> : null}

      {busy && shown?.status === "awaiting_approval" ? <p className="ade-muted ade-xs">The agent is still answering; you can decide when it stops.</p> : null}
      {error ? <p className="ade-error-text ade-xs" role="alert">{error}</p> : null}
    </div>
  )
}

/** Change a session's way of working: Vibe, or a blueprint that starts at its first stage. */
export function WayOfWorkingSelect({ sessionId, current, currentName, locked, busy, onChanged }: {
  sessionId: string
  current: string
  currentName: string
  locked: boolean
  busy: boolean
  onChanged: (next: SessionStages) => void
}) {
  const options = useBlueprintOptions()
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState("")
  const switchTo = async (blueprintId: string) => {
    if (blueprintId === current) return
    const target = options.find(option => option.id === blueprintId)
    const question = blueprintId === VIBE_ID
      ? "Switch to Vibe coding? The stages stop; files they wrote stay."
      : `Switch to ${target ? shortBlueprintName(target.name) : blueprintId}? It starts at its first stage, with the work so far as context.`
    if (!window.confirm(question)) return
    setSwitching(true)
    setError("")
    try {
      onChanged(await request<SessionStages>(`/api/sessions/${encodeURIComponent(sessionId)}/blueprint`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blueprintId }),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch.")
    } finally {
      setSwitching(false)
    }
  }
  return (
    <label className="ade-stages-switch" title={error || (locked ? "This project's sessions all use its blueprint." : busy ? "Wait until the agent stops to change this." : "Change this session's way of working")}>
      <span className="ade-muted">Way of working</span>
      <select value={current} disabled={locked || busy || switching} onChange={event => void switchTo(event.target.value)} aria-invalid={Boolean(error)}>
        {(options.length ? options : [{ id: current, name: currentName }]).map(option => <option key={option.id} value={option.id}>{shortBlueprintName(option.name)}</option>)}
      </select>
    </label>
  )
}

function StageDetail({ stage, onOpenFile }: { stage: StageView; onOpenFile?: (path: string) => void }) {
  return (
    <div className="ade-stage-detail">
      <div className="ade-stage-detail-head">
        <strong>{stage.name}</strong>
        <span className="ade-muted ade-xs">{stage.description}</span>
      </div>
      {stage.summary ? <p className="ade-stage-summary">{stage.summary}</p> : <p className="ade-muted ade-xs">{stage.status === "running" ? "The agent is working on this stage." : stage.status === "pending" ? "Not started yet." : ""}</p>}
      {stage.checks ? <StageChecksBlock checks={stage.checks} /> : null}
      {stage.review ? <StageReviewBlock review={stage.review} /> : stage.goldfish && stage.status === "running" ? <p className="ade-muted ade-xs">An independent reviewer has to look at this before it can finish.</p> : null}
      {stage.verdict ? (
        <div className={`ade-stage-verdict is-${stage.verdict.outcome}`}>
          <strong>{stage.verdict.outcome === "pass" ? "Review passed" : stage.verdict.outcome === "changes_requested" ? "Review asked for changes" : "Review needs your decision"}</strong>
          <span>{stage.verdict.summary}</span>
          {stage.verdict.findings?.length ? (
            <ul>{stage.verdict.findings.map((finding, index) => <li key={index}><span className={`ade-sev is-${finding.severity}`}>{finding.severity}</span> {finding.file ? <code>{finding.file}</code> : null} {finding.message}</li>)}</ul>
          ) : null}
        </div>
      ) : null}
      {stage.artifactPaths.length ? (
        <div className="ade-stage-files">
          {stage.artifactPaths.map(path => onOpenFile && stage.status !== "pending" ? (
            <button type="button" key={path} className="ade-chip-btn ade-mono" onClick={() => onOpenFile(path)}>{path}</button>
          ) : (
            <span key={path} className="ade-pill ade-mono">{path}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** What ADE ran to check the stage: each command with its result, failures with their output. */
function StageChecksBlock({ checks }: { checks: NonNullable<StageView["checks"]> }) {
  const marks = { passed: "✓", failed: "✕", skipped: "–" } as const
  const failed = checks.results.filter(result => result.status === "failed").length
  return (
    <div className={`ade-stage-checks ${checks.ok ? "" : "is-failed"}`}>
      <div className="ade-stage-checks-head">
        <strong>ADE's checks</strong>
        <span className="ade-muted ade-xs">{checks.results.length ? (checks.ok ? "all passed" : `${failed} failed`) : "nothing to run"}{checks.source === "project" ? " · the project's check script" : ""}</span>
      </div>
      {checks.results.map(result => (
        <div key={result.command}>
          <div className={`ade-stage-check is-${result.status}`}>
            <span className="ade-stage-check-mark" aria-hidden="true">{marks[result.status]}</span>
            <span>{result.label}</span>
            <code>{result.command}</code>
            {result.status === "skipped" ? <span className="ade-muted ade-xs">not installed here</span> : <span className="ade-muted ade-xs">{result.ms < 1000 ? `${result.ms} ms` : `${(result.ms / 1000).toFixed(1)} s`}</span>}
          </div>
          {result.status === "failed" && result.output ? <pre className="ade-stage-check-output">{result.output}</pre> : null}
        </div>
      ))}
      {checks.missing.length ? <p className="ade-muted ade-xs" style={{ margin: 0 }}>No command in this project for: {checks.missing.join(", ")}. Add a check script in the project's settings to include them.</p> : null}
    </div>
  )
}

/** Proof that the independent review ran: on which model, and what it reported. */
function StageReviewBlock({ review }: { review: NonNullable<StageView["review"]> }) {
  const state = review.status === "running" ? "reviewing now" : review.status === "failed" ? "failed" : review.independent ? "a different model family" : "same model family (no other model is set up)"
  return (
    <div className={`ade-stage-checks ${review.status === "failed" ? "is-failed" : ""}`}>
      <div className="ade-stage-checks-head">
        <strong>Independent review</strong>
        <span className="ade-muted ade-xs">{review.model ?? "the session's model"} · {state}</span>
      </div>
      {review.report ? <pre className="ade-stage-check-output">{review.report}</pre> : null}
    </div>
  )
}
