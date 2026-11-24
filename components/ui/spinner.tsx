import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export type SpinnerSize = "xs" | "sm" | "md"

export interface SpinnerProps {
  size?: SpinnerSize
  label?: string
  className?: string
}

const SIZE_CLASS: Record<SpinnerSize, string> = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
}

export function Spinner({ size = "sm", label, className }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-live={label ? "polite" : undefined}
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      <Loader2 aria-hidden="true" className={cn("animate-spin shrink-0", SIZE_CLASS[size])} />
      {label ? <span>{label}</span> : null}
    </span>
  )
}
