import { useState } from "react"
import { GitBranch, Play, Workflow } from "lucide-react"
import type { Conversation } from "../../app-types"
import type { FactoryRunDetail } from "../factory/types"
import { relativeTime, sessionStateInfo, type InboxEntry } from "../session-state"

/** The project's sessions as a scannable list: what each agent is doing and what it needs. */
export function ProjectSessionList({
  projectName,
  sessions,
  factoryRuns,
  entries,
  onOpenSession,
  onOpenFactoryRun,
  onQuickStart,
}: {
  projectName: string
  sessions: Conversation[]
  factoryRuns: FactoryRunDetail[]
  entries: Record<string, InboxEntry>
  onOpenSession: (sessionId: string) => void
  onOpenFactoryRun: (runId: string) => void
  onQuickStart: (prompt: string) => Promise<void>
}) {
  const [prompt, setPrompt] = useState("")
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState("")
  const sorted = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  return (
    <div className="ade-session-list">
      <form
        className="ade-quick-start"
        onSubmit={async event => {
          event.preventDefault()
          if (!prompt.trim() || starting) return
          setStarting(true)
          setError("")
          try {
            await onQuickStart(prompt.trim())
            setPrompt("")
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not start the session.")
          } finally {
            setStarting(false)
          }
        }}
      >
        <input
          aria-label={`Start a session in ${projectName}`}
          placeholder={`What should an agent do in ${projectName}? It gets its own branch.`}
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          disabled={starting}
        />
        <button type="submit" className="sf-btn-primary !h-8" disabled={starting || !prompt.trim()}>
          <Play className="size-3.5" /> {starting ? "Starting…" : "Start session"}
        </button>
      </form>
      {error ? <div className="ade-banner-error">{error}</div> : null}

      {sorted.length === 0 && factoryRuns.length === 0 ? (
        <p className="ade-inbox-empty">No sessions yet. Describe a task above, or start one from a GitHub issue.</p>
      ) : (
        <ul className="ade-session-rows">
          {sorted.map(session => {
            const entry = entries[session.id]
            const state = entry?.state ?? (session.status === "working" ? "working" : "idle")
            const info = sessionStateInfo[state]
            return (
              <li key={session.id}>
                <button type="button" onClick={() => onOpenSession(session.id)}>
                  <span className={`ade-state-dot is-${info.tone}`} aria-hidden="true" />
                  <span className="ade-inbox-main">
                    <strong className="ade-truncate">{session.label}</strong>
                    <small className="ade-truncate">
                      {session.workspace?.branch ? <><GitBranch className="inline size-3" /> {session.workspace.branch}</> : session.workspace?.kind === "checkout" ? "Project folder" : "No workspace"}
                      {entry?.uncommitted ? ` · ${entry.uncommitted} uncommitted` : ""}
                      {entry?.commitsAhead ? ` · ${entry.commitsAhead} commit${entry.commitsAhead === 1 ? "" : "s"}` : ""}
                      {entry?.pullRequest ? ` · PR #${entry.pullRequest.number}` : ""}
                    </small>
                  </span>
                  <span className={`ade-row-tag is-${info.tone}`} title={info.hint}>{info.label}</span>
                  <span className="ade-inbox-time">{relativeTime(session.updatedAt)}</span>
                </button>
              </li>
            )
          })}
          {factoryRuns.map(run => (
            <li key={run.run.runId}>
              <button type="button" onClick={() => onOpenFactoryRun(run.run.runId)}>
                <span className={`ade-state-dot is-${run.run.status === "running" ? "running" : run.run.status === "failed" ? "failed" : run.run.status === "completed" ? "ok" : "waiting"}`} aria-hidden="true" />
                <span className="ade-inbox-main">
                  <strong className="ade-truncate"><Workflow className="inline size-3.5" /> {run.run.issueRef?.title || run.taskPrompt || "Factory run"}</strong>
                  <small>Software Factory run{run.run.issueRef?.number ? ` · issue #${run.run.issueRef.number}` : ""}</small>
                </span>
                <span className="ade-row-tag">{run.run.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
