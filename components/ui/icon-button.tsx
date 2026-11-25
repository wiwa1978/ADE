import { Button, type ButtonProps } from "./button"
import { cn } from "@/lib/utils"

export interface IconButtonProps extends Omit<ButtonProps, "aria-label" | "asChild"> {
  "aria-label": string
  title?: string
}

export function IconButton({
  "aria-label": ariaLabel,
  title,
  variant = "ghost",
  size = "icon",
  className,
  ...props
}: IconButtonProps) {
  return (
    <Button
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      variant={variant}
      size={size}
      className={cn("shrink-0", className)}
      {...props}
    />
  )
}
