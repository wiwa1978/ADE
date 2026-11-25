import { Columns2, ListTodo, Workflow } from "lucide-react"
import { Button, EmptyState } from "../../../components/ui/index.ts"

interface ProjectQuickLaunchBarProps {
  projectName: string
  quickPrompt: string
  launching: boolean
  onQuickPromptChange: (value: string) => void
  onSubmit: () => void
  onStartFactoryRun: () => void
  onBrowseIssues: () => void
}

export function ProjectQuickLaunchBar({
  projectName,
  quickPrompt,
  launching,
  onQuickPromptChange,
  onSubmit,
  onStartFactoryRun,
  onBrowseIssues,
}: ProjectQuickLaunchBarProps) {
  return (
    <EmptyState
      className="flex-1"
      icon={<Columns2 className="size-5" />}
      title={`Start a session in ${projectName}`}
      description="Each session is an agent working on its own branch. Open several here to watch them side by side."
      action={
        <div className="flex flex-col items-center gap-4 w-full max-w-xl">
          <form
            className="w-full min-w-[320px] sm:min-w-[460px] flex items-center gap-2 p-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))]"
            onSubmit={e => {
              e.preventDefault()
              onSubmit()
            }}
          >
            <input
              className="flex-1 bg-transparent border-0 outline-none px-2 text-[13px] text-[rgb(var(--foreground))]"
              placeholder={`What should an agent build or investigate in ${projectName}?`}
              value={quickPrompt}
              onChange={e => onQuickPromptChange(e.target.value)}
              disabled={launching}
            />
            <Button type="submit" variant="primary" size="md" loading={launching} disabled={!quickPrompt.trim()}>
              {launching ? "Starting…" : "Start session"}
            </Button>
          </form>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="secondary" size="md" onClick={onStartFactoryRun}>
              <Workflow className="size-3.5" /> Start Software Factory Run
            </Button>
            <Button variant="ghost" size="md" onClick={onBrowseIssues}>
              <ListTodo className="size-3.5" /> Browse GitHub Issues
            </Button>
          </div>
        </div>
      }
    />
  )
}
