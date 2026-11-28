import { useCallback, useEffect, useState, type FormEvent } from "react"
import { ArrowLeft, ClipboardPaste, Link2, RefreshCw, Terminal, X, type LucideIcon } from "lucide-react"
import { Badge, Banner, Button, IconButton, Input, SettingsRow, SettingsSection, StatusPill, useEscapeKey } from "@/components/ui"
import type { EnvironmentDirectory, EnvironmentSummary } from "./app-types"
import { getCaptainEndpoint, request, setCaptainEndpoint } from "./api"
import { useI18n } from "./i18n/I18nContext"
import { usePolling } from "./hooks/usePolling"

type AddMode = "choose" | "direct" | "ssh" | "pairing"

const ADD_MODES: readonly {
  id: Exclude<AddMode, "choose">
  titleKey: "env.direct" | "env.remoteSsh" | "env.pasteLink"
  subtitleKey: "env.directShort" | "env.sshShort" | "env.pairingShort"
  detailKey: "env.directLong" | "env.sshLong" | "env.pairingLong"
  icon: LucideIcon
}[] = [
  { id: "direct", titleKey: "env.direct", subtitleKey: "env.directShort", detailKey: "env.directLong", icon: Link2 },
  { id: "ssh", titleKey: "env.remoteSsh", subtitleKey: "env.sshShort", detailKey: "env.sshLong", icon: Terminal },
  { id: "pairing", titleKey: "env.pasteLink", subtitleKey: "env.pairingShort", detailKey: "env.pairingLong", icon: ClipboardPaste },
]

const postJson = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

