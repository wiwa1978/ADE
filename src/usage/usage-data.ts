import { useEffect, useState } from "react"
import { request } from "../api"
import { formatNumber } from "../i18n"

export type UsageTotals = { inputTokens: number; outputTokens: number; cost: number }
export type UsageReport = {
  month: string
  monthTotal: UsageTotals
  projects: Array<{ projectId: string; totals: UsageTotals }>
  sessions: Record<string, UsageTotals & { projectId: string; updatedAt: number }>
  days: Array<{ day: string; totals: UsageTotals }>
}

export function formatCost(cost: number) {
  if (!cost) return "$0"
  if (cost < 0.01) return "<$0.01"
  return cost < 100 ? `$${cost.toFixed(2)}` : `$${formatNumber(Math.round(cost))}`
}

export function formatTokens(tokens: number) {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/** "$0.42 · 81k tokens", or only tokens when the agent doesn't report a price (e.g. a subscription). */
export function formatUsage(totals: UsageTotals) {
  const tokens = `${formatTokens(totals.inputTokens + totals.outputTokens)} tokens`
  return totals.cost ? `${formatCost(totals.cost)} · ${tokens}` : tokens
}

/** Where this month's spend stands against the budget: null when there is no budget or it is far off. */
export function budgetState(report: UsageReport | null, budget: number) {
  if (!report || budget <= 0) return null
  const ratio = report.monthTotal.cost / budget
  if (ratio < 0.8) return null
  return { ratio, spent: report.monthTotal.cost, budget, reached: ratio >= 1 }
}

/** The usage report, refreshed every 30 seconds (and whenever `refreshKey` changes). */
export function useUsage(refreshKey?: unknown) {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      void request<UsageReport>("/api/usage")
        .then(result => { if (!cancelled) { setReport(result); setError("") } })
        .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not read usage.") })
    }
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [refreshKey])
  return { report, error }
}
