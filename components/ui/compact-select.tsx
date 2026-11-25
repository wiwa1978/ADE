import type * as React from "react"
import type { ReactNode } from "react"
import * as Select from "@radix-ui/react-select"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

export interface CompactSelectProps<T extends string> {
  label: string
  icon?: ReactNode
  options: readonly SelectOption<T>[]
  value: T
  onValueChange: (value: T) => void
  disabled?: boolean
  className?: string
  fieldLabelClassName?: string
  placeholder?: string
}

export function CompactSelect<T extends string>({
  label,
  icon,
  options,
  value,
  onValueChange,
  disabled,
  className,
  fieldLabelClassName,
  placeholder,
}: CompactSelectProps<T>) {
  return (
    <Select.Root
      value={value}
      disabled={disabled}
      onValueChange={next => {
        const option = options.find(item => item.value === next)
        if (option) onValueChange(option.value)
      }}
    >
      <Select.Trigger aria-label={label} className={cn("compact-select", className)}>
        {fieldLabelClassName ? <span className={fieldLabelClassName}>{label}</span> : null}
        {icon}
        <Select.Value placeholder={placeholder} />
        <Select.Icon asChild>
          <ChevronDown size={12} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          align="start"
          sideOffset={5}
          collisionPadding={12}
          className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] text-[rgb(var(--foreground))] shadow-lg"
        >
          <Select.Viewport className="p-1">
            {options.map(option => (
              <Select.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex min-h-7 cursor-default items-center rounded-md py-1 pr-7 pl-2 text-[.9rem] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-highlighted:bg-[rgb(var(--surface))]"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-2">
                  <Check size={13} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

export interface NativeSelectProps<T extends string = string>
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
  value: T
  onValueChange?: (value: T) => void
  onChange?: React.ChangeEventHandler<HTMLSelectElement>
  options?: readonly SelectOption<T>[]
  selectSize?: "sm" | "md"
}

export function NativeSelect<T extends string = string>({
  value,
  onValueChange,
  onChange,
  options,
  selectSize = "md",
  className,
  children,
  ...props
}: NativeSelectProps<T>) {
  return (
    <div className="relative inline-flex w-full min-w-0 items-center">
      <select
        value={value}
        onChange={e => {
          onChange?.(e)
          onValueChange?.(e.target.value as T)
        }}
        className={cn(
          "w-full min-w-0 appearance-none rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--field))] pr-7 pl-2.5 text-xs text-[rgb(var(--foreground))]",
          "outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:border-[rgb(var(--primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary)/.18)]",
          selectSize === "sm" ? "h-7" : "h-8",
          className,
        )}
        {...props}
      >
        {options
          ? options.map(opt => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2 size-3.5 text-[rgb(var(--muted))]"
      />
    </div>
  )
}