export function EnvironmentSettings({
  onEnvironmentChanged,
  disabled = false,
  autoOpenAdd = false,
  embedded = false,
}: {
  onEnvironmentChanged: (activeId: string, activeName: string, directory: EnvironmentDirectory) => void
  disabled?: boolean
  autoOpenAdd?: boolean
  embedded?: boolean
}) {
  const { t } = useI18n()
  const [data, setData] = useState<EnvironmentDirectory | null>(null)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [modalState, setModalState] = useState<{ base: boolean; open: boolean; mode: AddMode }>({ base: autoOpenAdd, open: autoOpenAdd, mode: "choose" })
  const addOpen = modalState.base === autoOpenAdd ? modalState.open : autoOpenAdd
  const addMode: AddMode = modalState.base === autoOpenAdd ? modalState.mode : "choose"
  const setModal = (open: boolean, mode: AddMode = addMode) => setModalState({ base: autoOpenAdd, open, mode })

  const [name, setName] = useState("")
  const [sshHost, setSshHost] = useState("")
  const [sshPort, setSshPort] = useState("22")
  const [remotePort, setRemotePort] = useState("4319")
  const [sshConfigPath, setSshConfigPath] = useState("")
  const [sshScan, setSshScan] = useState<{
    configPath: string
    defaultPath: string
    exists: boolean
    hosts: Array<{ alias: string; hostName?: string; user?: string; port?: number }>
  } | null>(null)
  const [scanningSsh, setScanningSsh] = useState(false)
  const [directUrl, setDirectUrl] = useState(() => getCaptainEndpoint().baseUrl || "")
  const [directToken, setDirectToken] = useState(() => getCaptainEndpoint().authToken || "")
  const [pairingLink, setPairingLink] = useState("")

  const scanSshHosts = useCallback(async (customPath?: string) => {
    setScanningSsh(true)
    try {
      const q = customPath?.trim() ? `?configPath=${encodeURIComponent(customPath.trim())}` : ""
      const res = await request<{
        configPath: string
        defaultPath: string
        exists: boolean
        hosts: Array<{ alias: string; hostName?: string; user?: string; port?: number }>
      }>(`/api/environments/ssh-hosts${q}`)
      setSshScan(res)
    } catch {
      setSshScan(null)
    } finally {
      setScanningSsh(false)
    }
  }, [])

  useEffect(() => {
    if (!addOpen || addMode !== "ssh") return
    let cancelled = false
    const q = sshConfigPath.trim() ? `?configPath=${encodeURIComponent(sshConfigPath.trim())}` : ""
    void request<{
      configPath: string
      defaultPath: string
      exists: boolean
      hosts: Array<{ alias: string; hostName?: string; user?: string; port?: number }>
    }>(`/api/environments/ssh-hosts${q}`)
      .then(res => { if (!cancelled) setSshScan(res) })
      .catch(() => { if (!cancelled) setSshScan(null) })
    return () => { cancelled = true }
  }, [addOpen, addMode, sshConfigPath])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await request<EnvironmentDirectory>("/api/environments", { signal })
      setData(result)
      return result
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t("env.loadError"))
      return null
    }
  }, [t])

  usePolling(useCallback(async signal => { await refresh(signal) }, [refresh]), 5_000)
  useEscapeKey(() => setModal(false), addOpen)

  async function notifyChanged(result: EnvironmentDirectory) {
    const updated = await refresh()
    const activeName = updated?.environments.find(item => item.id === result.activeId)?.name
      ?? (result.activeId === "local" ? "This computer" : result.activeId)
    onEnvironmentChanged(result.activeId, activeName, updated ?? result)
  }

  async function activate(env: EnvironmentSummary) {
    setBusy(env.id); setError(""); setNotice("")
    try {
      const result = env.kind === "ssh" && !env.active
        ? await postJson<EnvironmentDirectory>(`/api/environments/${env.id}/connect`, {})
        : await postJson<EnvironmentDirectory>("/api/environments/active", { id: env.active ? "local" : env.id })
      await notifyChanged(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("env.switchError"))
      await refresh()
    } finally { setBusy("") }
  }

  async function remove(env: EnvironmentSummary) {
    setBusy(env.id); setError("")
    try {
      const result = await request<EnvironmentDirectory>(`/api/environments/${env.id}`, { method: "DELETE" })
      await notifyChanged(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("env.removeError"))
    } finally { setBusy("") }
  }

  async function addSsh(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || disabled) return
    setBusy("new"); setError("")
    try {
      const customConfig = sshConfigPath.trim() && sshConfigPath.trim() !== sshScan?.defaultPath ? sshConfigPath.trim() : undefined
      const result = await postJson<{ environment: EnvironmentSummary }>("/api/environments", {
        name,
        sshHost,
        sshPort: Number(sshPort),
        remotePort: Number(remotePort),
        ...(customConfig ? { sshConfigPath: customConfig } : {}),
      })
      const savedName = result.environment.name
      setName(""); setSshHost("")
      try {
        const connected = await postJson<EnvironmentDirectory>(`/api/environments/${result.environment.id}/connect`, {})
        await notifyChanged(connected)
      } catch (cause) {
        setError(t("env.savedButFailed", { name: savedName, reason: cause instanceof Error ? cause.message : t("env.unknownConnectionError") }))
        await refresh()
      }
      setModal(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("env.addSshError"))
      await refresh()
    } finally { setBusy("") }
  }

  function connectDirect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = directUrl.trim().replace(/\/+$/, "")
    if (!trimmed) { setError(t("env.hostUrlRequired")); return }
    setCaptainEndpoint({ flavor: "remote", baseUrl: trimmed, authToken: directToken.trim() || undefined })
    setNotice(t("env.directSet", { url: trimmed })); setError(""); setModal(false)
  }

  function connectPairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = pairingLink.trim()
    if (!raw) { setError(t("env.pairingLinkRequired")); return }
    try {
      const parsed = new URL(raw)
      const targetUrl = parsed.searchParams.get("url") || (parsed.protocol.startsWith("http") ? `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "") : "")
      if (!targetUrl) throw new Error(t("env.pairingMissingHost"))
      setCaptainEndpoint({ flavor: "remote", baseUrl: targetUrl, authToken: parsed.searchParams.get("token") || undefined })
      setPairingLink(""); setNotice(t("env.pairedVia", { url: targetUrl })); setError(""); setModal(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("env.pairingInvalid"))
    }
  }

  const remoteEndpoint = getCaptainEndpoint()
  const activeModeMeta = ADD_MODES.find(m => m.id === addMode)

  const listContent = embedded ? (
    <>
      {error && !addOpen ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="ok">{notice}</Banner> : null}
      <SettingsSection title={t("settings.environments.hosts")} description={t("env.subtitle")}>
        {remoteEndpoint.flavor === "remote" && remoteEndpoint.baseUrl ? (
          <SettingsRow title={t("env.remoteHost")} description={remoteEndpoint.baseUrl}>
            <StatusPill tone="ok">{t("env.remoteActive")}</StatusPill>
            <Button variant="outline" size="sm" onClick={() => { setCaptainEndpoint({ flavor: "local", baseUrl: "" }); setNotice(t("env.switchedLocal")) }}>{t("common.disconnect")}</Button>
          </SettingsRow>
        ) : null}
        {data?.environments.map(env => (
          <SettingsRow
            key={env.id}
            title={env.name}
            description={env.kind === "local" ? t("env.localDescription") : t("env.sshDescription", { host: env.sshHost ?? "", port: env.sshPort ?? "", remotePort: env.remotePort ?? "" })}
          >
            {env.active ? (
              <StatusPill tone="ok">{t("env.active")}</StatusPill>
            ) : env.status === "error" ? (
              <StatusPill tone="error">{t("env.retryConnection")}</StatusPill>
            ) : null}
            {!(env.kind === "local" && env.active) ? (
              <Button variant={env.active ? "outline" : "primary"} size="sm" loading={busy === env.id} disabled={disabled || Boolean(busy)} onClick={() => void activate(env)}>
                {busy === env.id ? t("env.connecting") : env.active ? t("common.disconnect") : env.status === "error" ? t("env.retryConnection") : t("common.connect")}
              </Button>
            ) : null}
            {env.kind === "ssh" ? <Button variant="ghost" size="sm" disabled={disabled || Boolean(busy)} onClick={() => void remove(env)}>{t("common.remove")}</Button> : null}
          </SettingsRow>
        ))}
        {!data && !error ? <SettingsRow title={t("env.loading")} /> : null}
        <SettingsRow title={t("env.addTitle")} description={t("env.addHint")}>
          <Button variant="secondary" size="sm" disabled={disabled || Boolean(busy)} onClick={() => { setError(""); setModal(true, "choose") }}>{t("env.addHost")}</Button>
        </SettingsRow>
      </SettingsSection>
    </>
  ) : (
    <>
      <div className="section-title"><h2>{t("env.title")}</h2><p>{t("env.subtitle")}</p></div>
      {error && !addOpen ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="ok">{notice}</Banner> : null}

      {remoteEndpoint.flavor === "remote" && remoteEndpoint.baseUrl ? (
        <div className="environment-card active mb-2.5">
          <div className="environment-card-main">
            <span className="environment-status connected" />
            <div className="environment-copy"><strong>{t("env.remoteHost")}</strong><small>{remoteEndpoint.baseUrl}</small></div>
            <Badge tone="accent" size="sm">{t("env.remoteActive")}</Badge>
          </div>
          <div className="environment-actions">
            <Button variant="outline" size="sm" onClick={() => { setCaptainEndpoint({ flavor: "local", baseUrl: "" }); setNotice(t("env.switchedLocal")) }}>{t("common.disconnect")}</Button>
          </div>
        </div>
      ) : null}

      <div className="environment-list">
        {data?.environments.map(env => (
          <article className={`environment-card${env.active ? " active" : ""}`} key={env.id}>
            <div className="environment-card-main">
              <span className={`environment-status ${env.status}`} aria-label={env.status} />
              <div className="environment-copy">
                <strong>{env.name}</strong>
                <small>{env.kind === "local" ? t("env.localDescription") : t("env.sshDescription", { host: env.sshHost ?? "", port: env.sshPort ?? "", remotePort: env.remotePort ?? "" })}</small>
              </div>
              {env.active ? <Badge tone="ok" size="sm">{t("env.active")}</Badge> : null}
            </div>
            <div className="environment-actions">
              {!(env.kind === "local" && env.active) ? (
                <Button variant={env.active ? "outline" : "primary"} size="sm" loading={busy === env.id} disabled={disabled || Boolean(busy)} onClick={() => void activate(env)}>
                  {busy === env.id ? t("env.connecting") : env.active ? t("common.disconnect") : env.status === "error" ? t("env.retryConnection") : t("common.connect")}
                </Button>
              ) : null}
              {env.kind === "ssh" ? <Button variant="ghost" size="sm" disabled={disabled || Boolean(busy)} onClick={() => void remove(env)}>{t("common.remove")}</Button> : null}
            </div>
          </article>
        ))}
        {!data && !error ? <p className="hint">{t("env.loading")}</p> : null}
      </div>

      <div className="environment-add-row">
        <div><strong>{t("env.addTitle")}</strong><p className="hint">{t("env.addHint")}</p></div>
        <Button variant="outline" size="sm" disabled={disabled || Boolean(busy)} onClick={() => { setError(""); setModal(true, "choose") }}>{t("env.addHost")}</Button>
      </div>
    </>
  )

  return (
    <section className={embedded ? undefined : "settings-section environment-settings"}>
      {listContent}

      {addOpen ? (
        <div className="environment-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setModal(false) }}>
          <section className="environment-modal" role="dialog" aria-modal="true" aria-labelledby="environment-modal-title">
            <header>
              <div className="flex items-center gap-2">
                {addMode !== "choose" ? <IconButton aria-label={t("common.back")} onClick={() => { setError(""); setModal(true, "choose") }}><ArrowLeft size={15} /></IconButton> : null}
                <div>
                  <h3 id="environment-modal-title">{activeModeMeta ? t(activeModeMeta.titleKey) : t("env.addConnection")}</h3>
                  {activeModeMeta ? <p>{t(activeModeMeta.detailKey)}</p> : null}
                </div>
              </div>
              <IconButton aria-label={t("env.closeDialog")} onClick={() => setModal(false)}><X size={15} /></IconButton>
            </header>

            {addMode === "choose" ? (
              <div className="environment-form gap-2.5">
                {ADD_MODES.map(({ id, titleKey, subtitleKey, icon: Icon }) => (
                  <button key={id} type="button" className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:border-[rgb(var(--primary)/0.6)] text-left transition-colors cursor-pointer" onClick={() => { setError(""); setModal(true, id) }}>
                    <Icon size={18} className="opacity-80 shrink-0" />
                    <div><div className="text-[13.5px] font-semibold">{t(titleKey)}</div><div className="mt-0.5 text-xs text-[rgb(var(--muted))]">{t(subtitleKey)}</div></div>
                  </button>
                ))}
              </div>
            ) : addMode === "direct" ? (
              <form className="environment-form" onSubmit={connectDirect}>
                <label>{t("env.hostUrl")}<Input autoFocus value={directUrl} onChange={e => setDirectUrl(e.target.value)} placeholder={t("env.hostUrlPlaceholder")} required /></label>
                <label>{t("env.bearerToken")}<Input type="password" value={directToken} onChange={e => setDirectToken(e.target.value)} placeholder={t("env.bearerPlaceholder")} /></label>
                {error ? <Banner tone="error">{error}</Banner> : null}
                <div className="form-actions"><Button variant="outline" onClick={() => setModal(false)}>{t("common.cancel")}</Button><Button type="submit" variant="primary" disabled={!directUrl.trim()}>{t("env.connectHost")}</Button></div>
              </form>
            ) : addMode === "pairing" ? (
              <form className="environment-form" onSubmit={connectPairing}>
                <label>{t("env.pairingLink")}<Input autoFocus value={pairingLink} onChange={e => setPairingLink(e.target.value)} placeholder="ade://pair?url=https://...&token=..." required /></label>
                {error ? <Banner tone="error">{error}</Banner> : null}
                <div className="form-actions"><Button variant="outline" onClick={() => setModal(false)}>{t("common.cancel")}</Button><Button type="submit" variant="primary" disabled={!pairingLink.trim()}>{t("env.pairAndConnect")}</Button></div>
              </form>
            ) : (
              <form className="environment-form" onSubmit={addSsh}>
                <p className="hint">{t("env.sshHint")}</p>
                <label>
                  SSH config file
                  <div style={{ display: "flex", gap: "0.45rem", alignItems: "center" }}>
                    <Input
                      value={sshConfigPath}
                      onChange={e => setSshConfigPath(e.target.value)}
                      placeholder={sshScan?.defaultPath || "~/.ssh/config"}
                      disabled={disabled || Boolean(busy)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={scanningSsh}
                      disabled={disabled || Boolean(busy)}
                      onClick={() => void scanSshHosts(sshConfigPath)}
                    >
                      <RefreshCw size={13} /> Scan
                    </Button>
                  </div>
                </label>
                {sshScan ? (
                  <label>
                    Pick from SSH config ({sshScan.hosts.length} found)
                    <select
                      className="st-select"
                      aria-label="Pick from SSH config"
                      value={sshScan.hosts.some(h => h.alias === sshHost) ? sshHost : ""}
                      disabled={disabled || Boolean(busy) || sshScan.hosts.length === 0}
                      onChange={event => {
                        const alias = event.target.value
                        if (!alias) return
                        const match = sshScan.hosts.find(h => h.alias === alias)
                        setSshHost(alias)
                        if (!name.trim()) setName(alias)
                        if (match?.port) setSshPort(String(match.port))
                      }}
                    >
                      <option value="">
                        {sshScan.hosts.length
                          ? "Select a host from SSH config…"
                          : sshScan.exists
                            ? "No named Host entries found in this config"
                            : `Config file not found (${sshScan.configPath})`}
                      </option>
                      {sshScan.hosts.map(host => {
                        const detail = [host.user ? `${host.user}@${host.hostName ?? ""}` : host.hostName, host.port && host.port !== 22 ? `:${host.port}` : ""].filter(Boolean).join("")
                        return (
                          <option key={host.alias} value={host.alias}>
                            {host.alias}{detail ? ` (${detail})` : ""}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                ) : null}
                <label>{t("env.envName")}<Input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={64} placeholder="HOME-DEVELOPMENT" required disabled={disabled || Boolean(busy)} /></label>
                <label>{t("env.sshHost")}<Input value={sshHost} onChange={e => setSshHost(e.target.value)} maxLength={255} placeholder={t("env.sshHostPlaceholder")} required disabled={disabled || Boolean(busy)} /></label>
                <div className="environment-ports">
                  <label>{t("env.sshPort")}<Input type="number" min="1" max="65535" value={sshPort} onChange={e => setSshPort(e.target.value)} required disabled={disabled || Boolean(busy)} /></label>
                  <label>{t("env.runtimePort")}<Input type="number" min="1" max="65535" value={remotePort} onChange={e => setRemotePort(e.target.value)} required disabled={disabled || Boolean(busy)} /></label>
                </div>
                {error ? <Banner tone="error">{error}</Banner> : null}
                <div className="form-actions"><Button variant="outline" disabled={Boolean(busy)} onClick={() => setModal(false)}>{t("common.cancel")}</Button><Button type="submit" variant="primary" loading={busy === "new"} disabled={disabled || Boolean(busy) || !name.trim() || !sshHost.trim()}>{busy === "new" ? t("env.connecting") : t("env.addAndConnect")}</Button></div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </section>
  )
}
