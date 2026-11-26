import { useEffect, useRef, useState } from "react"
import { Play, RotateCw, Square, Terminal as TerminalIcon } from "lucide-react"
import type { FitAddon as FitAddonInstance } from "@xterm/addon-fit"
import type { Terminal as XTermInstance } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { request, requestJson, resolveCaptainUrl } from "./api"
import { useI18n } from "./i18n/I18nContext"
import { HARNESS_LABELS, terminalPromptStorageKey, type TerminalHarnessId } from "./terminal-mode"

/** The runtime accepts 20–300 columns and 5–200 rows; a short drawer can measure less. */
function terminalSize(cols: number, rows: number) {
  return { cols: Math.min(300, Math.max(20, Math.round(cols))), rows: Math.min(200, Math.max(5, Math.round(rows))) }
}

type TerminalStart = { id: string; shell: string; cwd: string; cols: number; rows: number; harness?: TerminalHarnessId; reused?: boolean }
type TerminalOutput = { data: string; cursor: number; baseCursor: number; truncated: boolean; exited: boolean; exitCode: number | null; shell: string; harness?: TerminalHarnessId }
type TerminalStatus =
  | { kind: "not_started" }
  | { kind: "reconnecting" }
  | { kind: "starting" }
  | { kind: "running"; shell: string }
  | { kind: "exited"; exitCode: number | null }
  | { kind: "expired" }
  | { kind: "interrupted" }

type TerminalPanelProps = {
  environmentId: string
  workspaceKey: string
  cwd: string
  visible: boolean
  fontSize: number
  scrollback: number
  /** Start a shell (or harness) as soon as the terminal is ready instead of waiting for "Start". */
  autoStart?: boolean
  /** Optional interactive agent CLI harness to run instead of the system shell. */
  harness?: TerminalHarnessId
  /** Session ID used to reattach to a live harness PTY across tab switches. */
  sessionId?: string
  /** Fill the entire primary workspace pane (terminal mode). */
  fullPane?: boolean
}

function terminalTheme() {
  const root = getComputedStyle(document.documentElement)
  const color = (name: string, fallback: string) => {
    const value = root.getPropertyValue(name).trim()
    return value ? `rgb(${value.split(/\s+/).join(", ")})` : fallback
  }
  return {
    background: color("--background", "#201f1d"),
    foreground: color("--foreground", "#f0efed"),
    cursor: color("--primary", "#d97858"),
    selectionBackground: color("--primary", "#d97858"),
    black: "#242321", red: "#cf625b", green: "#78ae79", yellow: "#d5a35b",
    blue: "#7898c7", magenta: "#b28acb", cyan: "#77aeb0", white: "#d8d5d0",
    brightBlack: "#77716b", brightRed: "#e17d72", brightGreen: "#92c58c", brightYellow: "#e6bc73",
    brightBlue: "#94b3e0", brightMagenta: "#c6a2dc", brightCyan: "#8ec9ca", brightWhite: "#faf8f4",
  }
}

