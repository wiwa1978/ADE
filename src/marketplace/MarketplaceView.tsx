import { useMemo, useState, type FormEvent } from "react"
import { Blocks, Download, ExternalLink, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { Badge, Banner, Button } from "@/components/ui"
import type { PluginCategory, PluginsSnapshot, PluginView } from "./usePlugins"

type Tab = "core" | "community" | "sources"

const CATEGORIES: Array<{ id: "all" | PluginCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "terminal", label: "Terminal" },
  { id: "observability", label: "Observability" },
  { id: "workflows", label: "Workflows" },
  { id: "collaboration", label: "Collaboration" },
  { id: "cloud-vms", label: "Cloud VMs" },
  { id: "skills-mcp", label: "Skills & MCP" },
  { id: "security", label: "Security" },
  { id: "mobile", label: "Mobile" },
]

function capabilitySummary(plugin: PluginView): string[] {
  const badges: string[] = []
  const caps = plugin.capabilities
  if (caps.uiModules?.length) badges.push(`${caps.uiModules.length} UI module${caps.uiModules.length === 1 ? "" : "s"}`)
  if (caps.terminalProfiles?.length) badges.push(`${caps.terminalProfiles.length} terminal profile${caps.terminalProfiles.length === 1 ? "" : "s"}`)
  if (caps.notificationChannels?.length) badges.push(`${caps.notificationChannels.length} alert channel${caps.notificationChannels.length === 1 ? "" : "s"}`)
  if (caps.guardrails?.length) badges.push(`${caps.guardrails.length} guardrail${caps.guardrails.length === 1 ? "" : "s"}`)
  if (caps.recipes?.length) badges.push(`${caps.recipes.length} recipe${caps.recipes.length === 1 ? "" : "s"}`)
  if (caps.skills?.length) badges.push(`${caps.skills.length} skill${caps.skills.length === 1 ? "" : "s"}`)
  if (caps.mcpServers?.length) badges.push(`${caps.mcpServers.length} MCP server${caps.mcpServers.length === 1 ? "" : "s"}`)
  if (caps.cloudProviders?.length) badges.push(`${caps.cloudProviders.length} cloud VM provider${caps.cloudProviders.length === 1 ? "" : "s"}`)
  return badges
}

export type MarketplaceViewProps = {
  snapshot: PluginsSnapshot | null
  loading: boolean
  busyId: string | null
  error: string
  onToggle: (pluginId: string, enabled: boolean) => Promise<boolean>
  onInstall: (pluginId: string, sourceId?: string) => Promise<boolean>
  onUninstall: (pluginId: string) => Promise<boolean>
  onAddSource: (url: string, name?: string) => Promise<boolean>
  onRemoveSource: (sourceId: string) => Promise<boolean>
  onRefreshSources: () => Promise<boolean>
}

