import { useCallback, useEffect, useState } from "react"
import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronDown,
  ChevronRight,
  Columns2,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  KanbanSquare,
  LayoutGrid,
  ListTodo,
  Maximize2,
  Play,
  Plus,
  Send,
  Settings2,
  Square,
  Trash2,
  Workflow,
  X,
} from "lucide-react"
import { request, resolveCaptainUrl } from "../../api"
import type {
  Conversation,
  ConversationTimelineSnapshot,
  WorkspaceGitSummary,
} from "../../app-types"
import type { FeatureAgent } from "../../FeatureAgents"
import { BUILTIN_BLUEPRINTS } from "../../packages/blueprints/index.ts"
import type { Project, ProjectActivity } from "../../ProjectsView"
import { DiffPanel } from "../panels/DiffPanel"
import { FactoryKanban } from "../factory/FactoryKanban"
import { FactoryIssuesList } from "../factory/FactoryIssuesList"
import { ProjectPullRequests } from "./ProjectPullRequests"
import type { ProjectGitHubIssue } from "../factory/FactoryIssuesList"
import type { FactoryRunDetail } from "../factory/types"

const EMPTY_GIT: WorkspaceGitSummary = {
  isGitRepo: false,
  branch: null,
  ahead: 0,
  behind: 0,
  additions: 0,
  deletions: 0,
  files: [],
}

type ProjectTab = "sessions" | "kanban" | "issues" | "pulls" | "subagents"
type StreamLayout = "single" | "split" | "grid"

