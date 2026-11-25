import { useState } from "react"
import { GitPullRequest, Upload } from "lucide-react"
import { Button, Input, Textarea } from "../../../components/ui/index.ts"
import { useI18n } from "../../i18n/I18nContext"
import type { BranchStatus } from "./usePullRequestState"

interface CreatePullRequestFormProps {
  initialTitle: string
  initialBody: string
  draftDefault: boolean
  base: string
  onBaseChange: (base: string) => void
  status: BranchStatus
  busy: string | null
  onCreate: (payload: { title: string; body: string; draft: boolean; base: string }) => void
  onPush: () => void
}

export function CreatePullRequestForm({
  initialTitle,
  initialBody,
  draftDefault,
  base,
  onBaseChange,
  status,
  busy,
  onCreate,
  onPush,
}: CreatePullRequestFormProps) {
  const { t } = useI18n()
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState(initialBody)
  const [draft, setDraft] = useState(draftDefault)

  return (
    <form
      className="ade-pr-form"
      onSubmit={event => {
        event.preventDefault()
        onCreate({ title, body, draft, base })
      }}
    >
      <h3>{t("pnlx.pr.createHeading")}</h3>
      {status.commitsAhead === 0 ? (
        <p className="ade-muted ade-xs">{t("pnlx.pr.noCommitsYet")}</p>
      ) : null}
      <label>
        {t("pnlx.pr.labelTitle")}
        <Input value={title} onChange={event => setTitle(event.target.value)} maxLength={256} required />
      </label>
      <label>
        {t("pnlx.pr.labelDescription")}
        <Textarea value={body} onChange={event => setBody(event.target.value)} rows={6} placeholder={t("pnlx.pr.descPlaceholder")} />
      </label>
      <div className="ade-pr-form-row">
        <label className="ade-pr-base">
          {t("pnlx.pr.labelBaseBranch")}
          <Input value={base} onChange={event => onBaseChange(event.target.value)} placeholder="main" />
        </label>
        <label className="ade-pr-draft">
          <input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} /> {t("pnlx.pr.labelDraft")}
        </label>
      </div>
      <div className="ade-pr-actions">
        <Button
          type="submit"
          variant="primary"
          size="xs"
          disabled={Boolean(busy) || status.commitsAhead === 0 || !title.trim()}
          loading={busy === "create"}
        >
          <GitPullRequest className="size-3.5" />{" "}
          {busy === "create" ? t("pnlx.pr.pushingAndOpening") : draft ? t("pnlx.pr.pushAndOpenDraft") : t("pnlx.pr.pushAndOpen")}
        </Button>
        {status.unpushed > 0 ? (
          <Button variant="chip" size="xs" disabled={Boolean(busy)} loading={busy === "push"} onClick={onPush}>
            <Upload className="size-3" /> {busy === "push" ? t("pnlx.pr.pushing") : t("pnlx.pr.pushOnly")}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
