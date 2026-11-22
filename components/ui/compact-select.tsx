import type { ReactNode } from "react"
import * as Select from "@radix-ui/react-select"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

type CompactSelectProps<T extends string> = {
  label: string
  icon: ReactNode
  options: readonly { value: T; label: string }[]
  value: T
  onValueChange: (value: T) => void
  disabled?: boolean
  className?: string
  fieldLabelClassName?: string
}

export function CompactSelect<T extends string>({ label, icon, options, value, onValueChange, disabled, className, fieldLabelClassName }: CompactSelectProps<T>) {
  return <Select.Root value={value} disabled={disabled} onValueChange={next => {
    const option = options.find(item => item.value === next)
    if (option) onValueChange(option.value)
  }}>
    <Select.Trigger aria-label={label} className={cn("compact-select", className)}>
      {fieldLabelClassName && <span className={fieldLabelClassName}>{label}</span>}
      {icon}<Select.Value />
      <Select.Icon asChild><ChevronDown size={12} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content position="popper" align="start" sideOffset={5} collisionPadding={12} className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] text-[rgb(var(--foreground))] shadow-lg">
        <Select.Viewport className="p-1">
          {options.map(option => <Select.Item key={option.value} value={option.value} className="relative flex min-h-7 cursor-default items-center rounded-md py-1 pr-7 pl-2 text-[.9rem] outline-none data-highlighted:bg-[rgb(var(--surface))]">
            <Select.ItemText>{option.label}</Select.ItemText>
            <Select.ItemIndicator className="absolute right-2"><Check size={13} /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
}
