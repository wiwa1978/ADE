import { useEffect, useRef, useState } from "react"
import {
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Globe,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react"
import type { Project } from "../ProjectsView"
import type { AddProjectSource } from "../projects/AddProjectWizard"
import type { SidebarPrefs } from "./sidebar-prefs"
import { useI18n } from "../i18n/I18nContext"

type OpenPopover = null | "filters" | "add-project"
type FilterSub = null | "projects" | "group"

export function ProjectsHeaderControls({
  inboxCount,
  environmentName,
  projects,
  prefs,
  hasUnread,
  hasCompleted,
  onChangePrefs,
  onOpenInbox,
  onOpenEnvironments,
  onOpenAddProject,
  onOpenCreateWorktree,
  onMarkAllRead,
  onClearCompleted,
}: {
  inboxCount: number
  environmentName: string
  projects: Project[]
  prefs: SidebarPrefs
  hasUnread: boolean
  hasCompleted: boolean
  onChangePrefs: (patch: Partial<SidebarPrefs>) => void
  onOpenInbox: () => void
  onOpenEnvironments: () => void
  onOpenAddProject: (initialSource?: AddProjectSource) => void
  onOpenCreateWorktree: () => void
  onMarkAllRead: () => void
  onClearCompleted: () => void
}) {
  const { t } = useI18n()
  const [popover, setPopover] = useState<OpenPopover>(null)
  const [sub, setSub] = useState<FilterSub>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!popover) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPopover(null)
        setSub(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPopover(null)
        setSub(null)
      }
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [popover])

  const activeFiltersCount =
    Number(prefs.unreadOnly) + Number(prefs.pinnedOnly) + Number(prefs.hideChats) + Number(Boolean(prefs.projectFilter))

  const selectedProjectLabel = prefs.projectFilter
    ? (projects.find(p => p.id === prefs.projectFilter)?.name ?? t("projHead.oneProject"))
    : t("projHead.allProjects")

  return (
    <div className="ade-proj-head" ref={wrapRef}>
      <span className="ade-proj-head-title">{t("sidebar.projects")}</span>

      <div className="ade-proj-head-actions">
        {/* Bell Activity / Inbox Pill */}
        <button
          type="button"
          className={`ade-proj-bell-pill ${inboxCount > 0 ? "has-unread" : ""}`}
          onClick={onOpenInbox}
          title={inboxCount > 0 ? t("projHead.inboxAttention", { count: inboxCount }) : t("projHead.inboxCaughtUp")}
          aria-label={t("projHead.inboxAria", { count: inboxCount })}
        >
          <Bell className="size-3.5" />
          <span className="ade-proj-bell-count">
            <i className="ade-proj-bell-dot" aria-hidden="true" />
            <span>{inboxCount}</span>
          </span>
        </button>

        {/* Filters & View Popover Trigger */}
        <button
          type="button"
          className={`ade-proj-head-btn ${popover === "filters" || activeFiltersCount > 0 ? "is-active" : ""}`}
          aria-label={t("projHead.filtersAria")}
          aria-expanded={popover === "filters"}
          title={t("projHead.filtersTitle")}
          onClick={() => {
            setSub(null)
            setPopover(p => (p === "filters" ? null : "filters"))
          }}
        >
          <SlidersHorizontal className="size-3.5" />
        </button>

        {/* Add Project Quick Popover Trigger */}
        <button
          type="button"
          className={`ade-proj-head-btn ${popover === "add-project" ? "is-active" : ""}`}
          aria-label={t("projHead.addProjectAria")}
          aria-expanded={popover === "add-project"}
          title={t("projHead.addProjectTitle")}
          onClick={() => {
            setSub(null)
            setPopover(p => (p === "add-project" ? null : "add-project"))
          }}
        >
          <FolderPlus className="size-3.5" />
        </button>

        {/* New Workspace / Create Worktree Modal Trigger */}
        <button
          type="button"
          className="ade-proj-head-btn"
          aria-label={t("projHead.newWorkspaceAria")}
          title={t("projHead.newWorkspaceTitle")}
          onClick={() => {
            setPopover(null)
            onOpenCreateWorktree()
          }}
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {/* Filters & View Popover (Screenshot 2) */}
      {popover === "filters" ? (
        <div className="ade-proj-popover" role="menu" aria-label={t("projHead.filtersTitle")}>
          <div className="ade-proj-pop-heading">{t("projHead.filtersHeading")}</div>

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={prefs.unreadOnly}
            className="ade-proj-pop-item"
            onClick={() => onChangePrefs({ unreadOnly: !prefs.unreadOnly })}
          >
            <span className="ade-proj-pop-check">{prefs.unreadOnly ? <Check className="size-3.5" /> : null}</span>
            <span className="flex-1">{t("projHead.showUnreadOnly")}</span>
          </button>

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={prefs.pinnedOnly}
            className="ade-proj-pop-item"
            onClick={() => onChangePrefs({ pinnedOnly: !prefs.pinnedOnly })}
          >
            <span className="ade-proj-pop-check">{prefs.pinnedOnly ? <Check className="size-3.5" /> : null}</span>
            <span className="flex-1">{t("projHead.showPinnedOnly")}</span>
          </button>

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={prefs.hideChats}
            className="ade-proj-pop-item"
            onClick={() => onChangePrefs({ hideChats: !prefs.hideChats })}
          >
            <span className="ade-proj-pop-check">{prefs.hideChats ? <Check className="size-3.5" /> : null}</span>
            <span className="flex-1">{t("projHead.hideChats")}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="ade-proj-pop-item ade-proj-pop-row-meta"
            onClick={() => {
              setPopover(null)
              onOpenEnvironments()
            }}
          >
            <span className="flex-1">{t("projHead.hosts")}</span>
            <span className="ade-proj-pop-val">{environmentName}</span>
            <ChevronRight className="size-3.5 opacity-55" />
          </button>

          <button
            type="button"
            role="menuitem"
            className="ade-proj-pop-item ade-proj-pop-row-meta"
            onClick={() => setSub(s => (s === "projects" ? null : "projects"))}
          >
            <span className="flex-1">{t("sidebar.projects")}</span>
            <span className="ade-proj-pop-val ade-truncate max-w-[100px]">{selectedProjectLabel}</span>
            <ChevronRight className="size-3.5 opacity-55" />
          </button>

          {sub === "projects" ? (
            <div className="ade-proj-pop-sub">
              <button
                type="button"
                className={`ade-proj-pop-item ${prefs.projectFilter === null ? "is-selected" : ""}`}
                onClick={() => { onChangePrefs({ projectFilter: null }); setSub(null) }}
              >
                <span className="ade-proj-pop-check">{prefs.projectFilter === null ? <Check className="size-3.5" /> : null}</span>
                <span className="flex-1">{t("projHead.allProjects")}</span>
              </button>
              {projects.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`ade-proj-pop-item ${prefs.projectFilter === p.id ? "is-selected" : ""}`}
                  onClick={() => { onChangePrefs({ projectFilter: p.id }); setSub(null) }}
                >
                  <span className="ade-proj-pop-check">{prefs.projectFilter === p.id ? <Check className="size-3.5" /> : null}</span>
                  <span className="flex-1 ade-truncate">{p.name}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="ade-proj-pop-divider" />
          <div className="ade-proj-pop-heading">{t("projHead.viewHeading")}</div>

          <button
            type="button"
            role="menuitem"
            className="ade-proj-pop-item ade-proj-pop-row-meta"
            onClick={() => setSub(s => (s === "group" ? null : "group"))}
          >
            <span className="flex-1">{t("projHead.groupBy")}</span>
            <span className="ade-proj-pop-val">{prefs.groupBy === "status" ? t("projHead.groupStatus") : t("projHead.groupProject")}</span>
            <ChevronRight className="size-3.5 opacity-55" />
          </button>

          {sub === "group" ? (
            <div className="ade-proj-pop-sub">
              {(["project", "status"] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={`ade-proj-pop-item ${prefs.groupBy === mode ? "is-selected" : ""}`}
                  onClick={() => { onChangePrefs({ groupBy: mode }); setSub(null) }}
                >
                  <span className="ade-proj-pop-check">{prefs.groupBy === mode ? <Check className="size-3.5" /> : null}</span>
                  <span className="flex-1">{mode === "project" ? t("projHead.groupProject") : t("projHead.groupStatus")}</span>
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={prefs.compact}
            className="ade-proj-pop-item"
            onClick={() => onChangePrefs({ compact: !prefs.compact })}
          >
            <span className="ade-proj-pop-check">{prefs.compact ? <Check className="size-3.5" /> : null}</span>
            <span className="flex-1">{t("projHead.compactMode")}</span>
          </button>

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={prefs.showSearch}
            className="ade-proj-pop-item"
            onClick={() => onChangePrefs({ showSearch: !prefs.showSearch })}
          >
            <span className="ade-proj-pop-check">{prefs.showSearch ? <Check className="size-3.5" /> : null}</span>
            <span className="flex-1">{t("projHead.showSearch")}</span>
          </button>

          <div className="ade-proj-pop-divider" />

          <button
            type="button"
            role="menuitem"
            className="ade-proj-pop-item"
            disabled={!hasUnread}
            onClick={() => { onMarkAllRead(); setPopover(null) }}
          >
            <CheckCheck className="size-3.5 opacity-70 shrink-0" />
            <span className="flex-1">{t("projHead.markAllRead")}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="ade-proj-pop-item"
            disabled={!hasCompleted}
            onClick={() => { onClearCompleted(); setPopover(null) }}
          >
            <Trash2 className="size-3.5 opacity-70 shrink-0" />
            <span className="flex-1">{t("projHead.clearCompleted")}</span>
          </button>
        </div>
      ) : null}

      {/* Add Project Quick Popover (Screenshot 3) */}
      {popover === "add-project" ? (
        <div className="ade-proj-popover ade-proj-add-popover" role="menu" aria-label={t("projHead.addProjectAria")}>
          <div className="ade-proj-add-head">
            <span className="font-semibold text-[12.5px]">{t("sidebar.addProject")}</span>
            <button
              type="button"
              className="ade-proj-add-host-btn"
              onClick={() => { setPopover(null); onOpenEnvironments() }}
            >
              <span>{environmentName}</span>
              <ChevronRight className="size-3 opacity-60" />
            </button>
          </div>

          <button
            type="button"
            role="menuitem"
            className="ade-proj-pop-item"
            onClick={() => { setPopover(null); onOpenAddProject("local") }}
          >
            <FolderOpen className="size-4 opacity-75 shrink-0" />
            <span className="flex-1">{t("projHead.browseFolder")}</span>
            <span className="text-[11px] opacity-50">↩</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="ade-proj-pop-item"
            onClick={() => { setPopover(null); onOpenAddProject("url") }}
          >
            <Globe className="size-4 opacity-75 shrink-0" />
            <span className="flex-1">{t("projHead.cloneFromUrl")}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="ade-proj-pop-item"
            onClick={() => { setPopover(null); onOpenAddProject("menu") }}
          >
            <Plus className="size-4 opacity-75 shrink-0" />
            <span className="flex-1">{t("projHead.createNewProject")}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
