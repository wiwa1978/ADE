import { useState } from "react"
import { Check, CheckCircle2, FileText, MessageSquareWarning } from "lucide-react"
import { MessageContent } from "../../MessageContent"
import type { SessionArtifact } from "../../app-types"

export function ArtifactPanel({
  artifacts,
  activeArtifactId,
  onSelectArtifact,
  onReview,
}: {
  artifacts: SessionArtifact[]
  activeArtifactId?: string
  onSelectArtifact: (id: string) => void
  onReview: (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => Promise<void>
}) {
  const [feedback, setFeedback] = useState("")
  const [showFeedback, setShowFeedback] = useState(false)
  const [busy, setBusy] = useState(false)

  const current = artifacts.find(a => a.id === activeArtifactId) ?? artifacts[0] ?? null

  if (!current) {
    return (
      <div className="ade-pane-empty">
        <FileText className="size-7 opacity-40" />
        <p>No artifacts yet in this session.</p>
        <p className="ade-muted ade-xs">Try <code>/plan</code> to have the agent create an interactive Implementation Plan artifact.</p>
      </div>
    )
  }

  const handleReview = async (decision: "approved" | "changes_requested") => {
    setBusy(true)
    try {
      await onReview(current, decision, decision === "changes_requested" ? feedback : undefined)
      setFeedback("")
      setShowFeedback(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ade-pane-body">
      <div className="ade-pane-toolbar">
        <div className="ade-artifact-tabs">
          {artifacts.map(a => (
            <button
              key={a.id}
              type="button"
              className={`ade-chip-btn ${a.id === current.id ? "is-active" : ""}`}
              onClick={() => onSelectArtifact(a.id)}
            >
              <FileText className="size-3" />
              <span>{a.title}</span>
              {a.status === "awaiting_approval" ? <span className="ade-dot ade-dot-waiting" /> : null}
              {a.status === "approved" ? <CheckCircle2 className="size-3 text-[var(--ok)]" /> : null}
            </button>
          ))}
        </div>
        <span className={`ade-pill ${current.status === "approved" ? "ade-pill-ok" : current.status === "awaiting_approval" ? "ade-pill-warn" : ""}`}>
          {current.status.replace("_", " ")}
        </span>
      </div>

      <div className="ade-pane-scroll ade-artifact-body">
        {current.kind === "html" ? (
          <iframe
            srcDoc={current.content}
            title={current.title}
            className="ade-artifact-html-frame"
            sandbox="allow-scripts"
          />
        ) : (
          <div className="ade-msg-markdown">
            <MessageContent content={current.content} />
          </div>
        )}
      </div>

      {current.status === "awaiting_approval" || current.kind === "plan" ? (
        <div className="ade-artifact-footer">
          {showFeedback ? (
            <div className="ade-artifact-feedback-row">
              <input
                type="text"
                className="ade-input-sm flex-1"
                placeholder="Describe requested changes…"
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void handleReview("changes_requested") }}
              />
              <button type="button" className="ade-btn ade-btn-xs" disabled={busy} onClick={() => setShowFeedback(false)}>Cancel</button>
              <button type="button" className="ade-btn ade-btn-danger ade-btn-xs" disabled={busy || !feedback.trim()} onClick={() => void handleReview("changes_requested")}>
                Send feedback
              </button>
            </div>
          ) : (
            <div className="ade-artifact-actions">
              <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={busy} onClick={() => void handleReview("approved")}>
                <Check className="size-3.5" /> Approve &amp; Proceed
              </button>
              <button type="button" className="ade-btn ade-btn-xs" disabled={busy} onClick={() => setShowFeedback(true)}>
                <MessageSquareWarning className="size-3.5" /> Request changes
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
