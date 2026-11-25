import { useState } from "react"
import { ArrowUp, Bot, GitBranch, Loader2, Square } from "lucide-react"
import { TimelineView } from "../timeline/TimelineView"
import type { ConversationTimelineSnapshot, SubagentInfo } from "../app-types"

export function SubagentPanel({
  subagent,
  liveTimeline,
  onMessage,
  onStop,
  onOpenFile,
  onOpenBrowser,
  onOpenExternalBrowser,
}: {
  subagent: SubagentInfo
  liveTimeline?: ConversationTimelineSnapshot
  onMessage: (subagentId: string, message: string, mode: "steer" | "follow-up") => Promise<void>
  onStop: (subagentId: string) => Promise<void>
  onOpenFile?: (path: string) => void
  onOpenBrowser?: (url?: string) => void
  onOpenExternalBrowser?: (url: string) => void
}) {
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)

  const isRunning = subagent.status === "running" || subagent.status === "waiting" || Boolean(liveTimeline?.busy)

  const effectiveTimeline: ConversationTimelineSnapshot = liveTimeline ?? {
    sessionId: "",
    conversationId: subagent.id,
    busy: isRunning,
    items: subagent.timeline ?? subagent.messages.map(m => (
      m.role === "user"
        ? { id: m.id, kind: "user", content: m.content, createdAt: subagent.createdAt ?? 0 }
        : { id: m.id, kind: "assistant", thinking: "", text: m.content, toolCalls: [], createdAt: subagent.createdAt ?? 0 }
    )),
    liveTools: subagent.liveTools ?? [],
  }

  const handleSend = async (mode: "steer" | "follow-up") => {
    const trimmed = input.trim()
    if (!trimmed) return
    setSending(true)
    try {
      await onMessage(subagent.id, trimmed, mode)
      setInput("")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="ade-pane-body">
      <div className="ade-subagent-header">
        <div className="ade-subagent-header-info">
          <span className={`ade-dot ade-dot-${isRunning ? "running" : subagent.status}`} />
          <Bot className="size-4" />
          <strong>{subagent.name}</strong>
          {subagent.role ? <span className="ade-pill">{subagent.role}</span> : null}
          <span className="ade-pill">{subagent.mode ?? "readonly"}</span>
          {subagent.branch ? (
            <span className="ade-pill ade-mono"><GitBranch className="size-3" /> {subagent.branch}</span>
          ) : null}
          {subagent.model ? <span className="ade-muted ade-xs">{subagent.model}</span> : null}
        </div>
        <div className="ade-subagent-header-actions">
          <span className={`ade-pill ${isRunning ? "ade-pill-accent" : subagent.status === "completed" ? "ade-pill-ok" : subagent.status === "failed" ? "ade-pill-danger" : ""}`}>
            {isRunning ? <><Loader2 className="size-3 animate-spin" /> Running</> : subagent.status}
          </span>
          {isRunning ? (
            <button type="button" className="ade-btn ade-btn-danger ade-btn-xs" onClick={() => void onStop(subagent.id)}>
              <Square className="size-3" /> Stop
            </button>
          ) : null}
        </div>
      </div>

      {subagent.assignment ? (
        <div className="ade-subagent-assignment-bar">
          <span className="ade-muted">Assignment:</span> {subagent.assignment}
        </div>
      ) : null}

      <div className="ade-pane-scroll">
        <TimelineView
          timeline={effectiveTimeline}
          approvals={[]}
          subagents={[]}
          busy={isRunning}
          emptyTitle={`Subagent ${subagent.name}`}
          emptySubtitle="Waiting for subagent activity…"
          onOpenFile={onOpenFile}
          onOpenBrowser={onOpenBrowser}
          onOpenExternalBrowser={onOpenExternalBrowser}
        />
      </div>

      <form
        className="ade-subagent-composer"
        onSubmit={e => {
          e.preventDefault()
          void handleSend(isRunning ? "steer" : "follow-up")
        }}
      >
        <input
          type="text"
          className="ade-input-sm flex-1"
          placeholder={isRunning ? `Steer ${subagent.name}…` : `Send follow-up to ${subagent.name}…`}
          value={input}
          disabled={sending}
          onChange={e => setInput(e.target.value)}
        />
        <button type="submit" className="ade-btn ade-btn-primary ade-btn-xs" disabled={sending || !input.trim()}>
          <ArrowUp className="size-3.5" /> {isRunning ? "Steer" : "Send"}
        </button>
      </form>
    </div>
  )
}
