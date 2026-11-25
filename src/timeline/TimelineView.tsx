import { memo, useEffect, useRef } from "react"
import { AlertTriangle, ExternalLink, Globe } from "lucide-react"
import { Button, Spinner } from "../../components/ui/index.ts"
import { useI18n } from "../i18n/I18nContext"
import { MessageContent } from "../../MessageContent"
import { WorkspaceEmptyHero } from "../workspace/WorkspaceEmptyHero"
import type {
  ConversationMessage,
  ConversationTimelineSnapshot,
  PendingApproval,
  SubagentInfo,
  TimelineItem,
} from "../../app-types"
import { ApprovalCard } from "./ApprovalCard"
import { ThinkingBlock } from "./ThinkingBlock"
import { ToolCallCard } from "./ToolCallCard"

function extractLocalUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s)"'`]*/gi) ?? []
  return [...new Set(matches)].slice(0, 3)
}

export interface TimelineViewProps {
  timeline: ConversationTimelineSnapshot | null
  fallbackMessages?: ConversationMessage[]
  approvals: PendingApproval[]
  subagents: SubagentInfo[]
  busy: boolean
  workspacePath?: string | null
  emptyTitle?: string
  emptySubtitle?: string
  onResolveApproval?: (id: string, decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => Promise<void>
  onOpenFile?: (path: string) => void
  onOpenSubagent?: (subagentId: string) => void
  onOpenBrowser?: (url?: string) => void
  onOpenExternalBrowser?: (url: string) => void
  onOpenArtifact?: (artifactId?: string) => void
  /** Offer "Rewind files to before this message" on user messages (coding sessions with a workspace). */
  onRewind?: (messageContent: string) => void
}

export const TimelineView = memo(function TimelineView({
  timeline,
  fallbackMessages,
  approvals,
  subagents,
  busy,
  workspacePath,
  emptyTitle,
  emptySubtitle,
  onResolveApproval,
  onOpenFile,
  onOpenSubagent,
  onOpenBrowser,
  onOpenExternalBrowser,
  onOpenArtifact,
  onRewind,
}: TimelineViewProps) {
  const { t } = useI18n()
  const endRef = useRef<HTMLDivElement>(null)

  const items: TimelineItem[] = timeline && timeline.items.length > 0
    ? timeline.items
    : (fallbackMessages ?? []).map<TimelineItem>(m => {
        if (m.role === "user") return { id: m.id, kind: "user", content: m.content, createdAt: m.createdAt }
        if (m.role === "error") return { id: m.id, kind: "error", message: m.content, createdAt: m.createdAt }
        return { id: m.id, kind: "assistant", thinking: "", text: m.content, toolCalls: [], createdAt: m.createdAt }
      })

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [items.length, approvals.length, busy])

  return (
    <div className="ade-timeline">
      {items.length === 0 && approvals.length === 0 ? (
        <WorkspaceEmptyHero
          title={emptyTitle || t("tl.readyToBuild")}
          subtitle={emptySubtitle || t("tl.emptySubtitle")}
        />
      ) : null}

      {items.map(item => {
        if (item.kind === "user") {
          return (
            <div key={item.id} className="ade-msg ade-msg-user">
              <div className="ade-msg-user-bubble">{item.content}</div>
              {onRewind && !busy ? (
                <button
                  type="button"
                  className="ade-msg-rewind"
                  onClick={() => onRewind(item.content)}
                  title={t("tl.rewindTitle")}
                >
                  ↺ Rewind files to here
                </button>
              ) : null}
            </div>
          )
        }
        if (item.kind === "compaction") {
          return (
            <div key={item.id} className="ade-compaction-divider">
              <span>{t("tl.compacted")}</span>
            </div>
          )
        }
        if (item.kind === "error") {
          return (
            <div key={item.id} className="ade-msg-error">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{item.message}</span>
            </div>
          )
        }
        const localUrls = item.text ? extractLocalUrls(item.text) : []
        return (
          <div key={item.id} className={`ade-msg ade-msg-assistant ${item.streaming ? "is-streaming" : ""}`}>
            {item.thinking ? <ThinkingBlock text={item.thinking} streaming={item.streaming} /> : null}
            {item.toolCalls.length > 0 ? (
              <div className="ade-tool-stack">
                {item.toolCalls.map(tc => (
                  <ToolCallCard
                    key={tc.callId}
                    tool={tc}
                    subagents={subagents}
                    workspacePath={workspacePath}
                    onOpenFile={onOpenFile}
                    onOpenSubagent={onOpenSubagent}
                    onOpenBrowser={onOpenBrowser}
                    onOpenArtifact={onOpenArtifact}
                  />
                ))}
              </div>
            ) : null}
            {item.text ? (
              <div className="ade-msg-markdown">
                <MessageContent content={item.text} onOpenFile={onOpenFile} workspacePath={workspacePath} />
              </div>
            ) : null}
            {localUrls.length > 0 && (onOpenBrowser || onOpenExternalBrowser) ? (
              <div className="ade-url-pills">
                {localUrls.map(url => (
                  <div key={url} className="ade-url-pill-group">
                    {onOpenBrowser ? (
                      <Button variant="chip" size="xs" onClick={() => onOpenBrowser(url)}>
                        <Globe className="size-3" /> {t("tl.preview", { url })}
                      </Button>
                    ) : null}
                    {onOpenExternalBrowser ? (
                      <Button
                        variant="chip"
                        size="xs"
                        onClick={() => onOpenExternalBrowser(url)}
                        title={t("tl.openExternal")}
                        aria-label={`Open ${url} in external browser`}
                      >
                        <ExternalLink className="size-3" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}

      {approvals.length > 0 && onResolveApproval ? (
        <div className="ade-approval-stack">
          {approvals.map(a => (
            <ApprovalCard key={a.id} approval={a} onResolve={onResolveApproval} />
          ))}
        </div>
      ) : null}

      {timeline?.runFailure ? (
        <div className="ade-msg-error">
          <AlertTriangle className="size-4 shrink-0" />
          <span>Run stopped ({timeline.runFailure.reason}){timeline.runFailure.detail ? `: ${timeline.runFailure.detail}` : ""}</span>
        </div>
      ) : null}

      {busy ? (
        <div className="ade-working-indicator">
          <Spinner size="sm" label={t("tl.agentWorking")} />
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  )
})
