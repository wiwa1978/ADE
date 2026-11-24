import { Input, KeyValueListEditor } from "@/components/ui"
import {
  DEFAULT_HOME_PATHS,
  type ProviderRuntimeOverride,
  type UnifiedProviderItem,
} from "./provider-overrides"

export function ProviderRuntimeSection({
  item,
  override,
  onUpdateOverride,
}: {
  item: UnifiedProviderItem
  override: ProviderRuntimeOverride
  onUpdateOverride: (patch: Partial<ProviderRuntimeOverride>) => void
}) {
  return (
    <>
      {item.kind === "cli" ? (
        <div className="st-prov-section">
          <div className="st-prov-section-title">Runtime</div>
          <div className="st-prov-field-row">
            <div className="st-prov-field-text">
              <label htmlFor="prov-bin-path">Binary path</label>
              <p>Path to the {item.name} binary used by this instance.</p>
            </div>
            <Input
              id="prov-bin-path"
              className="st-prov-field-input font-mono !text-[12px]"
              value={override.binaryPath ?? item.command ?? ""}
              placeholder={item.command ?? item.id}
              onChange={e => onUpdateOverride({ binaryPath: e.target.value })}
            />
          </div>
          <div className="st-prov-field-row">
            <div className="st-prov-field-text">
              <label htmlFor="prov-home-path">Config home path</label>
              <p>Custom home and config directory for {item.name}.</p>
            </div>
            <Input
              id="prov-home-path"
              className="st-prov-field-input font-mono !text-[12px]"
              value={override.homePath ?? DEFAULT_HOME_PATHS[item.id] ?? `~/.${item.id}`}
              onChange={e => onUpdateOverride({ homePath: e.target.value })}
            />
          </div>
          <div className="st-prov-field-row">
            <div className="st-prov-field-text">
              <label htmlFor="prov-launch-args">Launch arguments</label>
              <p>Additional CLI arguments passed on session start.</p>
            </div>
            <Input
              id="prov-launch-args"
              className="st-prov-field-input font-mono !text-[12px]"
              value={override.launchArgs ?? ""}
              placeholder="Optional flags"
              onChange={e => onUpdateOverride({ launchArgs: e.target.value })}
            />
          </div>
        </div>
      ) : null}

      <div className="st-prov-section">
        <div className="st-prov-section-title">Environment</div>
        <p className="mb-2 text-xs text-[rgb(var(--muted))]">
          API keys, base URLs, and other per-instance settings.
        </p>
        <KeyValueListEditor
          items={override.envVars ?? []}
          onChange={envVars => onUpdateOverride({ envVars })}
          keyPlaceholder="ENV_KEY"
          valuePlaceholder="value"
          addLabel="Add variable"
          removeLabel="Remove variable"
        />
      </div>
    </>
  )
}
