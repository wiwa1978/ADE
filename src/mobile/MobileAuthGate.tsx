import { useState, type FormEvent } from "react"
import { AlertTriangle, CheckCircle2, Loader2, QrCode, ShieldCheck, Smartphone } from "lucide-react"
import { request } from "../../api"

export type MobileSessionState = {
  mobileBridge: boolean
  hostName: string
  paired: boolean
  device: {
    id: string
    name: string
    platform: "ios" | "android" | "web"
    pairedAt: number
  } | null
}

export function MobileAuthGate({
  hostName,
  pairError,
  onPaired,
}: {
  hostName: string
  pairError?: string | null
  onPaired: () => void
}) {
  const [code, setCode] = useState("")
  const [deviceName, setDeviceName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(
    pairError === "expired"
      ? "That QR code has already been used or expired. Scan a fresh QR code or enter the 6-digit code shown in ADE."
      : "",
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const clean = code.trim()
    if (!clean) return
    setSubmitting(true)
    setError("")
    try {
      await request("/api/mobile/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: clean, ...(deviceName.trim() ? { deviceName: deviceName.trim() } : {}) }),
      })
      onPaired()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pair this device.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="ade-mobile-gate" aria-label="Pair device with ADE">
      <div className="ade-mobile-gate-card">
        <div className="ade-mobile-gate-icon">
          <Smartphone className="size-6" />
        </div>
        <h1>Pair with {hostName || "ADE"}</h1>
        <p className="ade-mobile-gate-sub">
          Open <strong>Settings → Phone &amp; Mobile</strong> in ADE on your computer and scan the QR code, or enter the 6-digit code below.
        </p>

        {error ? (
          <div className="ade-mobile-gate-error" role="alert">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <form className="ade-mobile-gate-form" onSubmit={e => void handleSubmit(e)}>
          <label className="ade-mobile-gate-label">
            <span>6-digit pairing code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="482-915"
              value={code}
              onChange={e => setCode(e.target.value)}
              className="ade-mobile-gate-input ade-mono"
              aria-label="6-digit pairing code"
            />
          </label>
          <label className="ade-mobile-gate-label">
            <span>Device name (optional)</span>
            <input
              type="text"
              placeholder="e.g. Wim's iPhone"
              value={deviceName}
              onChange={e => setDeviceName(e.target.value)}
              className="ade-mobile-gate-input"
              aria-label="Device name"
            />
          </label>
          <button type="submit" className="ade-btn ade-btn-primary ade-mobile-gate-btn" disabled={submitting || !code.trim()}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {submitting ? "Pairing…" : "Connect this device"}
          </button>
        </form>

        <div className="ade-mobile-gate-footer">
          <span><QrCode className="size-3.5" /> Single-use 5 min codes</span>
          <span><ShieldCheck className="size-3.5" /> Revocable anytime</span>
        </div>
      </div>
    </main>
  )
}
