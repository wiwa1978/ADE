import { useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Camera,
  ExternalLink,
  Globe,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
  Tablet,
} from "lucide-react"
import { request, requestJson } from "../../api"
import type { BrowserState, BrowserViewport } from "../../app-types"

const QUICK_BOOKMARKS = [
  { label: "localhost:3000", url: "http://localhost:3000" },
  { label: "localhost:5173", url: "http://localhost:5173" },
  { label: "localhost:8080", url: "http://localhost:8080" },
  { label: "GitHub", url: "https://github.com" },
]

export function BrowserPanel({
  browserState,
  initialUrl,
  onStateChange,
  onOpenExternal,
}: {
  browserState: BrowserState
  initialUrl?: string
  onStateChange: (state: BrowserState) => void
  onOpenExternal: (url: string) => Promise<void>
}) {
  const [mode, setMode] = useState<"cdp" | "iframe">(() => (browserState.available ? "cdp" : "iframe"))
  const [urlInput, setUrlInput] = useState(initialUrl || (browserState.url !== "about:blank" ? browserState.url : "http://localhost:3000"))
  const [iframeUrl, setIframeUrl] = useState(initialUrl || "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const canvasImgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const lastSentSizeRef = useRef<{ width: number; height: number } | null>(null)
  const didAutoNavigate = useRef(false)

  useEffect(() => {
    if (browserState.url && browserState.url !== "about:blank") {
      setUrlInput(browserState.url)
    }
  }, [browserState.url])

  // Auto-fit Chrome CDP viewport to the exact Browser panel width & height in desktop mode
  useEffect(() => {
    if (mode !== "cdp" || !browserState.running || browserState.viewport.preset !== "desktop") return
    const el = stageRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    let timer: ReturnType<typeof setTimeout> | null = null
    const syncSize = () => {
      const rect = el.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (w < 200 || h < 180) return
      const prev = lastSentSizeRef.current
      if (prev && Math.abs(prev.width - w) < 16 && Math.abs(prev.height - h) < 16) return
      lastSentSizeRef.current = { width: w, height: h }
      void requestJson<BrowserState>("/api/browser/viewport", "POST", { preset: "desktop", width: w, height: h }).then(next => {
        if (next && typeof next.url === "string") onStateChange(next)
      }).catch(() => {
        // ignore transient resize error
      })
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(syncSize, 220)
    }
    schedule()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [mode, browserState.running, browserState.viewport.preset, onStateChange])

  useEffect(() => {
    if (initialUrl && !didAutoNavigate.current) {
      didAutoNavigate.current = true
      setUrlInput(initialUrl)
      if (mode === "cdp" && browserState.available) {
        void navigateCdp(initialUrl)
      } else {
        setIframeUrl(initialUrl)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl])

  const normalizeUrl = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return ""
    return /^https?:\/\//i.test(trimmed) ? trimmed : (trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1") ? `http://${trimmed}` : `https://${trimmed}`)
  }

  const navigateCdp = async (target: string) => {
    const normalized = normalizeUrl(target)
    if (!normalized) return
    setBusy(true)
    setError("")
    try {
      const next = await requestJson<BrowserState>("/api/browser/navigate", "POST", { url: normalized })
      onStateChange(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to navigate built-in Chrome.")
    } finally {
      setBusy(false)
    }
  }

  const handleGo = async (target = urlInput) => {
    const normalized = normalizeUrl(target)
    if (!normalized) return
    setUrlInput(normalized)
    if (mode === "iframe") {
      setIframeUrl(normalized)
      return
    }
    await navigateCdp(normalized)
  }

  const runAction = async (endpoint: string, body: Record<string, unknown> = {}) => {
    setBusy(true)
    setError("")
    try {
      const next = await request<BrowserState>(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (next && typeof next.url === "string") onStateChange(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Browser action failed.")
    } finally {
      setBusy(false)
    }
  }

  const mapCoords = (e: Pick<React.MouseEvent<HTMLImageElement>, "clientX" | "clientY">) => {
    const img = canvasImgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const x = ((e.clientX - rect.left) / rect.width) * browserState.viewport.width
    const y = ((e.clientY - rect.top) / rect.height) * browserState.viewport.height
    return { x, y }
  }

  const handleViewportClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    const pos = mapCoords(e)
    if (!pos) return
    try {
      await requestJson("/api/browser/input", "POST", { kind: "mouse", type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 1 })
      await requestJson("/api/browser/input", "POST", { kind: "mouse", type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount: 1 })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send browser click.")
    }
  }

  const handleViewportWheel = async (e: React.WheelEvent<HTMLImageElement>) => {
    const pos = mapCoords(e)
    if (!pos) return
    try {
      await requestJson("/api/browser/input", "POST", { kind: "mouse", type: "mouseWheel", x: pos.x, y: pos.y, deltaX: e.deltaX, deltaY: e.deltaY })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send browser scroll.")
    }
  }

  const handleViewportKeyDown = async (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (mode !== "cdp" || !browserState.running) return
    if (e.metaKey || e.ctrlKey) return
    e.preventDefault()
    try {
      if (e.key.length === 1) {
        await requestJson("/api/browser/input", "POST", { kind: "text", text: e.key })
      } else {
        await requestJson("/api/browser/input", "POST", { kind: "key", key: e.key })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send browser key input.")
    }
  }

  const activeUrl = mode === "iframe" ? (iframeUrl || urlInput) : (browserState.url !== "about:blank" ? browserState.url : urlInput)

  const setViewport = (preset: BrowserViewport["preset"]) => {
    if (preset === "desktop" && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      if (width >= 200 && height >= 180) {
        lastSentSizeRef.current = { width, height }
        void runAction("/api/browser/viewport", { preset, width, height })
        return
      }
    }
    void runAction("/api/browser/viewport", { preset })
  }

  return (
    <div className="ade-pane-body">
      <div className="ade-browser-bar">
        <div className="ade-browser-nav">
          <button type="button" className="ade-icon-btn" disabled={mode !== "cdp" || !browserState.canGoBack} onClick={() => void runAction("/api/browser/back")} title="Back">
            <ArrowLeft className="size-3.5" />
          </button>
          <button type="button" className="ade-icon-btn" disabled={mode !== "cdp" || !browserState.canGoForward} onClick={() => void runAction("/api/browser/forward")} title="Forward">
            <ArrowRight className="size-3.5" />
          </button>
          <button
            type="button"
            className="ade-icon-btn"
            onClick={() => {
              if (mode === "iframe") setIframeUrl(u => u ? `${u}` : urlInput)
              else void runAction("/api/browser/reload")
            }}
            title="Reload"
          >
            {busy || browserState.loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </button>
        </div>

        <form
          className="ade-browser-url-form"
          onSubmit={e => {
            e.preventDefault()
            void handleGo()
          }}
        >
          <Globe className="size-3.5 opacity-60 shrink-0" />
          <input
            type="text"
            className="ade-browser-url-input"
            value={urlInput}
            placeholder="Enter URL (e.g. http://localhost:3000 or https://example.com)"
            onChange={e => setUrlInput(e.target.value)}
          />
          <button type="submit" className="ade-chip-btn">Go</button>
        </form>

        <div className="ade-browser-controls">
          <div className="ade-segmented">
            <button type="button" className={mode === "cdp" ? "is-active" : ""} onClick={() => setMode("cdp")} title="Interactive Chrome CDP (works on any site + agent automation)">
              Chrome
            </button>
            <button type="button" className={mode === "iframe" ? "is-active" : ""} onClick={() => setMode("iframe")} title="Direct iframe (best for localhost hot-reload)">
              Iframe
            </button>
          </div>

          {mode === "cdp" ? (
            <div className="ade-segmented">
              <button type="button" className={browserState.viewport.preset === "desktop" ? "is-active" : ""} onClick={() => setViewport("desktop")} title="Desktop viewport">
                <Monitor className="size-3.5" />
              </button>
              <button type="button" className={browserState.viewport.preset === "tablet" ? "is-active" : ""} onClick={() => setViewport("tablet")} title="Tablet viewport">
                <Tablet className="size-3.5" />
              </button>
              <button type="button" className={browserState.viewport.preset === "mobile" ? "is-active" : ""} onClick={() => setViewport("mobile")} title="Mobile viewport">
                <Smartphone className="size-3.5" />
              </button>
            </div>
          ) : null}

          {mode === "cdp" && browserState.running ? (
            <button type="button" className="ade-icon-btn" onClick={() => void runAction("/api/browser/screenshot")} title="Refresh frame">
              <Camera className="size-3.5" />
            </button>
          ) : null}

          <button
            type="button"
            className="ade-btn ade-btn-xs"
            onClick={() => void onOpenExternal(normalizeUrl(activeUrl || "https://example.com"))}
            title="Open current URL in your external default browser"
          >
            <ExternalLink className="size-3.5" /> External
          </button>
        </div>
      </div>

      {browserState.agentDriving ? (
        <div className="ade-browser-driving-banner">
          <Bot className="size-3.5" />
          <span>Agent is currently operating the built-in browser…</span>
        </div>
      ) : null}

      {error || browserState.error ? (
        <div className="ade-banner-error">{error || browserState.error}</div>
      ) : null}

      <div ref={stageRef} className="ade-browser-stage" tabIndex={0} onKeyDown={handleViewportKeyDown}>
        {mode === "iframe" ? (
          iframeUrl ? (
            <iframe
              key={iframeUrl}
              src={iframeUrl}
              title="ADE Local Preview"
              className="ade-browser-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          ) : (
            <div className="ade-browser-empty">
              <Globe className="size-8 opacity-40" />
              <h4>Built-in Browser (Iframe mode)</h4>
              <p>Enter a local dev server URL above, switch to Chrome mode for any external site, or click a quick link:</p>
              <div className="ade-bookmark-row">
                {QUICK_BOOKMARKS.map(b => (
                  <button key={b.url} type="button" className="ade-chip-btn" onClick={() => void handleGo(b.url)}>{b.label}</button>
                ))}
              </div>
            </div>
          )
        ) : browserState.lastFrame ? (
          <div className={`ade-browser-cdp-frame preset-${browserState.viewport.preset}`}>
            <img
              ref={canvasImgRef}
              src={browserState.lastFrame}
              alt={browserState.title || "Built-in Browser"}
              className="ade-browser-canvas"
              draggable={false}
              onClick={handleViewportClick}
              onWheel={handleViewportWheel}
            />
          </div>
        ) : (
          <div className="ade-browser-empty">
            <Globe className="size-8 opacity-40" />
            <h4>Built-in Interactive Browser</h4>
            <p>
              {browserState.available
                ? "Powered by local Chrome CDP — works on localhost and external sites, supports clicks, typing, scrolling, and live agent automation."
                : "Chrome was not auto-detected. Switch to Iframe mode for localhost previews or open links externally."}
            </p>
            <div className="ade-bookmark-row">
              {QUICK_BOOKMARKS.map(b => (
                <button key={b.url} type="button" className="ade-chip-btn" onClick={() => void handleGo(b.url)}>{b.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
