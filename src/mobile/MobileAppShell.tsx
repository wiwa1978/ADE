import { useMemo, useState, type RefObject } from "react"
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileDiff,
  Folder,
  Inbox,
  Layers,
  Loader2,
  LogOut,
  MessageSquare,
  Moon,
  Pin,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Square,
  Sun,
  Wifi,
  WifiOff,
  X,
} from "lucide-react"
import { request } from "../../api"
import type {
  ApprovalPolicy,
  Conversation,
  ConversationTimelineSnapshot,
  PendingApproval,
  ProviderCatalogEntry,
  SessionArtifact,
  SkillsAndRulesCatalog,
  SubagentInfo,
  TaskStart,
  WorkspaceGitSummary,
} from "../../app-types"
import type { Project } from "../../ProjectsView"
import { sessionStateInfo, type InboxEntry } from "../session-state"
import { ActiveThreadSpinner } from "../sidebar/ActiveThreadSpinner"
import { TimelineView } from "../timeline/TimelineView"
import { ComposerDock } from "../composer/ComposerDock"
import { ArtefactsBrowserPanel } from "../panels/ArtefactsBrowserPanel"
import { RichFilePreview } from "../panels/RichFilePreview"
import { DiffPanel } from "../panels/DiffPanel"
import type { MobileSessionState } from "./MobileAuthGate"
import { MobileNewSessionSheet } from "./MobileNewSessionSheet"

export type MobileTab = "inbox" | "sessions" | "chat" | "artefacts"

