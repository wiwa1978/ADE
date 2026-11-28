import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, BarChart2, X } from "lucide-react"
import { Badge } from "@/components/ui"
import { request } from "../api"
import { formatCost, formatTokens, formatUsage, useUsage } from "./usage-data"

type ProviderStatus = {
  id: string
  name: string
  configured: boolean
  mode: "subscription" | "api-key" | "cli"
}

/** Floating overview of connected subscriptions/providers and monthly token consumption (T3 Code-inspired). */
export function UsagePopover({
  monthlyBudget = 0,
  onClose,
  onOpenUsageSettings,
}: {
  monthlyBudget?: number
  onClose: () => void
  onOpenUsageSettings: () => void
}) {
  const { report, error } = useUsage()
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      request<{ providers?: Array<{ id: string; name?: string; configured?: boolean; authType?: string }> }>("/api/models").catch(() => null),
      request<{ engines?: Array<{ id: string; label?: string; available?: boolean }> }>("/api/engines").catch(() => null),
    ]).then(([modelsRes, enginesRes]) => {
      if (cancelled) return
      const next: ProviderStatus[] = []
      for (const p of modelsRes?.providers ?? []) {
        if (!p.configured) continue
        next.push({
          id: `model:${p.id}`,
          name: p.name || p.id,
          configured: true,
          mode: p.id === "copilot" || p.authType === "oauth" ? "subscription" : "api-key",
        })
      }
      for (const e of enginesRes?.engines ?? []) {
        if (!e.available || e.id === "pi") continue
        next.push({
          id: `cli:${e.id}`,
          name: e.label || e.id,
          configured: true,
          mode: "cli",
        })
      }
      setProviders(next)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onPointerDown)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onPointerDown)
    }
  }, [onClose])

  const spent = report?.monthTotal.cost ?? 0
  const totalTokens = (report?.monthTotal.inputTokens ?? 0) + (report?.monthTotal.outputTokens ?? 0)
  const ratio = monthlyBudget > 0 ? Math.min(1, spent / monthlyBudget) : 0
  const recentDays = (report?.days ?? []).slice(-14)
  const dayVal = (d: { totals: { cost: number; inputTokens: number; outputTokens: number } }) =>
    d.totals.cost || (d.totals.inputTokens + d.totals.outputTokens) / 1e6
  const maxDay = Math.max(1e-9, ...recentDays.map(dayVal))

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Usage and subscriptions overview"
      style={{
        position: "fixed",
        left: 56,
        bottom: 14,
        width: 330,
        zIndex: 80,
        background: "var(--surface-1, var(--bg, #16181d))",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 14px 40px rgba(0,0,0,0.38)",
        padding: "0.95rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.85rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.9rem" }}>
          <BarChart2 className="size-4" />
          Usage & Subscriptions
        </strong>
        <button type="button" className="ade-icon-btn" aria-label="Close usage overview" onClick={onClose}>
          <X className="size-3.5" />
        </button>
      </div>

      {error ? <p className="ade-xs ade-text-error">{error}</p> : null}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
        <div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>
            {spent > 0 || monthlyBudget > 0 ? formatCost(spent) : `${formatTokens(totalTokens)} tokens`}
          </div>
          <div className="ade-muted ade-xs">
            {report
              ? `${formatTokens(report.monthTotal.inputTokens)} in · ${formatTokens(report.monthTotal.outputTokens)} out this month`
              : "Loading usage…"}
          </div>
        </div>
        {monthlyBudget > 0 ? (
          <Badge tone={ratio >= 1 ? "error" : ratio >= 0.8 ? "warn" : "ok"}>
            {Math.round(ratio * 100)}% of {formatCost(monthlyBudget)}
          </Badge>
        ) : null}
      </div>

      {monthlyBudget > 0 ? (
        <div className="ade-usage-meter" role="meter" aria-label="Monthly budget used" aria-valuemin={0} aria-valuemax={monthlyBudget} aria-valuenow={spent}>
          <span className={ratio >= 1 ? "is-error" : ratio >= 0.8 ? "is-warn" : ""} style={{ width: `${ratio * 100}%` }} />
        </div>
      ) : null}

      {recentDays.length > 0 ? (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 34 }} aria-label="Last 14 days usage">
          {recentDays.map(day => {
            const v = dayVal(day)
            return (
              <span
                key={day.day}
                title={`${day.day}: ${v ? formatUsage(day.totals) : "No usage"}`}
                style={{
                  flex: 1,
                  height: `${Math.max(10, (v / maxDay) * 100)}%`,
                  borderRadius: 3,
                  background: v > 0 ? "var(--accent, #60a5fa)" : "var(--border)",
                  opacity: v > 0 ? 0.85 : 0.45,
                }}
              />
            )
          })}
        </div>
      ) : null}

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.65rem" }}>
        <div className="ade-xs ade-muted" style={{ marginBottom: "0.45rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Connected Subscriptions & Keys
        </div>
        {providers.length === 0 ? (
          <p className="ade-xs ade-muted">No model providers or CLI subscriptions connected yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {providers.map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.82rem" }}>
                <span>{p.name}</span>
                <Badge tone="ok">
                  {p.mode === "subscription" ? "Subscription" : p.mode === "cli" ? "CLI" : "API Key"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.55rem", display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="ade-chip-btn"
          onClick={() => { onClose(); onOpenUsageSettings() }}
        >
          Full usage & budget <ArrowUpRight className="size-3" />
        </button>
      </div>
    </div>
  )
}
