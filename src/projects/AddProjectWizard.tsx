import { useEffect, useRef } from "react"
import { ArrowLeft, Cloud, Laptop, Sparkles, X } from "lucide-react"
import { Banner, Button, IconButton, SearchInput, useEscapeKey } from "@/components/ui"
import type { EnvironmentSummary } from "../../app-types"
import type { Project } from "../../ProjectsView"
import { useI18n } from "../i18n/I18nContext"
import { useAddProjectWizard } from "./wizard/useAddProjectWizard"
import { WizardConfigureStep } from "./wizard/WizardConfigureStep"
import { WizardEnvironmentStep } from "./wizard/WizardEnvironmentStep"
import { WizardSourceStep } from "./wizard/WizardSourceStep"

export type AddProjectSource = "menu" | "github" | "url" | "local" | "scratch"

export interface AddProjectWizardProps {
  open: boolean
  initialSource?: AddProjectSource
  githubLogin: string | null
  environments?: EnvironmentSummary[]
  activeEnvironmentId?: string
  existingProjectNames?: string[]
  onSelectEnvironment?: (env: EnvironmentSummary) => Promise<void>
  onAddHost?: () => void
  onClose: () => void
  onCreated: (project: Project, options?: { openSettings?: boolean }) => void
}

export function AddProjectWizard(props: AddProjectWizardProps) {
  if (!props.open) return null
  const remountKey = `${props.initialSource ?? "menu"}:${props.githubLogin ?? ""}:${props.activeEnvironmentId ?? "local"}`
  return <AddProjectWizardDialog key={remountKey} {...props} />
}

