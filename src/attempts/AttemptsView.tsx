import { useEffect, useState } from "react"
import { ArrowLeft, Check, GitBranch, Trophy } from "lucide-react"
import { request } from "../api"
import { useConfirm } from "../../components/ui/index.ts"
import type { Conversation } from "../app-types"
import { sessionStateInfo, relativeTime, type InboxEntry } from "../session-state"
import { formatUsage, useUsage } from "../usage/usage-data"
import { useI18n } from "../i18n/I18nContext"

type DiffFile = { path: string; additions: number; deletions: number; status: string }
type AttemptDetails = { files: DiffFile[] | null; check: string | null; error: string }

const engineNames: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" }

/**
 * Best of N: the attempts started together on one task, side by side — status, what each changed,
 * its check result and what it cost — so you can open them, keep the best, and archive the rest.
 */
export function AttemptsView({
  group,
  sessions,
  entries,
  onOpenSession,
  onArchive,
  onBack,
}: {
  group: string
  sessions: Conversation[]
  entries: Record<string, InboxEntry>
  onOpenSession: (session: Conversation) => void
  onArchive: (sessionId: string) => Promise<void> | void
  onBack: () => void
}) {
  const { t } = useI18n()
  const { confirm } = useConfirm()
  const attempts = sessions.filter(session => session.attemptGroup === group).sort((a, b) => a.label.localeCompare(b.label))
  const { report } = useUsage(attempts.map(item => item.status).join())
  const [details, setDetails] = useState<Record<string, AttemptDetails>>({})
  const [keeping, setKeeping] = useState<string | null>(null)
  const statusKey = attempts.map(item => `${item.id}:${item.status}`).join()

  useEffect(() => {
    let cancelled = false
    for (const attempt of attempts) {
      if (!attempt.workspace?.path) continue
      const id = encodeURIComponent(attempt.id)
      void Promise.all([
        request<{ files: DiffFile[] }>(`/api/sessions/${id}/branch-diff`).catch(() => ({ files: null })),
        request<{ check: { status: string } }>(`/api/sessions/${id}/scripts`).catch(() => null),
      ]).then(([diff, scripts]) => {
        if (cancelled) return
        setDetails(current => ({ ...current, [attempt.id]: { files: diff.files, check: scripts?.check?.status ?? null, error: "" } }))
      })
    }
    return () => { cancelled = true }
    // Refresh when an attempt starts or stops working.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- statusKey captures the attempts that matter
  }, [statusKey])

  const keep = async (winner: Conversation) => {
    const others = attempts.filter(item => item.id !== winner.id && !item.archivedAt)
    if (others.length) {
      const confirmed = await confirm({
        title: t("swx.att.keepConfirmTitle", { label: winner.label }),
        description: others.length === 1
          ? t("swx.att.keepConfirmDescOne", { count: others.length })
          : t("swx.att.keepConfirmDescOther", { count: others.length }),
        confirmLabel: t("swx.att.keepThisOne"),
      })
      if (!confirmed) return
    }
    setKeeping(winner.id)
    try {
      for (const other of others) await onArchive(other.id)
      onOpenSession(winner)
    } finally {
      setKeeping(null)
    }
  }

  const checkStatusText = (status: string) => {
    if (status === "succeeded") return t("swx.att.checkPassed")
    if (status === "failed") return t("swx.att.checkFailed")
    if (status === "running") return t("swx.att.checkRunning")
    return status
  }

  const title = attempts[0]?.label.replace(/ · [A-D]$/, "") ?? t("swx.att.defaultTitle")

  return (
    <main className="ade-attempts">
      <header className="ade-attempts-head">
        <button type="button" className="ade-link-btn" onClick={onBack}><ArrowLeft className="size-3.5" /> {t("swx.att.back")}</button>
        <h1><Trophy className="size-5" /> {title}</h1>
        <p>{t("swx.att.subtitle", { count: attempts.length })}</p>
      </header>
      {!attempts.length ? <p className="ade-muted">{t("swx.att.deleted")}</p> : (
        <div className="ade-attempts-grid" style={{ gridTemplateColumns: `repeat(${Math.min(attempts.length, 4)}, minmax(0, 1fr))` }}>
          {attempts.map(attempt => {
            const entry = entries[attempt.id]
            const state = entry?.state ?? (attempt.status === "working" ? "working" : "idle")
            const info = sessionStateInfo[state]
            const detail = details[attempt.id]
            const additions = detail?.files?.reduce((sum, file) => sum + file.additions, 0) ?? 0
            const deletions = detail?.files?.reduce((sum, file) => sum + file.deletions, 0) ?? 0
            const usage = report?.sessions[attempt.id]
            const archived = Boolean(attempt.archivedAt)
            const letter = attempt.label.match(/ · ([A-D])$/)?.[1]
            return (
              <section key={attempt.id} className={`ade-attempt-card ${archived ? "is-archived" : ""}`} aria-label={attempt.label}>
                <header>
                  <strong>{letter ? t("swx.att.attemptLetter", { letter }) : attempt.label}</strong>
                  <span className="ade-muted ade-xs">{attempt.engine ? engineNames[attempt.engine] : t("swx.att.adeAgent")}</span>
                  <span className={`ade-row-tag is-${archived ? "idle" : info.tone}`} title={info.hint}>{archived ? t("swx.att.archived") : info.label}</span>
                </header>
                <div className="ade-attempt-facts">
                  <span><GitBranch className="inline size-3" /> <code>{attempt.workspace?.branch ?? "—"}</code></span>
                  <span>
                    {detail?.files ? (
                      <>
                        <span className="ade-diff-add">+{additions}</span>{" "}
                        <span className="ade-diff-del">-{deletions}</span>{" · "}
                        {detail.files.length === 1
                          ? t("swx.att.filesOne", { count: detail.files.length })
                          : t("swx.att.filesOther", { count: detail.files.length })}
                      </>
                    ) : attempt.workspace?.path ? t("swx.att.readingChanges") : t("swx.att.noWorktree")}
                  </span>
                  {detail?.check && detail.check !== "idle" ? <span>{t("swx.att.checkLabel", { status: checkStatusText(detail.check) })}</span> : null}
                  <span>{usage ? formatUsage(usage) : t("swx.att.noUsageYet")}</span>
                  <span className="ade-muted">{t("swx.att.updated", { time: relativeTime(attempt.updatedAt) })}</span>
                </div>
                {detail?.files?.length ? (
                  <ul className="ade-attempt-files">
                    {detail.files.slice(0, 12).map(file => (
                      <li key={file.path}><code className="ade-truncate" title={file.path}>{file.path}</code><span className="ade-diff-add">+{file.additions}</span><span className="ade-diff-del">-{file.deletions}</span></li>
                    ))}
                    {detail.files.length > 12 ? <li className="ade-muted">{t("swx.att.andMore", { count: detail.files.length - 12 })}</li> : null}
                  </ul>
                ) : null}
                <div className="ade-attempt-actions">
                  <button type="button" className="ade-chip-btn" onClick={() => onOpenSession(attempt)}>{t("swx.att.open")}</button>
                  {!archived ? (
                    <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={Boolean(keeping) || attempt.status === "working"} title={attempt.status === "working" ? t("swx.att.waitToFinish") : t("swx.att.keepTitle")} onClick={() => void keep(attempt)}>
                      <Check className="size-3.5" /> {keeping === attempt.id ? t("swx.att.archivingOthers") : t("swx.att.keepThisOne")}
                    </button>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </main>
  )
}
