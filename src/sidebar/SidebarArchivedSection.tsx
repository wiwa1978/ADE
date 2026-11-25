import { Archive, ChevronDown, ChevronRight, FolderGit2, GitBranch, MessageSquare } from "lucide-react"
import type { Conversation } from "../app-types"
import type { Project } from "../ProjectsView"
import { useI18n } from "../i18n/I18nContext"

interface SidebarArchivedSectionProps {
  projects: Project[]
  archivedProjects: Project[]
  archivedSessions: Conversation[]
  expanded: boolean
  onToggle: () => void
  onRestore: (id: string) => void
  onOpenSession: (session: Conversation) => void
  onSessionContextMenu: (session: Conversation, x: number, y: number) => void
}

export function SidebarArchivedSection({
  projects,
  archivedProjects,
  archivedSessions,
  expanded,
  onToggle,
  onRestore,
  onOpenSession,
  onSessionContextMenu,
}: SidebarArchivedSectionProps) {
  const { t } = useI18n()
  const total = archivedProjects.length + archivedSessions.length
  if (total === 0) return null

  return (
    <div className="ade-archived-section">
      <button
        type="button"
        className="ade-nav-row opacity-60 hover:opacity-100 !text-[11.5px]"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <Archive className="size-3 shrink-0" />
        <span className="flex-1">{t("wsx.sb.archivedCount", { count: total })}</span>
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>
      {expanded ? (
        <>
          {archivedProjects.map(project => (
            <div key={project.id} className="ade-nav-row ade-nav-row-child ade-archived-row">
              <FolderGit2 className="size-3 shrink-0 opacity-60" />
              <span className="ade-truncate flex-1 opacity-70">{project.name}</span>
              <button
                type="button"
                className="ade-archived-restore"
                aria-label={t("wsx.sb.restoreProject", { name: project.name })}
                onClick={() => onRestore(`project:${project.id}`)}
              >
                {t("wsx.sb.restore")}
              </button>
            </div>
          ))}
          {archivedSessions.map(session => {
            const projectName = projects.find(p => p.id === session.projectId)?.name
              ?? archivedProjects.find(p => p.id === session.projectId)?.name
            return (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                className="ade-nav-row ade-nav-row-child ade-archived-row"
                title={session.workspace?.removed ? t("wsx.sb.worktreeRemovedHint") : undefined}
                onClick={() => onOpenSession(session)}
                onKeyDown={event => { if (event.key === "Enter") onOpenSession(session) }}
                onContextMenu={event => {
                  event.preventDefault()
                  onSessionContextMenu(session, event.clientX, event.clientY)
                }}
              >
                {session.chatThread ? <MessageSquare className="size-3 shrink-0 opacity-60" /> : <GitBranch className="size-3 shrink-0 opacity-60" />}
                <span className="ade-truncate flex-1 opacity-70">
                  {session.label}
                  {projectName ? <small className="opacity-60"> · {projectName}</small> : null}
                </span>
                <button
                  type="button"
                  className="ade-archived-restore"
                  aria-label={t("wsx.sb.restoreSession", { label: session.label })}
                  onClick={event => { event.stopPropagation(); onRestore(session.id) }}
                >
                  {t("wsx.sb.restore")}
                </button>
              </div>
            )
          })}
        </>
      ) : null}
    </div>
  )
}
