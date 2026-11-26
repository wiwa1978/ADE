import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FolderPlus, Laptop, Layers, SlidersHorizontal, X } from "lucide-react"
import { Banner, Button, IconButton, Switch, useEscapeKey } from "@/components/ui"
import { BUILTIN_BLUEPRINTS } from "@ade/blueprints"
import type { TaskStart } from "../app-types"
import { useBlueprintOptions } from "../blueprints/blueprint-options"
import type { Project } from "../ProjectsView"
import { targetLabel, targetUnavailable, useRunTargets, type RunTarget } from "../run-targets"
import {
  buildWorktreeCreatePayload,
  useWorktreeSourceData,
  type CreateFromTab,
  type OpenIssueItem,
  type OpenPullItem,
  type WorktreeCreatePayload,
} from "./worktree-modal/useWorktreeSourceData"
import { WorktreeAdvancedSection } from "./worktree-modal/WorktreeAdvancedSection"
import { WorktreeSourceTabs } from "./worktree-modal/WorktreeSourceTabs"
import { useI18n } from "../i18n/I18nContext"

export interface CreateWorktreeModalProps {
  open: boolean
  projects: Project[]
  initialProjectId: string | null
  environmentName: string
  starting: boolean
  error: string
  onClose: () => void
  onAddProject: () => void
  onOpenProviderSettings: () => void
  onCreate: (input: WorktreeCreatePayload) => Promise<string | null | void>
}

export function CreateWorktreeModal(props: CreateWorktreeModalProps) {
  if (!props.open) return null
  return <CreateWorktreeModalDialog key={props.initialProjectId ?? ""} {...props} />
}

