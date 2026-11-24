import type * as React from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SearchInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: string
  onValueChange: (value: string) => void
  clearable?: boolean
  clearLabel?: string
  clearOnEscape?: boolean
  inputClassName?: string
}

export function SearchInput({
  value,
  onValueChange,
  clearable = true,
  clearLabel = "Clear search",
  clearOnEscape = true,
  className,
  inputClassName,
  onKeyDown,
  disabled,
  placeholder = "Search…",
  ...props
}: SearchInputProps) {
  return (
    <div
      className={cn(
        "flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--field))] px-2.5 text-[rgb(var(--muted))]",
        "focus-within:border-[rgb(var(--primary))] focus-within:ring-2 focus-within:ring-[rgb(var(--primary)/.18)]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <Search aria-hidden="true" className="size-3.5 shrink-0" />
      <input
        type="search"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => onValueChange(e.target.value)}
        onKeyDown={e => {
          if (clearOnEscape && e.key === "Escape" && value) {
            e.preventDefault()
            onValueChange("")
          }
          onKeyDown?.(e)
        }}
        className={cn(
          "h-full flex-1 min-w-0 border-0 bg-transparent text-xs text-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted))] [&::-webkit-search-cancel-button]:hidden",
          inputClassName,
        )}
        {...props}
      />
      {clearable && value && !disabled ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onValueChange("")}
          className="grid size-4 shrink-0 place-items-center rounded text-[rgb(var(--muted))] hover:bg-[rgb(var(--surface))] hover:text-[rgb(var(--foreground))]"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )
}
