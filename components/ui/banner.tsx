import type { ReactNode } from "react"
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

export type BannerTone = "error" | "warn" | "ok" | "info"

export interface BannerProps {
  tone?: BannerTone
  title?: ReactNode
  children: ReactNode
  icon?: ReactNode
  action?: ReactNode
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
}

const TONE_CLASS: Record<BannerTone, string> = {
  error: "border-[rgb(var(--rose)/.4)] bg-[rgb(var(--rose)/.1)] text-[rgb(var(--rose))]",
  warn: "border-[#d99b38]/45 bg-[#d99b38]/10 text-[#d99b38]",
  ok: "border-[#34a872]/40 bg-[#34a872]/10 text-[#34a872]",
  info: "border-[rgb(var(--primary)/.35)] bg-[rgb(var(--primary)/.08)] text-[rgb(var(--foreground))]",
}

const DEFAULT_ICON: Record<BannerTone, typeof Info> = {
  error: AlertCircle,
  warn: AlertTriangle,
  ok: CheckCircle2,
  info: Info,
}

export function Banner({
  tone = "info",
  title,
  children,
  icon,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  className,
}: BannerProps) {
  const Icon = DEFAULT_ICON[tone]
  const role = tone === "error" || tone === "warn" ? "alert" : "status"

  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs leading-relaxed",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        {icon ?? <Icon className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        {title ? <div className="font-semibold">{title}</div> : null}
        <div>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="grid size-5 shrink-0 place-items-center rounded opacity-75 hover:bg-[rgb(var(--foreground)/.08)] hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
