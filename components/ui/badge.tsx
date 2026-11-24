import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

export type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "error"
export type BadgeSize = "xs" | "sm"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium leading-none",
  {
    variants: {
      tone: {
        neutral: "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--muted))]",
        accent: "border-[rgb(var(--primary)/.35)] bg-[rgb(var(--primary)/.12)] text-[rgb(var(--primary))]",
        ok: "border-[#34a872]/35 bg-[#34a872]/12 text-[#34a872]",
        warn: "border-[#d99b38]/40 bg-[#d99b38]/12 text-[#d99b38]",
        error: "border-[rgb(var(--rose)/.4)] bg-[rgb(var(--rose)/.12)] text-[rgb(var(--rose))]",
      },
      size: {
        xs: "h-[18px] px-1.5 text-[10px]",
        sm: "h-[22px] px-2 text-[11px]",
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "xs",
    },
  },
)

const DOT_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-[rgb(var(--muted)/.7)]",
  accent: "bg-[rgb(var(--primary))]",
  ok: "bg-[#34a872]",
  warn: "bg-[#d99b38]",
  error: "bg-[rgb(var(--rose))]",
}

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  tone?: BadgeTone
  size?: BadgeSize
  dot?: boolean
}

export function Badge({
  tone = "neutral",
  size = "xs",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot ? <span aria-hidden="true" className={cn("size-1.5 rounded-full shrink-0", DOT_CLASS[tone])} /> : null}
      {children}
    </span>
  )
}

export type StatusPillProps = BadgeProps

export function StatusPill({ dot = true, size = "sm", ...props }: StatusPillProps) {
  return <Badge dot={dot} size={size} {...props} />
}
