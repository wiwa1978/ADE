import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogPortal(props: DialogPrimitive.DialogPortalProps) {
  return <DialogPrimitive.Portal {...props} />
}

export function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay className={cn("fixed inset-0 z-[20] bg-[rgb(var(--shadow)/.58)]", className)} {...props} />
}

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content className={cn(
        "fixed left-1/2 top-1/2 z-[21] w-[min(520px,calc(100%-20px))] -translate-x-1/2 -translate-y-1/2",
        "max-h-[90dvh] overflow-auto rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] text-[rgb(var(--foreground))]",
        "shadow-[0_20px_70px_rgb(var(--shadow)/.3)] outline-none",
        className,
      )} {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}
