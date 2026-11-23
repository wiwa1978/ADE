import { useCallback, useEffect, useRef, useState } from "react"
import { ExternalLink, Globe, Play, RefreshCw, Settings2, Square } from "lucide-react"
import { request } from "../../api"
import { checkFailedPrompt } from "../../packages/protocol/agent-prompts.ts"
import { runTargetDescriptions, targetLabel, targetUnavailable, useRunTargets, type RunTarget, type TargetSettings, type TargetState } from "../run-targets"

type ScriptState = {
  kind: "setup" | "run" | "check"
  status: "idle" | "running" | "succeeded" | "failed" | "stopped"
  command: string
  output: string
  exitCode: number | null
  port: number | null
  url: string | null
}
type ScriptsResponse = { configured: { setup: string; run: string; copy: string[]; check: string; checkAutoFix: boolean } | null; setup: ScriptState; run: ScriptState; check: ScriptState }

const statusText: Record<ScriptState["status"], string> = {
  idle: "Not started",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  stopped: "Stopped",
}

export type RunStatus = { setup: ScriptState["status"]; run: ScriptState["status"]; check?: ScriptState["status"]; url: string | null; docker?: TargetState | null; target?: RunTarget }

type SessionTarget = TargetSettings & { container: string | null; port: number | null; boatId: string | null; state: TargetState; message: string }

const stateText: Record<TargetState, string> = {
  absent: "Not started",
  preparing: "Starting…",
  running: "Ready",
  stopped: "Stopped",
  failed: "Not available",
}

