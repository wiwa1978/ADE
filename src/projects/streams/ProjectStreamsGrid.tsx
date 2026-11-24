import { useState } from "react"
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, GitBranch, Trash2 } from "lucide-react"
import { Badge, Banner, Button } from "../../../components/ui/index.ts"
import type { Conversation } from "../../../app-types"
import type { FactoryRunDetail } from "../../factory/types"
import { LiveFactoryRunPane } from "../LiveFactoryRunPane"
import { LiveSessionPane } from "../LiveSessionPane"
import { ProjectQuickLaunchBar } from "./ProjectQuickLaunchBar"
import type { StreamLayout } from "./ProjectWorkspaceHeader"

interface ProjectStreamsGridProps {
  projectName: string
  layout: StreamLayout
  visiblePaneIds: string[]
  sessionMap: Map<string, Conversation>
  runMap: Map<string, FactoryRunDetail>
  archivedSessions: Conversation[]
  focusedStreamId: string | null
  quickPrompt: string
  launching: boolean
  launchError: string
  onQuickPromptChange: (value: string) => void
  onQuickLaunch: () => void
  onStartFactoryRun: () => void
  onBrowseIssues: () => void
  onFocusStream: (streamId: string) => void
  onCloseStreamPane: (streamId: string) => void
  onMaximizeSession: (sessionId: string) => void
  onMaximizeFactoryRun: (runId: string) => void
  onSendQuickMessage: (session: Conversation, text: string) => Promise<void>
  onFactoryRunAction: (runId: string, action: "step" | "approve" | "pause" | "steer", note?: string) => Promise<void>
  onUnarchiveSession: (sessionId: string) => void
  onDeleteSession: (session: Conversation) => void
}

export function ProjectStreamsGrid({
  projectName,
  layout,
  visiblePaneIds,
  sessionMap,
  runMap,
  archivedSessions,
  focusedStreamId,
  quickPrompt,
  launching,
  launchError,
  onQuickPromptChange,
  onQuickLaunch,
  onStartFactoryRun,
  onBrowseIssues,
  onFocusStream,
  onCloseStreamPane,
  onMaximizeSession,
  onMaximizeFactoryRun,
  onSendQuickMessage,
  onFactoryRunAction,
  onUnarchiveSession,
  onDeleteSession,
}: ProjectStreamsGridProps) {
  const [archivedOpen, setArchivedOpen] = useState(false)

  return (
    <div className="ade-streams-canvas">
      {launchError ? <Banner tone="error">{launchError}</Banner> : null}

      {visiblePaneIds.length === 0 ? (
        <ProjectQuickLaunchBar
          projectName={projectName}
          quickPrompt={quickPrompt}
          launching={launching}
          onQuickPromptChange={onQuickPromptChange}
          onSubmit={onQuickLaunch}
          onStartFactoryRun={onStartFactoryRun}
          onBrowseIssues={onBrowseIssues}
        />
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

      <section className="ade-archived-drawer">
        <button type="button" className="ade-archived-head" onClick={() => setArchivedOpen(v => !v)}>
          <span className="flex items-center gap-2">
            {archivedOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            <Archive className="size-3.5" />
            <span>Archived sessions</span>
            <Badge>{archivedSessions.length}</Badge>
          </span>
          <span className="text-[11px] font-normal opacity-70">Right-click a session to archive it</span>
        </button>
        {archivedOpen ? (
          <div className="border-t border-[rgb(var(--border)/0.7)] divide-y divide-[rgb(var(--border)/0.5)]">
            {archivedSessions.length === 0 ? (
              <div className="px-3.5 py-3 text-[12px] opacity-60">No archived sessions in this project.</div>
            ) : (
              archivedSessions.map(sess => (
                <div key={sess.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[12.5px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <GitBranch className="size-3.5 opacity-55 shrink-0" />
                    <span className="truncate">{sess.label}</span>
                    {sess.workspace?.branch ? <Badge className="font-mono">{sess.workspace.branch}</Badge> : null}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="chip" size="xs" onClick={() => onUnarchiveSession(sess.id)} title="Restore to active sessions">
                      <ArchiveRestore className="size-3" /> Restore
                    </Button>
                    <Button variant="ghost" size="xs" className="text-[rgb(var(--rose))]" onClick={() => onDeleteSession(sess)} title="Delete permanently" aria-label={`Delete ${sess.label}`}>
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}
