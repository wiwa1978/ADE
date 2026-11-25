import { ChevronRight, Cloud, Laptop, Plus } from "lucide-react"
import { Badge, SegmentedControl, type SegmentedOption } from "@/components/ui"
import type { EnvironmentSummary } from "../../app-types"
import { useI18n } from "../../i18n/I18nContext"

export type EnvScopeFilter = "all" | "local" | "remote"

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
  const { t } = useI18n()
  const envScopeOptions: readonly SegmentedOption<EnvScopeFilter>[] = [
    { value: "all", label: t("prjx.wiz.env.filterAll") },
    { value: "local", label: <><Laptop className="size-3.5" /> {t("prjx.wiz.env.filterLocal")}</> },
    { value: "remote", label: <><Cloud className="size-3.5" /> {t("prjx.wiz.env.filterRemote")}</> },
  ]

  return (
    <div className="ade-wizard-body">
      <div className="ade-wizard-scope-bar">
        <SegmentedControl
          aria-label={t("prjx.wiz.env.locationAria")}
          size="sm"
          options={envScopeOptions}
          value={envFilter}
          onValueChange={onEnvFilterChange}
        />
      </div>

      <div className="ade-wizard-section-label">{t("prjx.wiz.env.sectionLabel")}</div>
      <div className="ade-wizard-list" role="listbox" aria-label={t("prjx.wiz.env.sectionLabel")}>
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
                  {isLocal ? t("prjx.wiz.env.thisDevice") : env.sshHost || env.id}
                </span>
              </span>
              <span className="ade-wizard-item-meta">
                {env.id === activeEnvironmentId ? <Badge tone="accent">{t("prjx.wiz.env.current")}</Badge> : null}
                <ChevronRight className="size-3.5 opacity-45" />
              </span>
            </button>
          )
        })}

        {environments.length === 0 ? (
          <div className="px-3 py-5 text-center text-xs opacity-60">
            {envFilter === "remote"
              ? t("prjx.wiz.env.noRemote")
              : t("prjx.wiz.env.noMatch", { query: searchQuery })}
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
              <span className="ade-wizard-item-title">{t("prjx.wiz.env.addRemoteHost")}</span>
              <span className="ade-wizard-item-sub">{t("prjx.wiz.env.addRemoteHostSub")}</span>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
