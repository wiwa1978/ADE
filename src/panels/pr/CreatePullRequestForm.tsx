import { useState } from "react"
import { GitPullRequest, Upload } from "lucide-react"
import { Button, Input, Textarea } from "../../../components/ui/index.ts"
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
      <h3>Open a pull request</h3>
      {status.commitsAhead === 0 ? (
        <p className="ade-muted ade-xs">There are no commits on this branch yet. Commit changes first.</p>
      ) : null}
      <label>
        Title
        <Input value={title} onChange={event => setTitle(event.target.value)} maxLength={256} required />
      </label>
      <label>
        Description
        <Textarea value={body} onChange={event => setBody(event.target.value)} rows={6} placeholder="What changed and why" />
      </label>
      <div className="ade-pr-form-row">
        <label className="ade-pr-base">
          Base branch
          <Input value={base} onChange={event => onBaseChange(event.target.value)} placeholder="main" />
        </label>
        <label className="ade-pr-draft">
          <input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} /> Draft
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
          {busy === "create" ? "Pushing and opening…" : draft ? "Push and open draft PR" : "Push and open PR"}
        </Button>
        {status.unpushed > 0 ? (
          <Button variant="chip" size="xs" disabled={Boolean(busy)} loading={busy === "push"} onClick={onPush}>
            <Upload className="size-3" /> {busy === "push" ? "Pushing…" : "Push only"}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