function LiveSessionPane({
  session,
  focused,
  onFocus,
  onMaximize,
  onClose,
  onSendQuickMessage,
}: {
  session: Conversation
  focused: boolean
  onFocus: () => void
  onMaximize: () => void
  onClose: () => void
  onSendQuickMessage: (session: Conversation, text: string) => Promise<void>
}) {
  const [timeline, setTimeline] = useState<ConversationTimelineSnapshot | null>(null)
  const [gitSummary, setGitSummary] = useState<WorkspaceGitSummary>(EMPTY_GIT)
  const [paneView, setPaneView] = useState<"chat" | "diff">("chat")
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const snap = await request<ConversationTimelineSnapshot>(
        `/api/sessions/${encodeURIComponent(session.id)}/timeline`,
      )
      setTimeline(snap)
    } catch {
      // ignore
    }
  }, [session.id])

  const refreshGit = useCallback(async () => {
    try {
      const summary = await request<WorkspaceGitSummary>(
        `/api/workspace/git?sessionId=${encodeURIComponent(session.id)}`,
      )
      if (summary) setGitSummary(summary)
    } catch {
      // ignore
    }
  }, [session.id])

  useEffect(() => {
    void refresh()
    void refreshGit()
    if (typeof EventSource === "undefined") return
    const es = new EventSource(resolveCaptainUrl("/api/events"))
    const onMsg = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data)
        if (parsed?.sessionId === session.id || parsed?.payload?.sessionId === session.id) {
          void refresh()
          void refreshGit()
        }
      } catch {
        // ignore
      }
    }
    es.addEventListener("timeline.updated", onMsg)
    es.addEventListener("message", onMsg)
    return () => { es.close() }
  }, [session.id, refresh, refreshGit])

  const items = timeline?.items ?? []
  const isWorking = session.status === "working" || Boolean(timeline?.busy)
  const changedCount = gitSummary.files.length

  async function submit() {
    const trimmed = draft.trim()
    if (!trimmed || sending) return
    setDraft("")
    setSending(true)
    try {
      await onSendQuickMessage(session, trimmed)
      await refresh()
      await refreshGit()
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      className={`ade-stream-pane ${focused ? "is-focused" : ""}`}
      onClick={onFocus}
    >
      <header className="ade-stream-pane-head">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`ade-dot ade-dot-${isWorking ? "running" : session.workspace?.status === "attention" ? "failed" : "completed"}`} />
          <GitBranch className="size-3.5 opacity-70 shrink-0" />
          <span className="text-[12.5px] font-semibold truncate">{session.label}</span>
          {session.workspace?.branch || gitSummary.branch ? (
            <span className="ade-pill !text-[10.5px] font-mono">{session.workspace?.branch || gitSummary.branch}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="ade-segmented" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className={paneView === "chat" ? "is-active" : ""}
              onClick={() => setPaneView("chat")}
            >
              Stream
            </button>
            <button
              type="button"
              className={paneView === "diff" ? "is-active" : ""}
              onClick={() => { setPaneView("diff"); void refreshGit() }}
              title="Inspect git diff for this session"
            >
              Diff{changedCount > 0 ? ` (${changedCount})` : ""}
            </button>
          </div>
          <button
            type="button"
            className="ade-icon-btn !w-6 !h-6"
            title="Open full workspace (Terminal, Diff, Files, Browser)"
            onClick={e => { e.stopPropagation(); onMaximize() }}
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="ade-icon-btn !w-6 !h-6"
            title="Close pane (keeps stream in sidebar)"
            onClick={e => { e.stopPropagation(); onClose() }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      {paneView === "diff" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <DiffPanel sessionId={session.id} summary={gitSummary} onRefresh={() => void refreshGit()} />
        </div>
      ) : (
        <>
          <div className="ade-stream-pane-body">
            {items.length === 0 ? (
              <div className="my-auto text-center py-6 px-3 opacity-65">
                <div className="text-[12.5px] font-medium">Stream ready</div>
                <div className="text-[11.5px] mt-1">
                  Send a message below, switch to Diff to inspect changes, or click Maximize for Terminal &amp; Browser.
                </div>
              </div>
            ) : (
              items.slice(-12).map(entry => {
                if (entry.kind === "user") {
                  return (
                    <div key={entry.id} className="flex justify-end">
                      <div className="max-w-[88%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed bg-[rgb(var(--surface-raised))] border border-[rgb(var(--border)/0.8)] whitespace-pre-wrap break-words">
                        {entry.content}
                      </div>
                    </div>
                  )
                }
                if (entry.kind === "error") {
                  return (
                    <div key={entry.id} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[12px] text-rose-300">
                      {entry.message}
                    </div>
                  )
                }
                if (entry.kind === "compaction") {
                  return (
                    <div key={entry.id} className="text-[11px] opacity-60 italic">
                      {entry.summary}
                    </div>
                  )
                }
                const tools = entry.toolCalls ?? []
                return (
                  <div key={entry.id} className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed">
                    {tools.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {tools.slice(0, 6).map(tc => (
                          <span key={tc.callId} className="ade-pill !text-[10.5px] font-mono">
                            {tc.name}
                          </span>
                        ))}
                        {tools.length > 6 ? <span className="ade-pill !text-[10.5px]">+{tools.length - 6}</span> : null}
                      </div>
                    ) : null}
                    {entry.text ? (
                      <div className="whitespace-pre-wrap break-words opacity-90">
                        {entry.text.length > 600 ? `${entry.text.slice(0, 600)}…` : entry.text}
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
            {isWorking ? (
              <div className="flex items-center gap-2 text-[11.5px] opacity-70">
                <span className="ade-dot ade-dot-running" /> Working…
              </div>
            ) : null}
          </div>

          <form
            className="ade-stream-pane-composer"
            onSubmit={e => { e.preventDefault(); void submit() }}
          >
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={`Message ${session.label}…`}
              disabled={sending}
            />
            <button
              type="submit"
              className="ade-icon-btn !w-7 !h-7"
              disabled={sending || !draft.trim()}
              title="Send to stream"
            >
              <Send className="size-3.5" />
            </button>
          </form>
        </>
      )}
    </section>
  )
}

function LiveFactoryRunPane({
  detail,
  focused,
  onFocus,
  onMaximize,
  onClose,
  onAction,
}: {
  detail: FactoryRunDetail
  focused: boolean
  onFocus: () => void
  onMaximize: () => void
  onClose: () => void
  onAction: (runId: string, action: "step" | "approve" | "pause" | "steer", note?: string) => Promise<void>
}) {
  const [steerText, setSteerText] = useState("")
  const [busy, setBusy] = useState(false)
  const { run, subagents, blueprint: bp, taskPrompt } = detail
  const currentStage = run.stages[run.currentStageIndex]
  const currentStageId = currentStage?.stageId ?? bp.stages[0]?.id ?? "stage"

  return (
    <section
      className={`ade-stream-pane ${focused ? "is-focused" : ""}`}
      onClick={onFocus}
    >
      <header className="ade-stream-pane-head">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`ade-dot ade-dot-${
              run.status === "running"
                ? "running"
                : run.status === "completed"
                  ? "completed"
                  : run.status === "failed"
                    ? "failed"
                    : "waiting"
            }`}
          />
          <Workflow className="size-3.5 opacity-75 shrink-0" />
          <span className="text-[12.5px] font-semibold truncate">
            {run.issueRef?.number ? `#${run.issueRef.number} · ` : ""}
            {run.issueRef?.title || taskPrompt || run.runId.slice(0, 8)}
          </span>
          <span className="ade-pill ade-pill-accent !text-[10.5px]">{currentStageId}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className="ade-icon-btn !w-6 !h-6"
            title="Open full Factory Run workspace"
            onClick={e => { e.stopPropagation(); onMaximize() }}
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="ade-icon-btn !w-6 !h-6"
            title="Close pane"
            onClick={e => { e.stopPropagation(); onClose() }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="ade-stream-pane-body">
        {bp ? (
          <div className="flex flex-wrap items-center gap-1">
            {bp.stages.map(st => {
              const isCurrent = st.id === currentStageId
              return (
                <span
                  key={st.id}
                  className={`ade-pill !text-[10.5px] ${isCurrent ? "ade-pill-accent font-semibold" : ""}`}
                >
                  {st.name || st.id}
                </span>
              )
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-[11.5px] opacity-75">
          <span>Status: <strong className="opacity-100">{run.status}</strong></span>
          <span>·</span>
          <span>Subagents: <strong className="opacity-100">{subagents.length}</strong></span>
          {detail.diff ? (
            <>
              <span>·</span>
              <span className="font-mono text-[11px]">diff ready</span>
            </>
          ) : null}
        </div>

        {subagents.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {subagents.slice(0, 4).map(sa => (
              <div
                key={sa.id}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-[rgb(var(--border)/0.7)] bg-[rgb(var(--background)/0.55)] text-[11.5px]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`ade-dot ade-dot-${sa.status === "running" ? "running" : sa.status === "completed" ? "completed" : sa.status === "failed" ? "failed" : "waiting"}`} />
                  <span className="font-medium truncate">{sa.name}</span>
                </div>
                <span className="opacity-60 font-mono text-[10.5px] shrink-0">{sa.model}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 mt-auto pt-2">
          {run.status === "awaiting_approval" ? (
            <button
              type="button"
              className="sf-btn-primary !h-7 !text-[11.5px]"
              disabled={busy}
              onClick={async () => { setBusy(true); try { await onAction(run.runId, "approve") } finally { setBusy(false) } }}
            >
              Approve stage
            </button>
          ) : (
            <button
              type="button"
              className="sf-btn-secondary !h-7 !text-[11.5px]"
              disabled={busy || run.status === "completed"}
              onClick={async () => { setBusy(true); try { await onAction(run.runId, "step") } finally { setBusy(false) } }}
            >
              <Play className="size-3" /> Step
            </button>
          )}
          <button
            type="button"
            className="sf-btn-ghost !h-7 !text-[11.5px]"
            disabled={busy || run.status !== "running"}
            onClick={async () => { setBusy(true); try { await onAction(run.runId, "pause") } finally { setBusy(false) } }}
          >
            Pause
          </button>
        </div>
      </div>

      <form
        className="ade-stream-pane-composer"
        onSubmit={async e => {
          e.preventDefault()
          const text = steerText.trim()
          if (!text || busy) return
          setSteerText("")
          setBusy(true)
          try { await onAction(run.runId, "steer", text) } finally { setBusy(false) }
        }}
      >
        <input
          value={steerText}
          onChange={e => setSteerText(e.target.value)}
          placeholder="Steer Captain or give instruction…"
          disabled={busy}
        />
        <button type="submit" className="ade-icon-btn !w-7 !h-7" disabled={busy || !steerText.trim()}>
          <Send className="size-3.5" />
        </button>
      </form>
    </section>
  )
}

export function ProjectStreamsWorkspace({
  project,
  sessions,
  archivedSessions,
  factoryRuns,
  openStreamIds,
  focusedStreamId,
  activity,
  activityError,
  settingsOpen,
  onToggleSettings,
  onFocusStream,
  onCloseStreamPane,
  onOpenStreamPane,
  onMaximizeSession,
  onMaximizeFactoryRun,
  onQuickStartStream,
  onSendQuickMessage,
  onStartFactoryRun,
  onFactoryRunAction,
  onUnarchiveSession,
  onDeleteSession,
  onOpenAgent,
  onStartSessionFromIssue,
  onOpenExternal,
}: {
  project: Project
  sessions: Conversation[]
  archivedSessions: Conversation[]
  factoryRuns: FactoryRunDetail[]
  openStreamIds: string[]
  focusedStreamId: string | null
  activity: ProjectActivity | null
  activityError: string
  settingsOpen: boolean
  onToggleSettings: () => void
  onFocusStream: (streamId: string) => void
  onCloseStreamPane: (streamId: string) => void
  onOpenStreamPane: (streamId: string) => void
  onMaximizeSession: (sessionId: string) => void
  onMaximizeFactoryRun: (runId: string) => void
  onQuickStartStream: (prompt: string) => Promise<void>
  onSendQuickMessage: (session: Conversation, text: string) => Promise<void>
  onStartFactoryRun: (opts?: { issueNumber?: number; issueTitle?: string; issueBody?: string }) => Promise<void>
  onFactoryRunAction: (runId: string, action: "step" | "approve" | "pause" | "steer", note?: string) => Promise<void>
  onUnarchiveSession: (sessionId: string) => void
  onDeleteSession: (session: Conversation) => void
  onOpenAgent: (sessionId: string, agent: FeatureAgent) => void
  onStartSessionFromIssue?: (issue: ProjectGitHubIssue) => Promise<void>
  onOpenExternal?: (url: string) => void
}) {
  const [activeTab, setActiveTab] = useState<ProjectTab>("sessions")
  const [layout, setLayout] = useState<StreamLayout>("split")
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [quickPrompt, setQuickPrompt] = useState("")
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState("")

  const blueprint = BUILTIN_BLUEPRINTS.find(b => b.id === (project.blueprintId || "automated-factory")) ?? BUILTIN_BLUEPRINTS[0]
  const repoSlug = project.githubUrl?.replace(/^https:\/\/github\.com\//i, "") ?? null

  // Resolve visible stream panes in the middle
  const sessionMap = new Map(sessions.map(s => [s.id, s]))
  const runMap = new Map(factoryRuns.map(r => [`factory:${r.run.runId}`, r]))

  const allAvailableStreamIds = [
    ...sessions.map(s => s.id),
    ...factoryRuns.map(r => `factory:${r.run.runId}`),
  ]

  const activePaneIds = openStreamIds.filter(id => sessionMap.has(id) || runMap.has(id))
  const visiblePaneIds =
    activePaneIds.length > 0
      ? layout === "single"
        ? [focusedStreamId && activePaneIds.includes(focusedStreamId) ? focusedStreamId : activePaneIds[0]]
        : activePaneIds
      : allAvailableStreamIds.slice(0, layout === "single" ? 1 : 4)

  const hiddenStreamIds = allAvailableStreamIds.filter(id => !visiblePaneIds.includes(id))

  // Combine coding-task subagents + factory run subagents for Tab 4
  const factorySubagents = factoryRuns.flatMap(detail =>
    detail.subagents.map(sa => ({
      ...sa,
      runId: detail.run.runId,
      runTitle: detail.run.issueRef?.title || detail.taskPrompt || detail.run.runId.slice(0, 8),
    })),
  )
  const totalSubagentsCount = (activity?.agents.length ?? 0) + factorySubagents.length

  async function handleQuickLaunch() {
    const trimmed = quickPrompt.trim()
    if (!trimmed || launching) return
    setLaunching(true)
    setLaunchError("")
    try {
      await onQuickStartStream(trimmed)
      setQuickPrompt("")
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Could not start stream.")
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="ade-project-shell">
      {/* Project Header */}
      <header className="ade-project-topbar">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <FolderGit2 className="size-4 opacity-80 shrink-0" />
          <h1 className="text-[15px] font-semibold tracking-tight m-0 truncate">{project.name}</h1>
          {repoSlug ? <span className="ade-pill font-mono">{repoSlug}</span> : null}
          <span className="ade-pill ade-pill-accent">{blueprint.name}</span>
          {project.modelProfile ? <span className="ade-pill">{project.modelProfile}</span> : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="sf-btn-secondary !h-8"
            onClick={() => void onStartFactoryRun()}
            title="Launch a new Software Factory run on this project"
          >
            <Workflow className="size-3.5" /> New Factory Run
          </button>
          <button
            type="button"
            className="sf-btn-primary !h-8"
            onClick={() => {
              setActiveTab("sessions")
              void onQuickStartStream("")
            }}
          >
            <Plus className="size-3.5" /> New Stream
          </button>
          <button
            type="button"
            className={`ade-icon-btn ${settingsOpen ? "bg-[rgb(var(--surface-raised))] text-[rgb(var(--foreground))]" : ""}`}
            title="Project settings"
            onClick={onToggleSettings}
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </header>

      {/* 4 Project Tabs: Sessions (+archived), Kanban, GitHub Issues, Subagents Activity */}
      <div className="ade-project-tabs-row">
        <nav className="ade-project-tabs" role="tablist" aria-label="Project views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "sessions"}
            className={`ade-project-tab ${activeTab === "sessions" ? "is-active" : ""}`}
            onClick={() => setActiveTab("sessions")}
          >
            <Columns2 className="size-3.5" />
            <span>Sessions</span>
            <span className="ade-count-badge">{sessions.length + factoryRuns.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "kanban"}
            className={`ade-project-tab ${activeTab === "kanban" ? "is-active" : ""}`}
            onClick={() => setActiveTab("kanban")}
          >
            <KanbanSquare className="size-3.5" />
            <span>Kanban</span>
            <span className="ade-count-badge">{factoryRuns.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "issues"}
            className={`ade-project-tab ${activeTab === "issues" ? "is-active" : ""}`}
            onClick={() => setActiveTab("issues")}
          >
            <ListTodo className="size-3.5" />
            <span>GitHub Issues</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "pulls"}
            className={`ade-project-tab ${activeTab === "pulls" ? "is-active" : ""}`}
            onClick={() => setActiveTab("pulls")}
          >
            <GitPullRequest className="size-3.5" />
            <span>Pull Requests</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "subagents"}
            className={`ade-project-tab ${activeTab === "subagents" ? "is-active" : ""}`}
            onClick={() => setActiveTab("subagents")}
          >
            <Bot className="size-3.5" />
            <span>Subagents Activity</span>
            {totalSubagentsCount > 0 ? (
              <span className="ade-count-badge is-accent">{totalSubagentsCount}</span>
            ) : null}
          </button>
        </nav>

        {activeTab === "sessions" && visiblePaneIds.length > 0 ? (
          <div className="flex items-center gap-2">
            {hiddenStreamIds.length > 0 ? (
              <button
                type="button"
                className="ade-chip-btn"
                onClick={() => onOpenStreamPane(hiddenStreamIds[0])}
                title="Open another stream side-by-side"
              >
                <Plus className="size-3" /> Add pane ({hiddenStreamIds.length})
              </button>
            ) : null}
            <div className="ade-segmented" role="group" aria-label="Pane layout">
              <button
                type="button"
                className={layout === "single" ? "is-active" : ""}
                onClick={() => setLayout("single")}
                title="Single pane"
              >
                <Square className="size-3" />
              </button>
              <button
                type="button"
                className={layout === "split" ? "is-active" : ""}
                onClick={() => setLayout("split")}
                title="2-up split panes"
              >
                <Columns2 className="size-3" />
              </button>
              <button
                type="button"
                className={layout === "grid" ? "is-active" : ""}
                onClick={() => setLayout("grid")}
                title="Multi-pane grid"
              >
                <LayoutGrid className="size-3" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Tab 1: Sessions Overview (Multi-Stream Panes + Archived Sessions) */}
      {activeTab === "sessions" ? (
        <div className="ade-streams-canvas">
          {launchError ? <div className="ade-banner-error">{launchError}</div> : null}

          {visiblePaneIds.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="w-11 h-11 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] grid place-items-center mb-4 opacity-85">
                <Columns2 className="size-5" />
              </div>
              <h2 className="text-[16px] font-semibold m-0">Start a stream in {project.name}</h2>
              <p className="text-[13px] opacity-65 max-w-md mt-1.5 mb-5 leading-relaxed">
                Streams appear under {project.name} on the left and open side-by-side here so you can run parallel agents, features, and Factory pipelines at once.
              </p>
              <form
                className="w-full max-w-xl flex items-center gap-2 p-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))]"
                onSubmit={e => { e.preventDefault(); void handleQuickLaunch() }}
              >
                <input
                  className="flex-1 bg-transparent border-0 outline-none px-2 text-[13px]"
                  placeholder={`What should an agent build or investigate in ${project.name}?`}
                  value={quickPrompt}
                  onChange={e => setQuickPrompt(e.target.value)}
                  disabled={launching}
                />
                <button
                  type="submit"
                  className="sf-btn-primary !h-8"
                  disabled={launching || !quickPrompt.trim()}
                >
                  {launching ? "Starting…" : "Start stream"}
                </button>
              </form>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                <button type="button" className="sf-btn-secondary" onClick={() => void onStartFactoryRun()}>
                  <Workflow className="size-3.5" /> Start Software Factory Run
                </button>
                <button type="button" className="sf-btn-ghost" onClick={() => setActiveTab("issues")}>
                  <ListTodo className="size-3.5" /> Browse GitHub Issues
                </button>
              </div>
            </div>
          ) : (
            <div className={`ade-streams-grid layout-${layout}`}>
              {visiblePaneIds.map(streamId => {
                const sess = sessionMap.get(streamId)
                if (sess) {
                  return (
                    <LiveSessionPane
                      key={sess.id}
                      session={sess}
                      focused={focusedStreamId === sess.id}
                      onFocus={() => onFocusStream(sess.id)}
                      onMaximize={() => onMaximizeSession(sess.id)}
                      onClose={() => onCloseStreamPane(sess.id)}
                      onSendQuickMessage={onSendQuickMessage}
                    />
                  )
                }
                const runDetail = runMap.get(streamId)
                if (runDetail) {
                  return (
                    <LiveFactoryRunPane
                      key={streamId}
                      detail={runDetail}
                      focused={focusedStreamId === streamId}
                      onFocus={() => onFocusStream(streamId)}
                      onMaximize={() => onMaximizeFactoryRun(runDetail.run.runId)}
                      onClose={() => onCloseStreamPane(streamId)}
                      onAction={onFactoryRunAction}
                    />
                  )
                }
                return null
              })}
            </div>
          )}

          {/* Archived Sessions Drawer */}
          <section className="ade-archived-drawer">
            <button
              type="button"
              className="ade-archived-head"
              onClick={() => setArchivedOpen(v => !v)}
            >
              <span className="flex items-center gap-2">
                {archivedOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                <Archive className="size-3.5" />
                <span>Archived sessions</span>
                <span className="ade-count-badge">{archivedSessions.length}</span>
              </span>
              <span className="text-[11px] font-normal opacity-70">Right-click any stream to archive</span>
            </button>
            {archivedOpen ? (
              <div className="border-t border-[rgb(var(--border)/0.7)] divide-y divide-[rgb(var(--border)/0.5)]">
                {archivedSessions.length === 0 ? (
                  <div className="px-3.5 py-3 text-[12px] opacity-60">No archived sessions in this project.</div>
                ) : (
                  archivedSessions.map(sess => (
                    <div
                      key={sess.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[12.5px]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GitBranch className="size-3.5 opacity-55 shrink-0" />
                        <span className="truncate">{sess.label}</span>
                        {sess.workspace?.branch ? (
                          <span className="ade-pill !text-[10.5px] font-mono">{sess.workspace.branch}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          className="ade-chip-btn"
                          onClick={() => onUnarchiveSession(sess.id)}
                          title="Restore to active sessions"
                        >
                          <ArchiveRestore className="size-3" /> Restore
                        </button>
                        <button
                          type="button"
                          className="ade-chip-btn ade-chip-danger"
                          onClick={() => onDeleteSession(sess)}
                          title="Delete permanently"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {/* Tab 2: Kanban */}
      {activeTab === "kanban" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <FactoryKanban
            runs={factoryRuns}
            selectedRunId={null}
            onSelectRun={runId => onMaximizeFactoryRun(runId)}
            onAutoRun={runId => void onFactoryRunAction(runId, "step")}
            onNewRun={() => void onStartFactoryRun()}
          />
        </div>
      ) : null}

      {/* Tab 3: GitHub Issues */}
      {activeTab === "issues" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <FactoryIssuesList
            project={project}
            onStartFromIssue={async issue => {
              await onStartFactoryRun({
                issueNumber: issue.number,
                issueTitle: issue.title,
                issueBody: issue.body,
              })
              setActiveTab("kanban")
            }}
            onStartSessionFromIssue={onStartSessionFromIssue}
            onOpenProjectSettings={onToggleSettings}
          />
        </div>
      ) : null}

      {activeTab === "pulls" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <ProjectPullRequests
            project={project}
            sessionBranches={Object.fromEntries([...sessions, ...archivedSessions].filter(s => s.workspace?.branch).map(s => [s.workspace!.branch!, s.id]))}
            onOpenExternal={url => onOpenExternal ? onOpenExternal(url) : void window.open(url, "_blank", "noopener")}
            onOpenSession={onMaximizeSession}
            onOpenProjectSettings={onToggleSettings}
          />
        </div>
      ) : null}

      {/* Tab 4: Subagents Activity */}
      {activeTab === "subagents" ? (
        <div className="flex-1 min-h-0 overflow-auto p-5 flex flex-col gap-5">
          {activityError ? (
            <div className="text-[12px] opacity-65">Session subagent polling: {activityError}</div>
          ) : null}

          <section className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold m-0">Factory Pipeline Subagents</h2>
              <span className="ade-count-badge">{factorySubagents.length}</span>
            </div>
            {factorySubagents.length === 0 ? (
              <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface)/0.5)] px-4 py-5 text-[12.5px] opacity-65">
                No Software Factory subagents have run for this project yet. Start a Factory run from Kanban or GitHub Issues.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {factorySubagents.map(sa => (
                  <button
                    key={`${sa.runId}:${sa.id}`}
                    type="button"
                    className="w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:border-[rgb(var(--primary)/0.55)] text-left cursor-pointer"
                    onClick={() => onMaximizeFactoryRun(sa.runId)}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`ade-dot ade-dot-${sa.status === "running" ? "running" : sa.status === "completed" ? "completed" : sa.status === "failed" ? "failed" : "waiting"}`} />
                        <strong className="text-[13px] truncate">{sa.name}</strong>
                        <span className="ade-pill !text-[10.5px]">{sa.role}</span>
                        <span className="ade-pill !text-[10.5px] font-mono">{sa.model}</span>
                      </div>
                      <div className="text-[12px] opacity-65 truncate mt-1">
                        Run: {sa.runTitle} {sa.summary ? `· ${sa.summary}` : ""}
                      </div>
                    </div>
                    <span className="ade-pill shrink-0 capitalize">{sa.status}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold m-0">Session Delegated Subagents</h2>
              <span className="ade-count-badge">{activity?.agents.length ?? 0}</span>
            </div>
            {!activity && !activityError ? (
              <div className="text-[12px] opacity-60">Loading subagent activity…</div>
            ) : activity && activity.agents.length > 0 ? (
              <div className="flex flex-col gap-2">
                {activity.agents.map(agent => (
                  <button
                    key={`${agent.sessionId}:${agent.id}`}
                    type="button"
                    className="w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:border-[rgb(var(--primary)/0.55)] text-left cursor-pointer"
                    onClick={() => onOpenAgent(agent.sessionId, agent)}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`ade-dot ade-dot-${agent.status === "running" ? "running" : agent.status === "completed" ? "completed" : "waiting"}`} />
                        <strong className="text-[13px] truncate">{agent.name} · {agent.sessionName}</strong>
                      </div>
                      <div className="text-[12px] opacity-65 truncate mt-1">{agent.assignment}</div>
                    </div>
                    <span className="ade-pill shrink-0 capitalize">{agent.status}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface)/0.5)] px-4 py-5 text-[12.5px] opacity-65">
                No delegated session subagents yet. Ask a stream to spawn parallel subagents to see them live here.
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
