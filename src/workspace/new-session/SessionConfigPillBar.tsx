import { useRef, useState } from "react"
import {
  Check, ChevronDown, Cpu, FolderGit2, FolderOpen, FolderPlus,
  GitBranch, Layers, Link2, Lock, MessageSquare, Workflow,
} from "lucide-react"
import { SearchInput, useClickOutside, useEscapeKey } from "../../../components/ui/index.ts"
import type { GitHubIssue, TaskStart } from "../../../app-types"
import type { Project } from "../../../ProjectsView"
import { shortBlueprintName, stagesLine, VIBE_ID, type BlueprintOption } from "../../blueprints/blueprint-options"
import { runTargetDescriptions, targetLabel, targetUnavailable, type RunTarget, type RunTargetsInfo, type TargetSettings } from "../../run-targets"
import { WORKSPACE_OPTIONS, type OpenMenu } from "./useNewSessionForm"

interface SessionConfigPillBarProps {
  unarchivedProjects: Project[]
  selectedProjectId: string | null
  activeProject: Project | null
  kind: TaskStart["kind"]
  effectiveBlueprint: string
  projectBlueprint: string
  blueprintLocked: boolean
  effectiveBlueprintOption: BlueprintOption | undefined
  blueprintOptions: BlueprintOption[]
  effectiveRunOn: RunTarget
  runTargets: RunTargetsInfo | null
  projectRunOn: ({ projectId: string } & TargetSettings) | null
  canAttempt: boolean
  attemptCount: number
  linkedIssue: GitHubIssue | null
  onSelectProject: (id: string | null) => void
  onSelectKind: (kind: TaskStart["kind"]) => void
  onSelectBlueprint: (id: string) => void
  onSelectRunOn: (target: RunTarget) => void
  onSelectAttemptCount: (count: number) => void
  onAddProject?: () => void
  onToggleIssueOpen: () => void
}

