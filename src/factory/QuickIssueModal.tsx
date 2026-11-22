import { useState } from "react"
import { Play, X } from "lucide-react"
import type { Project } from "../../ProjectsView"

export function QuickIssueModal({
  open,
  project,
  busy,
  onClose,
  onStart,
}: {
  open: boolean
  project: Project | null
  busy: boolean
  onClose: () => void
  onStart: (input: { issueNumber?: number; taskPrompt: string; autoStart: boolean }) => Promise<void>
}) {
  const [issueNumber, setIssueNumber] = useState("")
  const [taskPrompt, setTaskPrompt] = useState("")
  const [autoStart, setAutoStart] = useState(true)
  const [error, setError] = useState("")

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const num = issueNumber.trim() ? Number(issueNumber.trim()) : undefined
    if (!taskPrompt.trim() && !Number.isFinite(num)) {
      setError("Enter a task description or a GitHub issue number.")
      return
    }
    setError("")
    await onStart({
      issueNumber: Number.isFinite(num) ? num : undefined,
      taskPrompt: taskPrompt.trim(),
      autoStart,
    })
    setIssueNumber("")
    setTaskPrompt("")
  }

  return (
    <div className="sf-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="sf-modal !max-w-lg" onSubmit={handleSubmit}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold">New Issue / Factory Run</h2>
            <p className="text-xs opacity-65 mt-0.5">
              Inherits repo, blueprint (<strong>{project?.blueprintId ?? "automated-factory"}</strong>), and model policy from{" "}
              <strong>{project?.name ?? "Project"}</strong>.
            </p>
          </div>
          <button type="button" className="sf-btn-ghost" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {error ? <div className="ade-banner-error">{error}</div> : null}

        {project?.githubUrl ? (
          <label className="sf-label">
            <span>GitHub Issue # (optional — pulls title &amp; body from {project.githubUrl.replace(/^https:\/\/github\.com\//i, "")})</span>
            <input
              className="sf-field"
              placeholder="e.g. 42"
              value={issueNumber}
              onChange={e => setIssueNumber(e.target.value)}
            />
          </label>
        ) : null}

        <label className="sf-label">
          <span>Task Description / Requirements</span>
          <textarea
            className="sf-textarea"
            placeholder="Describe the feature, bugfix, or refactor for the Captain and subagents…"
            value={taskPrompt}
            onChange={e => setTaskPrompt(e.target.value)}
            autoFocus
          />
        </label>

        <div className="flex items-center justify-between pt-2 border-t border-[rgb(var(--border)/0.8)]">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={autoStart} onChange={e => setAutoStart(e.target.checked)} />
            <span>Auto-Run to next human gate</span>
          </label>
          <div className="flex gap-2">
            <button type="button" className="sf-btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="sf-btn-primary" disabled={busy}>
              <Play className="size-3.5" /> {busy ? "Starting…" : "Start Run"}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
