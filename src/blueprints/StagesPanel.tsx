import { useState } from "react"
import { Check, CircleDashed, CircleSlash, Eye, Loader2, PauseCircle, RotateCcw, Users, XCircle } from "lucide-react"
import { requestJson } from "../../api"
import { useConfirm } from "../../components/ui/index.ts"
import "./stage-checks.css"
import { shortBlueprintName, useBlueprintOptions, VIBE_ID } from "./blueprint-options"
import { useI18n } from "../i18n/I18nContext"
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
  const { t } = useI18n()
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
      const next = await requestJson<SessionStages>(`/api/sessions/${encodeURIComponent(sessionId)}/stages/decision`, "POST", { decision, feedback })
      setFeedback("")
      setAsking(false)
      setSelected(null)
      setNotice(next.notice ?? "")
      onChanged(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("stg.decisionError"))
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
          {summary ? (summary.status === "completed" ? t("stg.allDone") : t("stg.progress", { done: summary.done, total: summary.total })) : t("stg.noStages")}
        </span>
        <span className="flex-1" />
        <WayOfWorkingSelect sessionId={sessionId} current={stages.blueprintId} currentName={stages.name} locked={locked} busy={busy || working} onChanged={next => { setSelected(null); onChanged(next) }} />
        {onOpenProgress ? <button type="button" className="ade-chip-btn" onClick={onOpenProgress}>{t("stg.openProgress")}</button> : null}
      </div>

      {stages.stages.length ? (
        <ol className="ade-stage-track" aria-label={t("stg.stagesAria")}>
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
                    {stage.status === "awaiting_approval" ? (stage.attempt === 0 ? t("stg.approveToStart") : t("stg.approve")) : stageStatusLabel[stage.status]}
                    {stage.gate !== "never" && stage.status !== "awaiting_approval" ? t("stg.gate") : ""}
                    {stage.checks && !stage.checks.ok ? t("stg.checksFailed") : ""}
                    {stage.attempt > 1 ? t("stg.round", { n: stage.attempt }) : ""}
                  </span>
                  {stage.executor === "parallel_subagents" ? <Users className="ade-stage-badge size-3" aria-label={t("stg.parallelAria")} /> : stage.goldfish ? <Eye className="ade-stage-badge size-3" aria-label={t("stg.reviewAria")} /> : null}
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="ade-muted ade-xs ade-stages-empty">{t("stg.vibeEmpty")}</p>
      )}

      {shown && shown.status === "awaiting_approval" ? (
        <div className="ade-stage-gate">
          {asking ? (
            <>
              <textarea value={feedback} onChange={event => setFeedback(event.target.value)} placeholder={t("stg.whatChange", { name: shown.name })} rows={3} autoFocus />
              <div className="flex gap-2">
                <button type="button" className="ade-chip-btn is-primary" disabled={working || busy || !feedback.trim()} onClick={() => void decide("request_changes")}>{t("stg.sendBack")}</button>
                <button type="button" className="ade-chip-btn" disabled={working} onClick={() => setAsking(false)}>{t("common.cancel")}</button>
              </div>
            </>
          ) : (
            <>
              <span className="ade-muted">{shown.attempt === 0 ? t("stg.startsAfter", { name: shown.name }) : t("stg.readyReview", { name: shown.name })}</span>
              <span className="flex-1" />
              <button type="button" className="ade-chip-btn" disabled={working || busy} onClick={() => setAsking(true)}>{t("stg.requestChanges")}</button>
              <button type="button" className="ade-chip-btn is-primary" disabled={working || busy} onClick={() => void decide("approve")}>{working ? t("stg.sending") : t("stg.approve")}</button>
            </>
          )}
        </div>
      ) : null}
      {notice ? <p className="ade-stage-notice ade-xs" role="status">{notice}</p> : null}
      {shown ? <StageDetail stage={shown} onOpenFile={onOpenFile} /> : null}

      {busy && shown?.status === "awaiting_approval" ? <p className="ade-muted ade-xs">{t("stg.stillAnswering")}</p> : null}
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
  const { t } = useI18n()
  const { confirm } = useConfirm()
  const options = useBlueprintOptions()
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState("")
  const switchTo = async (blueprintId: string) => {
    if (blueprintId === current) return
    const target = options.find(option => option.id === blueprintId)
    const targetName = target ? shortBlueprintName(target.name) : blueprintId
    const question = blueprintId === VIBE_ID
      ? t("stg.switchVibe")
      : t("stg.switchTo", { name: targetName })
    const confirmed = await confirm({
      title: blueprintId === VIBE_ID ? t("stg.wayOfWorking") : targetName,
      description: question,
      confirmLabel: t("common.continue"),
    })
    if (!confirmed) return
    setSwitching(true)
    setError("")
    try {
      onChanged(await requestJson<SessionStages>(`/api/sessions/${encodeURIComponent(sessionId)}/blueprint`, "PUT", { blueprintId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("stg.switchError"))
    } finally {
      setSwitching(false)
    }
  }
  return (
    <label className="ade-stages-switch" title={error || (locked ? t("stg.lockedTitle") : busy ? t("stg.busyTitle") : t("stg.changeTitle"))}>
      <span className="ade-muted">{t("stg.wayOfWorking")}</span>
      <select value={current} disabled={locked || busy || switching} onChange={event => void switchTo(event.target.value)} aria-invalid={Boolean(error)}>
        {(options.length ? options : [{ id: current, name: currentName }]).map(option => <option key={option.id} value={option.id}>{shortBlueprintName(option.name)}</option>)}
      </select>
    </label>
  )
}

function StageDetail({ stage, onOpenFile }: { stage: StageView; onOpenFile?: (path: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="ade-stage-detail">
      <div className="ade-stage-detail-head">
        <strong>{stage.name}</strong>
        <span className="ade-muted ade-xs">{stage.description}</span>
      </div>
      {stage.summary ? <p className="ade-stage-summary">{stage.summary}</p> : <p className="ade-muted ade-xs">{stage.status === "running" ? t("stg.working") : stage.status === "pending" ? t("stg.notStarted") : ""}</p>}
      {stage.checks ? <StageChecksBlock checks={stage.checks} /> : null}
      {stage.review ? <StageReviewBlock review={stage.review} /> : stage.goldfish && stage.status === "running" ? <p className="ade-muted ade-xs">{t("stg.needsReview")}</p> : null}
      {stage.verdict ? (
        <div className={`ade-stage-verdict is-${stage.verdict.outcome}`}>
          <strong>{stage.verdict.outcome === "pass" ? t("stg.reviewPassed") : stage.verdict.outcome === "changes_requested" ? t("stg.reviewChanges") : t("stg.reviewDecision")}</strong>
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
  const { t } = useI18n()
  const marks = { passed: "✓", failed: "✕", skipped: "–" } as const
  const failed = checks.results.filter(result => result.status === "failed").length
  return (
    <div className={`ade-stage-checks ${checks.ok ? "" : "is-failed"}`}>
      <div className="ade-stage-checks-head">
        <strong>{t("stg.checksTitle")}</strong>
        <span className="ade-muted ade-xs">{checks.results.length ? (checks.ok ? t("stg.allPassed") : t("stg.nFailed", { count: failed })) : t("stg.nothingToRun")}{checks.source === "project" ? t("stg.projectScript") : ""}</span>
      </div>
      {checks.results.map(result => (
        <div key={result.command}>
          <div className={`ade-stage-check is-${result.status}`}>
            <span className="ade-stage-check-mark" aria-hidden="true">{marks[result.status]}</span>
            <span>{result.label}</span>
            <code>{result.command}</code>
            {result.status === "skipped" ? <span className="ade-muted ade-xs">{t("stg.notInstalled")}</span> : <span className="ade-muted ade-xs">{result.ms < 1000 ? `${result.ms} ms` : `${(result.ms / 1000).toFixed(1)} s`}</span>}
          </div>
          {result.status === "failed" && result.output ? <pre className="ade-stage-check-output">{result.output}</pre> : null}
        </div>
      ))}
      {checks.missing.length ? <p className="ade-muted ade-xs" style={{ margin: 0 }}>{t("stg.noCommand", { words: checks.missing.join(", ") })}</p> : null}
    </div>
  )
}

/** Proof that the independent review ran: on which model, and what it reported. */
function StageReviewBlock({ review }: { review: NonNullable<StageView["review"]> }) {
  const { t } = useI18n()
  const state = review.status === "running" ? t("stg.reviewing") : review.status === "failed" ? t("stg.reviewFailed") : review.independent ? t("stg.otherFamily") : t("stg.sameFamily")
  return (
    <div className={`ade-stage-checks ${review.status === "failed" ? "is-failed" : ""}`}>
      <div className="ade-stage-checks-head">
        <strong>{t("stg.reviewTitle")}</strong>
        <span className="ade-muted ade-xs">{review.model ?? t("stg.sessionModel")} · {state}</span>
      </div>
      {review.report ? <pre className="ade-stage-check-output">{review.report}</pre> : null}
    </div>
  )
}
