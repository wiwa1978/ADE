import { memo, useState } from "react"
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileCode2,
  FileText,
  Globe,
  Search,
  Sparkles,
  Terminal,
  XCircle,
} from "lucide-react"
import { Badge, Button, Spinner } from "../../components/ui/index.ts"
import { MessageContent } from "../MessageContent"
import { useI18n } from "../i18n/I18nContext"
import { extractToolCallFilePaths, isFileToolName } from "../panels/file-preview-utils"
import type { SubagentInfo, TimelineToolCall } from "../app-types"

export interface ToolCallCardProps {
  tool: TimelineToolCall
  subagents: SubagentInfo[]
  workspacePath?: string | null
  onOpenFile?: (path: string) => void
  onOpenSubagent?: (subagentId: string) => void
  onOpenBrowser?: (url?: string) => void
  onOpenArtifact?: (artifactId?: string) => void
}

export const ToolCallCard = memo(function ToolCallCard({
  tool,
  subagents,
  workspacePath,
  onOpenFile,
  onOpenSubagent,
  onOpenBrowser,
  onOpenArtifact,
}: ToolCallCardProps) {
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
  const queryText = typeof tool.arguments.query === "string"
    ? tool.arguments.query
    : (typeof tool.arguments.pattern === "string" ? tool.arguments.pattern : undefined)
  const urlText = typeof tool.arguments.url === "string"
    ? tool.arguments.url
    : (typeof details.url === "string" ? details.url : undefined)

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
    ? <Badge tone="warn">{t("tl.awaitingApproval")}</Badge>
    : isRunning
      ? <Badge tone="accent"><Spinner size="xs" /> {t("tl.running")}</Badge>
      : tool.isError || tool.status === "error"
        ? <Badge tone="error"><XCircle className="size-3" /> {t("tl.error")}</Badge>
        : <Badge tone="ok"><CheckCircle2 className="size-3" /> {t("tl.done")}</Badge>

  if (isSubagentTool) {
    const subStatus = matchedSubagent?.status ?? (isRunning ? "running" : tool.isError ? "failed" : "completed")
    const activeSubTool = matchedSubagent?.liveTools?.find(tc => tc.status === "running" || tc.status === "pending")
    const subTone = subStatus === "running" ? "accent" : subStatus === "completed" ? "ok" : subStatus === "failed" ? "error" : "neutral"
    return (
      <div className={`ade-subagent-inline-card ${subStatus === "running" ? "is-running" : ""}`}>
        <div className="ade-subagent-inline-head">
          <div className="ade-subagent-inline-title">
            <span className={`ade-dot ade-dot-${subStatus}`} />
            <Bot className="size-4" />
            <strong>{String(tool.arguments.name || matchedSubagent?.name || "Subagent")}</strong>
            {tool.arguments.role || matchedSubagent?.role ? (
              <Badge>{String(tool.arguments.role || matchedSubagent?.role)}</Badge>
            ) : null}
            <Badge>{String(tool.arguments.mode || matchedSubagent?.mode || "readonly")}</Badge>
            {details.branch || matchedSubagent?.branch ? (
              <Badge className="font-mono">{String(details.branch || matchedSubagent?.branch)}</Badge>
            ) : null}
          </div>
          <div className="ade-subagent-inline-actions">
            <Badge tone={subTone}>
              {subStatus === "running" ? <><Spinner size="xs" /> {t("tl.working")}</> : subStatus}
            </Badge>
            {subagentId && onOpenSubagent ? (
              <Button variant="chip" size="xs" onClick={() => onOpenSubagent(subagentId)}>
                <Columns2 className="size-3.5" /> {t("tl.openBeside")}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="ade-subagent-inline-task">
          {String(tool.arguments.task || matchedSubagent?.assignment || "")}
        </div>
        {activeSubTool ? (
          <div className="ade-subagent-inline-live">
            <Spinner size="xs" />
            <span>
              {t("tl.runningTool", { name: "§N§" })
                .split("§N§")
                .flatMap((part, index) => (index === 0 ? [part] : [<code key={index}>{activeSubTool.name}</code>, part]))}
            </span>
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
              <Button key={fp} variant="chip" size="xs" onClick={() => onOpenFile(fp)} title={t("tl.viewFileTitle", { file: fp })}>
                {filePaths.length === 1 ? t("tl.openFile") : fp.split("/").pop() || fp}
              </Button>
            ))
          ) : null}
          {isBrowserTool && onOpenBrowser ? (
            <Button variant="chip" size="xs" onClick={() => onOpenBrowser(urlText)}>{t("tl.openBrowser")}</Button>
          ) : null}
          {isArtifactTool && onOpenArtifact ? (
            <Button variant="chip" size="xs" onClick={() => onOpenArtifact(typeof details.artifactId === "string" ? details.artifactId : undefined)}>{t("tl.viewArtifact")}</Button>
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
            <div className="ade-tool-waiting"><Spinner size="sm" label={t("tl.waitingOutput")} /></div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
