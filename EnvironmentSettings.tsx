import { useCallback, useState, type FormEvent } from "react"
import { ArrowLeft, ClipboardPaste, Link2, Terminal, X, type LucideIcon } from "lucide-react"
import { Badge, Banner, Button, IconButton, Input, useEscapeKey } from "@/components/ui"
import type { EnvironmentDirectory, EnvironmentSummary } from "./app-types"
import { getCaptainEndpoint, request, setCaptainEndpoint } from "./api"
import { usePolling } from "./src/hooks/usePolling"

type AddMode = "choose" | "direct" | "ssh" | "pairing"

const ADD_MODES: readonly { id: Exclude<AddMode, "choose">; title: string; subtitle: string; detail: string; icon: LucideIcon }[] = [
  { id: "direct", title: "Direct connection", subtitle: "Local network or VPN.", detail: "Connect to an ADE runtime on your local network, Tailscale, or EU cloud host.", icon: Link2 },
  { id: "ssh", title: "Remote SSH", subtitle: "Connect through the desktop SSH client.", detail: "Connect an ADE runtime through your desktop SSH client.", icon: Terminal },
  { id: "pairing", title: "Paste pairing link", subtitle: "Encrypted relay connection.", detail: "Paste an encrypted relay pairing link from another ADE host.", icon: ClipboardPaste },
]

const postJson = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

