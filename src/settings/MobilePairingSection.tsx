import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Check,
  Copy,
  Globe,
  Link2,
  Loader2,
  Pencil,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wifi,
} from "lucide-react"
import { request, requestJson } from "../api"
import { useI18n } from "../i18n/I18nContext"
import { generateQrSvgData } from "../mobile/qr-code"

export type MobileAddressMode = "lan" | "tailscale" | "tunnel" | "custom"

export type PairedDeviceInfo = {
  id: string
  name: string
  platform: "ios" | "android" | "web"
  pairedAt: number
  lastSeenAt: number
  lastIp: string
  userAgent: string
  revokedAt: number | null
}

export type MobilePairingStatusPayload = {
  enabled: boolean
  running: boolean
  port: number
  hostName: string
  mode: MobileAddressMode
  lanIps: string[]
  tailscaleIp: string | null
  tunnelUrl: string | null
  tunnelRunning: boolean
  tunnelError: string
  cloudflaredAvailable: boolean
  customUrl: string
  activeBaseUrl: string | null
  bridgeError: string
  challenge: {
    code: string
    shortCode: string
    qrUrl: string | null
    expiresAt: number
  } | null
  devices: PairedDeviceInfo[]
}

function formatCountdown(expiresAt: number, now: number): string {
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000))
  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function MobilePairingSection() {
  const { t, formatRelativeTime: relative, formatDay } = useI18n()
  const [status, setStatus] = useState<MobilePairingStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tunnelBusy, setTunnelBusy] = useState(false)
  const [error, setError] = useState("")
  const [customUrlDraft, setCustomUrlDraft] = useState("")
  const [copiedField, setCopiedField] = useState<"url" | "code" | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [now, setNow] = useState(() => Date.now())

  const loadStatus = useCallback(async () => {
    try {
      const next = await request<MobilePairingStatusPayload>("/api/mobile/status")
      setStatus(next)
      setCustomUrlDraft(prev => (prev ? prev : next.customUrl))
      setError("")
    } catch {
      // Ignore transient polling failures.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void request<MobilePairingStatusPayload>("/api/mobile/status")
      .then(next => {
        if (cancelled) return
        setStatus(next)
        setCustomUrlDraft(prev => (prev ? prev : next.customUrl))
        setError("")
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t("mobile.loadError"))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [t])

  // Live countdown tick + silent status poll while enabled so newly paired phones appear immediately.
  useEffect(() => {
    if (!status?.enabled) return
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    const poll = window.setInterval(() => void loadStatus(), 3000)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(poll)
    }
  }, [status?.enabled, loadStatus])

  const handleToggleEnabled = async (nextEnabled: boolean) => {
    setBusy(true)
    setError("")
    try {
      const updated = await requestJson<MobilePairingStatusPayload>("/api/mobile/enable", "POST", { enabled: nextEnabled })
      setStatus(updated)
      setNow(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mobile.updateError"))
    } finally {
      setBusy(false)
    }
  }

  const handleSwitchMode = async (mode: MobileAddressMode) => {
    setBusy(true)
    setError("")
    try {
      const updated = await requestJson<MobilePairingStatusPayload>("/api/mobile/pair", "POST", { mode, ...(mode === "custom" ? { customUrl: customUrlDraft } : {}) })
      setStatus(updated)
      setNow(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mobile.switchError"))
    } finally {
      setBusy(false)
    }
  }

  const handleRegenerateQr = async () => {
    setBusy(true)
    setError("")
    try {
      const updated = await requestJson<MobilePairingStatusPayload>("/api/mobile/pair", "POST", {
          mode: status?.mode ?? "lan",
          ...(status?.mode === "custom" ? { customUrl: customUrlDraft } : {}),
        })
      setStatus(updated)
      setNow(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mobile.qrError"))
    } finally {
      setBusy(false)
    }
  }

  const handleTunnelAction = async (action: "start" | "stop") => {
    setTunnelBusy(true)
    setError("")
    try {
      const updated = await requestJson<MobilePairingStatusPayload>("/api/mobile/tunnel", "POST", { action })
      setStatus(updated)
      setNow(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mobile.tunnelError"))
    } finally {
      setTunnelBusy(false)
    }
  }

  const handleSaveCustomUrl = async () => {
    setBusy(true)
    setError("")
    try {
      const updated = await requestJson<MobilePairingStatusPayload>("/api/mobile/enable", "POST", { mode: "custom", customUrl: customUrlDraft })
      setStatus(updated)
      setNow(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid URL.")
    } finally {
      setBusy(false)
    }
  }

  const handleRenameDevice = async (id: string) => {
    const clean = renameDraft.trim()
    if (!clean) {
      setRenamingId(null)
      return
    }
    try {
      await requestJson(`/api/mobile/devices/${encodeURIComponent(id)}`, "PATCH", { name: clean })
      setRenamingId(null)
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mobile.renameError"))
    }
  }

  const handleRevokeDevice = async (id: string) => {
    setError("")
    try {
      await request(`/api/mobile/devices/${encodeURIComponent(id)}`, { method: "DELETE" })
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mobile.revokeError"))
    }
  }

  const handleRevokeAll = async () => {
    setError("")
    try {
      await request("/api/mobile/devices/revoke-all", { method: "POST" })
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mobile.revokeAllError"))
    }
  }

  const copyValue = async (text: string, field: "url" | "code") => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1600)
    } catch {
      // Ignore clipboard restrictions.
    }
  }

  const qrSvg = useMemo(() => {
    const qrUrl = status?.challenge?.qrUrl
    if (!qrUrl) return null
    try {
      return generateQrSvgData(qrUrl, 4)
    } catch {
      return null
    }
  }, [status?.challenge?.qrUrl])

  const challengeExpired = Boolean(status?.challenge && status.challenge.expiresAt <= now)

  if (loading && !status) {
    return <div className="ade-pane-note">{t("mobile.loading")}</div>
  }

  return (
    <div className="ade-mobile-settings">
      {error ? <div className="st-banner is-error" role="alert">{error}</div> : null}
      {status?.bridgeError ? <div className="st-banner is-error" role="alert">{t("mobile.bridgeError", { error: status.bridgeError })}</div> : null}

      {/* Master Enable Card */}
      <section className="ade-mp-pair-card">
        <div className="ade-mp-pair-card-head">
          <div className="ade-mp-pair-card-title">
            <span className="ade-mp-pair-icon">
              <Smartphone className="size-4" />
            </span>
            <div>
              <h3>{t("mobile.title")}</h3>
              <p>{t("mobile.subtitle")}</p>
            </div>
          </div>
          <div className="ade-mp-pair-head-actions">
            <span className={`ade-pill ${status?.running ? "ade-pill-ok" : ""}`}>
              {status?.running ? t("mobile.listening", { port: status.port }) : t("mobile.off")}
            </span>
            <button
              type="button"
              className={`ade-btn ${status?.enabled ? "" : "ade-btn-primary"}`}
              disabled={busy}
              onClick={() => void handleToggleEnabled(!status?.enabled)}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {status?.enabled ? t("mobile.disable") : t("mobile.enable")}
            </button>
          </div>
        </div>

        {status?.enabled ? (
          <>
            {/* Connection mode tabs */}
            <div className="ade-mp-mode-bar" role="tablist" aria-label={t("mobile.modeAria")}>
              <button
                type="button"
                role="tab"
                aria-selected={status.mode === "lan"}
                className={`ade-mp-mode-tab ${status.mode === "lan" ? "is-active" : ""}`}
                onClick={() => void handleSwitchMode("lan")}
              >
                <Wifi className="size-3.5" />
                <span>{t("mobile.modeLan")}</span>
                {status.lanIps[0] ? <code className="ade-mp-mode-hint">{status.lanIps[0]}</code> : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={status.mode === "tailscale"}
                className={`ade-mp-mode-tab ${status.mode === "tailscale" ? "is-active" : ""}`}
                onClick={() => void handleSwitchMode("tailscale")}
              >
                <ShieldCheck className="size-3.5" />
                <span>{t("mobile.modeTailscale")}</span>
                {status.tailscaleIp ? <code className="ade-mp-mode-hint">{status.tailscaleIp}</code> : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={status.mode === "tunnel"}
                className={`ade-mp-mode-tab ${status.mode === "tunnel" ? "is-active" : ""}`}
                onClick={() => void handleSwitchMode("tunnel")}
              >
                <Globe className="size-3.5" />
                <span>{t("mobile.modeTunnel")}</span>
                {status.tunnelRunning ? <span className="ade-dot ade-dot-running" /> : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={status.mode === "custom"}
                className={`ade-mp-mode-tab ${status.mode === "custom" ? "is-active" : ""}`}
                onClick={() => void handleSwitchMode("custom")}
              >
                <Link2 className="size-3.5" />
                <span>{t("mobile.modeCustom")}</span>
              </button>
            </div>

            {/* Mode-specific controls */}
            {status.mode === "tailscale" && !status.tailscaleIp ? (
              <div className="ade-mp-mode-note">
                {t("mobile.noTailscale")}
              </div>
            ) : null}

            {status.mode === "tunnel" ? (
              <div className="ade-mp-tunnel-row">
                <div className="ade-mp-tunnel-meta">
                  <strong>{t("mobile.tunnelName")}</strong>
                  <span>
                    {status.tunnelUrl
                      ? status.tunnelUrl
                      : status.cloudflaredAvailable
                        ? t("mobile.tunnelCreate")
                        : t("mobile.tunnelInstall")}
                  </span>
                  {status.tunnelError ? <span className="text-rose-400">{status.tunnelError}</span> : null}
                </div>
                <button
                  type="button"
                  className={`ade-btn ${status.tunnelRunning ? "" : "ade-btn-primary"}`}
                  disabled={tunnelBusy || (!status.cloudflaredAvailable && !status.tunnelRunning)}
                  onClick={() => void handleTunnelAction(status.tunnelRunning ? "stop" : "start")}
                >
                  {tunnelBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {status.tunnelRunning ? t("mobile.stopTunnel") : t("mobile.startTunnel")}
                </button>
              </div>
            ) : null}

            {status.mode === "custom" ? (
              <div className="ade-mp-custom-row">
                <input
                  type="url"
                  className="ade-input-sm flex-1"
                  placeholder="https://ade.your-domain.com"
                  value={customUrlDraft}
                  onChange={e => setCustomUrlDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void handleSaveCustomUrl() }}
                  aria-label={t("mobile.customUrlAria")}
                />
                <button type="button" className="ade-btn ade-btn-primary" disabled={busy} onClick={() => void handleSaveCustomUrl()}>
                  {t("mobile.saveUrl")}
                </button>
              </div>
            ) : null}

            {/* QR Code + Pairing Instructions */}
            <div className="ade-mp-qr-grid">
              <div className="ade-mp-qr-frame">
                {qrSvg && !challengeExpired ? (
                  <svg
                    className="ade-mp-qr-svg"
                    viewBox={`0 0 ${qrSvg.viewBoxSize} ${qrSvg.viewBoxSize}`}
                    role="img"
                    aria-label={t("mobile.qrAria")}
                    shapeRendering="crispEdges"
                  >
                    <rect width={qrSvg.viewBoxSize} height={qrSvg.viewBoxSize} fill="#ffffff" />
                    <path d={qrSvg.path} fill="#111111" />
                  </svg>
                ) : (
                  <div className="ade-mp-qr-placeholder">
                    <QrCode className="size-8 opacity-40" />
                    <span>
                      {!status.activeBaseUrl
                        ? status.mode === "tunnel"
                          ? t("mobile.qrStartTunnel")
                          : status.mode === "custom"
                            ? t("mobile.qrEnterUrl")
                            : t("mobile.qrNoAddress")
                        : t("mobile.qrExpired")}
                    </span>
                    {status.activeBaseUrl ? (
                      <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" onClick={() => void handleRegenerateQr()}>
                        <RefreshCw className="size-3" /> {t("mobile.freshQr")}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="ade-mp-qr-details">
                <div className="ade-mp-qr-top">
                  <div>
                    <div className="ade-mp-qr-heading">{t("mobile.scanHeading")}</div>
                    <div className="ade-mp-qr-sub">
                      {status.challenge && !challengeExpired
                        ? t("mobile.singleUse", { time: formatCountdown(status.challenge.expiresAt, now) })
                        : t("mobile.generateSingleUse")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ade-chip-btn"
                    disabled={busy}
                    onClick={() => void handleRegenerateQr()}
                    title={t("mobile.newQrTitle")}
                  >
                    <RefreshCw className="size-3.5" /> {t("mobile.newQr")}
                  </button>
                </div>

                {status.challenge && !challengeExpired ? (
                  <div className="ade-mp-code-row">
                    <div className="ade-mp-short-code">
                      <span className="ade-mp-short-code-label">{t("mobile.manualCode")}</span>
                      <code className="ade-mono">{status.challenge.shortCode}</code>
                    </div>
                    <button
                      type="button"
                      className="ade-chip-btn"
                      onClick={() => void copyValue(status.challenge!.shortCode, "code")}
                    >
                      {copiedField === "code" ? <><Check className="size-3" /> {t("common.copied")}</> : <><Copy className="size-3" /> {t("mobile.copyCode")}</>}
                    </button>
                    {status.challenge.qrUrl ? (
                      <button
                        type="button"
                        className="ade-chip-btn"
                        onClick={() => void copyValue(status.challenge!.qrUrl!, "url")}
                      >
                        {copiedField === "url" ? <><Check className="size-3" /> {t("mobile.copiedLink")}</> : <><Copy className="size-3" /> {t("mobile.copyLink")}</>}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {status.activeBaseUrl ? (
                  <div className="ade-mp-endpoint-line">
                    <span>{t("mobile.bridgeAddress")}</span>
                    <code className="ade-mono">{status.activeBaseUrl}</code>
                  </div>
                ) : null}

                <ol className="ade-mp-steps">
                  <li><strong>iPhone:</strong> <span dangerouslySetInnerHTML={{ __html: t("mobile.iphoneSteps") }} /></li>
                  <li><strong>Android:</strong> <span dangerouslySetInnerHTML={{ __html: t("mobile.androidSteps") }} /></li>
                </ol>
              </div>
            </div>
          </>
        ) : null}
      </section>

      {/* Paired Devices Card */}
      <section className="ade-mp-pair-card">
        <div className="ade-mp-devices-head">
          <div>
            <h3>{t("mobile.devices", { count: status?.devices.length ?? 0 })}</h3>
            <p>{t("mobile.devicesHint")}</p>
          </div>
          {(status?.devices.length ?? 0) > 0 ? (
            <button type="button" className="ade-btn ade-btn-danger ade-btn-xs" onClick={() => void handleRevokeAll()}>
              {t("mobile.revokeAll")}
            </button>
          ) : null}
        </div>

        {!status || status.devices.length === 0 ? (
          <div className="ade-mp-devices-empty">
            {t("mobile.noDevices")}
          </div>
        ) : (
          <div className="ade-mp-devices-list">
            {status.devices.map(device => (
              <div key={device.id} className="ade-mp-device-row">
                <span className="ade-mp-device-icon">
                  <Smartphone className="size-4" />
                </span>
                <div className="ade-mp-device-info">
                  {renamingId === device.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        className="ade-input-sm"
                        value={renameDraft}
                        autoFocus
                        onChange={e => setRenameDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") void handleRenameDevice(device.id)
                          if (e.key === "Escape") setRenamingId(null)
                        }}
                      />
                      <button type="button" className="ade-btn ade-btn-primary ade-btn-xs" onClick={() => void handleRenameDevice(device.id)}>{t("common.save")}</button>
                      <button type="button" className="ade-btn ade-btn-xs" onClick={() => setRenamingId(null)}>{t("common.cancel")}</button>
                    </div>
                  ) : (
                    <div className="ade-mp-device-name">
                      <strong>{device.name}</strong>
                      <span className="ade-pill">{device.platform === "ios" ? "iOS" : device.platform === "android" ? "Android" : t("mobile.web")}</span>
                    </div>
                  )}
                  <div className="ade-mp-device-meta">
                    {t("mobile.deviceMeta", { seen: relative(device.lastSeenAt, now), ip: device.lastIp, paired: formatDay(device.pairedAt) })}
                  </div>
                </div>
                <div className="ade-mp-device-actions">
                  <button
                    type="button"
                    className="ade-icon-btn"
                    title={t("mobile.rename", { name: device.name })}
                    aria-label={t("mobile.rename", { name: device.name })}
                    onClick={() => { setRenamingId(device.id); setRenameDraft(device.name) }}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="ade-btn ade-btn-danger ade-btn-xs"
                    onClick={() => void handleRevokeDevice(device.id)}
                  >
                    <Trash2 className="size-3" /> {t("mobile.revoke")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
