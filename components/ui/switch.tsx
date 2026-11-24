import { cn } from "@/lib/utils"

export interface SwitchProps {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  onChange?: (checked: boolean) => void
  label?: string
  showLabel?: boolean
  disabled?: boolean
  id?: string
  className?: string
}

export function Switch({
  checked,
  onCheckedChange,
  onChange,
  label,
  showLabel = false,
  disabled = false,
  id,
  className,
}: SwitchProps) {
  const handleToggle = () => {
    if (disabled) return
    const next = !checked
    onCheckedChange?.(next)
    onChange?.(next)
  }

  const button = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={!showLabel ? label : undefined}
      disabled={disabled}
      onClick={handleToggle}
      className={cn(
        "relative inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--primary))]",
        "disabled:cursor-not-allowed disabled:opacity-45",
        checked ? "bg-[rgb(var(--primary))]" : "bg-[rgb(var(--foreground)/.18)]",
        !showLabel && className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/.3)] transition-transform duration-150",
          checked ? "translate-x-[16px]" : "translate-x-[2px]",
        )}
      />
    </button>
  )

  if (showLabel && label) {
    return (
      <label
        htmlFor={id}
        className={cn(
          "inline-flex items-center gap-2 text-xs text-[rgb(var(--foreground))]",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          className,
        )}
      >
        {button}
        <span>{label}</span>
      </label>
    )
  }

  return button
}
