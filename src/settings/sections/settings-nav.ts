import {
  Bell, Blocks, Bot, Gauge, GitPullRequest, Globe, Palette, Puzzle, Server, Settings2, Smartphone, Sparkles, Terminal, Workflow, type LucideIcon,
} from "lucide-react"
import type { Theme } from "../../../appearance-palettes"
import type {
  ApprovalPolicy, ApprovalRule, BrowserState, EnvironmentDirectory, McpServerStatus,
  ProviderCatalogEntry, RuntimeHealth, SkillsAndRulesCatalog,
} from "../../../app-types"
import type { Project } from "../../../ProjectsView"
import type { useConnections } from "../../../useConnections"
import type { Settings } from "../../../useSettings"
import type { TranslationKey } from "../../i18n"

/** Settings categories. Every category here changes something real; nothing is a placeholder. */
export type SettingsCategory =
  | "general" | "appearance" | "localization" | "models" | "agents" | "skills" | "usage" | "subagents" | "integrations" | "github" | "terminal" | "notifications" | "environments" | "mobile"

export type SettingsViewProps = {
  settings: Settings
  resolved: Exclude<Theme, "system">
  error: string
  runtimeError: string
  runtime: RuntimeHealth | null
  matchingRuntime: RuntimeHealth | null
  providerName: string | undefined
  selectedModel: string
  selectedProvider: string
  modelCatalog: ProviderCatalogEntry[]
  sending: boolean
  credentialChangesBlocked: boolean
  connections: ReturnType<typeof useConnections>
  projects: Project[]
  /** Session names for the usage breakdown. */
  sessionLabels?: Record<string, string>
  activeEnvironmentName: string
  update: (patch: Partial<Settings>) => void
  onBack: () => void
  onOpenProjects: () => void
  onWorktreeDiagnostics: () => void
  onEnvironmentChanged: (activeId: string, activeName: string, directory: EnvironmentDirectory) => void
  onModelsChanged?: () => void
  mcpServers?: McpServerStatus[]
  approvalPolicy?: ApprovalPolicy
  approvalRules?: ApprovalRule[]
  browserState?: BrowserState
  skillsCatalog?: SkillsAndRulesCatalog
  onRefreshMcp?: () => void
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => Promise<void>
  onDeleteApprovalRule?: (id: string) => Promise<void>
  onAddApprovalRule?: (prefix: string, effect: "allow" | "deny") => Promise<void>
  initialCategory?: SettingsCategory
  autoOpenAddEnvironment?: boolean
}

export type SettingsItemSpec = {
  id: SettingsCategory
  labelKey: TranslationKey
  icon: LucideIcon
  descKey: TranslationKey
  keywords: string
}

export const SETTINGS_GROUP_SPECS: readonly { labelKey: TranslationKey; items: readonly SettingsItemSpec[] }[] = [
  {
    labelKey: "settings.group.workspace",
    items: [
      { id: "general", labelKey: "settings.cat.general.label", icon: Settings2, descKey: "settings.cat.general.desc", keywords: "worktree checkout branch archive startup restore shortcuts keybindings keyboard hotkeys algemeen sneltoetsen archiveren" },
      { id: "terminal", labelKey: "settings.cat.terminal.label", icon: Terminal, descKey: "settings.cat.terminal.desc", keywords: "shell font scrollback auto start lettergrootte" },
      { id: "notifications", labelKey: "settings.cat.notifications.label", icon: Bell, descKey: "settings.cat.notifications.desc", keywords: "alert finished approval desktop meldingen notificaties" },
      { id: "integrations", labelKey: "settings.cat.integrations.label", icon: Blocks, descKey: "settings.cat.integrations.desc", keywords: "slack linear webhook notify issues jira integraties" },
    ],
  },
  {
    labelKey: "settings.group.ai",
    items: [
      { id: "models", labelKey: "settings.cat.models.label", icon: Sparkles, descKey: "settings.cat.models.desc", keywords: "openai anthropic claude copilot codex pi cursor opencode radius ollama compatible api key provider reasoning models" },
      { id: "agents", labelKey: "settings.cat.agents.label", icon: Bot, descKey: "settings.cat.agents.desc", keywords: "approval policy autopilot ask mcp skills rules permissions browser chrome limit cost budget overnight usage limit fallback queue concurrent rechten goedkeuringen" },
      { id: "skills", labelKey: "settings.cat.skills.label", icon: Puzzle, descKey: "settings.cat.skills.desc", keywords: "skill skills mcp tool server tools git repository import trust claude codex cursor gemini .mcp.json vaardigheden toolservers" },
      { id: "subagents", labelKey: "settings.cat.subagents.label", icon: Workflow, descKey: "settings.cat.subagents.desc", keywords: "harness claude code codex pi durable subagent model delegate" },
      { id: "usage", labelKey: "settings.cat.usage.label", icon: Gauge, descKey: "settings.cat.usage.desc", keywords: "cost spend tokens budget billing price money verbruik kosten" },
    ],
  },
  {
    labelKey: "settings.group.sourceControl",
    items: [
      { id: "github", labelKey: "settings.cat.github.label", icon: GitPullRequest, descKey: "settings.cat.github.desc", keywords: "gh cli pull request draft account" },
    ],
  },
  {
    labelKey: "settings.group.interface",
    items: [
      { id: "appearance", labelKey: "settings.cat.appearance.label", icon: Palette, descKey: "settings.cat.appearance.desc", keywords: "dark light theme accent color icon tint palette font size width syntax weergave thema kleur lettertype" },
      { id: "localization", labelKey: "settings.cat.localization.label", icon: Globe, descKey: "settings.cat.localization.desc", keywords: "language locale localization region translation english dutch nederlands engels taal lokalisatie regio vertaling date format time clock 12-hour 24-hour currency money euro dollar datum tijd klok valuta munteenheid" },
    ],
  },
  {
    labelKey: "settings.group.hosts",
    items: [
      { id: "environments", labelKey: "settings.cat.environments.label", icon: Server, descKey: "settings.cat.environments.desc", keywords: "ssh remote host diagnostics worktrees about version omgevingen diagnostiek" },
      { id: "mobile", labelKey: "settings.cat.mobile.label", icon: Smartphone, descKey: "settings.cat.mobile.desc", keywords: "iphone android phone mobile qr code pair remote tailscale tunnel pwa telefoon mobiel koppelen" },
    ],
  },
]

export const REASONING_LEVEL_IDS = ["none", "low", "medium", "high", "xhigh", "max"] as const
