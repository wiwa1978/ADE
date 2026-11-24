import type { ModelProfileId } from "../../app-types"
import { NativeSelect, type SelectOption } from "./compact-select"

export interface ModelProfileOption {
  id: ModelProfileId
  name: string
  euCompliantByDefault?: boolean
}

const DEFAULT_MODEL_PROFILES: readonly ModelProfileOption[] = [
  { id: "balanced", name: "Balanced", euCompliantByDefault: false },
  { id: "max-quality", name: "Max Quality", euCompliantByDefault: false },
  { id: "budget", name: "Budget / Fast", euCompliantByDefault: false },
  { id: "eu-only", name: "EU Data Residency (GDPR)", euCompliantByDefault: true },
  { id: "eu-sovereign", name: "EU Sovereign (CLOUD-Act-Free)", euCompliantByDefault: true },
  { id: "local-ollama", name: "Local / Ollama ($0)", euCompliantByDefault: true },
]

export interface ModelProfileSelectProps {
  value: ModelProfileId | string
  onChange: (value: ModelProfileId) => void
  profiles?: readonly ModelProfileOption[]
  disabled?: boolean
  id?: string
  "aria-label"?: string
  selectSize?: "sm" | "md"
  className?: string
}

export function ModelProfileSelect({
  value,
  onChange,
  profiles = DEFAULT_MODEL_PROFILES,
  disabled = false,
  id,
  "aria-label": ariaLabel = "Model profile",
  selectSize = "md",
  className,
}: ModelProfileSelectProps) {
  const options: SelectOption<ModelProfileId>[] = profiles.map(profile => ({
    value: profile.id,
    label: profile.name,
  }))

  return (
    <NativeSelect<ModelProfileId>
      id={id}
      aria-label={ariaLabel}
      value={value as ModelProfileId}
      onValueChange={onChange}
      options={options}
      disabled={disabled}
      selectSize={selectSize}
      className={className}
    />
  )
}
