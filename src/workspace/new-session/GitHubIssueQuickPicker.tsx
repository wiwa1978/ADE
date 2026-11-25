import { X } from "lucide-react"
import { Banner, Button, Input, Spinner } from "../../../components/ui/index.ts"
import type { GitHubIssue } from "../../../app-types"
import { useI18n } from "../../i18n/I18nContext"
import type { OpenIssueOption } from "./useNewSessionForm"

interface GitHubIssueQuickPickerProps {
  linkedIssue: GitHubIssue | null
  issueOpen: boolean
  hasGitHub: boolean
  loadingIssues: boolean
  openIssues: OpenIssueOption[]
  issueUrl: string
  lookingUp: boolean
  issueError: string
  onClearLinked: () => void
  onClosePicker: () => void
  onSelectIssue: (issue: OpenIssueOption) => void
  onIssueUrlChange: (url: string) => void
  onLookupIssue: () => void
}

export function GitHubIssueQuickPicker({
  linkedIssue,
  issueOpen,
  hasGitHub,
  loadingIssues,
  openIssues,
  issueUrl,
  lookingUp,
  issueError,
  onClearLinked,
  onClosePicker,
  onSelectIssue,
  onIssueUrlChange,
  onLookupIssue,
}: GitHubIssueQuickPickerProps) {
  const { t } = useI18n()

  if (linkedIssue) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--primary)/0.45)] bg-[rgb(var(--primary)/0.1)] text-xs">
        <span className="truncate">
          <strong className="font-mono">#{linkedIssue.number}</strong> {linkedIssue.title}
        </span>
        <Button variant="ghost" size="xs" onClick={onClearLinked} aria-label={t("common.remove")}>
          <X className="size-3.5" />
        </Button>
      </div>
    )
  }

  if (!issueOpen || !hasGitHub) return null

  return (
    <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3 flex flex-col gap-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{t("ns.importIssue")}</span>
        <Button variant="ghost" size="xs" onClick={onClosePicker} aria-label={t("common.close")}>
          <X className="size-3.5" />
        </Button>
      </div>
      {loadingIssues ? (
        <div className="opacity-65 py-2">
          <Spinner size="xs" label={t("ns.loadingIssues")} />
        </div>
      ) : openIssues.length > 0 ? (
        <div className="max-h-36 overflow-y-auto divide-y divide-[rgb(var(--border)/0.5)] rounded-lg border border-[rgb(var(--border)/0.7)] bg-[rgb(var(--background))]">
          {openIssues.map(iss => (
            <button
              key={iss.number}
              type="button"
              className="w-full px-3 py-2 text-left hover:bg-[rgb(var(--surface-raised))] flex items-center gap-2"
              onClick={() => onSelectIssue(iss)}
            >
              <span className="font-mono opacity-60">#{iss.number}</span>
              <span className="truncate">{iss.title}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          type="text"
          className="flex-1"
          placeholder={t("ns.pasteIssue")}
          value={issueUrl}
          onChange={e => onIssueUrlChange(e.target.value)}
        />
        <Button
          variant="secondary"
          size="md"
          loading={lookingUp}
          disabled={!issueUrl.trim()}
          onClick={onLookupIssue}
        >
          {lookingUp ? t("ns.loadingDots") : t("ns.load")}
        </Button>
      </div>
      {issueError ? <Banner tone="error">{issueError}</Banner> : null}
    </div>
  )
}
