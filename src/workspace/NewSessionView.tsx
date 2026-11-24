import { Server, Settings2 } from "lucide-react"
import { Banner, Button, FolderPathInput } from "../../components/ui/index.ts"
import type { ApprovalPolicy, GitHubIssue, ProviderCatalogEntry, SkillsAndRulesCatalog } from "../../app-types"
import type { Project } from "../../ProjectsView"
import { ComposerDock } from "../composer/ComposerDock"
import { StartFromPicker } from "./StartFromPicker"
import { LinearIssuePicker } from "./LinearIssuePicker"
import { DEFAULT_KEYBINDINGS, formatShortcut, type KeybindingMap } from "../keybindings"
import { ConversationLayout } from "./ConversationLayout"
import { WorkspaceEmptyHero } from "./WorkspaceEmptyHero"
import { GitHubIssueQuickPicker } from "./new-session/GitHubIssueQuickPicker"
import { SessionConfigPillBar } from "./new-session/SessionConfigPillBar"
import { useNewSessionForm, type NewSessionStartInput } from "./new-session/useNewSessionForm"

export function NewSessionView({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onConfigureProject,
  onOpenEnvironmentPalette,
  environmentName,
  keybindings = DEFAULT_KEYBINDINGS,
  modelCatalog,
  selectedProvider,
  selectedModel,
  onSelectModel,
  reasoning,
  onSelectReasoning,
  approvalPolicy,
  onChangeApprovalPolicy,
  skillsCatalog,
  onOpenSettings,
  starting,
  error,
  onStart,
  onLookupIssue,
  initialIssue,
}: {
  projects: Project[]
  selectedProjectId: string | null
  onSelectProject: (id: string | null) => void
  onAddProject?: () => void
  onConfigureProject?: (projectId: string) => void
  onOpenEnvironmentPalette?: () => void
  environmentName: string
  keybindings?: KeybindingMap
  modelCatalog: ProviderCatalogEntry[]
  selectedProvider: string
  selectedModel: string
  onSelectModel: (provider: string, id: string) => void
  reasoning: string
  onSelectReasoning: (level: string) => void
  approvalPolicy?: ApprovalPolicy
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => void
  skillsCatalog?: SkillsAndRulesCatalog
  onOpenSettings?: () => void
  starting: boolean
  error: string
  onStart: (input: NewSessionStartInput) => Promise<void>
  onLookupIssue?: (projectId: string, url: string) => Promise<GitHubIssue>
  /** Opened from an issue: link it and fill in the task. */
  initialIssue?: GitHubIssue | null
}) {
  const form = useNewSessionForm({
    projects,
    selectedProjectId,
    onSelectProject,
    starting,
    onStart,
    onLookupIssue,
    initialIssue,
  })

  return (
    <ConversationLayout
      header={
        <header className="ade-workspace-header">
          <div className="ade-header-left">
            <span className="ade-header-title ade-truncate">
              {form.sessionTitle.trim() || "New session"}
            </span>
            {form.activeProject ? (
              <span className="ade-pill">{form.activeProject.name}</span>
            ) : null}
          </div>
          <div className="ade-header-right">
            {onOpenEnvironmentPalette ? (
              <button
                type="button"
                className="ade-header-tool-btn"
                onClick={onOpenEnvironmentPalette}
                title={keybindings.switchEnvironment ? `Switch environment (${formatShortcut(keybindings.switchEnvironment)})` : "Switch environment"}
              >
                <Server className="size-3.5" />
                <span>{environmentName}</span>
              </button>
            ) : null}
          </div>
        </header>
      }
      aboveComposer={
        <div className="ade-ns-above">
          {error ? <Banner tone="error">{error}</Banner> : null}

          <SessionConfigPillBar
            unarchivedProjects={form.unarchivedProjects}
            selectedProjectId={selectedProjectId}
            activeProject={form.activeProject}
            kind={form.kind}
            effectiveBlueprint={form.effectiveBlueprint}
            projectBlueprint={form.projectBlueprint}
            blueprintLocked={form.blueprintLocked}
            effectiveBlueprintOption={form.effectiveBlueprintOption}
            blueprintOptions={form.blueprintOptions}
            effectiveRunOn={form.effectiveRunOn}
            runTargets={form.runTargets}
            projectRunOn={form.projectRunOn}
            canAttempt={form.canAttempt}
            attemptCount={form.attemptCount}
            linkedIssue={form.linkedIssue}
            onSelectProject={form.handleProjectChange}
            onSelectKind={form.setKind}
            onSelectBlueprint={form.setBlueprintChoice}
            onSelectRunOn={form.setRunOn}
            onSelectAttemptCount={form.setAttemptCount}
            onAddProject={onAddProject}
            onToggleIssueOpen={form.handleToggleIssueOpen}
          />

          {form.needsManualRepo ? (
            <div className="ade-ns-folder-bar">
              <FolderPathInput
                className="flex-1 min-w-0"
                value={form.repository}
                onChange={form.setRepository}
                placeholder={form.activeProject ? `Attach a folder to ${form.activeProject.name}…` : "Choose a local folder path…"}
                browseLabel="Browse…"
              />
              {form.activeProject && onConfigureProject ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onConfigureProject(form.activeProject!.id)}
                  title="Open project settings on the right side"
                >
                  <Settings2 className="size-3.5" /> Configure
                </Button>
              ) : null}
            </div>
          ) : null}

          {form.canStartFrom && form.activeProject ? (
            <StartFromPicker
              key={form.activeProject.id}
              projectId={form.activeProject.id}
              hasGitHub={Boolean(form.activeProject.githubUrl)}
              value={form.startChoice}
              onChange={form.setStartChoice}
            />
          ) : null}

          <GitHubIssueQuickPicker
            linkedIssue={form.linkedIssue}
            issueOpen={form.issueOpen}
            hasGitHub={Boolean(form.activeProject?.githubUrl)}
            loadingIssues={form.loadingIssues}
            openIssues={form.openIssues}
            issueUrl={form.issueUrl}
            lookingUp={form.lookingUp}
            issueError={form.issueError}
            onClearLinked={() => form.setLinkedIssue(null)}
            onClosePicker={() => form.setIssueOpen(false)}
            onSelectIssue={form.handleSelectOpenIssue}
            onIssueUrlChange={form.setIssueUrl}
            onLookupIssue={() => void form.handleLookupIssue()}
          />

          <LinearIssuePicker
            selected={form.linearIssue}
            onClear={() => form.setLinearIssue(null)}
            onPick={issue => {
              form.setLinearIssue(issue)
              if (!form.prompt.trim()) {
                form.setPrompt(`Work on ${issue.identifier}: ${issue.title}\n${issue.url}${issue.description ? `\n\n${issue.description}` : ""}`)
              }
            }}
          />
        </div>
      }
      composer={
        <ComposerDock
          draft={form.prompt}
          onDraftChange={form.setPrompt}
          busy={starting}
          disabled={!form.readyToStart}
          canSubmitEmpty={Boolean(form.startFrom)}
          placeholder={form.startFrom
            ? "Optional: what should the agent do on this branch? Leave empty to just open it."
            : `Message ADE… ${formatShortcut(keybindings.sendMessage)} to start, ${formatShortcut(keybindings.newLine)} for a new line.`}
          submitTitle={form.canAttempt && form.attemptCount > 1 ? `Start ${form.attemptCount} attempts` : "Start session"}
          modelCatalog={modelCatalog}
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          reasoning={reasoning}
          onSelectReasoning={onSelectReasoning}
          approvalPolicy={approvalPolicy}
          onChangeApprovalPolicy={onChangeApprovalPolicy}
          onOpenSettings={onOpenSettings}
          skillsCatalog={skillsCatalog}
          hasWorkspace={Boolean(form.effectiveRepo.trim())}
          sendChord={keybindings.sendMessage}
          newLineChord={keybindings.newLine}
          onSubmit={form.handleSubmitText}
        />
      }
    >
      <div className="ade-timeline">
        <WorkspaceEmptyHero
          title={form.sessionTitle.trim() || "New session"}
          subtitle="Click the title above to name this session, or describe what you want built, planned, or investigated."
          editableTitle={{
            value: form.sessionTitle,
            placeholder: "New session",
            ariaLabel: "Session name",
            onChange: form.setSessionTitle,
          }}
        />
      </div>
    </ConversationLayout>
  )
}
