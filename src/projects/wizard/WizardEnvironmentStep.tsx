import { ChevronRight, Cloud, Laptop, Plus } from "lucide-react"
import { Badge, SegmentedControl, type SegmentedOption } from "@/components/ui"
import type { EnvironmentSummary } from "../../../app-types"

export type EnvScopeFilter = "all" | "local" | "remote"

const ENV_SCOPE_OPTIONS: readonly SegmentedOption<EnvScopeFilter>[] = [
  { value: "all", label: "All" },
  { value: "local", label: <><Laptop className="size-3.5" /> This Computer</> },
  { value: "remote", label: <><Cloud className="size-3.5" /> Remote</> },
]

export function WizardEnvironmentStep({
  environments,
  envFilter,
  activeIndex,
  activeEnvironmentId,
  searchQuery,
  busy,
  hasAddHost,
  onEnvFilterChange,
  onHover,
  onSelectEnvironment,
  onAddHost,
}: {
  environments: readonly EnvironmentSummary[]
  envFilter: EnvScopeFilter
  activeIndex: number
  activeEnvironmentId: string
  searchQuery: string
  busy: boolean
  hasAddHost: boolean
  onEnvFilterChange: (next: EnvScopeFilter) => void
  onHover: (index: number) => void
  onSelectEnvironment: (env: EnvironmentSummary) => void
  onAddHost?: () => void
}) {
  return (
    <div className="ade-wizard-body">
      <div className="ade-wizard-scope-bar">
        <SegmentedControl
          aria-label="Environment location"
          size="sm"
          options={ENV_SCOPE_OPTIONS}
          value={envFilter}
          onValueChange={onEnvFilterChange}
        />
      </div>

      <div className="ade-wizard-section-label">Environments</div>
      <div className="ade-wizard-list" role="listbox" aria-label="Environments">
        {environments.map((env, idx) => {
          const isLocal = env.kind === "local"
          const highlighted = idx === activeIndex
          return (
            <button
              key={env.id}
              type="button"
              role="option"
              aria-selected={highlighted}
              className={`ade-wizard-item ${highlighted ? "is-active" : ""}`}
              onMouseMove={() => onHover(idx)}
              onClick={() => onSelectEnvironment(env)}
              disabled={busy}
            >
              <span className="ade-wizard-item-icon">
                {isLocal ? <Laptop className="size-4" /> : <Cloud className="size-4" />}
              </span>
              <span className="ade-wizard-item-copy">
                <span className="ade-wizard-item-title">{env.name}</span>
                <span className="ade-wizard-item-sub">
                  {isLocal ? "This device" : env.sshHost || env.id}
                </span>
              </span>
              <span className="ade-wizard-item-meta">
                {env.id === activeEnvironmentId ? <Badge tone="accent">Current</Badge> : null}
                <ChevronRight className="size-3.5 opacity-45" />
              </span>
            </button>
          )
        })}

        {environments.length === 0 ? (
          <div className="px-3 py-5 text-center text-xs opacity-60">
            {envFilter === "remote"
              ? "No remote hosts configured yet."
              : `No environments match “${searchQuery}”.`}
          </div>
        ) : null}

        {hasAddHost && onAddHost ? (
          <button
            type="button"
            className={`ade-wizard-item ${activeIndex === environments.length ? "is-active" : ""}`}
            onMouseMove={() => onHover(environments.length)}
            onClick={onAddHost}
            disabled={busy}
          >
            <span className="ade-wizard-item-icon">
              <Plus className="size-4" />
            </span>
            <span className="ade-wizard-item-copy">
              <span className="ade-wizard-item-title">Add remote host</span>
              <span className="ade-wizard-item-sub">Connect an SSH host or cloud workspace</span>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
