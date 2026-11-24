import {
  Bell, Blocks, Bot, Gauge, GitPullRequest, Palette, Server, Settings2, Smartphone, Sparkles, Terminal, Workflow, type LucideIcon,
} from "lucide-react"
import type { Theme } from "../../../appearance-palettes"
import type {
  ApprovalPolicy, ApprovalRule, BrowserState, EnvironmentDirectory, McpServerStatus,
  ProviderCatalogEntry, RuntimeHealth, SkillsAndRulesCatalog,
} from "../../../app-types"
import type { Project } from "../../../ProjectsView"
import type { useConnections } from "../../../useConnections"
import type { Settings } from "../../../useSettings"

/** Settings categories. Every category here changes something real; nothing is a placeholder. */
export type SettingsCategory =
  | "general" | "appearance" | "models" | "agents" | "usage" | "subagents" | "integrations" | "github" | "terminal" | "notifications" | "environments" | "mobile"

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

export type SettingsItem = {
  id: SettingsCategory
  label: string
  icon: LucideIcon
  description: string
  keywords: string
}

export const SETTINGS_GROUPS: readonly { label: string; items: readonly SettingsItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { id: "general", label: "General", icon: Settings2, description: "Session defaults, archiving, startup, and keyboard shortcuts.", keywords: "worktree checkout branch archive startup restore shortcuts keybindings keyboard hotkeys" },
      { id: "terminal", label: "Terminal", icon: Terminal, description: "The interactive terminal in coding sessions.", keywords: "shell font scrollback auto start" },
      { id: "notifications", label: "Notifications", icon: Bell, description: "Desktop notifications when agents need you.", keywords: "alert finished approval desktop" },
      { id: "integrations", label: "Integrations", icon: Blocks, description: "Slack notifications and Linear issues.", keywords: "slack linear webhook notify issues jira" },
    ],
  },
  {
    label: "AI",
    items: [
      { id: "models", label: "Providers", icon: Sparkles, description: "Model providers, CLI agents, API keys, and runtime settings.", keywords: "openai anthropic claude copilot codex pi cursor opencode radius ollama compatible api key provider reasoning models" },
      { id: "agents", label: "Agents & permissions", icon: Bot, description: "Ask or Autopilot, limits for unattended work, MCP servers, and skills.", keywords: "approval policy autopilot ask mcp skills rules permissions browser chrome limit cost budget overnight usage limit fallback queue concurrent" },
      { id: "subagents", label: "Subagents", icon: Workflow, description: "What subagents run on (Pi, Claude Code, Codex) and who picks.", keywords: "harness claude code codex pi durable subagent model delegate" },
      { id: "usage", label: "Usage", icon: Gauge, description: "Tokens and cost per project and session, and a monthly budget.", keywords: "cost spend tokens budget billing price money" },
    ],
  },
  {
    label: "Source control",
    items: [
      { id: "github", label: "Git & GitHub", icon: GitPullRequest, description: "GitHub account and pull request defaults.", keywords: "gh cli pull request draft account" },
    ],
  },
  {
    label: "Interface",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette, description: "Theme, color palette, fonts, and layout.", keywords: "dark light theme palette font size width syntax" },
    ],
  },
  {
    label: "Hosts",
    items: [
      { id: "environments", label: "Environments", icon: Server, description: "This computer and SSH hosts, diagnostics, and version information.", keywords: "ssh remote host diagnostics worktrees about version" },
      { id: "mobile", label: "Phone & Mobile", icon: Smartphone, description: "Pair iPhone or Android via QR code to continue your work remotely.", keywords: "iphone android phone mobile qr code pair remote tailscale tunnel pwa" },
    ],
  },
]

export const ALL_SETTINGS_ITEMS = SETTINGS_GROUPS.flatMap(group => group.items)

export const REASONING_LEVELS = [
  { id: "none", label: "None" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
  { id: "max", label: "Max" },
]
