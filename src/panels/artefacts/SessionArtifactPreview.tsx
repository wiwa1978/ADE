import { useState } from "react"
import { ArrowLeft, Check, CheckCircle2, FileText, MessageSquareWarning } from "lucide-react"
import { Badge, Button, Input } from "../../../components/ui/index.ts"
import { MessageContent } from "../../MessageContent"
import type { SessionArtifact } from "../../app-types"
import { getFileExtension } from "../file-preview-utils"
import type { ArtefactFileEntry, EnrichedSessionArtifact } from "./useArtefactsData"

interface SessionArtifactPreviewProps {
  scope: "session" | "project"
  artifact: EnrichedSessionArtifact
  allArtifacts: EnrichedSessionArtifact[]
  workspacePath?: string | null
  onBack: () => void
  onSelectArtifact: (id: string) => void
  onOpenFile: (file: ArtefactFileEntry) => void
  onOpenSession?: (sessionId: string) => void
  onReview?: (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => Promise<void>
}

export function SessionArtifactPreview({
  scope,
  artifact,
  allArtifacts,
  workspacePath,
  onBack,
  onSelectArtifact,
  onOpenFile,
  onOpenSession,
  onReview,
}: SessionArtifactPreviewProps) {
  const [feedback, setFeedback] = useState("")
  const [showFeedback, setShowFeedback] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)

  const handleReview = async (decision: "approved" | "changes_requested") => {
    if (!onReview) return
    setReviewBusy(true)
    try {
      await onReview(artifact, decision, decision === "changes_requested" ? feedback : undefined)
      setFeedback("")
      setShowFeedback(false)
    } finally {
      setReviewBusy(false)
    }
  }

  const statusTone = artifact.status === "approved"
    ? "ok"
    : artifact.status === "awaiting_approval"
      ? "warn"
      : "neutral"

  return (
    <div className="ade-pane-body">
      <div className="ade-pane-toolbar">
        <div className="ade-artifact-tabs">
          <button
            type="button"
            className="ade-chip-btn"
            onClick={onBack}
            title="Show all artefacts"
          >
            <ArrowLeft className="size-3" /> All artefacts
          </button>
          {allArtifacts.map(a => (
            <button
              key={a.id}
              type="button"
              className={`ade-chip-btn ${a.id === artifact.id ? "is-active" : ""}`}
              onClick={() => onSelectArtifact(a.id)}
            >
              <FileText className="size-3" />
              <span>{a.title}</span>
              {a.status === "awaiting_approval" ? <span className="ade-dot ade-dot-waiting" /> : null}
              {a.status === "approved" ? <CheckCircle2 className="size-3 text-[var(--ok)]" /> : null}
            </button>
          ))}
        </div>
        <div className="ade-toolbar-actions">
          {scope === "project" && onOpenSession && artifact.sessionId ? (
            <Button variant="chip" size="xs" onClick={() => onOpenSession(artifact.sessionId)}>
              Open session
            </Button>
          ) : null}
          <Badge tone={statusTone}>{artifact.status.replace("_", " ")}</Badge>
        </div>
      </div>

      <div className="ade-pane-scroll ade-artifact-body">
        {artifact.kind === "html" ? (
          <iframe
            srcDoc={artifact.content}
            title={artifact.title}
            className="ade-artifact-html-frame"
            sandbox="allow-scripts"
          />
        ) : (
          <div className="ade-msg-markdown">
            <MessageContent
              content={artifact.content}
              onOpenFile={p => onOpenFile({ path: p, name: p.split("/").pop() || p, ext: getFileExtension(p) })}
              workspacePath={workspacePath}
            />
          </div>
        )}
      </div>

      {onReview && (artifact.status === "awaiting_approval" || artifact.kind === "plan") ? (
        <div className="ade-artifact-footer">
          {showFeedback ? (
            <div className="ade-artifact-feedback-row">
              <Input
                type="text"
                inputSize="sm"
                className="flex-1"
                placeholder="Describe requested changes…"
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void handleReview("changes_requested") }}
              />
              <Button variant="secondary" size="xs" disabled={reviewBusy} onClick={() => setShowFeedback(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="xs"
                loading={reviewBusy}
                disabled={!feedback.trim()}
                onClick={() => void handleReview("changes_requested")}
              >
                Send feedback
              </Button>
            </div>
          ) : (
            <div className="ade-artifact-actions">
              <Button
                variant="primary"
                size="xs"
                loading={reviewBusy}
                onClick={() => void handleReview("approved")}
              >
                <Check className="size-3.5" /> Approve &amp; Proceed
              </Button>
              <Button
                variant="secondary"
                size="xs"
                disabled={reviewBusy}
                onClick={() => setShowFeedback(true)}
              >
                <MessageSquareWarning className="size-3.5" /> Request changes
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
