import { useCallback, useEffect, useState } from "react"
import { GitBranch, Maximize2, Send, X } from "lucide-react"
import { request } from "../../api"
import type { Conversation, ConversationTimelineSnapshot, WorkspaceGitSummary } from "../../app-types"
import { useEventStreamListener } from "../hooks/useEventStream"
import { DiffPanel } from "../panels/DiffPanel"

const EMPTY_GIT: WorkspaceGitSummary = {
  isGitRepo: false,
  branch: null,
  ahead: 0,
  behind: 0,
  additions: 0,
  deletions: 0,
  files: [],
}

export function LiveSessionPane({
  session,
  focused,
  onFocus,
  onMaximize,
  onClose,
  onSendQuickMessage,
}: {
  session: Conversation
  focused: boolean
  onFocus: () => void
  onMaximize: () => void
  onClose: () => void
  onSendQuickMessage: (session: Conversation, text: string) => Promise<void>
}) {
  const [timeline, setTimeline] = useState<ConversationTimelineSnapshot | null>(null)
  const [gitSummary, setGitSummary] = useState<WorkspaceGitSummary>(EMPTY_GIT)
  const [paneView, setPaneView] = useState<"chat" | "diff">("chat")
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const snap = await request<ConversationTimelineSnapshot>(
        `/api/sessions/${encodeURIComponent(session.id)}/timeline`,
      )
      setTimeline(snap)
    } catch (err) {
      console.warn("[ADE] Failed to refresh stream pane timeline:", err instanceof Error ? err.message : String(err))
    }
  }, [session.id])

  const refreshGit = useCallback(async () => {
    try {
      const summary = await request<WorkspaceGitSummary>(
        `/api/workspace/git?sessionId=${encodeURIComponent(session.id)}`,
      )
      if (summary) setGitSummary(summary)
    } catch (err) {
      console.warn("[ADE] Failed to refresh stream pane git summary:", err instanceof Error ? err.message : String(err))
    }
  }, [session.id])

  useEffect(() => {
    let cancelled = false
    void request<ConversationTimelineSnapshot>(`/api/sessions/${encodeURIComponent(session.id)}/timeline`)
      .then(snap => { if (!cancelled) setTimeline(snap) })
      .catch(err => console.warn("[ADE] Failed to refresh stream pane timeline:", err instanceof Error ? err.message : String(err)))
    void request<WorkspaceGitSummary>(`/api/workspace/git?sessionId=${encodeURIComponent(session.id)}`)
      .then(summary => { if (!cancelled && summary) setGitSummary(summary) })
      .catch(err => console.warn("[ADE] Failed to refresh stream pane git summary:", err instanceof Error ? err.message : String(err)))
    return () => { cancelled = true }
  }, [session.id])

  const handleStreamMessage = useCallback(
    (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data)
        if (parsed?.sessionId === session.id || parsed?.payload?.sessionId === session.id) {
          void refresh()
          void refreshGit()
        }
      } catch (err) {
        console.warn("[ADE] Ignored malformed stream SSE message:", err instanceof Error ? err.message : String(err))
      }
    },
    [session.id, refresh, refreshGit],
  )
  useEventStreamListener("timeline.updated", handleStreamMessage)
  useEventStreamListener("message", handleStreamMessage)

  const items = timeline?.items ?? []
  const isWorking = session.status === "working" || Boolean(timeline?.busy)
  const changedCount = gitSummary.files.length

  async function submit() {
    const trimmed = draft.trim()
    if (!trimmed || sending) return
    setDraft("")
    setSending(true)
    try {
      await onSendQuickMessage(session, trimmed)
      await refresh()
      await refreshGit()
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      className={`ade-stream-pane ${focused ? "is-focused" : ""}`}
      onClick={onFocus}
    >
      <header className="ade-stream-pane-head">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`ade-dot ade-dot-${isWorking ? "running" : session.workspace?.status === "attention" ? "failed" : "completed"}`} />
          <GitBranch className="size-3.5 opacity-70 shrink-0" />
          <span className="text-[12.5px] font-semibold truncate">{session.label}</span>
          {session.workspace?.branch || gitSummary.branch ? (
            <span className="ade-pill !text-[10.5px] font-mono">{session.workspace?.branch || gitSummary.branch}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="ade-segmented" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className={paneView === "chat" ? "is-active" : ""}
              onClick={() => setPaneView("chat")}
            >
              Stream
            </button>
            <button
              type="button"
              className={paneView === "diff" ? "is-active" : ""}
              onClick={() => { setPaneView("diff"); void refreshGit() }}
              title="Inspect git diff for this session"
            >
              Diff{changedCount > 0 ? ` (${changedCount})` : ""}
            </button>
          </div>
          <button
            type="button"
            className="ade-icon-btn !w-6 !h-6"
            title="Open full workspace (Terminal, Diff, Files, Browser)"
            onClick={e => { e.stopPropagation(); onMaximize() }}
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="ade-icon-btn !w-6 !h-6"
            title="Close pane (keeps stream in sidebar)"
            onClick={e => { e.stopPropagation(); onClose() }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      {paneView === "diff" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <DiffPanel sessionId={session.id} summary={gitSummary} onRefresh={() => void refreshGit()} />
        </div>
      ) : (
        <>
          <div className="ade-stream-pane-body">
            {items.length === 0 ? (
              <div className="my-auto text-center py-6 px-3 opacity-65">
                <div className="text-[12.5px] font-medium">Stream ready</div>
                <div className="text-[11.5px] mt-1">
                  Send a message below, switch to Diff to inspect changes, or click Maximize for Terminal &amp; Browser.
                </div>
              </div>
            ) : (
              items.slice(-12).map(entry => {
                if (entry.kind === "user") {
                  return (
                    <div key={entry.id} className="flex justify-end">
                      <div className="max-w-[88%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed bg-[rgb(var(--surface-raised))] border border-[rgb(var(--border)/0.8)] whitespace-pre-wrap break-words">
                        {entry.content}
                      </div>
                    </div>
                  )
                }
                if (entry.kind === "error") {
                  return (
                    <div key={entry.id} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[12px] text-rose-300">
                      {entry.message}
                    </div>
                  )
                }
                if (entry.kind === "compaction") {
                  return (
                    <div key={entry.id} className="text-[11px] opacity-60 italic">
                      {entry.summary}
                    </div>
                  )
                }
                const tools = entry.toolCalls ?? []
                return (
                  <div key={entry.id} className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed">
                    {tools.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {tools.slice(0, 6).map(tc => (
                          <span key={tc.callId} className="ade-pill !text-[10.5px] font-mono">
                            {tc.name}
                          </span>
                        ))}
                        {tools.length > 6 ? <span className="ade-pill !text-[10.5px]">+{tools.length - 6}</span> : null}
                      </div>
                    ) : null}
                    {entry.text ? (
                      <div className="whitespace-pre-wrap break-words opacity-90">
                        {entry.text.length > 600 ? `${entry.text.slice(0, 600)}…` : entry.text}
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
            {isWorking ? (
              <div className="flex items-center gap-2 text-[11.5px] opacity-70">
                <span className="ade-dot ade-dot-running" /> Working…
              </div>
            ) : null}
          </div>

          <form
            className="ade-stream-pane-composer"
            onSubmit={e => { e.preventDefault(); void submit() }}
          >
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={`Message ${session.label}…`}
              disabled={sending}
            />
            <button
              type="submit"
              className="ade-icon-btn !w-7 !h-7"
              disabled={sending || !draft.trim()}
              title="Send to stream"
            >
              <Send className="size-3.5" />
            </button>
          </form>
        </>
      )}
    </section>
  )
}