export function MobileAppShell({
  mobileSession,
  hostName,
  runtimeOnline,
  sseConnected,
  resolvedTheme,
  onToggleTheme,
  sessions,
  activeSession,
  projects,
  pinnedIds,
  unreadIds,
  archivedIds,
  inboxEntries,
  inboxCount,
  timeline,
  subagents,
  approvals,
  approvalPolicy,
  artifacts,
  gitSummary,
  skillsCatalog,
  modelCatalog,
  selectedProvider,
  selectedModel,
  reasoning,
  draft,
  attachments,
  creatingSession,
  launchError,
  composerRef,
  onSelectSession,
  onSelectModel,
  onSelectReasoning,
  onChangeApprovalPolicy,
  onDraftChange,
  onAttachFiles,
  onRemoveAttachment,
  onSendMessage,
  onAskAgent,
  onSteerSession,
  onAbortSession,
  onCompactSession,
  onResolveApproval,
  onReviewArtifact,
  onRefreshGit,
  onRefreshSessions,
  onCreateChatThread,
  onStartNewSession,
  onOpenExternalBrowser,
}: {
  mobileSession: MobileSessionState | null
  hostName: string
  runtimeOnline: boolean
  sseConnected: boolean
  resolvedTheme: "light" | "dark"
  onToggleTheme: () => void
  sessions: Conversation[]
  activeSession: Conversation
  projects: Project[]
  pinnedIds: string[]
  unreadIds: string[]
  archivedIds: string[]
  inboxEntries: Record<string, InboxEntry>
  inboxCount: number
  timeline: ConversationTimelineSnapshot | null
  subagents: SubagentInfo[]
  approvals: PendingApproval[]
  approvalPolicy: ApprovalPolicy
  artifacts: SessionArtifact[]
  gitSummary: WorkspaceGitSummary
  skillsCatalog: SkillsAndRulesCatalog
  modelCatalog: ProviderCatalogEntry[]
  selectedProvider: string
  selectedModel: string
  reasoning: string
  draft: string
  attachments: { id: string; name: string; content: string }[]
  creatingSession: boolean
  launchError: string
  composerRef: RefObject<HTMLTextAreaElement | null>
  onSelectSession: (session: Conversation) => void
  onSelectModel: (provider: string, id: string) => void
  onSelectReasoning: (level: string) => void
  onChangeApprovalPolicy: (policy: ApprovalPolicy) => void
  onDraftChange: (value: string) => void
  onAttachFiles: (files: FileList | null) => void
  onRemoveAttachment: (id: string) => void
  onSendMessage: (text: string) => void
  onAskAgent: (text: string) => Promise<void>
  onSteerSession: (text: string, mode: "steer" | "follow-up") => void
  onAbortSession: () => void
  onCompactSession: () => void
  onResolveApproval: (id: string, decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => Promise<void>
  onReviewArtifact: (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => Promise<void>
  onRefreshGit: () => void
  onRefreshSessions: () => Promise<void>
  onCreateChatThread: (mode: "coding" | "personal") => void
  onStartNewSession: (input: {
    projectId: string | null
    kind: TaskStart["kind"]
    repository: string
    prompt: string
    title?: string
  }) => Promise<void>
  onOpenExternalBrowser: (url: string) => void
}) {
  const [tab, setTab] = useState<MobileTab>("inbox")
  const [searchQuery, setSearchQuery] = useState("")
  const [artefactScope, setArtefactScope] = useState<"session" | "project">("session")
  const [artefactProjectId, setArtefactProjectId] = useState<string | null>(null)
  const [openFilePath, setOpenFilePath] = useState<string | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [deviceSheetOpen, setDeviceSheetOpen] = useState(false)
  const [newSheetOpen, setNewSheetOpen] = useState(false)
  const [newSheetProjectId, setNewSheetProjectId] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  const hasWorkspace = Boolean(activeSession.workspace?.path && activeSession.workspace.status === "ready")
  const workspacePath = activeSession.workspace?.path ?? null
  const isBusy = activeSession.status === "working" || Boolean(timeline?.busy)
  const activeProject = projects.find(p => p.id === activeSession.projectId) ?? null
  const pendingArtifacts = artifacts.filter(a => a.status === "awaiting_approval")

  const visibleSessions = useMemo(
    () => sessions.filter(s => !archivedIds.includes(s.id)),
    [sessions, archivedIds],
  )

  const inboxSorted = useMemo(() => {
    const weight = (s: Conversation) => {
      const e = inboxEntries[s.id]
      if (e?.state === "needs-approval") return 0
      if (e?.needsYou) return 1
      if (s.status === "working" || e?.state === "working") return 2
      if (unreadIds.includes(s.id)) return 3
      return 4
    }
    return [...visibleSessions].sort((a, b) => weight(a) - weight(b))
  }, [visibleSessions, inboxEntries, unreadIds])

  const projectList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const list = projects.filter(p => !archivedIds.includes(`project:${p.id}`))
    if (!q) return list
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      visibleSessions.some(s => s.projectId === p.id && s.label.toLowerCase().includes(q)),
    )
  }, [projects, archivedIds, searchQuery, visibleSessions])

  const chatList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const chats = visibleSessions.filter(s => s.id === "coding" || s.id === "personal" || s.chatThread)
    if (!q) return chats
    return chats.filter(c => c.label.toLowerCase().includes(q))
  }, [visibleSessions, searchQuery])

  const openSessionChat = (sess: Conversation) => {
    setOpenFilePath(null)
    setDiffOpen(false)
    onSelectSession(sess)
    setTab("chat")
  }

  const openProjectArtefacts = (projectId: string) => {
    setArtefactProjectId(projectId)
    setArtefactScope("project")
    setOpenFilePath(null)
    setDiffOpen(false)
    setTab("artefacts")
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await request("/api/mobile/logout", { method: "POST" })
    } catch {
      // Ignore errors and reload into the auth gate.
    } finally {
      window.location.reload()
    }
  }

  const effectiveProjectForArtefacts =
    projects.find(p => p.id === (artefactProjectId ?? activeProject?.id ?? projects[0]?.id)) ?? null

  const badgeInbox = approvals.length + inboxCount
  const badgeArtefacts = pendingArtifacts.length

  return (
    <div className="ade-mob-shell" data-mobile-shell="true">
      {/* Top App Bar */}
      <header className="ade-mob-topbar">
        <div className="ade-mob-topbar-left">
          {openFilePath ? (
            <button type="button" className="ade-mob-icon-btn" onClick={() => setOpenFilePath(null)} aria-label="Back">
              <ArrowLeft className="size-4" />
            </button>
          ) : diffOpen ? (
            <button type="button" className="ade-mob-icon-btn" onClick={() => setDiffOpen(false)} aria-label="Back to chat">
              <ArrowLeft className="size-4" />
            </button>
          ) : tab === "chat" ? (
            <button type="button" className="ade-mob-icon-btn" onClick={() => setTab("sessions")} aria-label="All sessions">
              <ArrowLeft className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              className="ade-mob-host-pill"
              onClick={() => setDeviceSheetOpen(true)}
              aria-label="Connection status"
            >
              <span className={`ade-mob-status-dot ${runtimeOnline && sseConnected ? "is-live" : runtimeOnline ? "is-warn" : "is-off"}`} />
              <span className="ade-truncate">{hostName || "ADE"}</span>
            </button>
          )}
        </div>

        <div className="ade-mob-topbar-center ade-truncate">
          {openFilePath ? (
            <span className="ade-mob-title ade-mono ade-truncate">{openFilePath.split("/").pop()}</span>
          ) : diffOpen ? (
            <span className="ade-mob-title">Changes</span>
          ) : tab === "chat" ? (
            <div className="ade-mob-chat-title">
              <span className="ade-mob-title ade-truncate">{activeSession.label}</span>
              {activeProject ? <span className="ade-mob-subtitle ade-truncate">{activeProject.name}</span> : null}
            </div>
          ) : tab === "inbox" ? (
            <span className="ade-mob-title">Inbox</span>
          ) : tab === "sessions" ? (
            <span className="ade-mob-title">Sessions</span>
          ) : (
            <span className="ade-mob-title">Artefacts</span>
          )}
        </div>

        <div className="ade-mob-topbar-right">
          {tab === "chat" && !openFilePath && !diffOpen ? (
            <>
              {isBusy ? (
                <button type="button" className="ade-mob-icon-btn is-danger" onClick={onAbortSession} aria-label="Stop agent" title="Stop agent">
                  <Square className="size-3.5" />
                </button>
              ) : null}
              {hasWorkspace ? (
                <button type="button" className="ade-mob-icon-btn" onClick={() => setDiffOpen(true)} aria-label="View changes" title="Changes">
                  <FileDiff className="size-4" />
                </button>
              ) : null}
              <button
                type="button"
                className="ade-mob-icon-btn"
                onClick={() => { setArtefactScope("session"); setTab("artefacts") }}
                aria-label="Session artefacts"
                title="Artefacts"
              >
                <Layers className="size-4" />
              </button>
            </>
          ) : tab === "sessions" ? (
            <button
              type="button"
              className="ade-mob-action-pill"
              onClick={() => { setNewSheetProjectId(activeProject?.id ?? null); setNewSheetOpen(true) }}
            >
              <Plus className="size-3.5" /> New
            </button>
          ) : tab === "inbox" ? (
            <button type="button" className="ade-mob-icon-btn" onClick={() => void onRefreshSessions()} aria-label="Refresh">
              <RefreshCw className="size-4" />
            </button>
          ) : (
            <button type="button" className="ade-mob-icon-btn" onClick={() => setDeviceSheetOpen(true)} aria-label="Device settings">
              <Smartphone className="size-4" />
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="ade-mob-main">
        {/* Full-screen file overlay (from clicking poem.txt / file link in chat) */}
        {openFilePath ? (
          <RichFilePreview
            sessionId={activeSession.id}
            filePath={openFilePath}
            onBack={() => setOpenFilePath(null)}
            backLabel="Chat"
            onMentionInChat={p => {
              onDraftChange(`${draft ? `${draft} ` : ""}\`${p}\` `)
              setOpenFilePath(null)
              setTab("chat")
            }}
            onSaved={onRefreshGit}
            canEdit={hasWorkspace}
          />
        ) : diffOpen ? (
          <DiffPanel
            sessionId={activeSession.id}
            summary={gitSummary}
            onRefresh={onRefreshGit}
            onOpenFile={fp => { setDiffOpen(false); setOpenFilePath(fp) }}
            agentBusy={isBusy}
            onAskAgent={onAskAgent}
          />
        ) : tab === "inbox" ? (
          <div className="ade-mob-scroll">
            {!runtimeOnline ? (
              <div className="ade-mob-offline-card">
                <WifiOff className="size-5 text-amber-400 shrink-0" />
                <div className="flex-1">
                  <strong>{hostName || "Host computer"} is offline or asleep</strong>
                  <p>Wake your computer to resume live sessions and approvals.</p>
                </div>
                <button type="button" className="ade-btn ade-btn-xs" onClick={() => window.location.reload()}>Retry</button>
              </div>
            ) : null}

            {/* 1-Tap Pending Approvals */}
            {approvals.length > 0 ? (
              <section className="ade-mob-section">
                <div className="ade-mob-section-title">
                  <ShieldAlert className="size-3.5 text-[var(--accent)]" />
                  <span>Approvals waiting ({approvals.length})</span>
                </div>
                {approvals.map(a => (
                  <div key={a.id} className="ade-mob-approval-card">
                    <div className="ade-mob-approval-head">
                      <strong>{a.toolName}</strong>
                      <span className="ade-pill ade-pill-warn">Action required</span>
                    </div>
                    <code className="ade-mob-approval-cmd">{a.command || a.summary}</code>
                    <div className="ade-mob-approval-btns">
                      <button type="button" className="ade-btn ade-btn-primary flex-1 justify-center" onClick={() => void onResolveApproval(a.id, { allow: true })}>
                        <Check className="size-4" /> Allow
                      </button>
                      {a.suggestedPrefix ? (
                        <button type="button" className="ade-btn flex-1 justify-center" onClick={() => void onResolveApproval(a.id, { allow: true, alwaysAllow: true, prefix: a.suggestedPrefix })}>
                          Always
                        </button>
                      ) : null}
                      <button type="button" className="ade-btn ade-btn-danger" onClick={() => void onResolveApproval(a.id, { allow: false, reason: "Denied from phone" })}>
                        <X className="size-4" /> Deny
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {/* Pending Plan / Artifact Approvals */}
            {pendingArtifacts.length > 0 ? (
              <section className="ade-mob-section">
                <div className="ade-mob-section-title">
                  <Sparkles className="size-3.5 text-[var(--accent)]" />
                  <span>Plans ready for review ({pendingArtifacts.length})</span>
                </div>
                {pendingArtifacts.map(art => (
                  <div key={art.id} className="ade-mob-approval-card">
                    <div className="ade-mob-approval-head">
                      <strong>{art.title}</strong>
                      <span className="ade-pill ade-pill-warn">Awaiting approval</span>
                    </div>
                    <div className="ade-mob-approval-btns">
                      <button type="button" className="ade-btn ade-btn-primary flex-1 justify-center" onClick={() => void onReviewArtifact(art, "approved")}>
                        <Check className="size-4" /> Approve &amp; Proceed
                      </button>
                      <button type="button" className="ade-btn" onClick={() => { setArtefactScope("session"); setTab("artefacts") }}>
                        Inspect
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {/* Active & Attention Sessions */}
            <section className="ade-mob-section">
              <div className="ade-mob-section-title">
                <span>Sessions ({inboxSorted.length})</span>
              </div>
              {inboxSorted.length === 0 ? (
                <div className="ade-mob-empty">
                  <Inbox className="size-7 opacity-40" />
                  <p>All clear. Start a session from the Sessions tab.</p>
                </div>
              ) : (
                <div className="ade-mob-card-list">
                  {inboxSorted.map(sess => {
                    const entry = inboxEntries[sess.id]
                    const proj = projects.find(p => p.id === sess.projectId)
                    const isWorking = entry?.state !== "needs-approval" && (sess.status === "working" || entry?.state === "working")
                    const stateMeta = entry && entry.state !== "idle" ? sessionStateInfo[entry.state] : null
                    return (
                      <button
                        key={sess.id}
                        type="button"
                        className={`ade-mob-session-card ${sess.id === activeSession.id ? "is-active" : ""}`}
                        onClick={() => openSessionChat(sess)}
                      >
                        <span className={`ade-mob-session-dot ${isWorking ? "is-working" : entry?.needsYou ? "is-attention" : "is-idle"}`} />
                        <div className="ade-mob-session-body">
                          <div className="ade-mob-session-top">
                            <strong className="ade-truncate">{sess.label}</strong>
                            {isWorking ? <ActiveThreadSpinner size={14} title="Working" />
                              : stateMeta ? <span className={`ade-pill ${entry?.needsYou ? "ade-pill-warn" : ""}`}>{stateMeta.label}</span> : null}
                          </div>
                          <div className="ade-mob-session-sub ade-truncate">
                            {proj ? proj.name : "Chat"}
                            {sess.workspace?.branch ? ` · ${sess.workspace.branch}` : ""}
                          </div>
                        </div>
                        <ChevronRight className="size-4 opacity-40 shrink-0" />
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        ) : tab === "sessions" ? (
          <div className="ade-mob-scroll">
            <div className="ade-mob-search-wrap">
              <Search className="size-4 opacity-60" />
              <input
                type="search"
                placeholder="Search projects & sessions…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Search projects and sessions"
              />
            </div>

            <section className="ade-mob-section">
              <div className="ade-mob-section-head">
                <span className="ade-mob-section-title">Projects ({projectList.length})</span>
              </div>
              {projectList.length === 0 ? (
                <div className="ade-mob-empty-inline">No projects found.</div>
              ) : (
                <div className="ade-mob-project-stack">
                  {projectList.map(project => {
                    const projSessions = visibleSessions.filter(s => s.projectId === project.id)
                    const pinned = pinnedIds.includes(`project:${project.id}`)
                    return (
                      <div key={project.id} className="ade-mob-project-card">
                        <div className="ade-mob-project-head">
                          <div className="ade-mob-project-name ade-truncate">
                            <Folder className="size-4 shrink-0 opacity-75" />
                            <strong className="ade-truncate">{project.name}</strong>
                            {pinned ? <Pin className="size-3 shrink-0 opacity-60" /> : null}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="ade-chip-btn"
                              onClick={() => openProjectArtefacts(project.id)}
                              title="Show all project artefacts"
                            >
                              <Layers className="size-3" /> Artefacts
                            </button>
                            <button
                              type="button"
                              className="ade-chip-btn"
                              onClick={() => { setNewSheetProjectId(project.id); setNewSheetOpen(true) }}
                              aria-label={`New session in ${project.name}`}
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                        </div>
                        {projSessions.length === 0 ? (
                          <button
                            type="button"
                            className="ade-mob-project-empty-btn"
                            onClick={() => { setNewSheetProjectId(project.id); setNewSheetOpen(true) }}
                          >
                            + Start first session in {project.name}
                          </button>
                        ) : (
                          <div className="ade-mob-project-sessions">
                            {projSessions.map(sess => {
                              const working = inboxEntries[sess.id]?.state !== "needs-approval" && (sess.status === "working" || inboxEntries[sess.id]?.state === "working")
                              return (
                                <button
                                  key={sess.id}
                                  type="button"
                                  className={`ade-mob-session-row ${sess.id === activeSession.id ? "is-active" : ""}`}
                                  onClick={() => openSessionChat(sess)}
                                >
                                  <span className={`ade-mob-session-dot ${working ? "is-working" : inboxEntries[sess.id]?.needsYou ? "is-attention" : "is-idle"}`} />
                                  <span className="ade-truncate flex-1">{sess.label}</span>
                                  {working ? <ActiveThreadSpinner size={14} title="Working" /> : null}
                                  <ChevronRight className="size-3.5 opacity-40 shrink-0" />
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="ade-mob-section">
              <div className="ade-mob-section-head">
                <span className="ade-mob-section-title">Chats</span>
                <button type="button" className="ade-chip-btn" onClick={() => onCreateChatThread("coding")}>
                  <Plus className="size-3" /> New chat
                </button>
              </div>
              <div className="ade-mob-card-list">
                {chatList.map(chat => {
                  const working = inboxEntries[chat.id]?.state !== "needs-approval" && (chat.status === "working" || inboxEntries[chat.id]?.state === "working")
                  return (
                    <button
                      key={chat.id}
                      type="button"
                      className={`ade-mob-session-card ${chat.id === activeSession.id ? "is-active" : ""}`}
                      onClick={() => openSessionChat(chat)}
                    >
                      <MessageSquare className="size-4 opacity-70 shrink-0" />
                      <div className="ade-mob-session-body">
                        <strong className="ade-truncate">{chat.label}</strong>
                      </div>
                      {working ? <ActiveThreadSpinner size={14} title="Working" /> : null}
                      <ChevronRight className="size-4 opacity-40 shrink-0" />
                    </button>
                  )
                })}
              </div>
            </section>
          </div>
        ) : tab === "chat" ? (
          <div className="ade-mob-chat-wrap">
            <div className="ade-mob-chat-scroll">
              <TimelineView
                timeline={timeline}
                fallbackMessages={activeSession.messages}
                approvals={approvals}
                subagents={subagents}
                busy={isBusy}
                workspacePath={workspacePath}
                emptyTitle={activeSession.label}
                emptySubtitle={hasWorkspace
                  ? "Describe a task below. Tap any created file link to preview it full-screen."
                  : "Ask anything or steer your agent remotely from your phone."}
                onResolveApproval={onResolveApproval}
                onOpenFile={hasWorkspace ? fp => setOpenFilePath(fp) : undefined}
                onOpenExternalBrowser={onOpenExternalBrowser}
                onOpenArtifact={() => { setArtefactScope("session"); setTab("artefacts") }}
              />
            </div>
            <div className="ade-mob-composer-wrap">
              <ComposerDock
                draft={draft}
                onDraftChange={onDraftChange}
                busy={isBusy}
                modelCatalog={modelCatalog}
                selectedProvider={selectedProvider}
                selectedModel={selectedModel}
                onSelectModel={onSelectModel}
                reasoning={reasoning}
                onSelectReasoning={onSelectReasoning}
                approvalPolicy={approvalPolicy}
                onChangeApprovalPolicy={onChangeApprovalPolicy}
                attachments={attachments}
                onAttachFiles={onAttachFiles}
                onRemoveAttachment={onRemoveAttachment}
                skillsCatalog={skillsCatalog}
                hasWorkspace={hasWorkspace}
                onSubmit={onSendMessage}
                onSteer={onSteerSession}
                onAbort={onAbortSession}
                onCompact={onCompactSession}
                textareaRef={composerRef}
                sessionId={activeSession.id}
              />
            </div>
          </div>
        ) : (
          <div className="ade-mob-artefacts-wrap">
            {effectiveProjectForArtefacts ? (
              <div className="ade-mob-scope-switch" role="tablist" aria-label="Artefact scope">
                <button
                  type="button"
                  role="tab"
                  aria-selected={artefactScope === "session"}
                  className={`ade-mob-scope-btn ${artefactScope === "session" ? "is-active" : ""}`}
                  onClick={() => setArtefactScope("session")}
                >
                  Session ({activeSession.label})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={artefactScope === "project"}
                  className={`ade-mob-scope-btn ${artefactScope === "project" ? "is-active" : ""}`}
                  onClick={() => setArtefactScope("project")}
                >
                  Project ({effectiveProjectForArtefacts.name})
                </button>
              </div>
            ) : null}
            <div className="ade-mob-artefacts-body">
              {artefactScope === "project" && effectiveProjectForArtefacts ? (
                <ArtefactsBrowserPanel
                  scope="project"
                  projectId={effectiveProjectForArtefacts.id}
                  workspacePath={effectiveProjectForArtefacts.repository ?? null}
                  onOpenSession={id => {
                    const found = sessions.find(s => s.id === id)
                    if (found) openSessionChat(found)
                  }}
                />
              ) : (
                <ArtefactsBrowserPanel
                  scope="session"
                  sessionId={activeSession.id}
                  workspacePath={workspacePath}
                  artifacts={artifacts}
                  gitSummary={gitSummary}
                  timelineItems={timeline?.items ?? []}
                  onReview={onReviewArtifact}
                  onMentionInChat={p => {
                    onDraftChange(`${draft ? `${draft} ` : ""}\`${p}\` `)
                    setTab("chat")
                  }}
                  onSaved={onRefreshGit}
                />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Tab Navigation */}
      <nav className="ade-mob-tabbar" aria-label="Mobile navigation">
        <button
          type="button"
          className={`ade-mob-tab ${tab === "inbox" && !openFilePath && !diffOpen ? "is-active" : ""}`}
          onClick={() => { setOpenFilePath(null); setDiffOpen(false); setTab("inbox") }}
        >
          <span className="ade-mob-tab-icon">
            <Inbox className="size-5" />
            {badgeInbox > 0 ? <span className="ade-mob-tab-badge">{badgeInbox > 99 ? "99+" : badgeInbox}</span> : null}
          </span>
          <span>Inbox</span>
        </button>
        <button
          type="button"
          className={`ade-mob-tab ${tab === "sessions" && !openFilePath && !diffOpen ? "is-active" : ""}`}
          onClick={() => { setOpenFilePath(null); setDiffOpen(false); setTab("sessions") }}
        >
          <span className="ade-mob-tab-icon">
            <Folder className="size-5" />
          </span>
          <span>Sessions</span>
        </button>
        <button
          type="button"
          className={`ade-mob-tab ${tab === "chat" && !openFilePath && !diffOpen ? "is-active" : ""}`}
          onClick={() => { setOpenFilePath(null); setDiffOpen(false); setTab("chat") }}
        >
          <span className="ade-mob-tab-icon">
            <MessageSquare className="size-5" />
            {isBusy ? <span className="ade-mob-tab-live" aria-label="Agent working" /> : null}
          </span>
          <span>Chat</span>
        </button>
        <button
          type="button"
          className={`ade-mob-tab ${tab === "artefacts" && !openFilePath && !diffOpen ? "is-active" : ""}`}
          onClick={() => { setOpenFilePath(null); setDiffOpen(false); setTab("artefacts") }}
        >
          <span className="ade-mob-tab-icon">
            <Layers className="size-5" />
            {badgeArtefacts > 0 ? <span className="ade-mob-tab-badge">{badgeArtefacts}</span> : null}
          </span>
          <span>Artefacts</span>
        </button>
      </nav>

      {/* New Session Sheet */}
      <MobileNewSessionSheet
        open={newSheetOpen}
        projects={projects.filter(p => !archivedIds.includes(`project:${p.id}`))}
        initialProjectId={newSheetProjectId}
        starting={creatingSession}
        error={launchError}
        onClose={() => setNewSheetOpen(false)}
        onStart={async input => {
          await onStartNewSession(input)
          setTab("chat")
        }}
      />

      {/* Device / Host Connection Sheet */}
      {deviceSheetOpen ? (
        <div className="ade-mob-sheet-backdrop" onClick={() => setDeviceSheetOpen(false)}>
          <div className="ade-mob-sheet" role="dialog" aria-modal="true" aria-label="Device connection" onClick={e => e.stopPropagation()}>
            <div className="ade-mob-sheet-handle" aria-hidden="true" />
            <div className="ade-mob-sheet-head">
              <strong>Connected host</strong>
              <button type="button" className="ade-icon-btn" aria-label="Close" onClick={() => setDeviceSheetOpen(false)}>
                <X className="size-4" />
              </button>
            </div>
            <div className="ade-mob-device-summary">
              <div className="ade-mob-device-row">
                <Wifi className="size-4 text-[var(--ok)]" />
                <div>
                  <strong>{hostName || "ADE Host"}</strong>
                  <div className="ade-muted ade-xs">
                    {runtimeOnline ? (sseConnected ? "Live sync active" : "Connected") : "Host offline or asleep"}
                  </div>
                </div>
              </div>
              {mobileSession?.device ? (
                <div className="ade-mob-device-row">
                  <Smartphone className="size-4 opacity-75" />
                  <div>
                    <strong>{mobileSession.device.name}</strong>
                    <div className="ade-muted ade-xs">Paired {new Date(mobileSession.device.pairedAt).toLocaleDateString()}</div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="ade-mob-device-actions">
              <button type="button" className="ade-btn flex-1 justify-center" onClick={onToggleTheme}>
                {resolvedTheme === "dark" ? <><Sun className="size-4" /> Light mode</> : <><Moon className="size-4" /> Dark mode</>}
              </button>
              {mobileSession?.mobileBridge ? (
                <button type="button" className="ade-btn ade-btn-danger flex-1 justify-center" disabled={disconnecting} onClick={() => void handleDisconnect()}>
                  {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                  Unpair phone
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
