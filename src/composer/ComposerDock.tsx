import { useRef, useState, type FormEvent } from "react"
import {
  ArrowUp,
  CornerDownLeft,
  FileDiff,
  FolderOpen,
  FolderTree,
  GitBranch,
  Globe,
  Paperclip,
  Plug,
  Plus,
  Slash,
  Square,
  Terminal,
  X,
} from "lucide-react"
import type { ApprovalPolicy, ProviderCatalogEntry, SkillsAndRulesCatalog } from "../../app-types"
import { ModelPicker } from "./ModelPicker"

export function ComposerDock({
  draft,
  onDraftChange,
  busy,
  disabled,
  placeholder,
  modelCatalog,
  selectedProvider,
  selectedModel,
  onSelectModel,
  reasoning,
  onSelectReasoning,
  approvalPolicy,
  onChangeApprovalPolicy,
  onOpenSettings,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  skillsCatalog,
  hasWorkspace,
  onSubmit,
  onSteer,
  onAbort,
  onCompact,
  onQuickOpenPanel,
  textareaRef,
  engineLabel,
}: {
  draft: string
  onDraftChange: (value: string) => void
  busy: boolean
  disabled?: boolean
  placeholder?: string
  modelCatalog: ProviderCatalogEntry[]
  selectedProvider: string
  selectedModel: string
  onSelectModel: (provider: string, id: string) => void
  reasoning: string
  onSelectReasoning: (level: string) => void
  approvalPolicy?: ApprovalPolicy
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => void
  onOpenSettings?: () => void
  attachments: { id: string; name: string; content: string }[]
  onAttachFiles?: (files: FileList | null) => void
  onRemoveAttachment?: (id: string) => void
  skillsCatalog: SkillsAndRulesCatalog
  hasWorkspace: boolean
  onSubmit: (text: string) => void
  onSteer?: (text: string, mode: "steer" | "follow-up") => void
  onAbort?: () => void
  onCompact?: () => void
  onQuickOpenPanel?: (panel: "files" | "diff" | "browser" | "terminal") => void
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  /** Set for Claude Code / Codex sessions: they pick their own model, so no model picker is shown. */
  engineLabel?: string
}) {
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const ref = textareaRef ?? internalRef
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)

  const slashMatch = /^\/([a-z0-9-_]*)$/i.exec(draft.trim())
  const filteredCommands = slashMatch
    ? skillsCatalog.commands.filter(c => c.name.toLowerCase().includes(slashMatch[1].toLowerCase()))
    : []
  const showSlashMenu = filteredCommands.length > 0

  const applySlashCommand = (cmdName: string) => {
    const cmd = skillsCatalog.commands.find(c => c.name === cmdName)
    if (!cmd) return
    if (cmd.prompt === "__ADE_COMPACT__") {
      onDraftChange("")
      onCompact?.()
      return
    }
    onDraftChange(`/${cmd.name} `)
    ref.current?.focus()
  }

  const expandAndDispatch = (mode: "normal" | "steer" | "follow-up" = "normal") => {
    const trimmed = draft.trim()
    if (!trimmed) return
    // Expand leading /command if it matches a known slash command
    const leadMatch = /^\/([a-z0-9-_]+)(?:\s+([\s\S]*))?$/i.exec(trimmed)
    let finalPrompt = trimmed
    if (leadMatch) {
      const cmd = skillsCatalog.commands.find(c => c.name.toLowerCase() === leadMatch[1].toLowerCase())
      if (cmd) {
        if (cmd.prompt === "__ADE_COMPACT__") {
          onDraftChange("")
          onCompact?.()
          return
        }
        const rest = (leadMatch[2] ?? "").trim()
        finalPrompt = rest ? `${cmd.prompt}\n\nUser request: ${rest}` : cmd.prompt
      }
    }
    if (busy && onSteer) {
      onSteer(finalPrompt, mode === "follow-up" ? "follow-up" : "steer")
    } else {
      onSubmit(finalPrompt)
    }
  }

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault()
    expandAndDispatch(busy ? "steer" : "normal")
  }

  return (
    <div className="ade-composer-shell">
      {showSlashMenu ? (
        <div className="ade-slash-menu" role="listbox" aria-label="Slash commands">
          {filteredCommands.map((cmd, idx) => (
            <button
              key={cmd.name}
              type="button"
              role="option"
              aria-selected={idx === slashIndex}
              className={`ade-slash-item ${idx === slashIndex ? "is-selected" : ""}`}
              onMouseEnter={() => setSlashIndex(idx)}
              onClick={() => applySlashCommand(cmd.name)}
            >
              <span className="ade-slash-name"><Slash className="size-3" />{cmd.name}</span>
              <span className="ade-slash-desc">{cmd.description}</span>
              <span className="ade-pill">{cmd.scope}</span>
            </button>
          ))}
        </div>
      ) : null}

      <form className={`ade-composer-dock ${busy ? "is-busy" : ""}`} onSubmit={handleFormSubmit}>
        {attachments.length > 0 ? (
          <div className="ade-attachment-row">
            {attachments.map(att => (
              <span key={att.id} className="ade-attachment-chip">
                <Paperclip className="size-3" />
                <span>{att.name}</span>
                {onRemoveAttachment ? (
                  <button type="button" onClick={() => onRemoveAttachment(att.id)} aria-label={`Remove ${att.name}`}>
                    <X className="size-3" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={ref}
          className="ade-composer-textarea"
          rows={2}
          value={draft}
          disabled={disabled}
          placeholder={busy ? "Type to steer the running agent (Enter) or queue follow-up (Alt+Enter)…" : (placeholder || "Message ADE… type / for slash commands (plan, subagent, review, browser, compact)")}
          onChange={e => {
            onDraftChange(e.target.value)
            setSlashIndex(0)
          }}
          onKeyDown={e => {
            if (showSlashMenu) {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setSlashIndex(i => (i + 1) % filteredCommands.length)
                return
              }
              if (e.key === "ArrowUp") {
                e.preventDefault()
                setSlashIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length)
                return
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault()
                applySlashCommand(filteredCommands[slashIndex]?.name ?? filteredCommands[0].name)
                return
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              expandAndDispatch(busy ? (e.altKey ? "follow-up" : "steer") : "normal")
            }
          }}
        />

        <div className="ade-composer-toolbar">
          <div className="ade-composer-left">
            <div className="relative">
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
              <button
                type="button"
                className="ade-icon-btn"
                onClick={() => setPlusMenuOpen(v => !v)}
                title="Add files, folder, GitHub issue, slash commands, or plugins"
                aria-expanded={plusMenuOpen}
              >
                <Plus className="size-4" />
              </button>
              {plusMenuOpen ? (
                <div
                  className="absolute bottom-full left-0 mb-2 z-30 w-56 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] shadow-xl p-1.5 flex flex-col gap-0.5 text-xs"
                  onMouseLeave={() => setPlusMenuOpen(false)}
                >
                  {onAttachFiles ? (
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgb(var(--surface-raised))] text-left"
                      onClick={() => {
                        setPlusMenuOpen(false)
                        fileInputRef.current?.click()
                      }}
                    >
                      <span className="flex items-center gap-2"><Paperclip className="size-3.5 opacity-75" /> Add files or photos</span>
                      <span className="opacity-50 font-mono text-[10.5px]">⌘U</span>
                    </button>
                  ) : null}
                  {onQuickOpenPanel ? (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgb(var(--surface-raised))] text-left"
                      onClick={() => {
                        setPlusMenuOpen(false)
                        onQuickOpenPanel("files")
                      }}
                    >
                      <FolderOpen className="size-3.5 opacity-75" /> Browse workspace folder
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgb(var(--surface-raised))] text-left"
                    onClick={() => {
                      setPlusMenuOpen(false)
                      onDraftChange("/")
                      ref.current?.focus()
                    }}
                  >
                    <Slash className="size-3.5 opacity-75" /> Slash commands
                  </button>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgb(var(--surface-raised))] text-left"
                    onClick={() => {
                      setPlusMenuOpen(false)
                      onDraftChange(draft ? `${draft}\nImport GitHub issue #` : "Import GitHub issue #")
                      ref.current?.focus()
                    }}
                  >
                    <GitBranch className="size-3.5 opacity-75" /> Import GitHub issue
                  </button>
                  {onOpenSettings ? (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgb(var(--surface-raised))] text-left"
                      onClick={() => {
                        setPlusMenuOpen(false)
                        onOpenSettings()
                      }}
                    >
                      <Plug className="size-3.5 opacity-75" /> Plugins &amp; MCP
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {engineLabel ? <span className="ade-engine-badge" title={`${engineLabel} chooses its own model and uses its own sign-in`}>{engineLabel}</span> : <ModelPicker
              catalog={modelCatalog}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              reasoning={reasoning}
              approvalPolicy={approvalPolicy}
              onSelectModel={onSelectModel}
              onSelectReasoning={onSelectReasoning}
              onChangeApprovalPolicy={onChangeApprovalPolicy}
              onOpenSettings={onOpenSettings}
            />}

            {onQuickOpenPanel ? (
              <div className="ade-composer-quick-tools">
                {hasWorkspace ? (
                  <>
                    <button type="button" className="ade-icon-btn" onClick={() => onQuickOpenPanel("files")} title="Open Files pane">
                      <FolderTree className="size-3.5" />
                    </button>
                    <button type="button" className="ade-icon-btn" onClick={() => onQuickOpenPanel("diff")} title="Open Git Diff pane">
                      <FileDiff className="size-3.5" />
                    </button>
                  </>
                ) : null}
                <button type="button" className="ade-icon-btn" onClick={() => onQuickOpenPanel("terminal")} title="Toggle Terminal (Cmd+J)">
                  <Terminal className="size-3.5" />
                </button>
                <button type="button" className="ade-icon-btn" onClick={() => onQuickOpenPanel("browser")} title="Open Built-in Browser pane">
                  <Globe className="size-3.5" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="ade-composer-right">
            {busy && onAbort ? (
              <button type="button" className="ade-btn ade-btn-danger" onClick={onAbort} title="Stop current run">
                <Square className="size-3.5" /> Stop
              </button>
            ) : null}
            <button
              type="submit"
              className="ade-send-btn"
              disabled={disabled || !draft.trim()}
              title={busy ? "Steer agent (Enter)" : "Send message (Enter)"}
            >
              {busy ? <CornerDownLeft className="size-4" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
