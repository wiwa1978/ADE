import { z } from "zod"
import type { ProviderCatalogEntry } from "../../app-types"

const FAVORITES_STORAGE_KEY = "ade.favorite-models-v1"
const favoritesSchema = z.array(z.string())

export type FavoriteKey = string

export type ModelEntry = {
  provider: string
  providerLabel: string
  id: string
  name: string
  isDefault?: boolean
  configured: boolean
}

export const THINKING_LEVELS: { value: string; label: string }[] = [
  { value: "none", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
]

export const PROVIDER_ORDER = [
  "claude", "codex", "copilot", "opencode", "pi", "oh-my-pi",
  "antigravity", "muse-code", "hermes", "cursor", "devin",
  "anthropic", "openai", "github-copilot", "radius", "compatible",
]

export function loadFavorites(): FavoriteKey[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed = favoritesSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export function saveFavorites(list: FavoriteKey[]) {
  try {
    const validated = favoritesSchema.parse(list)
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(validated))
  } catch (err) {
    console.warn("[ADE] Could not persist model favorites:", err instanceof Error ? err.message : String(err))
  }
}

export function shortModelLabel(name: string): string {
  const cleaned = name.replace(/^(Claude|Gemini|GPT|OpenAI)\s+/i, "").trim()
  return (cleaned || name).slice(0, 18)
}

export function thinkingLabel(value: string): string {
  if (value === "off") return "Off"
  return THINKING_LEVELS.find(t => t.value === value)?.label ?? "Medium"
}

export function sortCatalog(catalog: ProviderCatalogEntry[]): ProviderCatalogEntry[] {
  return [...catalog].sort((a, b) => {
    const ia = PROVIDER_ORDER.indexOf(a.id)
    const ib = PROVIDER_ORDER.indexOf(b.id)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
}

export function buildAllModelEntries(orderedCatalog: ProviderCatalogEntry[]): ModelEntry[] {
  const list: ModelEntry[] = []
  for (const p of orderedCatalog) {
    if (p.models.length === 0) {
      list.push({
        provider: p.id,
        providerLabel: p.id,
        id: p.defaultModel || "default",
        name: `${p.name.replace(/\s*\(.*?\)/, "")} default`,
        isDefault: true,
        configured: p.configured,
      })
    } else {
      for (const m of p.models) {
        list.push({
          provider: p.id,
          providerLabel: p.id,
          id: m.id,
          name: m.name,
          configured: p.configured,
        })
      }
    }
  }
  return list
}

export function computeVisibleEntries(
  query: string,
  activeTab: string,
  favorites: FavoriteKey[],
  allEntries: ModelEntry[],
  orderedCatalog: ProviderCatalogEntry[],
): ModelEntry[] {
  const q = query.trim().toLowerCase()
  if (q) {
    return allEntries.filter(
      e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.provider.toLowerCase().includes(q),
    )
  }
  if (activeTab === "favorites") {
    const favSet = new Set(favorites)
    const pinned = allEntries.filter(e => favSet.has(`${e.provider}::${e.id}`))
    if (pinned.length > 0) return pinned
    return orderedCatalog.flatMap(p => {
      if (p.models.length === 0) {
        return [{
          provider: p.id,
          providerLabel: p.id,
          id: p.defaultModel || "default",
          name: `${p.name.replace(/\s*\(.*?\)/, "")} default`,
          isDefault: true,
          configured: p.configured,
        }]
      }
      return p.models.slice(0, 2).map<ModelEntry>(m => ({
        provider: p.id,
        providerLabel: p.id,
        id: m.id,
        name: m.name,
        configured: p.configured,
      }))
    })
  }
  const providerEntry = orderedCatalog.find(p => p.id === activeTab)
  if (!providerEntry) return []
  const rows: ModelEntry[] = []
  const defaultId = providerEntry.defaultModel || providerEntry.models[0]?.id || "default"
  if (providerEntry.configured || providerEntry.models.length > 0) {
    rows.push({
      provider: providerEntry.id,
      providerLabel: "",
      id: defaultId,
      name: `${providerEntry.name.replace(/\s*\(.*?\)/, "")} default`,
      isDefault: true,
      configured: providerEntry.configured,
    })
  }
  for (const m of providerEntry.models) {
    rows.push({
      provider: providerEntry.id,
      providerLabel: providerEntry.id,
      id: m.id,
      name: m.name,
      configured: providerEntry.configured,
    })
  }
  return rows
}
