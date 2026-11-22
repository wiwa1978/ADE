import * as React from "react"
import { cn } from "@/lib/utils"

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input
    className={cn(
      "h-9 w-full min-w-0 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--field))] px-3 text-xs text-[rgb(var(--foreground))]",
      "outline-none placeholder:text-[rgb(var(--muted))] disabled:cursor-not-allowed disabled:opacity-50",
      "focus-visible:border-[rgb(var(--primary))]",
      className,
    )}
    {...props}
  />
}
