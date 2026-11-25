import { Check, ChevronUp, Shield, ShieldAlert, ShieldOff } from "lucide-react"
import type { ApprovalPolicy } from "../app-types"
import { useI18n } from "../i18n/I18nContext"
import type { TranslationKey } from "../i18n"

const ACCESS_OPTIONS: { value: ApprovalPolicy; labelKey: TranslationKey; descKey: TranslationKey }[] = [
  { value: "auto-all", labelKey: "wsx.comp.policyAutoAll", descKey: "wsx.comp.policyAutoAllDesc" },
  { value: "auto-safe", labelKey: "wsx.comp.policyAutoSafe", descKey: "wsx.comp.policyAutoSafeDesc" },
  { value: "ask", labelKey: "wsx.comp.policyAsk", descKey: "wsx.comp.policyAskDesc" },
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
  const { t } = useI18n()
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
                    <strong>{t(opt.labelKey)}</strong>
                    <small>{t(opt.descKey)}</small>
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
            title={t("wsx.comp.changeAccessLevel")}
          >
            <AccessIcon className="size-3.5 opacity-75" />
            <span>{t(currentAccess.labelKey)}</span>
            <ChevronUp className="size-3 opacity-60" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
