import { useState, type FormEvent } from "react"
import { Folder, GitBranch, Loader2, MessageSquare, Sparkles, X } from "lucide-react"
import type { Project } from "../../ProjectsView"
import type { TaskStart } from "../../app-types"
import { useI18n } from "../i18n/I18nContext"

export function MobileNewSessionSheet({
  open,
  projects,
  initialProjectId,
  starting,
  error,
  onClose,
  onStart,
}: {
  open: boolean
  projects: Project[]
  initialProjectId: string | null
  starting: boolean
  error: string
  onClose: () => void
  onStart: (input: {
    projectId: string | null
    kind: TaskStart["kind"]
    repository: string
    prompt: string
    title?: string
  }) => Promise<void>
}) {
  const { t } = useI18n()
  const [projectId, setProjectId] = useState<string>(initialProjectId ?? projects[0]?.id ?? "")
  const [kind, setKind] = useState<TaskStart["kind"]>("worktree")
  const [title, setTitle] = useState("")
  const [prompt, setPrompt] = useState("")

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setProjectId(initialProjectId ?? projects[0]?.id ?? "")
      setKind(projects.length > 0 ? "worktree" : "none")
      setTitle("")
      setPrompt("")
    }
  }

  if (!open) return null

  const selectedProject = projects.find(p => p.id === projectId) ?? null
  const effectiveKind: TaskStart["kind"] = selectedProject?.repository ? kind : "none"

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await onStart({
      projectId: selectedProject?.id ?? null,
      kind: effectiveKind,
      repository: effectiveKind === "none" ? "" : selectedProject?.repository ?? "",
      prompt: prompt.trim(),
      title: title.trim() || undefined,
    })
    onClose()
  }

  return (
    <div className="ade-mob-sheet-backdrop" onClick={onClose}>
      <div
        className="ade-mob-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("wsx.mob.newMobileSession")}
        onClick={e => e.stopPropagation()}
      >
        <div className="ade-mob-sheet-handle" aria-hidden="true" />
        <div className="ade-mob-sheet-head">
          <strong>{t("wsx.mob.newSession")}</strong>
          <button type="button" className="ade-icon-btn" aria-label={t("wsx.mob.close")} onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>

        {error ? <div className="ade-mobile-gate-error">{error}</div> : null}

        <form className="ade-mob-sheet-form" onSubmit={e => void handleSubmit(e)}>
          <label className="ade-mobile-gate-label">
            <span>{t("wsx.mob.project")}</span>
            <select
              className="ade-mobile-gate-input"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
            >
              <option value="">{t("wsx.mob.noProjectChatOnly")}</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          {selectedProject?.repository ? (
            <div className="ade-mob-mode-pills" role="radiogroup" aria-label={t("wsx.mob.workspaceMode")}>
              <button
                type="button"
                className={`ade-mob-pill-choice ${kind === "worktree" ? "is-active" : ""}`}
                onClick={() => setKind("worktree")}
              >
                <GitBranch className="size-3.5" /> {t("wsx.mob.ownBranch")}
              </button>
              <button
                type="button"
                className={`ade-mob-pill-choice ${kind === "checkout" ? "is-active" : ""}`}
                onClick={() => setKind("checkout")}
              >
                <Folder className="size-3.5" /> {t("wsx.mob.projectFolder")}
              </button>
              <button
                type="button"
                className={`ade-mob-pill-choice ${kind === "none" ? "is-active" : ""}`}
                onClick={() => setKind("none")}
              >
                <MessageSquare className="size-3.5" /> {t("wsx.mob.chatOnly")}
              </button>
            </div>
          ) : null}

          <label className="ade-mobile-gate-label">
            <span>{t("wsx.mob.sessionNameOptional")}</span>
            <input
              type="text"
              className="ade-mobile-gate-input"
              placeholder={t("wsx.mob.sessionNamePlaceholder")}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </label>

          <label className="ade-mobile-gate-label">
            <span>{t("wsx.mob.taskOrPrompt")}</span>
            <textarea
              className="ade-mob-sheet-textarea"
              rows={4}
              placeholder={t("wsx.mob.taskPromptPlaceholder")}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
          </label>

          <button type="submit" className="ade-btn ade-btn-primary ade-mobile-gate-btn" disabled={starting}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {starting ? t("wsx.mob.starting") : t("wsx.mob.startSession")}
          </button>
        </form>
      </div>
    </div>
  )
}
