import { Check, ChevronUp, Shield, ShieldAlert, ShieldOff } from "lucide-react"
import type { ApprovalPolicy } from "../../app-types"

const ACCESS_OPTIONS: { value: ApprovalPolicy; label: string; description: string }[] = [
  { value: "auto-all", label: "Autopilot", description: "Run everything without asking (no merging or force-pushing)" },
  { value: "auto-safe", label: "Auto-safe", description: "Auto-allow read-only commands" },
  { value: "ask", label: "Ask every cmd", description: "Require approval for every command" },
]

export function ModelPickerFooter({
  hint,
  approvalPolicy,
  accessMenuOpen,
  onToggleAccessMenu,
  onChangeApprovalPolicy,
}: {
  hint: string
  approvalPolicy?: ApprovalPolicy
  accessMenuOpen: boolean
  onToggleAccessMenu: () => void
  onChangeApprovalPolicy?: (policy: ApprovalPolicy) => void
}) {
  const currentAccess = ACCESS_OPTIONS.find(a => a.value === (approvalPolicy ?? "auto-safe")) ?? ACCESS_OPTIONS[1]
  const AccessIcon = currentAccess.value === "auto-all" ? ShieldOff : currentAccess.value === "ask" ? ShieldAlert : Shield

  return (
    <div className="ade-mp-footer">
      <span className="ade-mp-footer-hint">{hint}</span>

      {onChangeApprovalPolicy ? (
        <div className="ade-mp-access-wrap">
          {accessMenuOpen ? (
            <div className="ade-mp-access-menu" role="menu">
              {ACCESS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={currentAccess.value === opt.value}
                  className={`ade-mp-access-item ${currentAccess.value === opt.value ? "is-selected" : ""}`}
                  onClick={() => {
                    onChangeApprovalPolicy(opt.value)
                    onToggleAccessMenu()
                  }}
                >
                  <div>
                    <strong>{opt.label}</strong>
                    <small>{opt.description}</small>
                  </div>
                  {currentAccess.value === opt.value ? <Check className="size-3.5 text-[rgb(var(--primary))]" /> : null}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="ade-mp-access-btn"
            onClick={onToggleAccessMenu}
            title="Change command execution access level"
          >
            <AccessIcon className="size-3.5 opacity-75" />
            <span>{currentAccess.label}</span>
            <ChevronUp className="size-3 opacity-60" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
