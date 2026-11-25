import { memo, useState } from "react"
import { Check, ShieldAlert, X } from "lucide-react"
import { Badge, Button, Input } from "../../components/ui/index.ts"
import type { PendingApproval } from "../../app-types"
import { useI18n } from "../i18n/I18nContext"

export interface ApprovalCardProps {
  approval: PendingApproval
  onResolve: (id: string, decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => Promise<void>
}

export const ApprovalCard = memo(function ApprovalCard({ approval, onResolve }: ApprovalCardProps) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [denyReason, setDenyReason] = useState("")
  const [showDeny, setShowDeny] = useState(false)

  const handle = async (decision: { allow: boolean; alwaysAllow?: boolean; prefix?: string; reason?: string }) => {
    setBusy(true)
    try {
      await onResolve(approval.id, decision)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ade-approval-card" role="region" aria-label={t("tl.approvalRequired")}>
      <div className="ade-approval-head">
        <ShieldAlert className="size-4 text-[var(--accent)]" />
        <strong>{t("tl.approvalRequired")}</strong>
        <Badge>{approval.toolName}</Badge>
      </div>
      <div className="ade-approval-command">
        <code>{approval.command || approval.summary}</code>
      </div>
      <div className="ade-approval-actions">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void handle({ allow: true })}>
          <Check className="size-3.5" /> {t("tl.allowOnce")}
        </Button>
        {approval.suggestedPrefix ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void handle({ allow: true, alwaysAllow: true, prefix: approval.suggestedPrefix })}
          >
            {t("tl.alwaysAllow")} <code>{approval.suggestedPrefix}</code>
          </Button>
        ) : null}
        {!showDeny ? (
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => setShowDeny(true)}>
            <X className="size-3.5" /> {t("tl.deny")}
          </Button>
        ) : (
          <div className="ade-approval-deny-row">
            <Input
              type="text"
              inputSize="sm"
              placeholder={t("tl.denyReason")}
              value={denyReason}
              onChange={e => setDenyReason(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void handle({ allow: false, reason: denyReason }) }}
            />
            <Button variant="destructive" size="sm" loading={busy} onClick={() => void handle({ allow: false, reason: denyReason })}>
              {t("tl.confirmDeny")}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
})
