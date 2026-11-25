import { useState } from "react"
import { MessageSquare, RefreshCw, Send } from "lucide-react"
import { Banner, Button, IconButton, Spinner } from "../../../components/ui/index.ts"
import { useI18n } from "../../i18n/I18nContext"
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
  const { t } = useI18n()
  const [showResolved, setShowResolved] = useState(false)
  const items = feedback?.items ?? []
  const resolvedCount = items.filter(item => item.resolved).length
  const visibleFeedback = items.filter(item => showResolved || !item.resolved)
  const askDisabled = Boolean(busy) || agentBusy
  const askTitle = agentBusy ? t("pnlx.pr.agentWorkingTryAgain") : undefined

  return (
    <section className="ade-review-section" aria-label={t("pnlx.pr.reviewCommentsAria")}>
      <header>
        <MessageSquare className="size-3.5" />
        <span>{feedback ? t("pnlx.pr.reviewCommentsOpen", { count: items.length - resolvedCount }) : t("pnlx.pr.reviewComments")}</span>
        <IconButton aria-label={t("pnlx.pr.reloadCommentsAria")} title={t("pnlx.pr.reloadCommentsTitle")} onClick={onReload}>
          <RefreshCw className="size-3" />
        </IconButton>
      </header>
      {feedbackError ? (
        <Banner tone="error">{feedbackError}</Banner>
      ) : !feedback ? (
        <div className="py-2"><Spinner size="xs" label={t("pnlx.pr.loadingComments")} /></div>
      ) : !items.length ? (
        <p>{t("pnlx.pr.noReviewComments")}</p>
      ) : (
        <>
          <ul className="ade-feedback-list">
            {visibleFeedback.map(item => (
              <li key={item.id} className={`ade-feedback-item ${item.resolved ? "is-resolved" : ""}`}>
                <input
                  type="checkbox"
                  aria-label={t("pnlx.pr.includeCommentAria", { author: item.author })}
                  checked={selected.has(item.id)}
                  onChange={event => onToggleSelect(item.id, event.target.checked)}
                />
                <div>
                  <div className="ade-feedback-meta">
                    <strong>{item.author}</strong>
                    {item.path ? (
                      <code>{item.path}{item.line ? `:${item.line}` : ""}</code>
                    ) : (
                      <span>{item.kind === "review" ? (item.state === "CHANGES_REQUESTED" ? t("pnlx.pr.requestedChanges") : t("pnlx.pr.reviewed")) : t("pnlx.pr.commented")}</span>
                    )}
                    {item.resolved ? <span>{t("pnlx.pr.resolved")}</span> : item.outdated ? <span>{t("pnlx.pr.outdated")}</span> : null}
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
                <Send className="size-3.5" /> {busy === "address" ? t("pnlx.pr.sending") : t("pnlx.pr.askAddress", { count: selected.size })}
              </Button>
            ) : null}
            {resolvedCount ? (
              <button type="button" className="ade-link-btn" onClick={() => setShowResolved(value => !value)}>
                {showResolved ? t("pnlx.pr.hideResolved") : t("pnlx.pr.showResolved", { count: resolvedCount })}
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
