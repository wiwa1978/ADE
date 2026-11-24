import type * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.ComponentProps<"input"> {
  inputSize?: "sm" | "md"
}

export function Input({ className, inputSize = "md", ...props }: InputProps) {
  return (
    <input
      className={cn(
        "w-full min-w-0 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--field))] text-[rgb(var(--foreground))]",
        "outline-none placeholder:text-[rgb(var(--muted))] disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-[rgb(var(--primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary)/.18)]",
        inputSize === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-xs",
        className,
      )}
      {...props}
    />
  )
}
