import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
  size?: "xs" | "sm" | "md"
  disabled?: boolean
  "aria-label"?: string
  className?: string
}

const SIZE_CLASS: Record<"xs" | "sm" | "md", string> = {
  xs: "h-6 px-2 text-[11px]",
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-xs",
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = "sm",
  disabled = false,
  "aria-label": ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-0.5",
        className,
      )}
    >
      {options.map(option => {
        const active = option.value === value
        const itemDisabled = disabled || option.disabled
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            disabled={itemDisabled}
            onClick={() => {
              if (!itemDisabled && !active) onValueChange(option.value)
            }}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md border-0 font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary)/.45)]",
              "disabled:cursor-not-allowed disabled:opacity-45",
              SIZE_CLASS[size],
              active
                ? "bg-[rgb(var(--surface-raised))] text-[rgb(var(--foreground))] shadow-[0_1px_2px_rgb(var(--shadow)/.14)]"
                : "bg-transparent text-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
