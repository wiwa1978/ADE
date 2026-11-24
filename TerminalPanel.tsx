import { useEffect, useRef, useState } from "react"
import { Play, Square, Terminal as TerminalIcon } from "lucide-react"
import type { FitAddon as FitAddonInstance } from "@xterm/addon-fit"
import type { Terminal as XTermInstance } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { request } from "./api"

/** The runtime accepts 20–300 columns and 5–200 rows; a short drawer can measure less. */
function terminalSize(cols: number, rows: number) {
  return { cols: Math.min(300, Math.max(20, Math.round(cols))), rows: Math.min(200, Math.max(5, Math.round(rows))) }
}

type TerminalStart = { id: string; shell: string; cwd: string; cols: number; rows: number }
type TerminalOutput = { data: string; cursor: number; baseCursor: number; truncated: boolean; exited: boolean; exitCode: number | null; shell: string }

type TerminalPanelProps = {
  environmentId: string
  workspaceKey: string
  cwd: string
  visible: boolean
  fontSize: number
  scrollback: number
  /** Start a shell as soon as the terminal is ready instead of waiting for "Start terminal". */
  autoStart?: boolean
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

export function TerminalPanel({ environmentId, workspaceKey, cwd, visible, fontSize, scrollback, autoStart = false }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTermInstance | null>(null)
  const fitRef = useRef<FitAddonInstance | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const cursorRef = useRef(0)
  const exitedRef = useRef(false)
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const wakePollRef = useRef<(() => void) | null>(null)
  const fontSizeRef = useRef(fontSize)
  const scrollbackRef = useRef(scrollback)
  const [terminalReady, setTerminalReady] = useState(false)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [status, setStatus] = useState("Not started")
  const [error, setError] = useState("")
  const storageKey = `ade-terminal-v1:${environmentId}:${workspaceKey}`

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
        if (!TerminalConstructor || !FitAddonConstructor) throw new Error("Terminal libraries could not be loaded.")
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
          setTerminalId(savedId)
          setStatus("Reconnecting…")
        }

        inputSubscription = terminal.onData(data => {
          const id = terminalIdRef.current
          if (!id || exitedRef.current) return
          writeQueueRef.current = writeQueueRef.current.then(async () => {
            await request(`/api/terminals/${id}/input`, {
              method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }),
            })
            wakePollRef.current?.()
          }).catch(cause => {
            setError(cause instanceof Error ? cause.message : "Could not write to the terminal.")
          })
        })
        resizeSubscription = terminal.onResize(({ cols, rows }) => {
          const id = terminalIdRef.current
          if (!id) return
          void request(`/api/terminals/${id}/resize`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(terminalSize(cols, rows)),
          }).catch(cause => setError(cause instanceof Error ? cause.message : "Could not resize the terminal."))
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
        if (active) setError(cause instanceof Error ? cause.message : "Could not load the terminal UI.")
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

  useEffect(() => {
    if (!visible || !terminalReady || !terminalId || !terminalRef.current) return
    const ACTIVE_POLL_MS = 180
    const MAX_IDLE_POLL_MS = 1000
    let active = true
    let polling = false
    let delayMs = ACTIVE_POLL_MS
    let timer: ReturnType<typeof setTimeout> | null = null
    let controller: AbortController | null = null

    const isHidden = () => typeof document !== "undefined" && document.visibilityState !== "visible"

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const schedule = (ms: number) => {
      clearTimer()
      if (!active || exitedRef.current || isHidden()) return
      timer = setTimeout(() => { void poll() }, ms)
    }

    const poll = async () => {
      if (!active || polling || exitedRef.current || isHidden()) return
      polling = true
      clearTimer()
      const nextController = new AbortController()
      controller = nextController
      try {
        const result = await request<TerminalOutput>(
          `/api/terminals/${terminalId}/output?cursor=${cursorRef.current}`,
          { signal: nextController.signal },
        )
        if (!active || nextController.signal.aborted) return
        if (result.truncated) terminalRef.current?.write("\r\n[Earlier terminal output was truncated.]\r\n")
        if (result.data) terminalRef.current?.write(result.data)
        cursorRef.current = result.cursor
        exitedRef.current = result.exited
        setStatus(result.exited ? `Exited${result.exitCode === null ? "" : ` (${result.exitCode})`}` : `Running · ${result.shell}`)
        delayMs = result.data ? ACTIVE_POLL_MS : Math.min(MAX_IDLE_POLL_MS, Math.round(delayMs * 1.5))
      } catch (cause) {
        if (!active || nextController.signal.aborted) return
        const message = cause instanceof Error ? cause.message : "Terminal connection was lost."
        if (/not found|already closed/i.test(message)) {
          localStorage.removeItem(storageKey)
          terminalIdRef.current = null
          setTerminalId(null)
          exitedRef.current = true
          setStatus("Terminal expired")
        } else {
          setStatus("Connection interrupted")
          delayMs = MAX_IDLE_POLL_MS
        }
        setError(message)
      } finally {
        if (controller === nextController) controller = null
        polling = false
        if (active && !exitedRef.current && !isHidden()) {
          schedule(delayMs)
        }
      }
    }

    const wake = () => {
      if (!active || exitedRef.current || isHidden()) return
      delayMs = ACTIVE_POLL_MS
      if (!polling) {
        schedule(40)
      }
    }
    wakePollRef.current = wake

    const onVisibilityChange = () => {
      if (!active) return
      if (isHidden()) {
        clearTimer()
        return
      }
      delayMs = ACTIVE_POLL_MS
      void poll()
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange)
    }

    if (!isHidden()) {
      void poll()
    }

    return () => {
      active = false
      if (wakePollRef.current === wake) wakePollRef.current = null
      clearTimer()
      controller?.abort()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange)
      }
    }
  }, [visible, terminalReady, terminalId, storageKey])

  async function start() {
    if (!cwd || terminalId || !visible || !terminalReady || !terminalRef.current) return
    setError("")
    setStatus("Starting…")
    try {
      try { fitRef.current?.fit() } catch { /* Use the terminal's default size before first layout. */ }
      const terminal = terminalRef.current
      const result = await request<TerminalStart>("/api/terminals", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, ...terminalSize(terminal?.cols ?? 80, terminal?.rows ?? 24) }),
      })
      terminalIdRef.current = result.id
      cursorRef.current = 0
      exitedRef.current = false
      localStorage.setItem(storageKey, result.id)
      setTerminalId(result.id)
      setStatus(`Running · ${result.shell}`)
      terminal?.focus()
    } catch (cause) {
      setStatus("Not started")
      setError(cause instanceof Error ? cause.message : "Could not start the terminal.")
    }
  }

  // Auto-start once per mount when enabled and nothing is running for this workspace yet.
  const autoStartedRef = useRef(false)
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
        setError(cause instanceof Error ? cause.message : "Could not close the terminal.")
        return
      }
    }
    localStorage.removeItem(storageKey)
    terminalIdRef.current = null
    cursorRef.current = 0
    exitedRef.current = false
    setTerminalId(null)
    setStatus("Not started")
    terminalRef.current?.reset()
  }

  return <div className={`terminal-workbench${visible ? " visible" : ""}`} aria-label="Workspace terminal">
    <div className="terminal-toolbar">
      <div className="terminal-location"><TerminalIcon size={14} /><span title={cwd || "No workspace selected"}>{cwd || "No workspace selected"}</span><small>{status}</small></div>
      <div className="terminal-actions">{terminalId
        ? <button type="button" className="quiet-button" onClick={() => void close()}><Square size={13} /> Close terminal</button>
        : <button type="button" className="quiet-button" disabled={!cwd || !visible || !terminalReady} onClick={() => void start()}><Play size={13} /> Start terminal</button>}</div>
    </div>
    {!cwd && <p className="terminal-empty">Open a coding session with a checkout or worktree to start a terminal.</p>}
    {error && <p className="terminal-error" role="alert">{error}</p>}
    <div className="terminal-viewport" ref={hostRef} aria-label="Terminal output" />
    <p className="terminal-safety-note">{status.endsWith("· docker") ? "Commands run inside this session's Docker container." : "Commands run as the active host user."} Terminal input is user-operated and is not exposed as an agent tool.</p>
  </div>
}
