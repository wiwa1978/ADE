import { useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useClickOutside, useEscapeKey } from "./use-click-outside"

export interface PopoverMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  children: ReactNode
  align?: "start" | "end"
  side?: "top" | "bottom"
  className?: string
  menuClassName?: string
  "aria-label"?: string
}

export function PopoverMenu({
  open,
  onOpenChange,
  trigger,
  children,
  align = "start",
  side = "bottom",
  className,
  menuClassName,
  "aria-label": ariaLabel,
}: PopoverMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const close = () => onOpenChange(false)

  useClickOutside(containerRef, close, open)
  useEscapeKey(close, open)

  return (
    <div ref={containerRef} className={cn("relative inline-flex", className)}>
      {trigger}
      {open ? (
        <div
          role="menu"
          aria-label={ariaLabel}
          className={cn(
            "absolute z-40 min-w-[180px] rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-1 text-[rgb(var(--foreground))] shadow-lg",
            align === "end" ? "right-0" : "left-0",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            menuClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

export interface PopoverMenuItemProps {
  children: ReactNode
  icon?: ReactNode
  active?: boolean
  destructive?: boolean
  disabled?: boolean
  onSelect?: () => void
  className?: string
}

export function PopoverMenuItem({
  children,
  icon,
  active = false,
  destructive = false,
  disabled = false,
  onSelect,
  className,
}: PopoverMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border-0 px-2.5 py-1.5 text-left text-xs transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-45",
        destructive
          ? "text-[rgb(var(--rose))] hover:bg-[rgb(var(--rose)/.12)]"
          : active
            ? "bg-[rgb(var(--primary)/.14)] font-medium text-[rgb(var(--foreground))]"
            : "bg-transparent text-[rgb(var(--foreground))] hover:bg-[rgb(var(--surface))]",
        className,
      )}
    >
      {icon ? <span aria-hidden="true" className="shrink-0 opacity-80">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}
