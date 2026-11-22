import type { useWorktrees } from "./useWorktrees"

export function WorktreeDiagnostics({ state, onBack }: { state: ReturnType<typeof useWorktrees>; onBack: () => void }) {
  const { repository, setRepository, inspectedRepository, worktrees, worktreeOperations, worktreeError, inspecting, inspectRepository } = state
  return <main className="settings-scroll"><div className="settings-page">
    <button className="text-button project-back" onClick={onBack}>Back to Settings</button>
    <div className="page-heading"><div><h1>Worktree diagnostics</h1><p>Inspect existing worktrees and creation outcomes.</p></div></div>
    <section className="settings-section">
      <form onSubmit={inspectRepository} className="worktree-form">
        <label>Repository path<input value={repository} onChange={event => setRepository(event.target.value)} placeholder="C:\Code\your-repository" required /></label>
        <button type="submit" className="quiet-button" disabled={inspecting || !repository.trim()}>{inspecting ? "Inspecting…" : "Inspect repository"}</button>
      </form>
      <p className="hint">Read-only: this does not create, delete, or connect a worktree to the agent.</p>
      {worktreeError && <p className="error" role="alert">{worktreeError}</p>}
      {inspectedRepository && <div className="worktree-results"><h2>Worktrees</h2><p className="hint">Last inspected: {inspectedRepository}</p>
        {worktrees.map(tree => <article className="worktree-row" key={tree.path}>
          <strong>{tree.branch ?? (tree.bare ? "Bare repository" : tree.detached ? "Detached HEAD" : "No branch")}</strong>
          <span>{tree.path}</span>
          <small>{tree.head ? `Commit ${tree.head.slice(0, 12)}` : "No commit"}{tree.locked ? " · Locked" : ""}{tree.prunable ? " · Prunable" : ""}</small>
        </article>)}
      </div>}
      {worktreeOperations.length > 0 && <div className="worktree-results"><h2>Recent ADE operations</h2>
        {worktreeOperations.map(operation => <article className={`worktree-row worktree-operation ${operation.status}`} key={operation.id}>
          <strong>{operation.branch} · {operation.status === "attention" ? "Needs inspection" : operation.status}</strong>
          <span>{operation.message}</span>
          <small>{operation.createdAt ? new Date(operation.createdAt).toLocaleString() : ""}{operation.status === "completed" ? ` · ${operation.target}` : ""}</small>
        </article>)}
      </div>}
    </section>
  </div></main>
}