export function SessionConfigPillBar({
  unarchivedProjects, selectedProjectId, activeProject, kind,
  effectiveBlueprint, projectBlueprint, blueprintLocked, effectiveBlueprintOption, blueprintOptions,
  effectiveRunOn, runTargets, projectRunOn, canAttempt, attemptCount, linkedIssue,
  onSelectProject, onSelectKind, onSelectBlueprint, onSelectRunOn, onSelectAttemptCount,
  onAddProject, onToggleIssueOpen,
}: SessionConfigPillBarProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [projectQuery, setProjectQuery] = useState("")
  const pillBarRef = useRef<HTMLDivElement>(null)

  const closeMenu = () => setOpenMenu(null)
  useClickOutside(pillBarRef, closeMenu, openMenu !== null)
  useEscapeKey(closeMenu, openMenu !== null)

  const filteredProjects = unarchivedProjects.filter(p => {
    const q = projectQuery.trim().toLowerCase()
    if (!q) return true
    return p.name.toLowerCase().includes(q) || (p.repository ?? "").toLowerCase().includes(q)
  })
  const workspaceLabel = WORKSPACE_OPTIONS.find(o => o.id === kind)?.label ?? "New branch"
  const runOnAvailable = runTargets?.available ?? ["local", "docker"]

  const chooseProject = (id: string | null) => {
    onSelectProject(id)
    setOpenMenu(null)
    setProjectQuery("")
  }

  return (
    <div className="ade-ns-pills" ref={pillBarRef}>
      <div className="ade-ns-menu-anchor">
        <button
          type="button"
          className={`ade-ns-pill ${openMenu === "project" ? "is-open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={openMenu === "project"}
          onClick={() => setOpenMenu(m => (m === "project" ? null : "project"))}
        >
          <FolderGit2 className="size-3.5 opacity-70" />
          <span className="truncate max-w-[160px]">{activeProject ? activeProject.name : "No project"}</span>
          <ChevronDown className="size-3 opacity-55" />
        </button>
        {openMenu === "project" ? (
          <div className="ade-ns-popover ade-ns-popover-up" role="dialog" aria-label="Choose project">
            {unarchivedProjects.length > 4 ? (
              <div className="p-2 border-b border-[rgb(var(--border))]">
                <SearchInput value={projectQuery} onValueChange={setProjectQuery} placeholder="Filter projects…" autoFocus />
              </div>
            ) : null}
            <div className="ade-ns-popover-list">
              <button type="button" className={`ade-ns-popover-item ${selectedProjectId === null ? "is-selected" : ""}`} onClick={() => chooseProject(null)}>
                <span className="flex-1 truncate">No project</span>
                {selectedProjectId === null ? <Check className="size-3.5 text-[rgb(var(--primary))]" /> : null}
              </button>
              {filteredProjects.map(p => (
                <button key={p.id} type="button" className={`ade-ns-popover-item ${selectedProjectId === p.id ? "is-selected" : ""}`} onClick={() => chooseProject(p.id)}>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{p.name}</span>
                    {!p.repository ? <span className="block text-[10.5px] opacity-55 truncate">Empty project</span> : null}
                  </span>
                  {selectedProjectId === p.id ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
                </button>
              ))}
            </div>
            {onAddProject ? (
              <div className="ade-ns-popover-footer">
                <button type="button" className="ade-ns-popover-item" onClick={() => { setOpenMenu(null); onAddProject() }}>
                  <FolderPlus className="size-3.5 opacity-75" /><span>New project…</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="ade-ns-menu-anchor">
        <button
          type="button"
          className={`ade-ns-pill ${openMenu === "workspace" ? "is-open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={openMenu === "workspace"}
          onClick={() => setOpenMenu(m => (m === "workspace" ? null : "workspace"))}
        >
          {kind === "worktree" ? <GitBranch className="size-3.5 opacity-70" /> : kind === "checkout" ? <FolderOpen className="size-3.5 opacity-70" /> : <MessageSquare className="size-3.5 opacity-70" />}
          <span>{workspaceLabel}</span>
          <ChevronDown className="size-3 opacity-55" />
        </button>
        {openMenu === "workspace" ? (
          <div className="ade-ns-popover ade-ns-popover-up" role="dialog" aria-label="Workspace mode">
            <div className="ade-ns-popover-list">
              {WORKSPACE_OPTIONS.map(opt => (
                <button key={opt.id} type="button" className={`ade-ns-popover-item ${kind === opt.id ? "is-selected" : ""}`} onClick={() => { onSelectKind(opt.id); setOpenMenu(null) }}>
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium">{opt.label}</span>
                    <span className="block text-[11px] opacity-60">{opt.desc}</span>
                  </span>
                  {kind === opt.id ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {kind !== "none" ? (
        <div className="ade-ns-menu-anchor">
          <button
            type="button"
            className={`ade-ns-pill ${openMenu === "blueprint" ? "is-open" : ""}`}
            aria-haspopup="listbox"
            aria-expanded={openMenu === "blueprint"}
            title={blueprintLocked ? "This project's sessions all use its blueprint (project settings)." : "Way of working"}
            onClick={() => setOpenMenu(m => (m === "blueprint" ? null : "blueprint"))}
          >
            <Workflow className="size-3.5 opacity-70" />
            <span>{effectiveBlueprintOption ? shortBlueprintName(effectiveBlueprintOption.name) : "Vibe coding"}</span>
            {blueprintLocked ? <Lock className="size-3 opacity-55" /> : <ChevronDown className="size-3 opacity-55" />}
          </button>
          {openMenu === "blueprint" ? (
            <div className="ade-ns-popover !w-[320px]" role="dialog" aria-label="Way of working">
              <div className="ade-ns-popover-list">
                {blueprintOptions.map(option => {
                  const blocked = blueprintLocked && option.id !== projectBlueprint
                  return (
                    <button key={option.id} type="button" disabled={blocked} title={blocked ? "This project's sessions all use its blueprint." : option.description} className={`ade-ns-popover-item ${effectiveBlueprint === option.id ? "is-selected" : ""}`} onClick={() => { onSelectBlueprint(option.id); setOpenMenu(null) }}>
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium">{shortBlueprintName(option.name)}{option.id === projectBlueprint ? <span className="opacity-55 font-normal"> · project default</span> : null}</span>
                        <span className="block text-[11px] opacity-60 leading-snug">{option.id === VIBE_ID ? option.description : `${stagesLine(option)}. Best for ${option.bestFor}.`}</span>
                      </span>
                      {effectiveBlueprint === option.id ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {kind !== "none" ? (
        <div className="ade-ns-menu-anchor">
          <button type="button" className={`ade-ns-pill ${openMenu === "runOn" ? "is-open" : ""}`} aria-haspopup="listbox" aria-expanded={openMenu === "runOn"} onClick={() => setOpenMenu(m => (m === "runOn" ? null : "runOn"))}>
            <Cpu className="size-3.5 opacity-70" /><span>{targetLabel(effectiveRunOn)}</span><ChevronDown className="size-3 opacity-55" />
          </button>
          {openMenu === "runOn" ? (
            <div className="ade-ns-popover ade-ns-popover-up !w-[280px]" role="dialog" aria-label="Run on target">
              <div className="ade-ns-popover-list">
                {runOnAvailable.map(target => {
                  const blocked = runTargets?.docker ? targetUnavailable(target, runTargets, projectRunOn && projectRunOn.projectId === selectedProjectId ? projectRunOn : { sshHost: "" }) : ""
                  const detail = target === "docker" ? `${runTargetDescriptions.docker} Image: ${projectRunOn?.image ?? "node:22-bookworm"}.` : target === "ssh" && projectRunOn?.sshHost ? `Host: ${projectRunOn.sshHost}` : runTargetDescriptions[target]
                  return (
                    <button key={target} type="button" disabled={Boolean(blocked)} title={blocked || detail} className={`ade-ns-popover-item ${effectiveRunOn === target ? "is-selected" : ""}`} onClick={() => { onSelectRunOn(target); setOpenMenu(null) }}>
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium">{targetLabel(target)}</span>
                        <span className="block text-[11px] opacity-60 leading-snug">{blocked || detail}</span>
                      </span>
                      {effectiveRunOn === target ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {canAttempt ? (
        <div className="ade-ns-menu-anchor">
          <button type="button" className={`ade-ns-pill ${openMenu === "attempts" ? "is-open" : ""}`} aria-haspopup="listbox" aria-expanded={openMenu === "attempts"} onClick={() => setOpenMenu(m => (m === "attempts" ? null : "attempts"))}>
            <Layers className="size-3.5 opacity-70" /><span>{attemptCount === 1 ? "1 attempt" : `${attemptCount} attempts`}</span><ChevronDown className="size-3 opacity-55" />
          </button>
          {openMenu === "attempts" ? (
            <div className="ade-ns-popover ade-ns-popover-up !w-[240px]" role="dialog" aria-label="Attempts">
              <div className="ade-ns-popover-list">
                {[1, 2, 3].map(count => (
                  <button key={count} type="button" className={`ade-ns-popover-item ${attemptCount === count ? "is-selected" : ""}`} onClick={() => { onSelectAttemptCount(count); setOpenMenu(null) }}>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium">{count === 1 ? "1 attempt" : `${count} parallel attempts`}</span>
                      <span className="block text-[11px] opacity-60">{count === 1 ? "Single agent on one branch" : `${count} agents on separate branches`}</span>
                    </span>
                    {attemptCount === count ? <Check className="size-3.5 text-[rgb(var(--primary))] shrink-0" /> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {onAddProject ? (
        <button type="button" className="ade-ns-pill ade-ns-pill-quiet" onClick={onAddProject} title="Create a new project">
          <FolderPlus className="size-3.5 opacity-70" /><span>New project</span>
        </button>
      ) : null}

      {activeProject?.githubUrl && !linkedIssue ? (
        <button type="button" className="ade-ns-pill ade-ns-pill-quiet" onClick={onToggleIssueOpen}>
          <Link2 className="size-3.5 opacity-70" /><span>Link issue</span>
        </button>
      ) : null}
    </div>
  )
}
