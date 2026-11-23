import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Copy, Download, MessageSquare, RotateCcw, Sparkles, TriangleAlert, Wrench } from "lucide-react"
import { resolveCaptainUrl } from "../../api"
import type { TimelineItem } from "../../app-types"
import { describeToolCall, replaySteps, type ReplayStep, type TranscriptItem } from "../../packages/protocol/transcript.ts"

/**
 * Transcript: step through what the agent did — each message, reply and tool call in order, with
 * its arguments and output — and export the session as Markdown or JSON to share or file a bug.
 */
export function TranscriptPanel({
  sessionId,
  items,
  onRewind,
  workspacePath,
}: {
  sessionId: string
  items: TimelineItem[]
  /** Rewind the workspace's files to before a message (when the session has checkpoints). */
  onRewind?: (content: string) => void
  /** Shown as relative paths in step titles. */
  workspacePath?: string
}) {
  const relative = (text: string) => (workspacePath ? text.split(`${workspacePath}/`).join("") : text)
  const steps = replaySteps(items as TranscriptItem[])
  const [selected, setSelected] = useState<number | null>(null)
  const [notice, setNotice] = useState("")
  const listRef = useRef<HTMLOListElement>(null)
  // Follow the latest step until the user picks one.
  const index = selected === null ? steps.length - 1 : Math.min(selected, steps.length - 1)
  const step: ReplayStep | undefined = steps[index]

  useEffect(() => {
    listRef.current?.querySelector(`[data-step="${index}"]`)?.scrollIntoView({ block: "nearest" })
  }, [index])

  const exportUrl = (format: "md" | "json") => resolveCaptainUrl(`/api/sessions/${encodeURIComponent(sessionId)}/transcript?format=${format}`)

  const copyMarkdown = async () => {
    setNotice("")
    try {
      const response = await fetch(exportUrl("md"))
      if (!response.ok) throw new Error(`The export failed (${response.status}).`)
      await navigator.clipboard.writeText(await response.text())
      setNotice("Copied the transcript as Markdown.")
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not copy.")
    }
  }

  const go = (next: number) => setSelected(Math.max(0, Math.min(steps.length - 1, next)))

  return (
    <div className="ade-pane-body ade-transcript">
      <div className="ade-pane-toolbar">
        <div className="ade-diff-header-meta">
          <button type="button" className="ade-icon-btn" aria-label="Previous step" disabled={index <= 0} onClick={() => go(index - 1)}><ChevronLeft className="size-3.5" /></button>
          <span className="ade-xs">{steps.length ? `Step ${index + 1} of ${steps.length}` : "No steps yet"}</span>
          <button type="button" className="ade-icon-btn" aria-label="Next step" disabled={index >= steps.length - 1} onClick={() => go(index + 1)}><ChevronRight className="size-3.5" /></button>
          {steps.length > 1 ? (
            <input type="range" aria-label="Step" min={0} max={steps.length - 1} value={Math.max(0, index)} onChange={event => go(Number(event.target.value))} className="ade-transcript-range" />
          ) : null}
        </div>
        <div className="ade-toolbar-actions">
          <button type="button" className="ade-chip-btn" onClick={() => void copyMarkdown()} title="Copy the whole session as Markdown"><Copy className="size-3" /> Copy</button>
          <a className="ade-chip-btn" href={exportUrl("md")} download title="Download as Markdown"><Download className="size-3" /> .md</a>
          <a className="ade-chip-btn" href={exportUrl("json")} download title="Download as JSON"><Download className="size-3" /> .json</a>
        </div>
      </div>
      {notice ? <div className="ade-banner-ok" role="status">{notice}</div> : null}
      {!steps.length ? <div className="ade-pane-empty"><p>Nothing has happened in this session yet.</p></div> : (
        <div className="ade-transcript-body">
          <ol className="ade-transcript-steps" ref={listRef} aria-label="Steps">
            {steps.map(item => (
              <li key={item.index} data-step={item.index}>
                <button type="button" className={item.index === index ? "is-selected" : ""} onClick={() => setSelected(item.index)}>
                  <StepIcon step={item} />
                  <span className="ade-truncate">{relative(stepTitle(item))}</span>
                </button>
              </li>
            ))}
          </ol>
          {step ? (
            <section className="ade-transcript-detail" aria-label="Step details">
              <header>
                <StepIcon step={step} />
                <strong>{step.kind === "tool" ? step.call.name : step.kind === "user" ? "You" : step.kind === "reply" ? "Agent" : "Note"}</strong>
                <span className="ade-muted ade-xs">{new Date(step.at).toLocaleTimeString()}</span>
                {step.kind === "tool" ? <span className={`ade-row-tag is-${step.call.isError || step.call.status === "error" ? "failed" : step.call.status === "done" ? "ok" : "running"}`}>{step.call.isError || step.call.status === "error" ? "Failed" : step.call.status === "done" ? "Done" : step.call.status}</span> : null}
              </header>
              {step.kind === "user" ? (
                <>
                  <pre className="ade-transcript-text">{step.text}</pre>
                  {onRewind ? <button type="button" className="ade-chip-btn" onClick={() => onRewind(step.text)}><RotateCcw className="size-3" /> Rewind files to before this message</button> : null}
                </>
              ) : step.kind === "reply" ? (
                <>
                  {step.thinking.trim() ? <details><summary className="ade-xs">Thinking</summary><pre className="ade-transcript-text is-muted">{step.thinking}</pre></details> : null}
                  <pre className="ade-transcript-text">{step.text || "(no text)"}</pre>
                </>
              ) : step.kind === "tool" ? (
                <>
                  <h4>Arguments</h4>
                  <pre className="ade-run-log">{JSON.stringify(step.call.arguments, null, 2)}</pre>
                  <h4>Output</h4>
                  <pre className="ade-run-log">{step.call.output || "(no output)"}</pre>
                </>
              ) : <pre className="ade-transcript-text">{step.text}</pre>}
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}

function stepTitle(step: ReplayStep) {
  if (step.kind === "tool") return `${step.call.name} ${describeToolCall(step.call)}`.trim()
  if (step.kind === "user") return step.text.split("\n")[0]
  if (step.kind === "reply") return step.text.split("\n")[0] || "(thinking)"
  return step.text
}

function StepIcon({ step }: { step: ReplayStep }) {
  if (step.kind === "user") return <MessageSquare className="size-3.5 shrink-0" />
  if (step.kind === "reply") return <Sparkles className="size-3.5 shrink-0" />
  if (step.kind === "tool") return <Wrench className={`size-3.5 shrink-0 ${step.call.isError ? "ade-text-error" : ""}`} />
  return <TriangleAlert className="size-3.5 shrink-0" />
}
