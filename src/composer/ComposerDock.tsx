import { useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react"
import { ArrowUp, CornerDownLeft, FileDiff, FolderTree, Globe, Square, Terminal } from "lucide-react"
import { Button, IconButton } from "../../components/ui/index.ts"
import type { ApprovalPolicy, ProviderCatalogEntry, SkillsAndRulesCatalog } from "../../app-types"
import { matchesChord } from "../keybindings"
import { insertMention, mentionAt, useFileMentions } from "./file-mentions"
import { ModelPicker } from "./ModelPicker"
import { ComposerAttachmentsBar, type ComposerAttachment } from "./dock/ComposerAttachmentsBar"
import { ComposerAutocompleteMenu } from "./dock/ComposerAutocompleteMenu"
import { ComposerQuickActionsMenu } from "./dock/ComposerQuickActionsMenu"
import { filterSlashCommands, resolveSubmittedPrompt } from "./dock/composer-commands"

export interface ComposerDockProps {
  draft: string; onDraftChange: (value: string) => void; busy: boolean; disabled?: boolean; placeholder?: string
  modelCatalog: ProviderCatalogEntry[]; selectedProvider: string; selectedModel: string
  onSelectModel: (provider: string, id: string) => void; reasoning: string; onSelectReasoning: (level: string) => void
  approvalPolicy?: ApprovalPolicy; onChangeApprovalPolicy?: (policy: ApprovalPolicy) => void; onOpenSettings?: () => void
  attachments?: ComposerAttachment[]; onAttachFiles?: (files: FileList | null) => void; onRemoveAttachment?: (id: string) => void
  skillsCatalog?: SkillsAndRulesCatalog; hasWorkspace: boolean; canSubmitEmpty?: boolean; submitTitle?: string
  onSubmit: (text: string) => void; onSteer?: (text: string, mode: "steer" | "follow-up") => void
  onAbort?: () => void; onCompact?: () => void; onQuickOpenPanel?: (panel: "files" | "diff" | "browser" | "terminal") => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>; sendChord?: string; newLineChord?: string
  engineLabel?: string; sessionId?: string
}

export function ComposerDock(props: ComposerDockProps) {
  const {
    draft, onDraftChange, busy, disabled, placeholder, hasWorkspace, canSubmitEmpty = false,
    attachments = [], skillsCatalog = { skills: [], rules: [], commands: [] },
    sendChord = "Enter", newLineChord = "Shift+Enter", engineLabel, sessionId,
  } = props
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const ref = props.textareaRef ?? internalRef
  const [slashIndex, setSlashIndex] = useState(0)
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null)

  const filteredCommands = filterSlashCommands(draft, skillsCatalog.commands)
  const showSlashMenu = filteredCommands.length > 0
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
    if (cmd.prompt === "__ADE_COMPACT__") { onDraftChange(""); props.onCompact?.(); return }
    onDraftChange(`/${cmd.name} `)
    ref.current?.focus()
  }

  const expandAndDispatch = (mode: "normal" | "steer" | "follow-up" = "normal") => {
    const trimmed = draft.trim()
    if ((!trimmed && !canSubmitEmpty) || disabled) return
    const resolved = resolveSubmittedPrompt(trimmed, skillsCatalog.commands)
    if (resolved.kind === "compact") { onDraftChange(""); props.onCompact?.(); return }
    if (busy && props.onSteer) props.onSteer(resolved.text, mode === "follow-up" ? "follow-up" : "steer")
    else props.onSubmit(resolved.text)
  }

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault()
    expandAndDispatch(busy ? "steer" : "normal")
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionMenu && mentionActive) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => (i + 1) % mentionFiles.length); return }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => (i - 1 + mentionFiles.length) % mentionFiles.length); return }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); applyMention(mentionFiles[mentionIndex] ?? mentionFiles[0]); return }
      if (e.key === "Escape") { e.preventDefault(); setMentionDismissed(mentionActive.start); return }
    }
    if (showSlashMenu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex(i => (i + 1) % filteredCommands.length); return }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length); return }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); applySlashCommand(filteredCommands[slashIndex]?.name ?? filteredCommands[0].name); return }
    }
    if (matchesChord(e.nativeEvent, newLineChord)) {
      if (e.key !== "Enter") {
        e.preventDefault()
        const start = e.currentTarget.selectionStart ?? draft.length
        const end = e.currentTarget.selectionEnd ?? draft.length
        onDraftChange(`${draft.slice(0, start)}\n${draft.slice(end)}`)
      }
      return
    }
    if (matchesChord(e.nativeEvent, sendChord)) {
      e.preventDefault()
      expandAndDispatch(busy ? (e.altKey ? "follow-up" : "steer") : "normal")
    }
  }

  const resolvedPlaceholder = busy
    ? "Type to steer the running agent (Enter) or queue follow-up (Alt+Enter)…"
    : (placeholder || (hasWorkspace && sessionId ? "Message ADE… @ to mention a file, / for commands" : "Message ADE… type / for slash commands (plan, subagent, review, browser, compact)"))

  return (
    <div className="ade-composer-shell">
      <ComposerAutocompleteMenu
        showSlashMenu={showSlashMenu}
        filteredCommands={filteredCommands}
        slashIndex={slashIndex}
        onHoverSlash={setSlashIndex}
        onSelectSlash={applySlashCommand}
        showMentionMenu={showMentionMenu}
        mentionFiles={mentionFiles}
        mentionIndex={mentionIndex}
        onHoverMention={setMentionIndex}
        onSelectMention={applyMention}
      />

      <form className={`ade-composer-dock ${busy ? "is-busy" : ""}`} onSubmit={handleFormSubmit}>
        <ComposerAttachmentsBar attachments={attachments} onRemoveAttachment={props.onRemoveAttachment} />

        <textarea
          ref={ref}
          className="ade-composer-textarea"
          rows={2}
          value={draft}
          disabled={disabled}
          placeholder={resolvedPlaceholder}
          onChange={e => {
            onDraftChange(e.target.value)
            setCaret(e.target.selectionStart ?? e.target.value.length)
            setSlashIndex(0)
            setMentionIndex(0)
          }}
          onSelect={e => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={handleKeyDown}
        />

        <div className="ade-composer-toolbar">
          <div className="ade-composer-left">
            <ComposerQuickActionsMenu
              onAttachFiles={props.onAttachFiles}
              onOpenWorkspaceFiles={props.onQuickOpenPanel ? () => props.onQuickOpenPanel!("files") : undefined}
              onInsertSlash={() => { onDraftChange("/"); ref.current?.focus() }}
              onInsertGitHubIssue={() => {
                onDraftChange(draft ? `${draft}\nImport GitHub issue #` : "Import GitHub issue #")
                ref.current?.focus()
              }}
              onOpenSettings={props.onOpenSettings}
            />

            {engineLabel ? (
              <span className="ade-engine-badge" title={`${engineLabel} chooses its own model and uses its own sign-in`}>{engineLabel}</span>
            ) : (
              <ModelPicker
                catalog={props.modelCatalog}
                selectedProvider={props.selectedProvider}
                selectedModel={props.selectedModel}
                reasoning={props.reasoning}
                approvalPolicy={props.approvalPolicy}
                onSelectModel={props.onSelectModel}
                onSelectReasoning={props.onSelectReasoning}
                onChangeApprovalPolicy={props.onChangeApprovalPolicy}
                onOpenSettings={props.onOpenSettings}
              />
            )}

            {props.onQuickOpenPanel ? (
              <div className="ade-composer-quick-tools">
                {hasWorkspace ? (
                  <>
                    <IconButton aria-label="Open Files pane" title="Open Files pane" onClick={() => props.onQuickOpenPanel!("files")}>
                      <FolderTree className="size-3.5" />
                    </IconButton>
                    <IconButton aria-label="Open Git Diff pane" title="Open Git Diff pane" onClick={() => props.onQuickOpenPanel!("diff")}>
                      <FileDiff className="size-3.5" />
                    </IconButton>
                  </>
                ) : null}
                <IconButton aria-label="Toggle Terminal (Cmd+J)" title="Toggle Terminal (Cmd+J)" onClick={() => props.onQuickOpenPanel!("terminal")}>
                  <Terminal className="size-3.5" />
                </IconButton>
                <IconButton aria-label="Open Built-in Browser pane" title="Open Built-in Browser pane" onClick={() => props.onQuickOpenPanel!("browser")}>
                  <Globe className="size-3.5" />
                </IconButton>
              </div>
            ) : null}
          </div>

          <div className="ade-composer-right">
            {busy && props.onAbort ? (
              <Button variant="destructive" size="sm" onClick={props.onAbort} title="Stop current run">
                <Square className="size-3.5" /> Stop
              </Button>
            ) : null}
            <button
              type="submit"
              className="ade-send-btn"
              disabled={disabled || (!canSubmitEmpty && !draft.trim())}
              title={props.submitTitle ?? (busy ? "Steer agent (Enter)" : "Send message (Enter)")}
            >
              {busy ? <CornerDownLeft className="size-4" /> : <ArrowUp className="size-4" />}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
