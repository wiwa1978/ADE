import type * as React from "react"
import { cn } from "@/lib/utils"

export type TextareaProps = React.ComponentProps<"textarea">

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "w-full min-w-0 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--field))] px-3 py-2 text-xs text-[rgb(var(--foreground))]",
        "outline-none placeholder:text-[rgb(var(--muted))] disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-[rgb(var(--primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary)/.18)]",
        className,
      )}
      {...props}
    />
  )
}
