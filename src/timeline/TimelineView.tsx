import { useEffect, useRef, useState } from "react"
import { useI18n } from "../i18n/I18nContext"
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns2,
  ExternalLink,
  FileCode2,
  FileText,
  Globe,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  X,
  XCircle,
} from "lucide-react"
import { MessageContent } from "../../MessageContent"
import { WorkspaceEmptyHero } from "../workspace/WorkspaceEmptyHero"
import { extractToolCallFilePaths, isFileToolName } from "../panels/file-preview-utils"
import type {
  ConversationMessage,
  ConversationTimelineSnapshot,
  PendingApproval,
  SubagentInfo,
  TimelineItem,
  TimelineToolCall,
} from "../../app-types"

function ToolCallCard({
  tool,
  subagents,
  workspacePath,
  onOpenFile,
  onOpenSubagent,
  onOpenBrowser,
  onOpenArtifact,
}: {
  tool: TimelineToolCall
  subagents: SubagentInfo[]
  workspacePath?: string | null
  onOpenFile?: (path: string) => void
  onOpenSubagent?: (subagentId: string) => void
  onOpenBrowser?: (url?: string) => void
  onOpenArtifact?: (artifactId?: string) => void
}) {
  const { t } = useI18n()
  const isRunning = tool.status === "running" || tool.status === "pending" || tool.status === "waiting"
  const isSleeping = tool.status === "sleeping"
  const [open, setOpen] = useState(isRunning || isSleeping || tool.isError)

  const details = (tool.details && typeof tool.details === "object" ? tool.details : {}) as Record<string, unknown>
  const isSubagentTool = tool.name === "spawn_subagent" || tool.name === "delegate"
  const isBrowserTool = tool.name.startsWith("browser_")
  const isFileTool = isFileToolName(tool.name)
  const isSearchTool = tool.name === "grep_search" || tool.name === "find_files"
  const isShellTool = tool.name === "run_command" || tool.name === "manage_process"
  const isArtifactTool = tool.name === "write_artifact"

  const subagentId = typeof details.conversationId === "string" ? details.conversationId : undefined
  const matchedSubagent = subagentId ? subagents.find(s => s.id === subagentId) : undefined

  const filePaths = extractToolCallFilePaths(tool, workspacePath)
  const filePath = filePaths[0]
  const commandText = typeof tool.arguments.command === "string" ? tool.arguments.command : undefined
  const queryText = typeof tool.arguments.query === "string" ? tool.arguments.query : (typeof tool.arguments.pattern === "string" ? tool.arguments.pattern : undefined)
  const urlText = typeof tool.arguments.url === "string" ? tool.arguments.url : (typeof details.url === "string" ? details.url : undefined)

  const icon = isSubagentTool ? <Bot className="size-3.5" />
    : isBrowserTool ? <Globe className="size-3.5" />
    : isShellTool ? <Terminal className="size-3.5" />
    : isSearchTool ? <Search className="size-3.5" />
    : isArtifactTool ? <FileText className="size-3.5" />
    : isFileTool ? <FileCode2 className="size-3.5" />
    : <Sparkles className="size-3.5" />

  const label = isSubagentTool
    ? `${tool.arguments.name || matchedSubagent?.name || "Subagent"}`
    : isShellTool && commandText
      ? commandText
      : isFileTool && filePath
        ? `${tool.name} ${filePath}`
        : isSearchTool && queryText
          ? `${tool.name} "${queryText}"`
          : isBrowserTool && urlText
            ? `${tool.name.replace("browser_", "")} ${urlText}`
            : isArtifactTool && tool.arguments.title
              ? t("tl.artifact", { title: String(tool.arguments.title) })
              : tool.name

  const statusBadge = isSleeping
    ? <span className="ade-pill ade-pill-warn">{t("tl.awaitingApproval")}</span>
    : isRunning
      ? <span className="ade-pill ade-pill-accent"><Loader2 className="size-3 animate-spin" /> {t("tl.running")}</span>
      : tool.isError || tool.status === "error"
        ? <span className="ade-pill ade-pill-danger"><XCircle className="size-3" /> {t("tl.error")}</span>
        : <span className="ade-pill ade-pill-ok"><CheckCircle2 className="size-3" /> {t("tl.done")}</span>

  // Dedicated rich Subagent Activity Card inline in the timeline!
  if (isSubagentTool) {
    const subStatus = matchedSubagent?.status ?? (isRunning ? "running" : tool.isError ? "failed" : "completed")
    const activeSubTool = matchedSubagent?.liveTools?.find(t => t.status === "running" || t.status === "pending")
    return (
      <div className={`ade-subagent-inline-card ${subStatus === "running" ? "is-running" : ""}`}>
        <div className="ade-subagent-inline-head">
          <div className="ade-subagent-inline-title">
            <span className={`ade-dot ade-dot-${subStatus}`} />
            <Bot className="size-4" />
            <strong>{String(tool.arguments.name || matchedSubagent?.name || "Subagent")}</strong>
            {tool.arguments.role || matchedSubagent?.role ? (
              <span className="ade-pill">{String(tool.arguments.role || matchedSubagent?.role)}</span>
            ) : null}
            <span className="ade-pill">{String(tool.arguments.mode || matchedSubagent?.mode || "readonly")}</span>
            {details.branch || matchedSubagent?.branch ? (
              <span className="ade-pill ade-mono">{String(details.branch || matchedSubagent?.branch)}</span>
            ) : null}
          </div>
          <div className="ade-subagent-inline-actions">
            <span className={`ade-pill ${subStatus === "running" ? "ade-pill-accent" : subStatus === "completed" ? "ade-pill-ok" : subStatus === "failed" ? "ade-pill-danger" : ""}`}>
              {subStatus === "running" ? <><Loader2 className="size-3 animate-spin" /> {t("tl.working")}</> : subStatus}
            </span>
            {subagentId && onOpenSubagent ? (
              <button type="button" className="ade-chip-btn" onClick={() => onOpenSubagent(subagentId)}>
                <Columns2 className="size-3.5" /> {t("tl.openBeside")}
              </button>
            ) : null}
          </div>
        </div>
        <div className="ade-subagent-inline-task">
          {String(tool.arguments.task || matchedSubagent?.assignment || "")}
        </div>
        {activeSubTool ? (
          <div className="ade-subagent-inline-live">
            <Loader2 className="size-3 animate-spin" />
            <span dangerouslySetInnerHTML={{ __html: t("tl.runningTool", { name: activeSubTool.name.replace(/[<>&]/g, "") }) }} />
          </div>
        ) : null}
        {tool.output ? (
          <details open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)} className="ade-subagent-inline-report">
            <summary>{open ? t("tl.hideReport") : t("tl.viewReport")}</summary>
            <div className="ade-tool-output-md">
              <MessageContent content={tool.output} onOpenFile={onOpenFile} workspacePath={workspacePath} />
            </div>
          </details>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`ade-tool-card ${tool.isError ? "is-error" : ""} ${isRunning ? "is-running" : ""}`}>
      <div className="ade-tool-head" onClick={() => setOpen(v => !v)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setOpen(v => !v) }}>
        <span className="ade-tool-chevron">{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</span>
        <span className="ade-tool-icon">{icon}</span>
        <span className="ade-tool-label" title={label}>{label}</span>
        <div className="ade-tool-head-right" onClick={e => e.stopPropagation()}>
          {filePaths.length > 0 && onOpenFile ? (
            filePaths.slice(0, 2).map(fp => (
              <button key={fp} type="button" className="ade-chip-btn" onClick={() => onOpenFile(fp)} title={t("tl.viewFileTitle", { file: fp })}>
                {filePaths.length === 1 ? t("tl.openFile") : fp.split("/").pop() || fp}
              </button>
            ))
          ) : null}
          {isBrowserTool && onOpenBrowser ? (
            <button type="button" className="ade-chip-btn" onClick={() => onOpenBrowser(urlText)}>{t("tl.openBrowser")}</button>
          ) : null}
          {isArtifactTool && onOpenArtifact ? (
            <button type="button" className="ade-chip-btn" onClick={() => onOpenArtifact(typeof details.artifactId === "string" ? details.artifactId : undefined)}>{t("tl.viewArtifact")}</button>
          ) : null}
          {statusBadge}
        </div>
      </div>
      {open ? (
        <div className="ade-tool-body">
          {Object.keys(tool.arguments).length > 0 && !isShellTool ? (
            <pre className="ade-tool-args">{JSON.stringify(tool.arguments, null, 2)}</pre>
          ) : null}
          {typeof details.screenshot === "string" ? (
            <img src={details.screenshot} alt={t("tl.screenshot")} className="ade-tool-screenshot" />
          ) : null}
          {tool.output ? (
            <pre className={`ade-tool-output ${isShellTool ? "is-terminal" : ""}`}>{tool.output}</pre>
          ) : isRunning ? (
            <div className="ade-tool-waiting"><Loader2 className="size-3.5 animate-spin" /> {t("tl.waitingOutput")}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: PendingApproval
  onResolve: (id: string, decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => Promise<void>
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [denyReason, setDenyReason] = useState("")
  const [showDeny, setShowDeny] = useState(false)

  const handle = async (decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => {
    setBusy(true)
    try {
      await onResolve(approval.id, decision)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ade-approval-card" role="region" aria-label={t("tl.approvalRequired")}>
      <div className="ade-approval-head">
        <ShieldAlert className="size-4 text-[var(--accent)]" />
        <strong>{t("tl.approvalRequired")}</strong>
        <span className="ade-pill">{approval.toolName}</span>
      </div>
      <div className="ade-approval-command">
        <code>{approval.command || approval.summary}</code>
      </div>
      <div className="ade-approval-actions">
        <button type="button" className="ade-btn ade-btn-primary" disabled={busy} onClick={() => void handle({ allow: true })}>
          <Check className="size-3.5" /> {t("tl.allowOnce")}
        </button>
        {approval.suggestedPrefix ? (
          <button
            type="button"
            className="ade-btn"
            disabled={busy}
            onClick={() => void handle({ allow: true, alwaysAllow: true, prefix: approval.suggestedPrefix })}
          >
            {t("tl.alwaysAllow")} <code>{approval.suggestedPrefix}</code>
          </button>
        ) : null}
        {!showDeny ? (
          <button type="button" className="ade-btn ade-btn-danger" disabled={busy} onClick={() => setShowDeny(true)}>
            <X className="size-3.5" /> {t("tl.deny")}
          </button>
        ) : (
          <div className="ade-approval-deny-row">
            <input
              type="text"
              className="ade-input-sm"
              placeholder={t("tl.denyReason")}
              value={denyReason}
              onChange={e => setDenyReason(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void handle({ allow: false, reason: denyReason }) }}
            />
            <button type="button" className="ade-btn ade-btn-danger" disabled={busy} onClick={() => void handle({ allow: false, reason: denyReason })}>
              {t("tl.confirmDeny")}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(Boolean(streaming))
  return (
    <div className="ade-thinking">
      <button type="button" className="ade-thinking-toggle" onClick={() => setOpen(v => !v)}>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Brain className="size-3.5" />
        <span>{streaming ? t("tl.thinking") : t("tl.thought")}</span>
      </button>
      {open ? <div className="ade-thinking-body">{text}</div> : null}
    </div>
  )
}

export function TimelineView({
  timeline,
  fallbackMessages,
  approvals,
  subagents,
  busy,
  workspacePath,
  emptyTitle,
  emptySubtitle,
  onResolveApproval,
  onOpenFile,
  onOpenSubagent,
  onOpenBrowser,
  onOpenExternalBrowser,
  onOpenArtifact,
  onRewind,
}: {
  timeline: ConversationTimelineSnapshot | null
  fallbackMessages?: ConversationMessage[]
  approvals: PendingApproval[]
  subagents: SubagentInfo[]
  busy: boolean
  workspacePath?: string | null
  emptyTitle?: string
  emptySubtitle?: string
  onResolveApproval?: (id: string, decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => Promise<void>
  onOpenFile?: (path: string) => void
  onOpenSubagent?: (subagentId: string) => void
  onOpenBrowser?: (url?: string) => void
  onOpenExternalBrowser?: (url: string) => void
  onOpenArtifact?: (artifactId?: string) => void
  /** Offer "Rewind files to before this message" on user messages (coding sessions with a workspace). */
  onRewind?: (messageContent: string) => void
}) {
  const { t } = useI18n()
  const endRef = useRef<HTMLDivElement>(null)

  const items: TimelineItem[] = timeline && timeline.items.length > 0
    ? timeline.items
    : (fallbackMessages ?? []).map<TimelineItem>(m => {
        if (m.role === "user") return { id: m.id, kind: "user", content: m.content, createdAt: m.createdAt }
        if (m.role === "error") return { id: m.id, kind: "error", message: m.content, createdAt: m.createdAt }
        return { id: m.id, kind: "assistant", thinking: "", text: m.content, toolCalls: [], createdAt: m.createdAt }
      })

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [items.length, approvals.length, busy])

  // Detect any localhost URLs in the latest assistant message to offer a quick open pill
  const extractUrls = (text: string): string[] => {
    const matches = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s)"'`]*/gi) ?? []
    return [...new Set(matches)].slice(0, 3)
  }

  return (
    <div className="ade-timeline">
      {items.length === 0 && approvals.length === 0 ? (
        <WorkspaceEmptyHero
          title={emptyTitle || t("tl.readyToBuild")}
          subtitle={emptySubtitle || t("tl.emptySubtitle")}
        />
      ) : null}

      {items.map((item) => {
        if (item.kind === "user") {
          return (
            <div key={item.id} className="ade-msg ade-msg-user">
              <div className="ade-msg-user-bubble">{item.content}</div>
              {onRewind && !busy ? (
                <button type="button" className="ade-msg-rewind" onClick={() => onRewind(item.content)} title={t("tl.rewindTitle")}>
                  ↺ Rewind files to here
                </button>
              ) : null}
            </div>
          )
        }
        if (item.kind === "compaction") {
          return (
            <div key={item.id} className="ade-compaction-divider">
              <span>{t("tl.compacted")}</span>
            </div>
          )
        }
        if (item.kind === "error") {
          return (
            <div key={item.id} className="ade-msg-error">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{item.message}</span>
            </div>
          )
        }
        const localUrls = item.text ? extractUrls(item.text) : []
        return (
          <div key={item.id} className={`ade-msg ade-msg-assistant ${item.streaming ? "is-streaming" : ""}`}>
            {item.thinking ? <ThinkingBlock text={item.thinking} streaming={item.streaming} /> : null}
            {item.toolCalls.length > 0 ? (
              <div className="ade-tool-stack">
                {item.toolCalls.map(tc => (
                  <ToolCallCard
                    key={tc.callId}
                    tool={tc}
                    subagents={subagents}
                    workspacePath={workspacePath}
                    onOpenFile={onOpenFile}
                    onOpenSubagent={onOpenSubagent}
                    onOpenBrowser={onOpenBrowser}
                    onOpenArtifact={onOpenArtifact}
                  />
                ))}
              </div>
            ) : null}
            {item.text ? (
              <div className="ade-msg-markdown">
                <MessageContent content={item.text} onOpenFile={onOpenFile} workspacePath={workspacePath} />
              </div>
            ) : null}
            {localUrls.length > 0 && (onOpenBrowser || onOpenExternalBrowser) ? (
              <div className="ade-url-pills">
                {localUrls.map(url => (
                  <div key={url} className="ade-url-pill-group">
                    {onOpenBrowser ? (
                      <button type="button" className="ade-chip-btn" onClick={() => onOpenBrowser(url)}>
                        <Globe className="size-3" /> {t("tl.preview", { url })}
                      </button>
                    ) : null}
                    {onOpenExternalBrowser ? (
                      <button type="button" className="ade-chip-btn" onClick={() => onOpenExternalBrowser(url)} title={t("tl.openExternal")}>
                        <ExternalLink className="size-3" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}

      {approvals.length > 0 && onResolveApproval ? (
        <div className="ade-approval-stack">
          {approvals.map(a => (
            <ApprovalCard key={a.id} approval={a} onResolve={onResolveApproval} />
          ))}
        </div>
      ) : null}

      {timeline?.runFailure ? (
        <div className="ade-msg-error">
          <AlertTriangle className="size-4 shrink-0" />
          <span>Run stopped ({timeline.runFailure.reason}){timeline.runFailure.detail ? `: ${timeline.runFailure.detail}` : ""}</span>
        </div>
      ) : null}

      {busy ? (
        <div className="ade-working-indicator">
          <Loader2 className="size-3.5 animate-spin" />
          <span>{t("tl.agentWorking")}</span>
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  )
}
