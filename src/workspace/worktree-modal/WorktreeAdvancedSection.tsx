import { ChevronDown, ChevronUp } from "lucide-react"
import { FolderPathInput } from "@/components/ui"
import type { TaskStart } from "../../../app-types"

export function WorktreeAdvancedSection({
  open,
  kind,
  attempts,
  activeRepo,
  manualRepo,
  onToggle,
  onKindChange,
  onAttemptsChange,
  onManualRepoChange,
}: {
  open: boolean
  kind: TaskStart["kind"]
  attempts: number
  activeRepo: string
  manualRepo: string
  onToggle: () => void
  onKindChange: (kind: TaskStart["kind"]) => void
  onAttemptsChange: (attempts: number) => void
  onManualRepoChange: (path: string) => void
}) {
  return (
    <div>
      <button
        type="button"
        className="ade-wt-advanced-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>Advanced</span>
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>

      {open ? (
        <div className="ade-wt-advanced-body">
          <div className="ade-wt-grid-2">
            <div className="ade-wt-field">
              <label htmlFor="wt-kind">Workspace mode</label>
              <select
                id="wt-kind"
                className="ade-wt-select"
                value={kind}
                onChange={e => onKindChange(e.target.value as TaskStart["kind"])}
              >
                <option value="worktree">New branch (worktree)</option>
                <option value="checkout">Direct checkout</option>
                <option value="none">Chat only</option>
              </select>
            </div>
            <div className="ade-wt-field">
              <label htmlFor="wt-attempts">Parallel attempts</label>
              <select
                id="wt-attempts"
                className="ade-wt-select"
                value={attempts}
                onChange={e => onAttemptsChange(Number(e.target.value))}
              >
                <option value={1}>1 agent</option>
                <option value={2}>2 parallel branches</option>
                <option value={3}>3 parallel branches</option>
              </select>
            </div>
          </div>

          {kind !== "none" && !activeRepo ? (
            <div className="ade-wt-field">
              <label htmlFor="wt-folder">Local folder path</label>
              <FolderPathInput
                id="wt-folder"
                value={manualRepo}
                onChange={onManualRepoChange}
                placeholder="/Users/you/Code/my-project"
                browseLabel="Browse…"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
