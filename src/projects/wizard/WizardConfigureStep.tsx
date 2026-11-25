import { ChevronDown, ChevronRight } from "lucide-react"
import { ModelProfileSelect } from "@/components/ui"
import type { ModelProfileId } from "../../../app-types"
import { BUILTIN_BLUEPRINTS } from "../../../packages/blueprints/index.ts"
import type { GitHubRepositoryPage } from "../../../ProjectsView"
import { useI18n } from "../../i18n/I18nContext"
import { AddProjectSourceFields, type DirBrowserState } from "../AddProjectForms"
import type { ConcreteProjectSource } from "./wizard-helpers"

export interface WizardConfigureStepProps {
  source: ConcreteProjectSource
  busy: boolean
  activeGhLogin: string | null
  ghRepo: string
  cloneLocally: boolean
  cloneParentDir: string
  gitUrl: string
  localPath: string
  detectedGh: string | null
  showInitGit: boolean
  initGitIfMissing: boolean
  showBrowser: boolean
  dirState: DirBrowserState | null
  projectName: string
  createOnGitHub: boolean
  visibility: "private" | "public"
  showAdvanced: boolean
  blueprintId: string
  modelProfile: ModelProfileId
  onGhRepoChange: (val: string) => void
  onCloneLocallyChange: (val: boolean) => void
  onCloneParentDirChange: (val: string) => void
  onGitUrlChange: (val: string) => void
  onLocalPathChange: (val: string) => void
  onProjectNameChange: (val: string) => void
  onInitGitChange: (val: boolean) => void
  onToggleBrowser: () => void
  onCreateOnGitHubChange: (val: boolean) => void
  onVisibilityChange: (val: "private" | "public") => void
  onSearchRepos: (login: string, query: string, page: number, signal?: AbortSignal) => Promise<GitHubRepositoryPage>
  onQuickConnectGh: () => Promise<string | null>
  onPickFolderNative: (target: "local" | "parent") => void
  onDetectRemote: (path: string) => void
  onLoadDirectory: (path?: string) => void
  onUseBrowserFolder: (path: string) => void
  onToggleAdvanced: () => void
  onBlueprintChange: (id: string) => void
  onModelProfileChange: (profile: ModelProfileId) => void
}

export function WizardConfigureStep({
  showAdvanced,
  blueprintId,
  modelProfile,
  onToggleAdvanced,
  onBlueprintChange,
  onModelProfileChange,
  ...sourceProps
}: WizardConfigureStepProps) {
  const { t } = useI18n()

  return (
    <div className="ade-wizard-config-body">
      <AddProjectSourceFields {...sourceProps} />

      <div className="pt-1 border-t border-[rgb(var(--border)/0.65)]">
        <button
          type="button"
          className="flex items-center gap-1.5 text-[11.5px] opacity-65 hover:opacity-100 transition-opacity cursor-pointer bg-transparent border-0 p-0 text-inherit"
          onClick={onToggleAdvanced}
        >
          {showAdvanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span>{t("prjx.wiz.cfg.advancedToggle")}</span>
        </button>
        {showAdvanced ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
            <label className="sf-label">
              <span>{t("prjx.wiz.cfg.wayOfWorking")}</span>
              <select className="sf-field" value={blueprintId} onChange={e => onBlueprintChange(e.target.value)}>
                {[{ id: "vibe", name: t("prjx.wiz.cfg.vibeCoding") }, ...BUILTIN_BLUEPRINTS].map(bp => (
                  <option key={bp.id} value={bp.id}>{bp.name}</option>
                ))}
              </select>
            </label>
            <label className="sf-label">
              <span>{t("prjx.wiz.cfg.modelProfile")}</span>
              <ModelProfileSelect
                value={modelProfile}
                onChange={onModelProfileChange}
                className="w-full"
              />
            </label>
          </div>
        ) : null}
      </div>
    </div>
  )
}