export function EnvironmentSettings({
  onEnvironmentChanged,
  disabled = false,
  autoOpenAdd = false,
}: {
  onEnvironmentChanged: (activeId: string, activeName: string, directory: EnvironmentDirectory) => void
  disabled?: boolean
  autoOpenAdd?: boolean
}) {
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
  const [directUrl, setDirectUrl] = useState(() => getCaptainEndpoint().baseUrl || "")
  const [directToken, setDirectToken] = useState(() => getCaptainEndpoint().authToken || "")
  const [pairingLink, setPairingLink] = useState("")

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await request<EnvironmentDirectory>("/api/environments", { signal })
      setData(result)
      return result
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load environments.")
      return null
    }
  }, [])

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
      setError(cause instanceof Error ? cause.message : "Could not switch environments.")
      await refresh()
    } finally { setBusy("") }
  }

  async function remove(env: EnvironmentSummary) {
    setBusy(env.id); setError("")
    try {
      const result = await request<EnvironmentDirectory>(`/api/environments/${env.id}`, { method: "DELETE" })
      await notifyChanged(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the environment.")
    } finally { setBusy("") }
  }

  async function addSsh(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || disabled) return
    setBusy("new"); setError("")
    try {
      const result = await postJson<{ environment: EnvironmentSummary }>("/api/environments", {
        name, sshHost, sshPort: Number(sshPort), remotePort: Number(remotePort),
      })
      setName(""); setSshHost("")
      try {
        const connected = await postJson<EnvironmentDirectory>(`/api/environments/${result.environment.id}/connect`, {})
        await notifyChanged(connected)
      } catch (cause) {
        setError(`${result.environment.name} was saved, but the connection failed: ${cause instanceof Error ? cause.message : "Unknown connection error."}`)
        await refresh()
      }
      setModal(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the SSH environment.")
      await refresh()
    } finally { setBusy("") }
  }

  function connectDirect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = directUrl.trim().replace(/\/+$/, "")
    if (!trimmed) { setError("Enter a host URL (e.g. https://captain.eu.example.com or http://192.168.1.50:4318)."); return }
    setCaptainEndpoint({ flavor: "remote", baseUrl: trimmed, authToken: directToken.trim() || undefined })
    setNotice(`Direct connection set to ${trimmed}.`); setError(""); setModal(false)
  }

  function connectPairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = pairingLink.trim()
    if (!raw) { setError("Paste a pairing link (e.g. ade://pair?url=https://...&token=...)."); return }
    try {
      const parsed = new URL(raw)
      const targetUrl = parsed.searchParams.get("url") || (parsed.protocol.startsWith("http") ? `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "") : "")
      if (!targetUrl) throw new Error("Pairing link is missing a host URL.")
      setCaptainEndpoint({ flavor: "remote", baseUrl: targetUrl, authToken: parsed.searchParams.get("token") || undefined })
      setPairingLink(""); setNotice(`Paired via encrypted relay to ${targetUrl}.`); setError(""); setModal(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid pairing link format.")
    }
  }

  const remoteEndpoint = getCaptainEndpoint()
  const activeModeMeta = ADD_MODES.find(m => m.id === addMode)

  return (
    <section className="settings-section environment-settings">
      <div className="section-title"><h2>Environments</h2><p>Choose where ADE stores sessions, runs the Software Factory, and opens coding workspaces.</p></div>
      {error && !addOpen ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="ok">{notice}</Banner> : null}

      {remoteEndpoint.flavor === "remote" && remoteEndpoint.baseUrl ? (
        <div className="environment-card active mb-2.5">
          <div className="environment-card-main">
            <span className="environment-status connected" />
            <div className="environment-copy"><strong>Remote Captain / Direct Host</strong><small>{remoteEndpoint.baseUrl}</small></div>
            <Badge tone="accent" size="sm">Remote active</Badge>
          </div>
          <div className="environment-actions">
            <Button variant="outline" size="sm" onClick={() => { setCaptainEndpoint({ flavor: "local", baseUrl: "" }); setNotice("Switched back to local host.") }}>Disconnect</Button>
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
                <small>{env.kind === "local" ? "This computer · local ADE runtime" : `SSH · ${env.sshHost}:${env.sshPort} · ADE ${env.remotePort}`}</small>
              </div>
              {env.active ? <Badge tone="ok" size="sm">Active</Badge> : null}
            </div>
            <div className="environment-actions">
              {!(env.kind === "local" && env.active) ? (
                <Button variant={env.active ? "outline" : "primary"} size="sm" loading={busy === env.id} disabled={disabled || Boolean(busy)} onClick={() => void activate(env)}>
                  {busy === env.id ? "Connecting…" : env.active ? "Disconnect" : env.status === "error" ? "Retry connection" : "Connect"}
                </Button>
              ) : null}
              {env.kind === "ssh" ? <Button variant="ghost" size="sm" disabled={disabled || Boolean(busy)} onClick={() => void remove(env)}>Remove</Button> : null}
            </div>
          </article>
        ))}
        {!data && !error ? <p className="hint">Loading environments…</p> : null}
      </div>

      <div className="environment-add-row">
        <div><strong>Add an environment</strong><p className="hint">Connect via Direct LAN/VPN URL, Remote SSH, or an encrypted pairing link.</p></div>
        <Button variant="outline" size="sm" disabled={disabled || Boolean(busy)} onClick={() => { setError(""); setModal(true, "choose") }}>Add host</Button>
      </div>

      {addOpen ? (
        <div className="environment-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setModal(false) }}>
          <section className="environment-modal" role="dialog" aria-modal="true" aria-labelledby="environment-modal-title">
            <header>
              <div className="flex items-center gap-2">
                {addMode !== "choose" ? <IconButton aria-label="Back" onClick={() => { setError(""); setModal(true, "choose") }}><ArrowLeft size={15} /></IconButton> : null}
                <div>
                  <h3 id="environment-modal-title">{activeModeMeta?.title ?? "Add connection"}</h3>
                  {activeModeMeta ? <p>{activeModeMeta.detail}</p> : null}
                </div>
              </div>
              <IconButton aria-label="Close dialog" onClick={() => setModal(false)}><X size={15} /></IconButton>
            </header>

            {addMode === "choose" ? (
              <div className="environment-form gap-2.5">
                {ADD_MODES.map(({ id, title, subtitle, icon: Icon }) => (
                  <button key={id} type="button" className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:border-[rgb(var(--primary)/0.6)] text-left transition-colors cursor-pointer" onClick={() => { setError(""); setModal(true, id) }}>
                    <Icon size={18} className="opacity-80 shrink-0" />
                    <div><div className="text-[13.5px] font-semibold">{title}</div><div className="mt-0.5 text-xs text-[rgb(var(--muted))]">{subtitle}</div></div>
                  </button>
                ))}
              </div>
            ) : addMode === "direct" ? (
              <form className="environment-form" onSubmit={connectDirect}>
                <label>Host URL<Input autoFocus value={directUrl} onChange={e => setDirectUrl(e.target.value)} placeholder="https://captain.eu.example.com or http://192.168.1.50:4318" required /></label>
                <label>Bearer token (optional)<Input type="password" value={directToken} onChange={e => setDirectToken(e.target.value)} placeholder="Leave empty on trusted LAN" /></label>
                {error ? <Banner tone="error">{error}</Banner> : null}
                <div className="form-actions"><Button variant="outline" onClick={() => setModal(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={!directUrl.trim()}>Connect host</Button></div>
              </form>
            ) : addMode === "pairing" ? (
              <form className="environment-form" onSubmit={connectPairing}>
                <label>Pairing link<Input autoFocus value={pairingLink} onChange={e => setPairingLink(e.target.value)} placeholder="ade://pair?url=https://...&token=..." required /></label>
                {error ? <Banner tone="error">{error}</Banner> : null}
                <div className="form-actions"><Button variant="outline" onClick={() => setModal(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={!pairingLink.trim()}>Pair &amp; connect</Button></div>
              </form>
            ) : (
              <form className="environment-form" onSubmit={addSsh}>
                <p className="hint">Uses your system OpenSSH client, SSH keys/agent, and known_hosts. ADE does not ask for or store SSH passwords.</p>
                <label>Environment name<Input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={64} placeholder="HOME-DEVELOPMENT" required disabled={disabled || Boolean(busy)} /></label>
                <label>SSH host or alias<Input value={sshHost} onChange={e => setSshHost(e.target.value)} maxLength={255} placeholder="user@server or ~/.ssh/config alias" required disabled={disabled || Boolean(busy)} /></label>
                <div className="environment-ports">
                  <label>SSH port<Input type="number" min="1" max="65535" value={sshPort} onChange={e => setSshPort(e.target.value)} required disabled={disabled || Boolean(busy)} /></label>
                  <label>ADE runtime port<Input type="number" min="1" max="65535" value={remotePort} onChange={e => setRemotePort(e.target.value)} required disabled={disabled || Boolean(busy)} /></label>
                </div>
                {error ? <Banner tone="error">{error}</Banner> : null}
                <div className="form-actions"><Button variant="outline" disabled={Boolean(busy)} onClick={() => setModal(false)}>Cancel</Button><Button type="submit" variant="primary" loading={busy === "new"} disabled={disabled || Boolean(busy) || !name.trim() || !sshHost.trim()}>{busy === "new" ? "Connecting…" : "Add and connect"}</Button></div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </section>
  )
}