export function TerminalPanel({
  environmentId,
  workspaceKey,
  cwd,
  visible,
  fontSize,
  scrollback,
  autoStart = false,
  harness,
  sessionId,
  fullPane = false,
}: TerminalPanelProps) {
  const { t } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTermInstance | null>(null)
  const fitRef = useRef<FitAddonInstance | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const cursorRef = useRef(0)
  const exitedRef = useRef(false)
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const fontSizeRef = useRef(fontSize)
  const scrollbackRef = useRef(scrollback)
  const autoStartedRef = useRef(false)
  const [terminalReady, setTerminalReady] = useState(false)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [status, setStatus] = useState<TerminalStatus>({ kind: "not_started" })
  const [error, setError] = useState("")
  const storageKey = harness && sessionId
    ? `ade-terminal-harness-v1:${environmentId}:${sessionId}:${harness}`
    : `ade-terminal-v1:${environmentId}:${workspaceKey}`

  useEffect(() => {
    if (!visible || !hostRef.current) return
    let active = true
    let terminal: XTermInstance | null = null
    let fit: FitAddonInstance | null = null
    let observer: ResizeObserver | null = null
    let fitTerminal: (() => void) | null = null
    let inputSubscription: { dispose: () => void } | null = null
    let resizeSubscription: { dispose: () => void } | null = null

    void (async () => {
      try {
        const [loadedXterm, loadedFitAddon] = await Promise.all([
          import("@xterm/xterm") as Promise<unknown>,
          import("@xterm/addon-fit") as Promise<unknown>,
        ])
        if (!active || !hostRef.current) return
        const xtermModule = loadedXterm as { Terminal?: typeof import("@xterm/xterm").Terminal; default?: { Terminal?: typeof import("@xterm/xterm").Terminal } }
        const fitModule = loadedFitAddon as { FitAddon?: typeof import("@xterm/addon-fit").FitAddon; default?: { FitAddon?: typeof import("@xterm/addon-fit").FitAddon } }
        const TerminalConstructor = xtermModule.Terminal ?? xtermModule.default?.Terminal
        const FitAddonConstructor = fitModule.FitAddon ?? fitModule.default?.FitAddon
        if (!TerminalConstructor || !FitAddonConstructor) throw new Error(tRef.current("pnlx.term.errLibs"))
        terminal = new TerminalConstructor({
          cursorBlink: true,
          fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace',
          fontSize: fontSizeRef.current,
          scrollback: scrollbackRef.current,
          convertEol: false,
          theme: terminalTheme(),
        })
        fit = new FitAddonConstructor()
        terminal.loadAddon(fit)
        terminal.open(hostRef.current)
        terminalRef.current = terminal
        fitRef.current = fit
        setTerminalReady(true)

        const savedId = localStorage.getItem(storageKey)
        if (savedId && !terminalIdRef.current) {
          terminalIdRef.current = savedId
          cursorRef.current = 0
          exitedRef.current = false
          setTerminalId(savedId)
          setStatus({ kind: "reconnecting" })
        }

        inputSubscription = terminal.onData(data => {
          const id = terminalIdRef.current
          if (!id || exitedRef.current) return
          writeQueueRef.current = writeQueueRef.current.then(async () => {
            await requestJson(`/api/terminals/${id}/input`, "POST", { data })
          }).catch(cause => {
            setError(cause instanceof Error ? cause.message : tRef.current("pnlx.term.errWrite"))
          })
        })
        resizeSubscription = terminal.onResize(({ cols, rows }) => {
          const id = terminalIdRef.current
          if (!id) return
          void requestJson(`/api/terminals/${id}/resize`, "POST", terminalSize(cols, rows)).catch(cause => setError(cause instanceof Error ? cause.message : tRef.current("pnlx.term.errResize")))
        })

        fitTerminal = () => {
          if (!hostRef.current?.clientWidth || !hostRef.current.clientHeight || !fit) return
          try { fit.fit() } catch { /* The panel may be between layout states. */ }
        }
        observer = new ResizeObserver(fitTerminal)
        observer.observe(hostRef.current)
        window.addEventListener("resize", fitTerminal)
        requestAnimationFrame(fitTerminal)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : tRef.current("pnlx.term.errLoadUi"))
      }
    })()

    return () => {
      active = false
      observer?.disconnect()
      if (fitTerminal) window.removeEventListener("resize", fitTerminal)
      inputSubscription?.dispose()
      resizeSubscription?.dispose()
      terminal?.dispose()
      if (terminalRef.current === terminal) terminalRef.current = null
      if (fitRef.current === fit) fitRef.current = null
      setTerminalReady(false)
    }
  }, [visible, storageKey])

  useEffect(() => {
    fontSizeRef.current = fontSize
    scrollbackRef.current = scrollback
    if (!terminalRef.current) return
    terminalRef.current.options.fontSize = fontSize
    terminalRef.current.options.scrollback = scrollback
    try { fitRef.current?.fit() } catch { /* The terminal can be hidden while preferences change. */ }
  }, [fontSize, scrollback])

  // Reset per-workspace terminal state when switching sessions/storage keys.
  const prevStorageKeyRef = useRef(storageKey)
  useEffect(() => {
    if (prevStorageKeyRef.current === storageKey) return
    prevStorageKeyRef.current = storageKey
    terminalIdRef.current = null
    cursorRef.current = 0
    exitedRef.current = false
    autoStartedRef.current = false
    setTerminalId(null)
    setStatus({ kind: "not_started" })
    setError("")
  }, [storageKey])

  // Stream PTY output over SSE for low-latency interactive TUIs (falls back to single fetch when EventSource is absent).
  useEffect(() => {
    if (!visible || !terminalReady || !terminalId || !terminalRef.current) return
    let active = true
    let source: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let probeController: AbortController | null = null

    const closeStream = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (source) {
        source.close()
        source = null
      }
      if (probeController) {
        probeController.abort()
        probeController = null
      }
    }

    const applyOutput = (result: TerminalOutput) => {
      if (!active) return
      if (result.truncated) terminalRef.current?.write(tRef.current("pnlx.term.truncated"))
      if (result.data) terminalRef.current?.write(result.data)
      cursorRef.current = result.cursor
      exitedRef.current = result.exited
      setError("")
      setStatus(result.exited ? { kind: "exited", exitCode: result.exitCode } : { kind: "running", shell: result.shell })
    }

    const handleExpired = (message: string) => {
      localStorage.removeItem(storageKey)
      terminalIdRef.current = null
      setTerminalId(null)
      exitedRef.current = true
      setStatus({ kind: "expired" })
      if (!harness) setError(message)
    }

    const connect = () => {
      if (!active || exitedRef.current) return
      if (typeof EventSource === "undefined") {
        // Fallback for non-browser test environments without EventSource.
        const controller = new AbortController()
        probeController = controller
        void request<TerminalOutput>(`/api/terminals/${terminalId}/output?cursor=${cursorRef.current}`, { signal: controller.signal })
          .then(applyOutput)
          .catch(cause => {
            if (!active || controller.signal.aborted) return
            const message = cause instanceof Error ? cause.message : tRef.current("pnlx.term.errLost")
            if (/not found|already closed/i.test(message)) handleExpired(message)
            else { setStatus({ kind: "interrupted" }); setError(message) }
          })
        return
      }

      const url = resolveCaptainUrl(`/api/terminals/${terminalId}/stream?cursor=${cursorRef.current}`)
      const nextSource = new EventSource(url)
      source = nextSource

      nextSource.addEventListener("output", (event: MessageEvent) => {
        if (!active || source !== nextSource) return
        try {
          const parsed = JSON.parse(String(event.data)) as TerminalOutput
          applyOutput(parsed)
        } catch {
          // Ignore malformed SSE frames.
        }
      })

      nextSource.addEventListener("exit", (event: MessageEvent) => {
        if (!active || source !== nextSource) return
        try {
          const parsed = JSON.parse(String(event.data)) as { exitCode: number | null; cursor?: number }
          if (typeof parsed.cursor === "number") cursorRef.current = parsed.cursor
          exitedRef.current = true
          setStatus({ kind: "exited", exitCode: parsed.exitCode ?? null })
        } catch {
          exitedRef.current = true
          setStatus({ kind: "exited", exitCode: null })
        }
        nextSource.close()
        if (source === nextSource) source = null
      })

      nextSource.onerror = () => {
        if (!active || source !== nextSource || exitedRef.current) return
        nextSource.close()
        source = null
        // Probe once to distinguish an expired/closed terminal (404) from a transient disconnect.
        const controller = new AbortController()
        probeController = controller
        void request<TerminalOutput>(`/api/terminals/${terminalId}/output?cursor=${cursorRef.current}`, { signal: controller.signal })
          .then(result => {
            if (!active || controller.signal.aborted) return
            applyOutput(result)
            if (!result.exited) {
              reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, 500)
            }
          })
          .catch(cause => {
            if (!active || controller.signal.aborted) return
            const message = cause instanceof Error ? cause.message : tRef.current("pnlx.term.errLost")
            if (/not found|already closed/i.test(message)) {
              handleExpired(message)
            } else {
              setStatus({ kind: "interrupted" })
              setError(message)
              reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, 1500)
            }
          })
      }
    }

    connect()

    return () => {
      active = false
      closeStream()
    }
  }, [visible, terminalReady, terminalId, storageKey, harness])

  async function start() {
    if (!cwd || terminalId || !visible || !terminalReady || !terminalRef.current) return
    setError("")
    setStatus({ kind: "starting" })
    try {
      try { fitRef.current?.fit() } catch { /* Use the terminal's default size before first layout. */ }
      const terminal = terminalRef.current
      let initialPrompt: string | undefined
      if (harness && sessionId) {
        const promptKey = terminalPromptStorageKey(sessionId)
        const stored = sessionStorage.getItem(promptKey)
        if (stored?.trim()) {
          initialPrompt = stored.trim()
          sessionStorage.removeItem(promptKey)
        }
      }
      const result = await requestJson<TerminalStart>("/api/terminals", "POST", {
        cwd,
        ...terminalSize(terminal?.cols ?? 80, terminal?.rows ?? 24),
        ...(harness ? { harness } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(initialPrompt ? { initialPrompt } : {}),
      })
      terminalIdRef.current = result.id
      cursorRef.current = 0
      exitedRef.current = false
      localStorage.setItem(storageKey, result.id)
      setTerminalId(result.id)
      setStatus({ kind: "running", shell: result.shell })
      terminal?.focus()
    } catch (cause) {
      setStatus({ kind: "not_started" })
      setError(cause instanceof Error ? cause.message : t("pnlx.term.errStart"))
    }
  }

  // Auto-start once per mount when enabled and nothing is running for this workspace yet.
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || !terminalReady || terminalId || !cwd || !visible) return
    autoStartedRef.current = true
    void start()
  })

  async function close() {
    const id = terminalIdRef.current
    setError("")
    if (id) {
      try { await request(`/api/terminals/${id}`, { method: "DELETE" }) }
      catch (cause) {
        setError(cause instanceof Error ? cause.message : t("pnlx.term.errClose"))
        return
      }
    }
    localStorage.removeItem(storageKey)
    terminalIdRef.current = null
    cursorRef.current = 0
    exitedRef.current = false
    setTerminalId(null)
    setStatus({ kind: "not_started" })
    terminalRef.current?.reset()
  }

  async function restart() {
    await close()
    autoStartedRef.current = false
  }

  const statusText = status.kind === "not_started" ? t("pnlx.term.notStarted")
    : status.kind === "reconnecting" ? t("pnlx.term.reconnecting")
    : status.kind === "starting" ? t("pnlx.term.starting")
    : status.kind === "running" ? t("pnlx.term.runningShell", { shell: status.shell })
    : status.kind === "exited" ? (status.exitCode === null ? t("pnlx.term.exited") : t("pnlx.term.exitedCode", { code: status.exitCode }))
    : status.kind === "expired" ? t("pnlx.term.expired")
    : t("pnlx.term.interrupted")
  const isDocker = status.kind === "running" && status.shell === "docker"
  const harnessLabel = harness ? HARNESS_LABELS[harness] : null

  return <div className={`terminal-workbench${visible ? " visible" : ""}${fullPane ? " is-full-pane" : ""}`} aria-label={t("pnlx.term.ariaWorkbench")}>
    <div className="terminal-toolbar">
      <div className="terminal-location">
        <TerminalIcon size={14} />
        {harnessLabel ? <span className="ade-pill">{harnessLabel}</span> : null}
        <span title={cwd || t("pnlx.term.noWorkspace")}>{cwd || t("pnlx.term.noWorkspace")}</span>
        <small>{statusText}</small>
      </div>
      <div className="terminal-actions">
        {terminalId && status.kind === "exited" ? (
          <button type="button" className="quiet-button" onClick={() => void restart()}><RotateCw size={13} /> Restart</button>
        ) : null}
        {terminalId
          ? <button type="button" className="quiet-button" onClick={() => void close()}><Square size={13} /> {t("pnlx.term.close")}</button>
          : <button type="button" className="quiet-button" disabled={!cwd || !visible || !terminalReady} onClick={() => void start()}><Play size={13} /> {harnessLabel ? `Start ${harnessLabel}` : t("pnlx.term.start")}</button>}
      </div>
    </div>
    {!cwd && <p className="terminal-empty">{t("pnlx.term.empty")}</p>}
    {error && <p className="terminal-error" role="alert">{error}</p>}
    <div className="terminal-viewport" ref={hostRef} aria-label={t("pnlx.term.ariaOutput")} />
    <p className="terminal-safety-note">{isDocker ? t("pnlx.term.safetyDocker") : t("pnlx.term.safetyHost")}</p>
  </div>
}
