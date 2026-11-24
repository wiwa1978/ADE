import { useState } from "react"
import { MessageSquare, RefreshCw, Send } from "lucide-react"
import { Banner, Button, IconButton, Spinner } from "../../../components/ui/index.ts"
import type { FeedbackItem } from "./usePullRequestState"

interface PrFeedbackSectionProps {
  feedback: { number: number; items: FeedbackItem[] } | null
  feedbackError: string
  selected: Set<string>
  busy: string | null
  agentBusy: boolean
  canAskAgent: boolean
  onReload: () => void
  onToggleSelect: (id: string, checked: boolean) => void
  onAskToAddress: () => void
}

export function PrFeedbackSection({
  feedback,
  feedbackError,
  selected,
  busy,
  agentBusy,
  canAskAgent,
  onReload,
  onToggleSelect,
  onAskToAddress,
}: PrFeedbackSectionProps) {
  const [showResolved, setShowResolved] = useState(false)
  const items = feedback?.items ?? []
  const resolvedCount = items.filter(item => item.resolved).length
  const visibleFeedback = items.filter(item => showResolved || !item.resolved)
  const askDisabled = Boolean(busy) || agentBusy
  const askTitle = agentBusy ? "The agent is working. Try again when it is done." : undefined

  return (
    <section className="ade-review-section" aria-label="Review comments">
      <header>
        <MessageSquare className="size-3.5" />
        <span>Review comments{feedback ? ` · ${items.length - resolvedCount} open` : ""}</span>
        <IconButton aria-label="Reload review comments" title="Reload comments" onClick={onReload}>
          <RefreshCw className="size-3" />
        </IconButton>
      </header>
      {feedbackError ? (
        <Banner tone="error">{feedbackError}</Banner>
      ) : !feedback ? (
        <div className="py-2"><Spinner size="xs" label="Loading comments…" /></div>
      ) : !items.length ? (
        <p>No review comments yet.</p>
      ) : (
        <>
          <ul className="ade-feedback-list">
            {visibleFeedback.map(item => (
              <li key={item.id} className={`ade-feedback-item ${item.resolved ? "is-resolved" : ""}`}>
                <input
                  type="checkbox"
                  aria-label={`Include comment from ${item.author}`}
                  checked={selected.has(item.id)}
                  onChange={event => onToggleSelect(item.id, event.target.checked)}
                />
                <div>
                  <div className="ade-feedback-meta">
                    <strong>{item.author}</strong>
                    {item.path ? (
                      <code>{item.path}{item.line ? `:${item.line}` : ""}</code>
                    ) : (
                      <span>{item.kind === "review" ? (item.state === "CHANGES_REQUESTED" ? "requested changes" : "reviewed") : "commented"}</span>
                    )}
                    {item.resolved ? <span>resolved</span> : item.outdated ? <span>outdated</span> : null}
                  </div>
                  <div className="ade-feedback-body">{item.body}</div>
                  {item.replies?.map((reply, index) => (
                    <div key={index} className="ade-feedback-reply">↳ {reply.author}: {reply.body}</div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="ade-review-actions">
            {canAskAgent ? (
              <Button
                variant="primary"
                size="xs"
                disabled={askDisabled || selected.size === 0}
                loading={busy === "address"}
                title={askTitle}
                onClick={onAskToAddress}
              >
                <Send className="size-3.5" /> {busy === "address" ? "Sending…" : `Ask the agent to address ${selected.size}`}
              </Button>
            ) : null}
            {resolvedCount ? (
              <button type="button" className="ade-link-btn" onClick={() => setShowResolved(value => !value)}>
                {showResolved ? "Hide resolved" : `Show ${resolvedCount} resolved`}
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
