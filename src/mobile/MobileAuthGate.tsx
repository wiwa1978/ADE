import { useState, type FormEvent } from "react"
import { AlertTriangle, CheckCircle2, Loader2, QrCode, ShieldCheck, Smartphone } from "lucide-react"
import { requestJson } from "../api"
import { useI18n } from "../i18n/I18nContext"

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
  const { t } = useI18n()
  const [code, setCode] = useState("")
  const [deviceName, setDeviceName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(
    pairError === "expired"
      ? t("mobile.auth.expiredError")
      : "",
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const clean = code.trim()
    if (!clean) return
    setSubmitting(true)
    setError("")
    try {
      await requestJson("/api/mobile/claim", "POST", { code: clean, ...(deviceName.trim() ? { deviceName: deviceName.trim() } : {}) })
      onPaired()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mobile.auth.pairError"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="ade-mobile-gate" aria-label={t("mobile.auth.aria")}>
      <div className="ade-mobile-gate-card">
        <div className="ade-mobile-gate-icon">
          <Smartphone className="size-6" />
        </div>
        <h1>{t("mobile.auth.title", { host: hostName || "ADE" })}</h1>
        <p className="ade-mobile-gate-sub">
          {t("mobile.auth.subtitle")}
        </p>

        {error ? (
          <div className="ade-mobile-gate-error" role="alert">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <form className="ade-mobile-gate-form" onSubmit={e => void handleSubmit(e)}>
          <label className="ade-mobile-gate-label">
            <span>{t("mobile.auth.codeLabel")}</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="482-915"
              value={code}
              onChange={e => setCode(e.target.value)}
              className="ade-mobile-gate-input ade-mono"
              aria-label={t("mobile.auth.codeLabel")}
            />
          </label>
          <label className="ade-mobile-gate-label">
            <span>{t("mobile.auth.deviceNameLabel")}</span>
            <input
              type="text"
              placeholder={t("mobile.auth.deviceNamePlaceholder")}
              value={deviceName}
              onChange={e => setDeviceName(e.target.value)}
              className="ade-mobile-gate-input"
              aria-label={t("mobile.auth.deviceNameAria")}
            />
          </label>
          <button type="submit" className="ade-btn ade-btn-primary ade-mobile-gate-btn" disabled={submitting || !code.trim()}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {submitting ? t("mobile.auth.connecting") : t("mobile.auth.connect")}
          </button>
        </form>

        <div className="ade-mobile-gate-footer">
          <span><QrCode className="size-3.5" /> {t("mobile.auth.singleUse")}</span>
          <span><ShieldCheck className="size-3.5" /> {t("mobile.auth.revocable")}</span>
        </div>
      </div>
    </main>
  )
}
