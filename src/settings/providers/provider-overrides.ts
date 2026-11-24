import { z } from "zod"
import type {
  ModelCredential,
  ModelCredentialProvider,
  ProviderCatalogEntry,
  ProviderTool,
  RuntimeHealth,
} from "../../../app-types"
import { modelCredentialProviders } from "../../../useConnections"

const EnvVarRowSchema = z.object({
  key: z.string(),
  value: z.string(),
})

const ProviderRuntimeOverrideSchema = z.object({
  displayName: z.string().optional(),
  binaryPath: z.string().optional(),
  homePath: z.string().optional(),
  launchArgs: z.string().optional(),
  envVars: z.array(EnvVarRowSchema).optional(),
})

const ProviderOverridesMapSchema = z.record(z.string(), ProviderRuntimeOverrideSchema)

export type EnvVarRow = z.infer<typeof EnvVarRowSchema>
export type ProviderRuntimeOverride = z.infer<typeof ProviderRuntimeOverrideSchema>
export type ProviderOverridesMap = Record<string, ProviderRuntimeOverride>

export interface UnifiedProviderItem {
  id: string
  name: string
  kind: "cli" | "api" | "copilot"
  command?: string | null
  installed?: boolean
  available: boolean
  enabled: boolean
  canToggle: boolean
  statusText: string
  tone: "ok" | "off" | "warn"
  modelCount: number | null
  models: { id: string; name: string }[]
  credentialProvider?: ModelCredentialProvider
  credentialSource?: ModelCredential["source"]
  installHint?: string | null
}

const RUNTIME_OVERRIDES_KEY = "ade-provider-overrides-v1"

export const DEFAULT_HOME_PATHS: Record<string, string> = {
  codex: "~/.codex",
  claude: "~/.claude",
  copilot: "~/.config/github-copilot",
  opencode: "~/.config/opencode",
  pi: "~/.pi",
  "oh-my-pi": "~/.omp",
  cursor: "~/.cursor",
  antigravity: "~/.gemini/antigravity",
  "muse-code": "~/.muse",
  hermes: "~/.hermes",
  devin: "~/.devin",
}

export function loadOverrides(): ProviderOverridesMap {
  try {
    const raw = localStorage.getItem(RUNTIME_OVERRIDES_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    const validated = ProviderOverridesMapSchema.safeParse(parsed)
    return validated.success ? validated.data : {}
  } catch {
    return {}
  }
}

export function saveOverrides(next: ProviderOverridesMap): void {
  try {
    localStorage.setItem(RUNTIME_OVERRIDES_KEY, JSON.stringify(next))
  } catch {
    // Ignore storage quota errors.
  }
}

export function buildUnifiedProviderItems({
  providerTools,
  modelCatalog,
  modelCredentials,
  copilotHealth,
  copilotStatusError,
  copilotWaiting,
}: {
  providerTools: ProviderTool[] | null
  modelCatalog: ProviderCatalogEntry[]
  modelCredentials: ModelCredential[] | null
  copilotHealth: RuntimeHealth | null
  copilotStatusError: string
  copilotWaiting: boolean
}): UnifiedProviderItem[] {
  const credMap = new Map((modelCredentials ?? []).map(c => [c.provider, c.source]))
  const catalogMap = new Map(modelCatalog.map(c => [c.id, c]))
  const toolMap = new Map((providerTools ?? []).map(t => [t.id, t]))
  const list: UnifiedProviderItem[] = []
  const seen = new Set<string>()

  for (const tool of providerTools ?? []) {
    if (tool.kind === "api") continue
    seen.add(tool.id)
    const cat = catalogMap.get(tool.id)
    const models = cat?.models?.length ? cat.models : (tool.models ?? [])
    const count = models.length || tool.modelCount || null
    const enabled = tool.enabled
    const statusText = !enabled
      ? "Disabled"
      : tool.installed
        ? (count ? `Available · ${count} model${count === 1 ? "" : "s"}` : "Available")
        : "Not installed"
    list.push({
      id: tool.id,
      name: tool.name,
      kind: "cli",
      command: tool.command,
      installed: tool.installed,
      available: tool.installed && enabled,
      enabled,
      canToggle: true,
      statusText,
      tone: !enabled ? "off" : tool.installed ? "ok" : "warn",
      modelCount: count,
      models,
      installHint: tool.install,
    })
  }

  const copilotCat = catalogMap.get("github-copilot")
  const copilotTool = toolMap.get("github-copilot")
  const copilotSignedIn = Boolean(copilotHealth?.copilotSignedIn)
  list.push({
    id: "github-copilot",
    name: "GitHub Copilot",
    kind: "copilot",
    available: copilotSignedIn,
    enabled: copilotTool ? copilotTool.enabled : copilotSignedIn,
    canToggle: Boolean(copilotTool),
    statusText: copilotStatusError
      ? "Unavailable"
      : copilotSignedIn
        ? "Authenticated · Subscription"
        : copilotWaiting
          ? "Waiting for sign-in"
          : "Not signed in",
    tone: copilotStatusError ? "warn" : copilotSignedIn ? "ok" : "off",
    modelCount: copilotCat?.models.length || null,
    models: copilotCat?.models ?? [],
  })
  seen.add("github-copilot")

  for (const cred of modelCredentialProviders) {
    if (seen.has(cred.id)) continue
    seen.add(cred.id)
    const source = credMap.get(cred.id)
    const cat = catalogMap.get(cred.id)
    const tool = toolMap.get(cred.id)
    const configured = Boolean(cat?.configured || source === "saved" || source === "environment")
    const enabled = tool ? tool.enabled : configured
    const statusText = !enabled && tool
      ? "Disabled"
      : source === "saved"
        ? "Authenticated · Key saved"
        : source === "environment"
          ? "Authenticated · Environment"
          : configured
            ? "Configured"
            : "Not set up"
    list.push({
      id: cred.id,
      name: cred.name,
      kind: "api",
      available: configured && enabled,
      enabled,
      canToggle: Boolean(tool),
      statusText,
      tone: configured && enabled ? "ok" : "off",
      modelCount: cat?.models.length || null,
      models: cat?.models ?? [],
      credentialProvider: cred.id,
      credentialSource: source,
    })
  }

  return list
}
