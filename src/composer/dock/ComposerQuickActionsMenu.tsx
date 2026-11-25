import { useRef, useState } from "react"
import { FolderOpen, GitBranch, Paperclip, Plug, Plus, Slash } from "lucide-react"
import { IconButton, useClickOutside, useEscapeKey } from "../../../components/ui/index.ts"
import { useI18n } from "../../i18n/I18nContext"

interface ComposerQuickActionsMenuProps {
  onAttachFiles?: (files: FileList | null) => void
  onOpenWorkspaceFiles?: () => void
  onInsertSlash: () => void
  onInsertGitHubIssue: () => void
  onOpenSettings?: () => void
}

export function ComposerQuickActionsMenu({
  onAttachFiles,
  onOpenWorkspaceFiles,
  onInsertSlash,
  onInsertGitHubIssue,
  onOpenSettings,
}: ComposerQuickActionsMenuProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const close = () => setOpen(false)
  useClickOutside(containerRef, close, open)
  useEscapeKey(close, open)

  return (
    <div className="relative" ref={containerRef}>
      {onAttachFiles ? (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => {
            onAttachFiles(e.target.files)
            e.target.value = ""
          }}
        />
      ) : null}
      <IconButton
        aria-label={t("workspace.plusMenuTitle")}
        title={t("workspace.plusMenuTitle")}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <Plus className="size-4" />
      </IconButton>
      {open ? (
        <div
          className="absolute bottom-full left-0 mb-2 z-30 w-56 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] shadow-xl p-1.5 flex flex-col gap-0.5 text-xs"
          role="menu"
          aria-label={t("workspace.plusMenuTitle")}
        >
          {onAttachFiles ? (
            <button
              type="button"
              role="menuitem"
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgb(var(--surface-raised))] text-left"
              onClick={() => {
                setOpen(false)
                fileInputRef.current?.click()
              }}
            >
              <span className="flex items-center gap-2"><Paperclip className="size-3.5 opacity-75" /> {t("workspace.addFilesOrPhotos")}</span>
              <span className="opacity-50 font-mono text-[10.5px]">⌘U</span>
            </button>
          ) : null}
          {onOpenWorkspaceFiles ? (
            <button
              type="button"
              role="menuitem"
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgb(var(--surface-raised))] text-left"
              onClick={() => {
                setOpen(false)
                onOpenWorkspaceFiles()
              }}
            >
              <FolderOpen className="size-3.5 opacity-75" /> {t("workspace.browseWorkspace")}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgb(var(--surface-raised))] text-left"
            onClick={() => {
              setOpen(false)
              onInsertSlash()
            }}
          >
            <Slash className="size-3.5 opacity-75" /> {t("workspace.slashCommands")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgb(var(--surface-raised))] text-left"
            onClick={() => {
              setOpen(false)
              onInsertGitHubIssue()
            }}
          >
            <GitBranch className="size-3.5 opacity-75" /> {t("workspace.importGithubIssue")}
          </button>
          {onOpenSettings ? (
            <button
              type="button"
              role="menuitem"
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgb(var(--surface-raised))] text-left"
              onClick={() => {
                setOpen(false)
                onOpenSettings()
              }}
            >
              <Plug className="size-3.5 opacity-75" /> {t("workspace.pluginsAndMcp")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
