import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            "grid place-items-center rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--muted))]",
            compact ? "size-9" : "size-12",
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <div className={cn("font-semibold text-[rgb(var(--foreground))]", compact ? "text-xs" : "text-sm")}>
          {title}
        </div>
        {description ? (
          <p className={cn("mx-auto max-w-[380px] text-[rgb(var(--muted))] leading-relaxed", compact ? "text-[11px]" : "text-xs")}>
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
