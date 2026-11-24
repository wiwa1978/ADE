import { useRef, useState, type FormEvent } from "react"
import {
  ArrowUp,
  AtSign,
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
import { insertMention, mentionAt, useFileMentions } from "./file-mentions"
import { matchesChord } from "../keybindings"
import { useI18n } from "../i18n/I18nContext"

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
  attachments = [],
  onAttachFiles,
  onRemoveAttachment,
  skillsCatalog = { skills: [], rules: [], commands: [] },
  hasWorkspace,
  canSubmitEmpty = false,
  submitTitle,
  onSubmit,
  onSteer,
  onAbort,
  onCompact,
  onQuickOpenPanel,
  textareaRef,
  sendChord = "Enter",
  newLineChord = "Shift+Enter",
  engineLabel,
  sessionId,
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
  attachments?: { id: string; name: string; content: string }[]
  onAttachFiles?: (files: FileList | null) => void
  onRemoveAttachment?: (id: string) => void
  skillsCatalog?: SkillsAndRulesCatalog
  hasWorkspace: boolean
  canSubmitEmpty?: boolean
  submitTitle?: string
  onSubmit: (text: string) => void
  onSteer?: (text: string, mode: "steer" | "follow-up") => void
  onAbort?: () => void
  onCompact?: () => void
  onQuickOpenPanel?: (panel: "files" | "diff" | "browser" | "terminal") => void
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  sendChord?: string
  newLineChord?: string
  /** Set for Claude Code / Codex sessions: they pick their own model, so no model picker is shown. */
  engineLabel?: string
  /** Enables @-mentions of files in the session's workspace. */
  sessionId?: string
}) {
  const { t } = useI18n()
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

  // @-mentions: point the agent at a file in the workspace.
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null)
  const mention = hasWorkspace && sessionId && !showSlashMenu ? mentionAt(draft, Math.min(caret, draft.length)) : null
  const mentionActive = mention && mention.start !== mentionDismissed ? mention : null
  const mentionFiles = useFileMentions(hasWorkspace ? sessionId : undefined, mentionActive ? mentionActive.query : null)
  const showMentionMenu = Boolean(mentionActive) && mentionFiles.length > 0
  const applyMention = (path: string) => {
    const next = insertMention(draft, Math.min(caret, draft.length), path)
    onDraftChange(next.text)
    setCaret(next.caret)
    window.requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(next.caret, next.caret)
    })
  }

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
    if (!trimmed && !canSubmitEmpty) return
    if (disabled) return
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

      {showMentionMenu ? (
        <div className="ade-slash-menu" role="listbox" aria-label="Files">
          {mentionFiles.map((file, idx) => {
            const slash = file.lastIndexOf("/")
            return (
              <button
                key={file}
                type="button"
                role="option"
                aria-selected={idx === mentionIndex}
                className={`ade-slash-item ${idx === mentionIndex ? "is-selected" : ""}`}
                onMouseEnter={() => setMentionIndex(idx)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => applyMention(file)}
              >
                <span className="ade-slash-name"><AtSign className="size-3" />{file.slice(slash + 1)}</span>
                <span className="ade-slash-desc">{slash > 0 ? file.slice(0, slash) : ""}</span>
              </button>
            )
          })}
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
          placeholder={busy ? "Type to steer the running agent (Enter) or queue follow-up (Alt+Enter)…" : (placeholder || (hasWorkspace && sessionId ? "Message ADE… @ to mention a file, / for commands" : "Message ADE… type / for slash commands (plan, subagent, review, browser, compact)"))}
          onChange={e => {
            onDraftChange(e.target.value)
            setCaret(e.target.selectionStart ?? e.target.value.length)
            setSlashIndex(0)
            setMentionIndex(0)
          }}
          onSelect={e => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={e => {
            if (showMentionMenu && mentionActive) {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setMentionIndex(i => (i + 1) % mentionFiles.length)
                return
              }
              if (e.key === "ArrowUp") {
                e.preventDefault()
                setMentionIndex(i => (i - 1 + mentionFiles.length) % mentionFiles.length)
                return
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault()
                applyMention(mentionFiles[mentionIndex] ?? mentionFiles[0])
                return
              }
              if (e.key === "Escape") {
                e.preventDefault()
                setMentionDismissed(mentionActive.start)
                return
              }
            }
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
            if (matchesChord(e.nativeEvent, newLineChord)) {
              if (e.key !== "Enter") {
                e.preventDefault()
                const el = e.currentTarget
                const start = el.selectionStart ?? draft.length
                const end = el.selectionEnd ?? draft.length
                onDraftChange(`${draft.slice(0, start)}\n${draft.slice(end)}`)
              }
              return
            }
            if (matchesChord(e.nativeEvent, sendChord)) {
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
                title={t("workspace.plusMenuTitle")}
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
                      <span className="flex items-center gap-2"><Paperclip className="size-3.5 opacity-75" /> {t("workspace.addFilesOrPhotos")}</span>
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
                      <FolderOpen className="size-3.5 opacity-75" /> {t("workspace.browseWorkspace")}
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
                    <Slash className="size-3.5 opacity-75" /> {t("workspace.slashCommands")}
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
                    <GitBranch className="size-3.5 opacity-75" /> {t("workspace.importGithubIssue")}
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
                      <Plug className="size-3.5 opacity-75" /> {t("workspace.pluginsAndMcp")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {engineLabel ? <span className="ade-engine-badge" title={t("workspace.engineBadgeHint", { engine: engineLabel })}>{engineLabel}</span> : <ModelPicker
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
                    <button type="button" className="ade-icon-btn" onClick={() => onQuickOpenPanel("files")} title={t("workspace.openFilesPane")}>
                      <FolderTree className="size-3.5" />
                    </button>
                    <button type="button" className="ade-icon-btn" onClick={() => onQuickOpenPanel("diff")} title={t("workspace.openDiffPane")}>
                      <FileDiff className="size-3.5" />
                    </button>
                  </>
                ) : null}
                <button type="button" className="ade-icon-btn" onClick={() => onQuickOpenPanel("terminal")} title={t("workspace.toggleTerminal")}>
                  <Terminal className="size-3.5" />
                </button>
                <button type="button" className="ade-icon-btn" onClick={() => onQuickOpenPanel("browser")} title={t("workspace.openBrowserPane")}>
                  <Globe className="size-3.5" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="ade-composer-right">
            {busy && onAbort ? (
              <button type="button" className="ade-btn ade-btn-danger" onClick={onAbort} title={t("workspace.stopRun")}>
                <Square className="size-3.5" /> {t("workspace.stop")}
              </button>
            ) : null}
            <button
              type="submit"
              className="ade-send-btn"
              disabled={disabled || (!canSubmitEmpty && !draft.trim())}
              title={submitTitle ?? (busy ? t("workspace.steerAgent") : t("workspace.sendMessage"))}
            >
              {busy ? <CornerDownLeft className="size-4" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
