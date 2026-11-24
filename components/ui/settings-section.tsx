import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface SettingsSectionProps {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  plain?: boolean
  className?: string
}

export function SettingsSection({
  title,
  description,
  children,
  plain = false,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn("st-section", className)}>
      <h2>{title}</h2>
      {description ? <p className="st-section-desc">{description}</p> : null}
      {plain ? children : <SettingsCard>{children}</SettingsCard>}
    </section>
  )
}

export interface SettingsCardProps {
  children: ReactNode
  className?: string
}

export function SettingsCard({ children, className }: SettingsCardProps) {
  return <div className={cn("st-card", className)}>{children}</div>
}

export interface SettingsRowProps {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  htmlFor?: string
  stacked?: boolean
  className?: string
}

export function SettingsRow({
  title,
  description,
  children,
  htmlFor,
  stacked = false,
  className,
}: SettingsRowProps) {
  return (
    <div className={cn("st-row", stacked && "is-stacked", className)}>
      <div className="st-row-text">
        {htmlFor ? <label htmlFor={htmlFor}>{title}</label> : <span className="st-row-title">{title}</span>}
        {description ? <p>{description}</p> : null}
      </div>
      {children ? <div className="st-row-control">{children}</div> : null}
    </div>
  )
}
