import type { RefObject } from "react"
import { GitBranch, GitPullRequest, Sparkles } from "lucide-react"
import { SearchInput } from "@/components/ui"
import type { BranchItem, CreateFromTab, OpenIssueItem, OpenPullItem } from "./useWorktreeSourceData"

const SOURCE_TABS = [
  { id: "prompt" as const, title: "Task prompt", icon: <Sparkles className="size-3.5" /> },
  { id: "github" as const, title: "GitHub issue or PR", icon: <GitPullRequest className="size-3.5" /> },
  { id: "branch" as const, title: "Existing Git branch", icon: <GitBranch className="size-3.5" /> },
  { id: "name" as const, title: "Custom workspace name", icon: <span className="text-[11.5px] font-semibold">Aa</span> },
]

export function WorktreeSourceTabs({
  inputRef,
  activeRepo,
  fromTab,
  queryText,
  baseBranch,
  branches,
  issues,
  pulls,
  selectedBranch,
  selectedIssue,
  selectedPr,
  onTabChange,
  onQueryChange,
  onBaseBranchChange,
  onSelectBranch,
  onSelectIssue,
  onSelectPr,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  activeRepo: string
  fromTab: CreateFromTab
  queryText: string
  baseBranch: string
  branches: readonly BranchItem[]
  issues: readonly OpenIssueItem[]
  pulls: readonly OpenPullItem[]
  selectedBranch: string
  selectedIssue: OpenIssueItem | null
  selectedPr: OpenPullItem | null
  onTabChange: (tab: CreateFromTab) => void
  onQueryChange: (next: string) => void
  onBaseBranchChange: (next: string) => void
  onSelectBranch: (name: string) => void
  onSelectIssue: (issue: OpenIssueItem) => void
  onSelectPr: (pr: OpenPullItem) => void
}) {
  const q = queryText.trim().toLowerCase()
  const filteredBranches = branches.filter(b => !q || b.name.toLowerCase().includes(q)).slice(0, 8)
  const filteredIssues = issues.filter(i => !q || `#${i.number} ${i.title}`.toLowerCase().includes(q)).slice(0, 6)
  const filteredPulls = pulls.filter(p => !q || `#${p.number} ${p.title}`.toLowerCase().includes(q)).slice(0, 6)

  const placeholder =
    fromTab === "github"
      ? "Search open issues/PRs or enter #1234…"
      : fromTab === "branch"
        ? "Filter or type a Git branch name…"
        : fromTab === "name"
          ? "Give this workspace a name…"
          : "Type a task, #1234, branch, or GitHub URL…"

  return (
    <div className="ade-wt-field">
      <div className="ade-wt-label-row">
        <label htmlFor="wt-create-from">
          Create From <span className="opacity-50 font-normal">[Optional]</span>
        </label>
        {activeRepo ? (
          <div className="ade-wt-branch-pill">
            <GitBranch className="size-3 opacity-70" />
            <select aria-label="Base branch" value={baseBranch} onChange={e => onBaseBranchChange(e.target.value)}>
              <option value={baseBranch}>{baseBranch}</option>
              {branches.filter(b => b.name !== baseBranch).slice(0, 12).map(b => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="ade-wt-tabs" role="tablist" aria-label="Create worktree source">
        {SOURCE_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={fromTab === tab.id}
            title={tab.title}
            className={`ade-wt-tab ${fromTab === tab.id ? "is-active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      <SearchInput
        ref={inputRef}
        id="wt-create-from"
        value={queryText}
        onValueChange={onQueryChange}
        placeholder={placeholder}
        clearLabel="Clear"
        clearOnEscape={false}
      />

      {fromTab === "branch" && filteredBranches.length > 0 ? (
        <div className="ade-wt-pick-list">
          {filteredBranches.map(b => (
            <button
              key={b.name}
              type="button"
              className={`ade-wt-pick-item ${selectedBranch === b.name ? "is-selected" : ""}`}
              onClick={() => onSelectBranch(b.name)}
            >
              <GitBranch className="size-3 opacity-60 shrink-0" />
              <span className="ade-truncate">{b.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {fromTab === "github" && (filteredIssues.length > 0 || filteredPulls.length > 0) ? (
        <div className="ade-wt-pick-list">
          {filteredIssues.map(iss => (
            <button
              key={`iss-${iss.number}`}
              type="button"
              className={`ade-wt-pick-item ${selectedIssue?.number === iss.number ? "is-selected" : ""}`}
              onClick={() => onSelectIssue(iss)}
            >
              <span className="font-mono text-[11px] opacity-60">#{iss.number}</span>
              <span className="ade-truncate">{iss.title}</span>
            </button>
          ))}
          {filteredPulls.map(pr => (
            <button
              key={`pr-${pr.number}`}
              type="button"
              className={`ade-wt-pick-item ${selectedPr?.number === pr.number ? "is-selected" : ""}`}
              onClick={() => onSelectPr(pr)}
            >
              <GitPullRequest className="size-3 opacity-65 shrink-0" />
              <span className="font-mono text-[11px] opacity-60">#{pr.number}</span>
              <span className="ade-truncate">{pr.title}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
