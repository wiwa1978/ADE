import { useCallback, useEffect, useState, type FormEvent } from "react"
import { ArrowLeft, ClipboardPaste, Link2, Terminal, X } from "lucide-react"
import type { EnvironmentDirectory, EnvironmentSummary } from "./app-types"
import { getCaptainEndpoint, request, setCaptainEndpoint } from "./api"
import { useI18n } from "./src/i18n/I18nContext"

type Environment = EnvironmentSummary
type EnvironmentList = EnvironmentDirectory
type AddMode = "choose" | "direct" | "ssh" | "pairing"

export function EnvironmentSettings({
  onEnvironmentChanged,
  disabled = false,
  autoOpenAdd = false,
}: {
  onEnvironmentChanged: (activeId: string, activeName: string, directory: EnvironmentDirectory) => void
  disabled?: boolean
  autoOpenAdd?: boolean
}) {
  const { t } = useI18n()
  const [data, setData] = useState<EnvironmentList | null>(null)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const [addOpen, setAddOpen] = useState(autoOpenAdd)
  const [prevAutoOpenAdd, setPrevAutoOpenAdd] = useState(autoOpenAdd)
  const [addMode, setAddMode] = useState<AddMode>("choose")

  if (autoOpenAdd !== prevAutoOpenAdd) {
    setPrevAutoOpenAdd(autoOpenAdd)
    if (autoOpenAdd) {
      setAddMode("choose")
      setAddOpen(true)
    }
  }

  // SSH fields
  const [name, setName] = useState("")
  const [sshHost, setSshHost] = useState("")
  const [sshPort, setSshPort] = useState("22")
  const [remotePort, setRemotePort] = useState("4319")

  // Direct connection fields (Local network / VPN / Remote Captain)
  const [directUrl, setDirectUrl] = useState(() => getCaptainEndpoint().baseUrl || "")
  const [directToken, setDirectToken] = useState(() => getCaptainEndpoint().authToken || "")

  // Pairing link field
  const [pairingLink, setPairingLink] = useState("")

  const refresh = useCallback(async () => {
    try {
      const result = await request<EnvironmentList>("/api/environments")
      setData(result)
      return result
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("env.loadError"))
      return null
    }
  }, [t])

  useEffect(() => {
    if (!addOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [addOpen])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await request<EnvironmentList>("/api/environments")
        if (active) setData(result)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : t("env.loadError"))
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [t])

  async function activate(environment: Environment) {
    setBusy(environment.id)
    setError("")
    setNotice("")
    try {
      const result = environment.kind === "ssh" && !environment.active
        ? await request<EnvironmentList>(`/api/environments/${environment.id}/connect`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
        })
        : await request<EnvironmentList>("/api/environments/active", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: environment.active ? "local" : environment.id }),
        })
      const updated = await refresh()
      const activeName = updated?.environments.find(item => item.id === result.activeId)?.name ?? (result.activeId === "local" ? "This computer" : result.activeId)
      onEnvironmentChanged(result.activeId, activeName, updated ?? result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("env.switchError"))
      await refresh()
    } finally {
      setBusy("")
    }
  }

  async function remove(environment: Environment) {
    setBusy(environment.id)
    setError("")
    try {
      const result = await request<EnvironmentList>(`/api/environments/${environment.id}`, { method: "DELETE" })
      const updated = await refresh()
      const activeName = updated?.environments.find(item => item.id === result.activeId)?.name ?? "This computer"
      onEnvironmentChanged(result.activeId, activeName, updated ?? result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("env.removeError"))
    } finally {
      setBusy("")
    }
  }

  async function addSsh(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || disabled) return
    setBusy("new")
    setError("")
    try {
      const result = await request<{ environment: Environment }>("/api/environments", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, sshHost, sshPort: Number(sshPort), remotePort: Number(remotePort) }),
      })
      const savedName = result.environment.name
      setName("")
      setSshHost("")
      try {
        const connected = await request<EnvironmentList>(`/api/environments/${result.environment.id}/connect`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
        })
        const updated = await refresh()
        const activeName = updated?.environments.find(item => item.id === connected.activeId)?.name ?? connected.activeId
        onEnvironmentChanged(connected.activeId, activeName, updated ?? connected)
        setAddOpen(false)
      } catch (cause) {
        setError(t("env.savedButFailed", { name: savedName, reason: cause instanceof Error ? cause.message : t("env.unknownConnectionError") }))
        await refresh()
        setAddOpen(false)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("env.addSshError"))
      await refresh()
    } finally {
      setBusy("")
    }
  }

  function connectDirect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = directUrl.trim().replace(/\/+$/, "")
    if (!trimmed) {
      setError(t("env.hostUrlRequired"))
      return
    }
    setCaptainEndpoint({
      flavor: "remote",
      baseUrl: trimmed,
      authToken: directToken.trim() || undefined,
    })
    setNotice(t("env.directSet", { url: trimmed }))
    setError("")
    setAddOpen(false)
  }

  function connectPairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = pairingLink.trim()
    if (!raw) {
      setError(t("env.pairingLinkRequired"))
      return
    }
    try {
      const parsed = new URL(raw)
      const targetUrl = parsed.searchParams.get("url") || (parsed.protocol.startsWith("http") ? `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "") : "")
      const token = parsed.searchParams.get("token") || ""
      if (!targetUrl) throw new Error(t("env.pairingMissingHost"))
      setCaptainEndpoint({
        flavor: "remote",
        baseUrl: targetUrl,
        authToken: token || undefined,
      })
      setPairingLink("")
      setNotice(t("env.pairedVia", { url: targetUrl }))
      setError("")
      setAddOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("env.pairingInvalid"))
    }
  }

  const remoteEndpoint = getCaptainEndpoint()

  return <section className="settings-section environment-settings">
    <div className="section-title"><h2>{t("env.title")}</h2><p>{t("env.subtitle")}</p></div>
    {error && !addOpen && <p className="error environment-error" role="alert">{error}</p>}
    {notice && <p className="runtime-notice ready" role="status">{notice}</p>}

    {remoteEndpoint.flavor === "remote" && remoteEndpoint.baseUrl ? (
      <div className="environment-card active" style={{ marginBottom: 10 }}>
        <div className="environment-card-main">
          <span className="environment-status connected" />
          <div className="environment-copy">
            <strong>{t("env.remoteHost")}</strong>
            <small>{remoteEndpoint.baseUrl}</small>
          </div>
          <span className="environment-active-label">{t("env.remoteActive")}</span>
        </div>
        <div className="environment-actions">
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              setCaptainEndpoint({ flavor: "local", baseUrl: "" })
              setNotice(t("env.switchedLocal"))
            }}
          >
            {t("common.disconnect")}
          </button>
        </div>
      </div>
    ) : null}

    <div className="environment-list">
      {data?.environments.map(environment => <article className={`environment-card${environment.active ? " active" : ""}`} key={environment.id}>
        <div className="environment-card-main">
          <span className={`environment-status ${environment.status}`} aria-label={environment.status} />
          <div className="environment-copy"><strong>{environment.name}</strong><small>{environment.kind === "local" ? t("env.localDescription") : t("env.sshDescription", { host: environment.sshHost ?? "", port: environment.sshPort ?? "", remotePort: environment.remotePort ?? "" })}</small></div>
          {environment.active && <span className="environment-active-label">{t("env.active")}</span>}
        </div>
        <div className="environment-actions">
          {!(environment.kind === "local" && environment.active) && <button type="button" className={environment.active ? "quiet-button" : "action-button"} disabled={disabled || Boolean(busy)} onClick={() => void activate(environment)}>
            {busy === environment.id ? t("env.connecting") : environment.active ? t("common.disconnect") : environment.status === "error" ? t("env.retryConnection") : t("common.connect")}
          </button>}
          {environment.kind === "ssh" && <button type="button" className="text-button environment-remove" disabled={disabled || Boolean(busy)} onClick={() => void remove(environment)}>{t("common.remove")}</button>}
        </div>
      </article>)}
      {!data && !error && <p className="hint">{t("env.loading")}</p>}
    </div>

    <div className="environment-add-row">
      <div><strong>{t("env.addTitle")}</strong><p className="hint">{t("env.addHint")}</p></div>
      <button type="button" className="quiet-button" disabled={disabled || Boolean(busy)} onClick={() => { setError(""); setAddMode("choose"); setAddOpen(true) }}>{t("env.addHost")}</button>
    </div>

    {addOpen && <div className="environment-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAddOpen(false) }}>
      <section className="environment-modal" role="dialog" aria-modal="true" aria-labelledby="environment-modal-title">
        <header>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {addMode !== "choose" ? (
              <button type="button" className="icon-button" aria-label={t("common.back")} onClick={() => { setError(""); setAddMode("choose") }}>
                <ArrowLeft size={15} />
              </button>
            ) : null}
            <div>
              <h3 id="environment-modal-title">
                {addMode === "choose" ? t("env.addConnection") : addMode === "direct" ? t("env.direct") : addMode === "ssh" ? t("env.remoteSsh") : t("env.pasteLink")}
              </h3>
              {addMode !== "choose" ? (
                <p>
                  {addMode === "direct" ? t("env.directLong") : addMode === "ssh" ? t("env.sshLong") : t("env.pairingLong")}
                </p>
              ) : null}
            </div>
          </div>
          <button type="button" className="icon-button" aria-label={t("env.closeDialog")} onClick={() => setAddOpen(false)}><X size={15} /></button>
        </header>

        {addMode === "choose" ? (
          <div className="environment-form" style={{ gap: 10 }}>
            <button
              type="button"
              className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:border-[rgb(var(--primary)/0.6)] text-left transition-colors cursor-pointer"
              onClick={() => { setError(""); setAddMode("direct") }}
            >
              <Link2 size={18} className="opacity-80 shrink-0" />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("env.direct")}</div>
                <div style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 2 }}>{t("env.directShort")}</div>
              </div>
            </button>

            <button
              type="button"
              className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:border-[rgb(var(--primary)/0.6)] text-left transition-colors cursor-pointer"
              onClick={() => { setError(""); setAddMode("ssh") }}
            >
              <Terminal size={18} className="opacity-80 shrink-0" />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("env.remoteSsh")}</div>
                <div style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 2 }}>{t("env.sshShort")}</div>
              </div>
            </button>

            <button
              type="button"
              className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:border-[rgb(var(--primary)/0.6)] text-left transition-colors cursor-pointer"
              onClick={() => { setError(""); setAddMode("pairing") }}
            >
              <ClipboardPaste size={18} className="opacity-80 shrink-0" />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("env.pasteLink")}</div>
                <div style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 2 }}>{t("env.pairingShort")}</div>
              </div>
            </button>
          </div>
        ) : addMode === "direct" ? (
          <form className="environment-form" onSubmit={connectDirect}>
            <label>{t("env.hostUrl")}<input autoFocus value={directUrl} onChange={e => setDirectUrl(e.target.value)} placeholder={t("env.hostUrlPlaceholder")} required /></label>
            <label>{t("env.bearerToken")}<input type="password" value={directToken} onChange={e => setDirectToken(e.target.value)} placeholder={t("env.bearerPlaceholder")} /></label>
            {error && <p className="error environment-error" role="alert">{error}</p>}
            <div className="form-actions"><button type="button" className="quiet-button" onClick={() => setAddOpen(false)}>{t("common.cancel")}</button><button className="action-button" disabled={!directUrl.trim()}>{t("env.connectHost")}</button></div>
          </form>
        ) : addMode === "pairing" ? (
          <form className="environment-form" onSubmit={connectPairing}>
            <label>{t("env.pairingLink")}<input autoFocus value={pairingLink} onChange={e => setPairingLink(e.target.value)} placeholder="ade://pair?url=https://...&token=..." required /></label>
            {error && <p className="error environment-error" role="alert">{error}</p>}
            <div className="form-actions"><button type="button" className="quiet-button" onClick={() => setAddOpen(false)}>{t("common.cancel")}</button><button className="action-button" disabled={!pairingLink.trim()}>{t("env.pairAndConnect")}</button></div>
          </form>
        ) : (
          <form className="environment-form" onSubmit={addSsh}>
            <p className="hint">{t("env.sshHint")}</p>
            <label>{t("env.envName")}<input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={64} placeholder="HOME-DEVELOPMENT" required disabled={disabled || Boolean(busy)} /></label>
            <label>{t("env.sshHost")}<input value={sshHost} onChange={event => setSshHost(event.target.value)} maxLength={255} placeholder={t("env.sshHostPlaceholder")} required disabled={disabled || Boolean(busy)} /></label>
            <div className="environment-ports">
              <label>{t("env.sshPort")}<input type="number" min="1" max="65535" value={sshPort} onChange={event => setSshPort(event.target.value)} required disabled={disabled || Boolean(busy)} /></label>
              <label>{t("env.runtimePort")}<input type="number" min="1" max="65535" value={remotePort} onChange={event => setRemotePort(event.target.value)} required disabled={disabled || Boolean(busy)} /></label>
            </div>
            {error && <p className="error environment-error" role="alert">{error}</p>}
            <div className="form-actions"><button type="button" className="quiet-button" disabled={Boolean(busy)} onClick={() => setAddOpen(false)}>{t("common.cancel")}</button><button className="action-button" disabled={disabled || Boolean(busy) || !name.trim() || !sshHost.trim()}>{busy === "new" ? t("env.connecting") : t("env.addAndConnect")}</button></div>
          </form>
        )}
      </section>
    </div>}
  </section>
}
