import type {
  ApprovalPolicy, BrowserState, Conversation, ConversationTimelineSnapshot, GitHubIssue,
  ManagedProcessSummary, PendingApproval, ProviderCatalogEntry, SessionArtifact, SessionTaskItem,
  SkillsAndRulesCatalog, SubagentInfo, WorkspaceGitSummary, WorkspaceTab,
} from "../../../app-types"
import type { KeybindingMap } from "../../keybindings"

export type SplitWorkspaceProps = {
  session: Conversation
  timeline: ConversationTimelineSnapshot | null
  subagentTimelines: Record<string, ConversationTimelineSnapshot>
  subagents: SubagentInfo[]
  approvals: PendingApproval[]
  approvalPolicy: ApprovalPolicy
  processes: ManagedProcessSummary[]
  gitSummary: WorkspaceGitSummary
  artifacts: SessionArtifact[]
  tasks: SessionTaskItem[]
  skillsCatalog: SkillsAndRulesCatalog
  browserState: BrowserState
  onBrowserStateChange: (state: BrowserState) => void
  modelCatalog: ProviderCatalogEntry[]
  selectedProvider: string
  selectedModel: string
  onSelectModel: (provider: string, id: string) => void
  reasoning: string
  onSelectReasoning: (level: string) => void
  onOpenSettings?: () => void
  draft: string
  onDraftChange: (value: string) => void
  attachments: { id: string; name: string; content: string }[]
  onAttachFiles?: (files: FileList | null) => void
  onRemoveAttachment?: (id: string) => void
  onSendMessage: (text: string) => void
  onAskAgent: (text: string) => Promise<void>
  onOpenAttempts?: (group: string) => void
  onSteerSession: (text: string, mode: "steer" | "follow-up") => void
  onAbortSession: () => void
  onCompactSession: () => void
  onResolveApproval: (id: string, decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => Promise<void>
  onChangeApprovalPolicy: (policy: ApprovalPolicy) => void
  onKillProcess: (id: string) => Promise<void>
  onRefreshProcesses: () => void
  onRefreshGit: () => void
  onMessageSubagent: (subagentId: string, message: string, mode: "steer" | "follow-up") => Promise<void>
  onStopSubagent: (subagentId: string) => Promise<void>
  onOpenExternalBrowser: (url: string) => Promise<void>
  onReviewArtifact: (artifact: SessionArtifact, decision: "approved" | "changes_requested", feedback?: string) => Promise<void>
  terminalFontSize: number
  terminalScrollback: number
  terminalAutoStart?: boolean
  prDraftDefault?: boolean
  projectName?: string
  blueprintLocked?: boolean
  onStartFromIssue?: (issue: GitHubIssue) => void
  onOpenProject?: () => void
  onOpenProjectSettings?: () => void
  stateLabel?: { label: string; tone: string; hint: string }
  environmentId: string
  externalOpenRequest: WorkspaceTab | null
  onClearExternalOpenRequest: () => void
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  keybindings?: KeybindingMap
}