function CreateWorktreeModalDialog({
  projects, initialProjectId, environmentName, starting, error,
  onClose, onAddProject, onOpenProviderSettings, onCreate,
}: CreateWorktreeModalProps) {
  const { t } = useI18n()
  const unarchived = useMemo(() => projects.filter(p => !p.archivedAt), [projects])
  const initialProject = unarchived.find(p => p.id === initialProjectId) ?? unarchived[0] ?? null

  const [projectId, setProjectId] = useState<string>(initialProject?.id ?? "")
  const [runOn, setRunOn] = useState<RunTarget>("local")
  const [fromTab, setFromTab] = useState<CreateFromTab>("prompt")
  const [queryText, setQueryText] = useState("")
  const [selectedBranch, setSelectedBranch] = useState("")
  const [selectedPr, setSelectedPr] = useState<OpenPullItem | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<OpenIssueItem | null>(null)
  const [blueprintId, setBlueprintId] = useState<string>(initialProject?.blueprintId || "vibe")
  const blueprintOptions = useBlueprintOptions()
  const [kind, setKind] = useState<TaskStart["kind"]>(initialProject?.repository ? "worktree" : "checkout")
  const [attempts, setAttempts] = useState(1)
  const [manualRepo, setManualRepo] = useState(initialProject?.repository ?? "")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [createMore, setCreateMore] = useState(false)
  const [localError, setLocalError] = useState("")

  const inputRef = useRef<HTMLInputElement>(null)
  const runTargets = useRunTargets()
  const activeProject = unarchived.find(p => p.id === projectId) ?? null
  const activeProjectId = activeProject?.id ?? null
  const activeRepo = activeProject?.repository ?? ""
  const activeGithubUrl = activeProject?.githubUrl ?? ""
  const effectiveRepo = activeRepo || manualRepo.trim()

  const { branches, baseBranch, setBaseBranch, issues, pulls } = useWorktreeSourceData({
    projectId, activeRepo, activeGithubUrl, fromTab,
  })

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [fromTab])

  const canCreate = !starting && (kind === "none" || Boolean(effectiveRepo)) && (
    Boolean(queryText.trim()) || Boolean(selectedBranch) || Boolean(selectedPr) || Boolean(selectedIssue)
  )

  const submitCreate = useCallback(async () => {
    if (!canCreate) {
      if (kind !== "none" && !effectiveRepo) {
        setLocalError(t("wsx.ws.attachRepoError"))
        setAdvancedOpen(true)
      }
      return
    }
    setLocalError("")
    try {
      const effectiveBlueprint = activeProject?.blueprintLocked ? (activeProject.blueprintId || "vibe") : blueprintId
      await onCreate(buildWorktreeCreatePayload({
        projectId: activeProjectId, kind, effectiveRepo, fromTab, queryText,
        selectedBranch, selectedPr, selectedIssue, engine: "pi", blueprintId: effectiveBlueprint, runOn, attempts,
      }))
      if (createMore) {
        setQueryText(""); setSelectedBranch(""); setSelectedPr(null); setSelectedIssue(null)
        inputRef.current?.focus()
      } else {
        onClose()
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t("wsx.ws.couldNotCreateWorktree"))
    }
  }, [
    activeProject, activeProjectId, attempts, blueprintId, canCreate, createMore, effectiveRepo,
    fromTab, kind, onClose, onCreate, queryText, runOn, selectedBranch, selectedIssue, selectedPr, t,
  ])

  useEscapeKey(() => { if (!starting) onClose() }, true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submitCreate() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [submitCreate])

  const availableTargets = runTargets?.available ?? ["local", "docker"]

  return (
    <div className="ade-cmd-backdrop" onClick={e => { if (e.target === e.currentTarget && !starting) onClose() }}>
      <div className="ade-wt-modal" role="dialog" aria-modal="true" aria-label={t("wsx.ws.createWorktree")}>
        <div className="ade-wt-head">
          <h2>{t("wsx.ws.createWorktree")}</h2>
          <IconButton onClick={onClose} disabled={starting} aria-label={t("wsx.ws.close")}><X className="size-4" /></IconButton>
        </div>

        {(error || localError) ? <div className="px-5"><Banner tone="error">{localError || error}</Banner></div> : null}

        <div className="ade-wt-body">
          <div className="ade-wt-grid-2">
            <div className="ade-wt-field">
              <div className="ade-wt-label-row">
                <label htmlFor="wt-project">{t("wsx.ws.project")}</label>
                <IconButton title={t("wsx.ws.addNewProject")} aria-label={t("wsx.ws.addNewProject")} onClick={() => { onClose(); onAddProject() }}>
                  <FolderPlus className="size-3.5" />
                </IconButton>
              </div>
              <select
                id="wt-project" className="ade-wt-select" value={projectId}
                onChange={e => {
                  const id = e.target.value
                  setProjectId(id)
                  const next = unarchived.find(p => p.id === id)
                  setManualRepo(next?.repository ?? ""); setKind(next?.repository ? "worktree" : "checkout")
                  setBlueprintId(next?.blueprintId || "vibe")
                  setSelectedBranch(""); setSelectedPr(null); setSelectedIssue(null)
                }}
              >
                {unarchived.length === 0 ? <option value="">{t("wsx.ws.noProjectsYet")}</option> : null}
                {unarchived.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div className="ade-wt-field">
              <div className="ade-wt-label-row"><label htmlFor="wt-run-on">{t("wsx.ws.runOn")}</label></div>
              <div className="ade-wt-select-wrap">
                <Laptop className="size-3.5 opacity-60 shrink-0" />
                <select id="wt-run-on" className="ade-wt-select-bare" value={runOn} onChange={e => setRunOn(e.target.value as RunTarget)}>
                  {availableTargets.map(target => {
                    const blocked = runTargets?.docker ? targetUnavailable(target, runTargets, { sshHost: "" }) : ""
                    return <option key={target} value={target} disabled={Boolean(blocked)}>{target === "local" ? environmentName : targetLabel(target)}</option>
                  })}
                </select>
              </div>
            </div>
          </div>

          <WorktreeSourceTabs
            inputRef={inputRef} activeRepo={activeRepo} fromTab={fromTab} queryText={queryText}
            baseBranch={baseBranch} branches={branches} issues={issues} pulls={pulls}
            selectedBranch={selectedBranch} selectedIssue={selectedIssue} selectedPr={selectedPr}
            onTabChange={tab => { setFromTab(tab); setSelectedBranch(""); setSelectedPr(null); setSelectedIssue(null) }}
            onQueryChange={setQueryText} onBaseBranchChange={setBaseBranch}
            onSelectBranch={name => { setSelectedBranch(name); setQueryText(name) }}
            onSelectIssue={iss => { setSelectedIssue(iss); setSelectedPr(null); setQueryText(`#${iss.number} ${iss.title}`) }}
            onSelectPr={pr => { setSelectedPr(pr); setSelectedIssue(null); setQueryText(`PR #${pr.number} ${pr.title}`) }}
          />

          <div className="ade-wt-field">
            <div className="ade-wt-label-row">
              <label htmlFor="wt-blueprint">{t("prjx.cfg.wayOfWorking")}</label>
              <IconButton title={t("wsx.ws.configureProviders")} aria-label={t("wsx.ws.configureProviders")} onClick={() => { onClose(); onOpenProviderSettings() }}>
                <SlidersHorizontal className="size-3.5" />
              </IconButton>
            </div>
            <div className="ade-wt-select-wrap">
              <Layers className="size-3.5 opacity-75 shrink-0" />
              <select
                id="wt-blueprint"
                className="ade-wt-select-bare"
                value={activeProject?.blueprintLocked ? (activeProject.blueprintId || "vibe") : blueprintId}
                disabled={Boolean(activeProject?.blueprintLocked)}
                onChange={e => setBlueprintId(e.target.value)}
              >
                {(blueprintOptions.length ? blueprintOptions : [{ id: "vibe", name: t("prjx.wiz.cfg.vibeCoding") }, ...BUILTIN_BLUEPRINTS]).map(bp => (
                  <option key={bp.id} value={bp.id}>{bp.name}</option>
                ))}
              </select>
            </div>
          </div>

          <WorktreeAdvancedSection
            open={advancedOpen} kind={kind} attempts={attempts} activeRepo={activeRepo} manualRepo={manualRepo}
            onToggle={() => setAdvancedOpen(v => !v)} onKindChange={setKind}
            onAttemptsChange={setAttempts} onManualRepoChange={setManualRepo}
          />
        </div>

        <div className="ade-wt-footer">
          <Switch checked={createMore} onCheckedChange={setCreateMore} label={t("wsx.ws.createMore")} showLabel />
          <Button variant="primary" size="md" className="ade-wt-create-btn" loading={starting} disabled={!canCreate} onClick={() => void submitCreate()}>
            <span>{starting ? t("wsx.ws.creating") : t("wsx.ws.create")}</span>
            <kbd>⌘↩</kbd>
          </Button>
        </div>
      </div>
    </div>
  )
}
