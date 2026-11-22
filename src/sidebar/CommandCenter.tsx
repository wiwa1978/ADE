import { useEffect, useRef, useState } from "react"
import {
  Bot,
  ExternalLink,
  FileDiff,
  Folder,
  FolderTree,
  Globe,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  Terminal,
} from "lucide-react"
import type { Conversation, SubagentInfo } from "../../app-types"
import type { Project } from "../../ProjectsView"

type CommandItem = {
  id: string
  group: string
  label: string
  detail?: string
  icon: React.ReactNode
  action: () => void
}

export function CommandCenter({
  open,
  onClose,
  projects,
  sessions,
  subagents,
  hasActiveWorkspace,
  onSelectProject,
  onSelectSession,
  onNewSession,
  onOpenPanel,
  onOpenSubagent,
  onOpenExternalBrowser,
  onOpenSettings,
}: {
  open: boolean
  onClose: () => void
  projects: Project[]
  sessions: Conversation[]
  subagents: SubagentInfo[]
  hasActiveWorkspace: boolean
  onSelectProject: (id: string) => void
  onSelectSession: (session: Conversation) => void
  onNewSession: () => void
  onOpenPanel: (kind: "files" | "diff" | "browser" | "terminal" | "artifact" | "processes") => void
  onOpenSubagent: (id: string) => void
  onOpenExternalBrowser: (url: string) => void
  onOpenSettings: () => void
}) {
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const [prevOpen, setPrevOpen] = useState(open)
  const inputRef = useRef<HTMLInputElement>(null)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setQuery("")
      setIndex(0)
    }
  }

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  if (!open) return null

  const items: CommandItem[] = [
    { id: "act-new", group: "Actions", label: "New coding session", detail: "Start a fresh workspace or worktree", icon: <Plus className="size-4" />, action: onNewSession },
    { id: "act-browser", group: "Workspace", label: "Open Built-in Browser", detail: "Interactive Chrome CDP + iframe preview", icon: <Globe className="size-4" />, action: () => onOpenPanel("browser") },
    { id: "act-ext", group: "Workspace", label: "Open localhost:3000 in External Browser", detail: "Launch default system browser", icon: <ExternalLink className="size-4" />, action: () => onOpenExternalBrowser("http://localhost:3000") },
    ...(hasActiveWorkspace ? [
      { id: "act-files", group: "Workspace", label: "Open Files Explorer", detail: "Browse and edit workspace files", icon: <FolderTree className="size-4" />, action: () => onOpenPanel("files") },
      { id: "act-diff", group: "Workspace", label: "Open Git Changes & Diff", detail: "Review diffs, stage, and commit", icon: <FileDiff className="size-4" />, action: () => onOpenPanel("diff") },
      { id: "act-term", group: "Workspace", label: "Open Terminal", detail: "Interactive shell in session workspace", icon: <Terminal className="size-4" />, action: () => onOpenPanel("terminal") },
    ] : []),
    { id: "act-settings", group: "Actions", label: "Open Settings & MCP Servers", detail: "Providers, appearance, approvals, MCP", icon: <Settings2 className="size-4" />, action: onOpenSettings },
    ...subagents.map(sub => ({
      id: `sub-${sub.id}`,
      group: "Subagents",
      label: `${sub.name} (${sub.status})`,
      detail: sub.assignment.slice(0, 70),
      icon: <Bot className="size-4" />,
      action: () => onOpenSubagent(sub.id),
    })),
    ...projects.map(proj => ({
      id: `proj-${proj.id}`,
      group: "Projects",
      label: proj.name,
      detail: proj.repository || proj.githubUrl || "Project",
      icon: <Folder className="size-4" />,
      action: () => onSelectProject(proj.id),
    })),
    ...sessions.map(sess => ({
      id: `sess-${sess.id}`,
      group: "Sessions",
      label: sess.label,
      detail: sess.workspace?.branch || sess.mode,
      icon: <MessageSquare className="size-4" />,
      action: () => onSelectSession(sess),
    })),
  ]

  const q = query.trim().toLowerCase()
  const filtered = q
    ? items.filter(i => i.label.toLowerCase().includes(q) || (i.detail?.toLowerCase().includes(q) ?? false) || i.group.toLowerCase().includes(q))
    : items

  const runSelected = (item?: CommandItem) => {
    if (!item) return
    onClose()
    item.action()
  }

  return (
    <div className="ade-cmd-backdrop" onClick={onClose}>
      <div className="ade-cmd-dialog" onClick={e => e.stopPropagation()} role="dialog" aria-label="Command Center">
        <div className="ade-cmd-input-row">
          <Search className="size-4 opacity-60" />
          <input
            ref={inputRef}
            type="text"
            className="ade-cmd-input"
            placeholder="Jump to session, project, subagent, or open panel…"
            value={query}
            onChange={e => { setQuery(e.target.value); setIndex(0) }}
            onKeyDown={e => {
              if (e.key === "Escape") { e.preventDefault(); onClose() }
              else if (e.key === "ArrowDown") { e.preventDefault(); setIndex(i => (i + 1) % Math.max(filtered.length, 1)) }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIndex(i => (i - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1)) }
              else if (e.key === "Enter") { e.preventDefault(); runSelected(filtered[index] ?? filtered[0]) }
            }}
          />
          <kbd className="ade-kbd">ESC</kbd>
        </div>
        <div className="ade-cmd-results">
          {filtered.length === 0 ? (
            <div className="ade-pane-note">No matches for "{query}".</div>
          ) : (
            filtered.slice(0, 24).map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={`ade-cmd-item ${idx === index ? "is-selected" : ""}`}
                onMouseEnter={() => setIndex(idx)}
                onClick={() => runSelected(item)}
              >
                <span className="ade-cmd-icon">{item.icon}</span>
                <div className="ade-cmd-text">
                  <div className="ade-cmd-label">{item.label}</div>
                  {item.detail ? <div className="ade-cmd-detail ade-truncate">{item.detail}</div> : null}
                </div>
                <span className="ade-pill">{item.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
