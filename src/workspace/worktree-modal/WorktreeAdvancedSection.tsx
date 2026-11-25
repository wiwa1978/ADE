import { ChevronDown, ChevronUp } from "lucide-react"
import { FolderPathInput } from "@/components/ui"
import type { TaskStart } from "../../../app-types"
import { useI18n } from "../../i18n/I18nContext"

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
  const { t } = useI18n()
  return (
    <div>
      <button
        type="button"
        className="ade-wt-advanced-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{t("wsx.ws.advanced")}</span>
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>

      {open ? (
        <div className="ade-wt-advanced-body">
          <div className="ade-wt-grid-2">
            <div className="ade-wt-field">
              <label htmlFor="wt-kind">{t("wsx.ws.workspaceMode")}</label>
              <select
                id="wt-kind"
                className="ade-wt-select"
                value={kind}
                onChange={e => onKindChange(e.target.value as TaskStart["kind"])}
              >
                <option value="worktree">{t("wsx.ws.modeWorktree")}</option>
                <option value="checkout">{t("wsx.ws.modeCheckout")}</option>
                <option value="none">{t("wsx.ws.modeNone")}</option>
              </select>
            </div>
            <div className="ade-wt-field">
              <label htmlFor="wt-attempts">{t("wsx.ws.parallelAttempts")}</label>
              <select
                id="wt-attempts"
                className="ade-wt-select"
                value={attempts}
                onChange={e => onAttemptsChange(Number(e.target.value))}
              >
                <option value={1}>{t("wsx.ws.agentsOne")}</option>
                <option value={2}>{t("wsx.ws.parallelBranchesTwo")}</option>
                <option value={3}>{t("wsx.ws.parallelBranchesThree")}</option>
              </select>
            </div>
          </div>

          {kind !== "none" && !activeRepo ? (
            <div className="ade-wt-field">
              <label htmlFor="wt-folder">{t("wsx.ws.localFolderPath")}</label>
              <FolderPathInput
                id="wt-folder"
                value={manualRepo}
                onChange={onManualRepoChange}
                placeholder="/Users/you/Code/my-project"
                browseLabel={t("wsx.ws.browse")}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