/** ADE Plugin Marketplace: toggle built-in Core Modules and install community packs from Git-backed catalogs. */
export function MarketplaceView(props: MarketplaceViewProps) {
  const [tab, setTab] = useState<Tab>("core")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<"all" | PluginCategory>("all")
  const [sourceUrl, setSourceUrl] = useState("")
  const [sourceName, setSourceName] = useState("")

  const filterPlugins = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (list: PluginView[]) =>
      list.filter(plugin => {
        if (category !== "all" && plugin.category !== category) return false
        if (!q) return true
        const haystack = `${plugin.name} ${plugin.description} ${plugin.author} ${plugin.tags.join(" ")}`.toLowerCase()
        return haystack.includes(q)
      })
  }, [query, category])

  const coreList = useMemo(() => filterPlugins(props.snapshot?.corePlugins ?? []), [filterPlugins, props.snapshot])
  const communityList = useMemo(() => filterPlugins(props.snapshot?.catalog ?? []), [filterPlugins, props.snapshot])
  const sources = props.snapshot?.sources ?? []

  const submitSource = async (event: FormEvent) => {
    event.preventDefault()
    if (!sourceUrl.trim()) return
    const ok = await props.onAddSource(sourceUrl, sourceName)
    if (ok) {
      setSourceUrl("")
      setSourceName("")
    }
  }

  return (
    <div className="ade-page" style={{ maxWidth: 980, margin: "0 auto", padding: "1.5rem 2rem 3rem", width: "100%", overflowY: "auto" }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.35rem", fontWeight: 600, margin: 0 }}>
            <Blocks className="size-5" />
            ADE Marketplace
          </h1>
          <p className="ade-muted" style={{ marginTop: "0.35rem", maxWidth: 640 }}>
            Keep your workspace lean by toggling built-in Core Modules, or install open-source community packs (recipes, skills, MCP bundles, cloud providers) from Git-backed <code>marketplace.json</code> repositories.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button variant="chip" size="sm" loading={props.busyId === "refresh"} onClick={() => void props.onRefreshSources()}>
            <RefreshCw className="size-3.5" /> Refresh catalogs
          </Button>
        </div>
      </header>

      {props.error ? <div style={{ marginBottom: "1rem" }}><Banner tone="error">{props.error}</Banner></div> : null}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div className="st-segmented" role="tablist" aria-label="Marketplace sections">
          <button type="button" role="tab" aria-selected={tab === "core"} className={tab === "core" ? "is-active" : ""} onClick={() => setTab("core")}>
            Core Modules ({props.snapshot?.corePlugins.filter(p => p.enabled).length ?? 0}/{props.snapshot?.corePlugins.length ?? 0})
          </button>
          <button type="button" role="tab" aria-selected={tab === "community"} className={tab === "community" ? "is-active" : ""} onClick={() => setTab("community")}>
            Community ({props.snapshot?.installed.length ?? 0} installed)
          </button>
          <button type="button" role="tab" aria-selected={tab === "sources"} className={tab === "sources" ? "is-active" : ""} onClick={() => setTab("sources")}>
            Sources ({sources.length})
          </button>
        </div>

        {tab !== "sources" ? (
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.35rem 0.65rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2, transparent)", minWidth: 240 }}>
            <Search className="size-3.5 ade-muted" />
            <input
              type="search"
              placeholder="Search plugins, tags, authors…"
              value={query}
              onChange={event => setQuery(event.target.value)}
              style={{ border: "none", background: "transparent", outline: "none", width: "100%", fontSize: "0.875rem", color: "inherit" }}
            />
          </label>
        ) : null}
      </div>

      {tab !== "sources" ? (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
          {CATEGORIES.map(item => (
            <button
              key={item.id}
              type="button"
              className={`st-button ${category === item.id ? "" : "is-quiet"}`}
              style={{ fontSize: "0.78rem", padding: "0.25rem 0.65rem" }}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {props.loading && !props.snapshot ? (
        <p className="ade-muted">Loading marketplace…</p>
      ) : tab === "core" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "0.9rem" }}>
          {coreList.map(plugin => {
            const busy = props.busyId === `toggle:${plugin.id}`
            return (
              <article key={plugin.id} className="st-card" style={{ padding: "1rem", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "0.75rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                    <strong style={{ fontSize: "0.95rem" }}>{plugin.name}</strong>
                    <Badge tone={plugin.enabled ? "ok" : "neutral"}>{plugin.enabled ? "Enabled" : "Off"}</Badge>
                  </div>
                  <p className="ade-muted" style={{ fontSize: "0.84rem", marginTop: "0.4rem", lineHeight: 1.45 }}>{plugin.description}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.6rem" }}>
                    {plugin.tags.map(tag => (
                      <span key={tag} style={{ fontSize: "0.72rem", padding: "0.1rem 0.45rem", borderRadius: 999, border: "1px solid var(--border)", opacity: 0.8 }}>{tag}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                  <span className="ade-muted" style={{ fontSize: "0.76rem" }}>Built-in · v{plugin.version}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-label={`Toggle ${plugin.name}`}
                    aria-checked={plugin.enabled}
                    disabled={busy}
                    className={`st-switch ${plugin.enabled ? "is-on" : ""}`}
                    onClick={() => void props.onToggle(plugin.id, !plugin.enabled)}
                  >
                    <span />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ) : tab === "community" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "0.9rem" }}>
          {communityList.map(plugin => {
            const caps = capabilitySummary(plugin)
            const installing = props.busyId === `install:${plugin.id}`
            const uninstalling = props.busyId === `uninstall:${plugin.id}`
            const toggling = props.busyId === `toggle:${plugin.id}`
            return (
              <article key={plugin.id} className="st-card" style={{ padding: "1rem", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "0.75rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                    <strong style={{ fontSize: "0.95rem" }}>{plugin.name}</strong>
                    {plugin.installed ? (
                      <Badge tone={plugin.enabled ? "ok" : "neutral"}>{plugin.enabled ? "Installed" : "Paused"}</Badge>
                    ) : (
                      <Badge tone="neutral">Available</Badge>
                    )}
                  </div>
                  <p className="ade-muted" style={{ fontSize: "0.84rem", marginTop: "0.4rem", lineHeight: 1.45 }}>{plugin.description}</p>
                  {caps.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.55rem" }}>
                      {caps.map(item => (
                        <span key={item} style={{ fontSize: "0.72rem", padding: "0.1rem 0.45rem", borderRadius: 6, background: "var(--surface-2, rgba(128,128,128,0.12))" }}>{item}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                  <span className="ade-muted" style={{ fontSize: "0.76rem" }}>
                    {plugin.author} · v{plugin.version}
                    {plugin.homepage ? (
                      <>
                        {" · "}
                        <a href={plugin.homepage} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                          Docs <ExternalLink className="size-3" />
                        </a>
                      </>
                    ) : null}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    {plugin.installed ? (
                      <>
                        <button
                          type="button"
                          role="switch"
                          aria-label={`Toggle ${plugin.name}`}
                          aria-checked={plugin.enabled}
                          disabled={toggling || uninstalling}
                          className={`st-switch ${plugin.enabled ? "is-on" : ""}`}
                          onClick={() => void props.onToggle(plugin.id, !plugin.enabled)}
                        >
                          <span />
                        </button>
                        <button
                          type="button"
                          className="st-button is-quiet"
                          disabled={uninstalling}
                          title="Uninstall plugin"
                          onClick={() => void props.onUninstall(plugin.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    ) : (
                      <Button variant="chip" size="xs" loading={installing} onClick={() => void props.onInstall(plugin.id, plugin.sourceId)}>
                        <Download className="size-3" /> Install
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
          {communityList.length === 0 ? <p className="ade-muted">No community plugins match your filter.</p> : null}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <section className="st-card" style={{ padding: "1rem" }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.35rem" }}>Add a Git-backed Marketplace</h2>
            <p className="ade-muted" style={{ fontSize: "0.84rem", marginBottom: "0.75rem" }}>
              Point ADE at any open-source or private GitHub repository (<code>owner/repo</code>) or HTTPS URL serving a <code>marketplace.json</code> index.
            </p>
            <form className="st-inline-form" onSubmit={event => void submitSource(event)}>
              <input
                type="text"
                aria-label="Marketplace repository or URL"
                placeholder="owner/ade-marketplace or https://…/marketplace.json"
                value={sourceUrl}
                onChange={event => setSourceUrl(event.target.value)}
              />
              <input
                type="text"
                aria-label="Display name (optional)"
                placeholder="Display name (optional)"
                value={sourceName}
                onChange={event => setSourceName(event.target.value)}
                style={{ maxWidth: 200 }}
              />
              <button type="submit" className="st-button" disabled={!sourceUrl.trim() || props.busyId === "add-source"}>
                <Plus className="size-3.5" style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
                {props.busyId === "add-source" ? "Adding…" : "Add source"}
              </button>
            </form>
          </section>

          <section className="st-card">
            {sources.map(source => (
              <div className="st-row" key={source.id}>
                <div className="st-row-text">
                  <span className="st-row-title">
                    {source.name} {source.official ? <Badge tone="ok">Official</Badge> : null}
                  </span>
                  <p>
                    <code>{source.url}</code> · {source.pluginCount} plugin{source.pluginCount === 1 ? "" : "s"}
                    {source.lastError ? <span className="st-error"> · {source.lastError}</span> : null}
                  </p>
                </div>
                <div className="st-row-control">
                  {!source.official ? (
                    <button
                      type="button"
                      className="st-button is-quiet"
                      disabled={props.busyId === `remove-source:${source.id}`}
                      onClick={() => void props.onRemoveSource(source.id)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  )
}
