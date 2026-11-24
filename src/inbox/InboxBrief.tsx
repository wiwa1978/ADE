import { useEffect, useState } from "react"
import { ArrowRight } from "lucide-react"
import { request } from "../../api"
import { useI18n } from "../i18n/I18nContext"
import "./inbox-brief.css"

export type SessionBrief = {
  question: string
  work: { summary: string; files: number; added: number; removed: number; stage: { name: string; done: number; total: number } | null; subagents: number }
  approval:
    | { kind: "command"; subject: string; detail: string; count: number }
    | { kind: "stage" | "failed" | "review" | "none"; subject: string; detail: string }
}

/**
 * A session at a glance, beside the Inbox list: what was asked, what has been done, and what waits
 * for you. A line or two each, so you know what it is about without reading the thread.
 */
export function InboxBrief({ sessionId, title, refreshKey, onOpen }: { sessionId: string; title: string; refreshKey: string; onOpen: () => void }) {
  const { t } = useI18n()
  const [loaded, setLoaded] = useState<{ key: string; brief: SessionBrief | null; failed: boolean } | null>(null)
  const key = `${sessionId}:${refreshKey}`

  useEffect(() => {
    let alive = true
    request<SessionBrief>(`/api/sessions/${encodeURIComponent(sessionId)}/brief`).then(
      brief => { if (alive) setLoaded({ key, brief, failed: false }) },
      () => { if (alive) setLoaded({ key, brief: null, failed: true }) },
    )
    return () => { alive = false }
  }, [sessionId, key])

  // Keep showing the previous summary of the same session while a fresh one loads.
  const brief = loaded?.brief ?? null
  const stale = loaded !== null && loaded.key !== key
  const facts: string[] = []
  if (brief) {
    const { work } = brief
    if (work.files) facts.push(work.files === 1 ? t("brief.oneFile", { added: work.added, removed: work.removed }) : t("brief.files", { count: work.files, added: work.added, removed: work.removed }))
    if (work.stage) facts.push(t("brief.stage", { name: work.stage.name, done: work.stage.done, total: work.stage.total }))
    if (work.subagents) facts.push(work.subagents === 1 ? t("brief.oneSubagent") : t("brief.subagents", { count: work.subagents }))
  }
  const approval = brief?.approval
  return (
    <aside className="ade-brief" aria-label={title} aria-busy={!brief || stale}>
      <h2 className="ade-brief-title ade-truncate" title={title}>{title}</h2>
      {loaded?.failed && !brief ? <p className="ade-muted">{t("brief.error")}</p> : !brief ? <p className="ade-muted">{t("brief.loading")}</p> : (
        <div className={stale ? "is-stale" : ""}>
          <section>
            <h3>{t("brief.question")}</h3>
            <p>{brief.question || <span className="ade-muted">{t("brief.noQuestion")}</span>}</p>
          </section>
          <section>
            <h3>{t("brief.work")}</h3>
            <p>{brief.work.summary || <span className="ade-muted">{t("brief.noWork")}</span>}</p>
            {facts.length ? <ul className="ade-brief-facts">{facts.map(fact => <li key={fact}>{fact}</li>)}</ul> : null}
          </section>
          <section className={approval && approval.kind !== "none" && approval.kind !== "review" ? "is-attention" : ""}>
            <h3>{t("brief.approval")}</h3>
            {approval ? (
              <>
                <p><strong>{
                  approval.kind === "command" ? t("brief.commandTitle")
                    : approval.kind === "stage" ? t("brief.stageTitle", { name: approval.subject })
                      : approval.kind === "failed" ? t("brief.failedTitle")
                        : approval.kind === "review" ? t("brief.reviewTitle") : t("brief.noneTitle")
                }</strong></p>
                {approval.kind === "command" ? <p><code>{approval.subject}</code>{approval.count > 1 ? <span className="ade-muted"> {t("brief.commandMore", { count: approval.count - 1 })}</span> : null}</p> : null}
                {approval.kind === "stage" ? <p>{approval.detail || <span className="ade-muted">{t("brief.stageStart")}</span>}</p> : null}
                {approval.kind === "failed" && approval.detail ? <p>{approval.detail}</p> : null}
                {approval.kind === "review" ? <p className="ade-muted">{t("brief.reviewDetail")}</p> : null}
              </>
            ) : null}
          </section>
        </div>
      )}
      <button type="button" className="sf-btn-primary ade-brief-open" onClick={onOpen}>{t("brief.open")} <ArrowRight className="size-3.5" /></button>
    </aside>
  )
}
