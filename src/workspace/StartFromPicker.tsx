import { useEffect, useState } from "react"
import { GitBranch, GitPullRequest } from "lucide-react"
import { request } from "../../api"
import { relativeTime } from "../session-state"
import { useI18n } from "../i18n/I18nContext"

/** Where a new worktree session starts: a fresh branch, an existing branch, or a pull request. */
export type StartChoice =
  | { mode: "new" }
  | { mode: "branch"; branch: string }
  | { mode: "pr"; number: number | null; title: string }

type BranchOption = { name: string; remote: boolean; updatedAt: number; subject: string; checkedOutAt: string | null }
type PullOption = { number: number; title: string; author: string; headRefName: string; isDraft: boolean; updatedAt: string }

export function StartFromPicker({
  projectId,
  hasGitHub,
  value,
  onChange,
}: {
  projectId: string
  hasGitHub: boolean
  value: StartChoice
  onChange: (value: StartChoice) => void
}) {
  const { t } = useI18n()
  const [branches, setBranches] = useState<BranchOption[] | null>(null)
  const [pulls, setPulls] = useState<PullOption[] | null>(null)
  const [loadError, setLoadError] = useState("")
  const [filter, setFilter] = useState("")

  useEffect(() => {
    if (value.mode !== "branch" || branches) return
    let cancelled = false
    void request<{ branches: BranchOption[] }>(`/api/projects/${encodeURIComponent(projectId)}/branches`)
      .then(result => { if (!cancelled) setBranches(result.branches) })
      .catch(err => { if (!cancelled) { setBranches([]); setLoadError(err instanceof Error ? err.message : t("wsx.ws.couldNotListBranches")) } })
    return () => { cancelled = true }
  }, [value.mode, projectId, branches, t])

  useEffect(() => {
    if (value.mode !== "pr" || pulls || !hasGitHub) return
    let cancelled = false
    void request<{ pullRequests: PullOption[] }>(`/api/projects/${encodeURIComponent(projectId)}/pulls?state=open`)
      .then(result => { if (!cancelled) setPulls(result.pullRequests) })
      .catch(err => { if (!cancelled) { setPulls([]); setLoadError(err instanceof Error ? err.message : t("wsx.ws.couldNotListPulls")) } })
    return () => { cancelled = true }
  }, [value.mode, projectId, pulls, hasGitHub, t])

  const query = filter.trim().toLowerCase()
  const shownBranches = (branches ?? [])
    .filter(branch => !query || branch.name.toLowerCase().includes(query))
    .sort((a, b) => Number(Boolean(a.checkedOutAt)) - Number(Boolean(b.checkedOutAt)))
    .slice(0, 60)
  const shownPulls = (pulls ?? []).filter(pull => !query || `${pull.number} ${pull.title} ${pull.headRefName} ${pull.author}`.toLowerCase().includes(query))

  return (
    <div className="sf-label">
      <span>{t("wsx.ws.startFrom")}</span>
      <div className="sf-segmented h-9 w-full justify-between" role="radiogroup" aria-label={t("wsx.ws.startFrom")}>
        {([
          { mode: "new", label: t("wsx.ws.newBranch") },
          { mode: "branch", label: t("wsx.ws.existingBranch") },
          { mode: "pr", label: t("wsx.ws.pullRequest") },
        ] as const).map(option => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={value.mode === option.mode}
            className={`sf-seg-btn flex-1 justify-center ${value.mode === option.mode ? "is-active" : ""}`}
            onClick={() => {
              setFilter("")
              setLoadError("")
              onChange(option.mode === "new" ? { mode: "new" } : option.mode === "branch" ? { mode: "branch", branch: "" } : { mode: "pr", number: null, title: "" })
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {value.mode !== "new" ? (
        <div className="ade-start-from">
          <input
            className="sf-field !h-8"
            value={filter}
            placeholder={value.mode === "branch" ? t("wsx.ws.filterBranches") : hasGitHub ? t("wsx.ws.filterPullsOrNumber") : t("wsx.ws.pullRequestNumber")}
            aria-label={value.mode === "branch" ? t("wsx.ws.filterBranches") : t("wsx.ws.findPullRequest")}
            onChange={event => {
              setFilter(event.target.value)
              // A typed PR number works even when the list can't be loaded.
              const number = Number(event.target.value.trim().replace(/^#/, ""))
              if (value.mode === "pr" && Number.isInteger(number) && number > 0) onChange({ mode: "pr", number, title: "" })
            }}
          />
          {loadError ? <p className="ade-start-from-note">{loadError}</p> : null}
          {value.mode === "branch" ? (
            branches === null ? <p className="ade-start-from-note">{t("wsx.ws.loadingBranches")}</p>
              : (
                <ul className="ade-start-from-list" role="listbox" aria-label={t("wsx.ws.branchesAria")}>
                  {shownBranches.map(branch => (
                    <li key={branch.name}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={value.branch === branch.name}
                        disabled={Boolean(branch.checkedOutAt)}
                        title={branch.checkedOutAt ? t("wsx.ws.checkedOutIn", { path: branch.checkedOutAt }) : branch.subject}
                        className={value.branch === branch.name ? "is-selected" : ""}
                        onClick={() => onChange({ mode: "branch", branch: branch.name })}
                      >
                        <GitBranch className="size-3.5" />
                        <span className="ade-start-from-name">{branch.name}</span>
                        <span className="ade-start-from-meta">{branch.checkedOutAt ? t("wsx.ws.inUsePrefix") : branch.remote ? t("wsx.ws.originPrefix") : ""}{relativeTime(branch.updatedAt)}</span>
                      </button>
                    </li>
                  ))}
                  {!shownBranches.length ? <li className="ade-start-from-note">{t("wsx.ws.noBranchesMatch")}</li> : null}
                </ul>
              )
          ) : !hasGitHub ? (
            <p className="ade-start-from-note">{t("wsx.ws.noGitHubLinkedPrNote")}</p>
          ) : pulls === null ? <p className="ade-start-from-note">{t("wsx.ws.loadingPulls")}</p> : (
            <ul className="ade-start-from-list" role="listbox" aria-label={t("wsx.ws.pullRequestsAria")}>
              {shownPulls.map(pull => (
                <li key={pull.number}>
                  <button type="button" role="option" aria-selected={value.number === pull.number} className={value.number === pull.number ? "is-selected" : ""} onClick={() => onChange({ mode: "pr", number: pull.number, title: pull.title })}>
                    <GitPullRequest className="size-3.5" />
                    <span className="ade-start-from-name">#{pull.number} {pull.title}</span>
                    <span className="ade-start-from-meta">{pull.isDraft ? t("wsx.ws.draftPrefix") : ""}{pull.author}</span>
                  </button>
                </li>
              ))}
              {!shownPulls.length ? <li className="ade-start-from-note">{t("wsx.ws.noOpenPullsMatch")}</li> : null}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