function AddProjectWizardDialog({
  initialSource = "menu",
  githubLogin,
  environments = [],
  activeEnvironmentId = "local",
  existingProjectNames = [],
  onSelectEnvironment,
  onAddHost,
  onClose,
  onCreated,
}: AddProjectWizardProps) {
  const { t } = useI18n()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const wizard = useAddProjectWizard({
    initialSource, githubLogin, environments, activeEnvironmentId, existingProjectNames,
    onSelectEnvironment, onAddHost, onClose, onCreated,
  })

  useEscapeKey(() => { if (!wizard.busy) onClose() }, true)

  useEffect(() => {
    if (wizard.step !== "environment" && wizard.step !== "source") return
    const id = setTimeout(() => searchInputRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [wizard.step])

  const sourceTitle =
    wizard.source === "scratch" ? t("prjx.wiz.source.scratch.title")
      : wizard.source === "local" ? t("prjx.wiz.source.local.title")
        : wizard.source === "url" ? t("prjx.wiz.source.url.title")
          : t("prjx.wiz.source.github.title")

  return (
    <div className="ade-cmd-backdrop" onClick={e => { if (e.target === e.currentTarget && !wizard.busy) onClose() }}>
      <div className="ade-wizard-dialog" role="dialog" aria-modal="true" aria-label={t("prjx.wiz.dialogAria")} onKeyDown={wizard.handleStepKeyDown}>
        {wizard.step === "environment" || wizard.step === "source" ? (
          <div className="ade-wizard-search-row">
            {wizard.step === "source" ? (
              <IconButton
                onClick={() => { wizard.setStep("environment"); wizard.setSearchQuery(""); wizard.setActiveIndex(0) }}
                disabled={wizard.busy} aria-label={t("prjx.wiz.backToEnvironments")} title={t("prjx.wiz.backTitle")}
              >
                <ArrowLeft className="size-4" />
              </IconButton>
            ) : null}
            <SearchInput
              ref={searchInputRef}
              className="flex-1 border-0 bg-transparent px-0 focus-within:ring-0"
              inputClassName="ade-cmd-input"
              placeholder={wizard.step === "environment" ? t("prjx.wiz.searchEnvironments") : t("prjx.wiz.searchSources")}
              value={wizard.searchQuery}
              onValueChange={next => { wizard.setSearchQuery(next); wizard.setActiveIndex(0) }}
              disabled={wizard.busy}
              clearOnEscape={false}
            />
            {wizard.step === "source" && wizard.selectedEnv ? (
              <span className="ade-wizard-env-pill">
                {wizard.selectedEnv.kind === "local" ? <Laptop className="size-3" /> : <Cloud className="size-3" />}
                <span>{wizard.selectedEnv.name}</span>
              </span>
            ) : null}
            <IconButton onClick={onClose} disabled={wizard.busy} aria-label={t("prjx.wiz.close")}><X className="size-4" /></IconButton>
          </div>
        ) : (
          <div className="ade-wizard-header-row">
            <div className="flex items-center gap-2 min-w-0">
              <IconButton onClick={() => { wizard.setStep("source"); wizard.setError("") }} disabled={wizard.busy} aria-label={t("prjx.wiz.backToSources")}>
                <ArrowLeft className="size-4" />
              </IconButton>
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold leading-tight truncate">{sourceTitle}</h2>
                <p className="text-[11.5px] opacity-60 truncate">
                  {wizard.selectedEnv ? `${wizard.selectedEnv.name} · ` : ""}{t("prjx.wiz.configureOrSkip")}
                </p>
              </div>
            </div>
            <IconButton onClick={onClose} disabled={wizard.busy} aria-label={t("prjx.wiz.close")}><X className="size-4" /></IconButton>
          </div>
        )}

        {wizard.error ? <div className="px-4 pt-3"><Banner tone="error">{wizard.error}</Banner></div> : null}

        {wizard.step === "environment" ? (
          <WizardEnvironmentStep
            environments={wizard.filteredEnvs} envFilter={wizard.envFilter} activeIndex={wizard.safeEnvIndex}
            activeEnvironmentId={activeEnvironmentId} searchQuery={wizard.searchQuery} busy={wizard.busy}
            hasAddHost={Boolean(onAddHost)}
            onEnvFilterChange={next => { wizard.setEnvFilter(next); wizard.setActiveIndex(0) }}
            onHover={wizard.setActiveIndex}
            onSelectEnvironment={env => void wizard.selectEnvironmentAndAdvance(env)}
            onAddHost={onAddHost ? () => { onClose(); onAddHost() } : undefined}
          />
        ) : null}

        {wizard.step === "source" ? (
          <WizardSourceStep
            sources={wizard.filteredSources} activeIndex={wizard.safeSourceIndex}
            searchQuery={wizard.searchQuery} busy={wizard.busy}
            onHover={wizard.setActiveIndex} onSelect={wizard.selectSourceAndAdvance}
          />
        ) : null}

        {wizard.step === "configure" ? (
          <WizardConfigureStep
            source={wizard.source} busy={wizard.busy} activeGhLogin={wizard.activeGhLogin}
            ghRepo={wizard.ghRepo} cloneLocally={wizard.cloneLocally} cloneParentDir={wizard.cloneParentDir}
            gitUrl={wizard.gitUrl} localPath={wizard.localPath} detectedGh={wizard.detectedGh}
            showInitGit={Boolean(wizard.localPath.trim()) && wizard.localGitStatus === "no-git"}
            initGitIfMissing={wizard.initGitIfMissing} showBrowser={wizard.showBrowser} dirState={wizard.dirState}
            projectName={wizard.projectName} createOnGitHub={wizard.createOnGitHub} visibility={wizard.visibility}
            showAdvanced={wizard.showAdvanced} blueprintId={wizard.blueprintId} modelProfile={wizard.modelProfile}
            onGhRepoChange={wizard.setGhRepo} onCloneLocallyChange={wizard.setCloneLocally}
            onCloneParentDirChange={wizard.setCloneParentDir} onGitUrlChange={wizard.setGitUrl}
            onLocalPathChange={next => { wizard.setLocalPath(next); wizard.setLocalGitStatus("unknown"); wizard.setDetectedGh(null) }}
            onProjectNameChange={wizard.setProjectName} onInitGitChange={wizard.setInitGitIfMissing}
            onToggleBrowser={() => { wizard.setShowBrowser(v => !v); if (!wizard.showBrowser) void wizard.loadDirectory(wizard.localPath || undefined) }}
            onCreateOnGitHubChange={wizard.setCreateOnGitHub} onVisibilityChange={wizard.setVisibility}
            onSearchRepos={wizard.searchRepos} onQuickConnectGh={wizard.quickConnectGh}
            onPickFolderNative={target => void wizard.pickFolderNative(target)}
            onDetectRemote={path => void wizard.detectRemoteForPath(path)}
            onLoadDirectory={path => void wizard.loadDirectory(path)}
            onUseBrowserFolder={path => {
              wizard.setLocalPath(path)
              const nm = path.split(/[\\/]/).filter(Boolean).pop() ?? ""
              if (!wizard.projectName.trim() && nm) wizard.setProjectName(nm)
              wizard.setShowBrowser(false); void wizard.detectRemoteForPath(path)
            }}
            onToggleAdvanced={() => wizard.setShowAdvanced(v => !v)}
            onBlueprintChange={wizard.setBlueprintId} onModelProfileChange={wizard.setModelProfile}
          />
        ) : null}

        <div className="ade-wizard-footer">
          {wizard.step === "environment" || wizard.step === "source" ? (
            <>
              <div className="ade-wizard-hints">
                <span><kbd className="ade-kbd">↑</kbd> <kbd className="ade-kbd">↓</kbd> {t("prjx.wiz.hintNavigate")}</span>
                <span><kbd className="ade-kbd">Enter</kbd> {t("prjx.wiz.hintSelect")}</span>
                {wizard.step === "source" ? <span><kbd className="ade-kbd">Backspace</kbd> {t("prjx.wiz.hintBack")}</span> : null}
                <span><kbd className="ade-kbd">Esc</kbd> {t("prjx.wiz.hintClose")}</span>
              </div>
              <Button variant="ghost" size="sm" className="ade-wizard-skip-btn" onClick={() => void wizard.handleSkipCreateEmpty()} disabled={wizard.busy} title={t("prjx.wiz.skipTitle")}>
                {wizard.busy ? wizard.statusMsg || t("prjx.wiz.creating") : t("prjx.wiz.skip")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="ade-wizard-skip-btn" onClick={() => void wizard.handleSkipCreateEmpty()} disabled={wizard.busy} title={t("prjx.wiz.skipTitle")}>
                {t("prjx.wiz.skip")}
              </Button>
              <div className="flex items-center gap-2">
                {wizard.statusMsg ? <span className="text-[11.5px] opacity-65">{wizard.statusMsg}</span> : null}
                <Button variant="secondary" size="md" onClick={onClose} disabled={wizard.busy}>{t("prjx.wiz.cancel")}</Button>
                <Button variant="primary" size="md" loading={wizard.busy} onClick={() => void wizard.finishCreate()}>
                  {!wizard.busy ? <Sparkles className="size-3.5" /> : null}
                  {wizard.busy ? t("prjx.wiz.creating") : t("prjx.wiz.createProject")}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