/** "Runs on" for a session: switch where its commands run, see the machine's state, start it again. */
function RunOnControls({ sessionId, busy }: { sessionId: string; busy: boolean }) {
  const info = useRunTargets()
  const [target, setTarget] = useState<SessionTarget | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      void request<SessionTarget>(`/api/sessions/${encodeURIComponent(sessionId)}/run-on`)
        .then(result => { if (!cancelled) setTarget(result) })
        .catch(() => undefined)
    }
    tick()
    const timer = window.setInterval(tick, 3000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [sessionId])
  const call = async (method: string, path: string, body: unknown) => {
    setWorking(true)
    setError("")
    try {
      setTarget(await request<SessionTarget>(`/api/sessions/${encodeURIComponent(sessionId)}/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.")
    } finally {
      setWorking(false)
    }
  }
  if (!target) return null
  const remote = target.target !== "local"
  const detail = target.target === "docker" ? <><code>{target.image}</code>{target.container ? <> · <code>{target.container}</code></> : null}{target.port ? <> · Run uses port {target.port}</> : null}</>
    : target.target === "ssh" ? <><code>{target.sshHost}</code> · <code>{target.remoteRoot}</code></>
      : target.target === "boat" ? <>{target.boatId ? <code>{target.boatId}</code> : "VM not created yet"}</>
        : target.target === "wsl" ? <code>{target.wslDistro || "default distribution"}</code> : null
  return (
    <div className="ade-run-on">
      <div className="ade-diff-header-meta">
        <strong className="ade-xs">Runs on</strong>
        <div className="ade-segmented" role="radiogroup" aria-label="Runs on">
          {(info?.available ?? ["local", "docker"]).map(option => {
            const blocked = targetUnavailable(option, info)
            return (
              <button key={option} type="button" role="radio" aria-checked={target.target === option} className={target.target === option ? "is-active" : ""}
                disabled={working || busy || Boolean(blocked)} title={blocked || runTargetDescriptions[option]}
                onClick={() => void call("PUT", "run-on", { target: option })}>
                {targetLabel(option)}
              </button>
            )
          })}
        </div>
        {remote ? (
          <>
            <span className={`ade-state-dot is-${target.state === "running" ? "ok" : target.state === "failed" ? "failed" : target.state === "preparing" ? "running" : "idle"}`} />
            <span className="ade-xs">{stateText[target.state]}</span>
            {target.state !== "preparing" && target.state !== "running" ? <button type="button" className="ade-chip-btn" disabled={working} onClick={() => void call("POST", "run-on/restart", {})}>{working ? "Starting…" : "Start again"}</button> : null}
          </>
        ) : null}
      </div>
      {remote ? <p className="ade-muted ade-xs">{detail}</p> : null}
      {remote && target.state === "failed" && target.message ? <p className="ade-xs ade-text-error">{target.message}</p> : null}
      {busy ? <p className="ade-muted ade-xs">Wait for the agent to finish to switch.</p> : null}
      {error ? <p className="ade-xs ade-text-error" role="alert">{error}</p> : null}
    </div>
  )
}

/** Session panel for the project's setup and run scripts: start the app, see its output, open it. */
export function RunPanel({
  sessionId,
  onOpenUrl,
  onOpenExternal,
  onOpenProjectSettings,
  onStatusChange,
  onAskAgent,
  agentBusy = false,
}: {
  sessionId: string
  onOpenUrl: (url: string) => void
  onOpenExternal: (url: string) => void
  onOpenProjectSettings?: () => void
  onStatusChange?: (status: RunStatus) => void
  onAskAgent?: (text: string) => Promise<void>
  agentBusy?: boolean
}) {
  const [data, setData] = useState<ScriptsResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const openedUrl = useRef<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  const apply = useCallback((result: ScriptsResponse) => {
    setData(result)
    onStatusChange?.({ setup: result.setup.status, run: result.run.status, check: result.check.status, url: result.run.url })
    // Open the app in the browser panel the first time its URL appears.
    if (result.run.status === "running" && result.run.url && openedUrl.current !== result.run.url) {
      openedUrl.current = result.run.url
      onOpenUrl(result.run.url)
    }
  }, [onOpenUrl, onStatusChange])
  const load = useCallback(() => request<ScriptsResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/scripts`).then(apply), [sessionId, apply])

  useEffect(() => {
    let cancelled = false
    const tick = () => {
      void request<ScriptsResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/scripts`)
        .then(result => { if (!cancelled) apply(result) })
        .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not read the scripts.") })
    }
    tick()
    const timer = window.setInterval(tick, 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [sessionId, apply])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [data?.run.output, data?.setup.output])

  const act = async (kind: "setup" | "run" | "check", action: "start" | "stop") => {
    setBusy(true)
    setError("")
    if (kind === "run" && action === "start") openedUrl.current = null
    try {
      await request(`/api/sessions/${encodeURIComponent(sessionId)}/scripts/${kind}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The script could not start.")
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <div className="ade-pane-empty"><p>Loading scripts…</p></div>

  const configured = data.configured
  const nothingConfigured = !configured?.setup && !configured?.run && !configured?.check
  return (
    <div className="ade-pane-body ade-run-panel">
      <div className="ade-pane-toolbar">
        <div className="ade-diff-header-meta">
          <span className={`ade-state-dot is-${data.run.status === "running" ? "running" : data.run.status === "failed" ? "failed" : "idle"}`} />
          <strong className="ade-xs">App {statusText[data.run.status].toLowerCase()}</strong>
          {data.run.port ? <span className="ade-pill ade-mono">port {data.run.port}</span> : null}
        </div>
        <div className="ade-toolbar-actions">
          {data.run.status === "running" ? (
            <button type="button" className="ade-chip-btn" disabled={busy} onClick={() => void act("run", "stop")}><Square className="size-3" /> Stop</button>
          ) : (
            <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" disabled={busy || !configured?.run} onClick={() => void act("run", "start")}><Play className="size-3.5" /> Run</button>
          )}
        </div>
      </div>
      {error ? <div className="ade-banner-error" role="alert">{error}</div> : null}
      <RunOnControls sessionId={sessionId} busy={agentBusy} />

      {nothingConfigured ? (
        <div className="ade-pane-empty">
          <p>This project has no setup or run script yet.</p>
          <p className="ade-muted ade-xs">Add them in the project’s settings (or commit <code>.ade/project.json</code>) to install dependencies in new worktrees and start the app with one click.</p>
          {onOpenProjectSettings ? <button type="button" className="ade-chip-btn" onClick={onOpenProjectSettings}><Settings2 className="size-3" /> Project settings</button> : null}
        </div>
      ) : (
        <div className="ade-run-body">
          {data.run.url ? (
            <div className="ade-run-url">
              <Globe className="size-3.5" />
              <code className="ade-truncate">{data.run.url}</code>
              <button type="button" className="ade-chip-btn" onClick={() => onOpenUrl(data.run.url!)}>Open in browser panel</button>
              <button type="button" className="ade-icon-btn" title="Open in your default browser" aria-label="Open in your default browser" onClick={() => onOpenExternal(data.run.url!)}><ExternalLink className="size-3.5" /></button>
            </div>
          ) : null}
          {configured?.run ? <p className="ade-muted ade-xs">Run: <code>{configured.run}</code></p> : <p className="ade-muted ade-xs">No run script configured.</p>}
          {data.run.output ? <pre className="ade-run-log" ref={logRef} aria-label="App output">{data.run.output}</pre> : null}

          {configured?.check ? (
            <div className="ade-run-setup" aria-label="Check after each turn">
              <div className="ade-diff-header-meta">
                <span className={`ade-state-dot is-${data.check.status === "running" ? "running" : data.check.status === "failed" ? "failed" : data.check.status === "succeeded" ? "ok" : "idle"}`} />
                <strong className="ade-xs">Check · {data.check.status === "succeeded" ? "Passed" : statusText[data.check.status]}{data.check.exitCode !== null && data.check.status === "failed" ? ` (exit ${data.check.exitCode})` : ""}</strong>
                <button type="button" className="ade-chip-btn" disabled={busy || data.check.status === "running"} onClick={() => void act("check", "start")}><RefreshCw className="size-3" /> Run check</button>
                {data.check.status === "failed" && onAskAgent ? (
                  <button type="button" className="ade-chip-btn" disabled={busy || agentBusy} title={agentBusy ? "The agent is working" : "Send the failing output to the agent"}
                    onClick={() => { setBusy(true); void onAskAgent(checkFailedPrompt(configured.check, data.check.output)).catch(() => undefined).finally(() => setBusy(false)) }}>
                    Ask the agent to fix
                  </button>
                ) : null}
              </div>
              <p className="ade-muted ade-xs">Runs after every agent turn: <code>{configured.check}</code>{configured.checkAutoFix ? " · failures go back to the agent automatically" : ""}</p>
              {data.check.output ? <pre className="ade-run-log is-setup" aria-label="Check output">{data.check.output}</pre> : null}
            </div>
          ) : null}

          <div className="ade-run-setup">
            <div className="ade-diff-header-meta">
              <span className={`ade-state-dot is-${data.setup.status === "running" ? "running" : data.setup.status === "failed" ? "failed" : data.setup.status === "succeeded" ? "ok" : "idle"}`} />
              <strong className="ade-xs">Setup · {statusText[data.setup.status]}{data.setup.exitCode !== null && data.setup.status === "failed" ? ` (exit ${data.setup.exitCode})` : ""}</strong>
              {configured?.setup ? (
                <button type="button" className="ade-chip-btn" disabled={busy || data.setup.status === "running"} onClick={() => void act("setup", "start")}><RefreshCw className="size-3" /> {data.setup.status === "idle" ? "Run setup" : "Run again"}</button>
              ) : null}
            </div>
            {configured?.setup ? <p className="ade-muted ade-xs">Setup: <code>{configured.setup}</code></p> : <p className="ade-muted ade-xs">No setup script configured.</p>}
            {data.setup.output ? <pre className="ade-run-log is-setup" aria-label="Setup output">{data.setup.output}</pre> : null}
          </div>
        </div>
      )}
    </div>
  )
}
