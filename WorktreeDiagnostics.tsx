import type { useWorktrees } from "./useWorktrees"
import { useI18n } from "./src/i18n/I18nContext"

export function WorktreeDiagnostics({ state, onBack }: { state: ReturnType<typeof useWorktrees>; onBack: () => void }) {
  const { t, formatDateTime } = useI18n()
  const { repository, setRepository, inspectedRepository, worktrees, worktreeOperations, worktreeError, inspecting, inspectRepository } = state
  return <main className="settings-scroll"><div className="settings-page">
    <button className="text-button project-back" onClick={onBack}>{t("wsx.diag.backToSettings")}</button>
    <div className="page-heading"><div><h1>{t("wsx.diag.title")}</h1><p>{t("wsx.diag.subtitle")}</p></div></div>
    <section className="settings-section">
      <form onSubmit={inspectRepository} className="worktree-form">
        <label>{t("wsx.diag.repoPath")}<input value={repository} onChange={event => setRepository(event.target.value)} placeholder="C:\Code\your-repository" required /></label>
        <button type="submit" className="quiet-button" disabled={inspecting || !repository.trim()}>{inspecting ? t("wsx.diag.inspecting") : t("wsx.diag.inspectRepo")}</button>
      </form>
      <p className="hint">{t("wsx.diag.readOnlyHint")}</p>
      {worktreeError && <p className="error" role="alert">{worktreeError}</p>}
      {inspectedRepository && <div className="worktree-results"><h2>{t("wsx.diag.worktrees")}</h2><p className="hint">{t("wsx.diag.lastInspected", { path: inspectedRepository })}</p>
        {worktrees.map(tree => <article className="worktree-row" key={tree.path}>
          <strong>{tree.branch ?? (tree.bare ? t("wsx.diag.bareRepo") : tree.detached ? t("wsx.diag.detachedHead") : t("wsx.diag.noBranch"))}</strong>
          <span>{tree.path}</span>
          <small>{tree.head ? t("wsx.diag.commitHash", { hash: tree.head.slice(0, 12) }) : t("wsx.diag.noCommit")}{tree.locked ? t("wsx.diag.lockedSuffix") : ""}{tree.prunable ? t("wsx.diag.prunableSuffix") : ""}</small>
        </article>)}
      </div>}
      {worktreeOperations.length > 0 && <div className="worktree-results"><h2>{t("wsx.diag.recentOperations")}</h2>
        {worktreeOperations.map(operation => <article className={`worktree-row worktree-operation ${operation.status}`} key={operation.id}>
          <strong>{operation.branch} · {operation.status === "attention" ? t("wsx.diag.needsInspection") : operation.status}</strong>
          <span>{operation.message}</span>
          <small>{operation.createdAt ? formatDateTime(operation.createdAt, { seconds: true }) : ""}{operation.status === "completed" ? ` · ${operation.target}` : ""}</small>
        </article>)}
      </div>}
    </section>
  </div></main>
}
