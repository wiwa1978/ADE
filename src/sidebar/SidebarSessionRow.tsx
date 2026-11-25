import { memo } from "react"
import { MessageCircle, MessageSquare, Pin } from "lucide-react"
import type { Conversation } from "../app-types"
import { sessionStateIcon, sessionStateInfo, type InboxEntry } from "../session-state"
import { useI18n } from "../i18n/I18nContext"

function StateDot({ entry, session }: { entry?: InboxEntry; session: Conversation }) {
  const state = entry?.state ?? (session.status === "working" ? "working" : "idle")
  const info = sessionStateInfo[state]
  return <span className={`ade-state-dot is-${info.tone}`} title={info.label} aria-label={info.label} />
}

function StateIcon({ state }: { state: InboxEntry["state"] }) {
  const info = sessionStateInfo[state]
  const Icon = sessionStateIcon[state]
  return (
    <span className={`ade-row-icon is-${info.tone}`} role="img" aria-label={info.label} title={`${info.label} — ${info.hint}`}>
      <Icon className="size-3.5" />
    </span>
  )
}

export function SidebarRowLabel({
  session,
  renaming,
  renameText,
  unread,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: {
  session: Conversation
  renaming: boolean
  renameText: string
  unread: boolean
  onRenameChange: (text: string) => void
  onRenameSubmit: (session: Conversation) => void
  onRenameCancel: () => void
}) {
  const { t } = useI18n()
  if (renaming) {
    return (
      <input
        className="ade-input-sm !h-6 flex-1"
        autoFocus
        aria-label={t("wsx.sb.sessionName")}
        value={renameText}
        onClick={event => event.stopPropagation()}
        onChange={event => onRenameChange(event.target.value)}
        onBlur={() => onRenameSubmit(session)}
        onKeyDown={event => {
          if (event.key === "Enter") onRenameSubmit(session)
          if (event.key === "Escape") onRenameCancel()
        }}
      />
    )
  }
  return <span className={`ade-truncate flex-1 ${unread ? "font-semibold" : ""}`}>{session.label}</span>
}

export interface SidebarSessionRowProps {
  session: Conversation
  entry?: InboxEntry
  selected: boolean
  unread: boolean
  pinned: boolean
  child: boolean
  renaming: boolean
  renameText: string
  onOpenSession: (session: Conversation) => void
  onContextMenu: (session: Conversation, x: number, y: number) => void
  onRenameChange: (text: string) => void
  onRenameSubmit: (session: Conversation) => void
  onRenameCancel: () => void
}

export const SidebarSessionRow = memo(function SidebarSessionRow({
  session, entry, selected, unread, pinned, child, renaming, renameText,
  onOpenSession, onContextMenu, onRenameChange, onRenameSubmit, onRenameCancel,
}: SidebarSessionRowProps) {
  const { t } = useI18n()
  const pr = entry?.pullRequest
  const showState = entry && entry.state !== "idle" && entry.state !== "replied" && entry.state !== "working"

  return (
    <div
      role="button"
      tabIndex={0}
      className={`ade-nav-row ${child ? "ade-nav-row-child" : ""} ${selected ? "is-selected" : ""}`}
      onClick={() => onOpenSession(session)}
      onKeyDown={event => { if (event.key === "Enter") onOpenSession(session) }}
      onContextMenu={event => { event.preventDefault(); onContextMenu(session, event.clientX, event.clientY) }}
      title={entry ? `${sessionStateInfo[entry.state].label} — ${sessionStateInfo[entry.state].hint}` : undefined}
    >
      <StateDot entry={entry} session={session} />
      {pinned ? <Pin className="size-3 shrink-0 opacity-60" aria-label={t("wsx.sb.pinned")} /> : null}
      <SidebarRowLabel
        session={session}
        renaming={renaming}
        renameText={renameText}
        unread={unread}
        onRenameChange={onRenameChange}
        onRenameSubmit={onRenameSubmit}
        onRenameCancel={onRenameCancel}
      />
      {pr ? (
        <span className={`ade-row-tag is-${pr.state === "OPEN" ? (pr.checksSummary === "failure" ? "failed" : "ok") : pr.state === "MERGED" ? "merged" : "idle"}`}>
          #{pr.number}
        </span>
      ) : showState ? (
        <StateIcon state={entry.state} />
      ) : null}
    </div>
  )
})

export const SidebarChatRow = memo(function SidebarChatRow({
  session, selected, unread, pinned, renaming, renameText,
  onOpenSession, onContextMenu, onRenameChange, onRenameSubmit, onRenameCancel,
}: Omit<SidebarSessionRowProps, "entry" | "child">) {
  const { t } = useI18n()
  return (
    <div
      role="button"
      tabIndex={0}
      className={`ade-nav-row ${selected ? "is-selected" : ""}`}
      onClick={() => onOpenSession(session)}
      onKeyDown={event => { if (event.key === "Enter") onOpenSession(session) }}
      onContextMenu={event => { event.preventDefault(); onContextMenu(session, event.clientX, event.clientY) }}
    >
      {session.status === "working" ? (
        <span className="ade-state-dot is-running" title={t("wsx.sb.working")} />
      ) : session.mode === "personal" ? (
        <MessageCircle className="size-3.5 shrink-0 opacity-70" />
      ) : (
        <MessageSquare className="size-3.5 shrink-0 opacity-70" />
      )}
      <SidebarRowLabel
        session={session}
        renaming={renaming}
        renameText={renameText}
        unread={unread}
        onRenameChange={onRenameChange}
        onRenameSubmit={onRenameSubmit}
        onRenameCancel={onRenameCancel}
      />
      {pinned ? <Pin className="size-3 shrink-0 opacity-55" aria-label={t("wsx.sb.pinned")} /> : null}
    </div>
  )
})
