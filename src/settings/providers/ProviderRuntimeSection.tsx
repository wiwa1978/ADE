import { Input, KeyValueListEditor } from "@/components/ui"
import { useI18n } from "../../i18n/I18nContext"
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
  const { t } = useI18n()

  return (
    <>
      {item.kind === "cli" ? (
        <div className="st-prov-section">
          <div className="st-prov-section-title">{t("prov.runtime")}</div>
          <div className="st-prov-field-row">
            <div className="st-prov-field-text">
              <label htmlFor="prov-bin-path">{t("prov.binaryPath")}</label>
              <p>{t("prov.binaryHint", { name: item.name })}</p>
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
              <label htmlFor="prov-home-path">{t("prov.homePath")}</label>
              <p>{t("prov.homeHint", { name: item.name })}</p>
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
              <label htmlFor="prov-launch-args">{t("prov.launchArgs")}</label>
              <p>{t("prov.launchHint")}</p>
            </div>
            <Input
              id="prov-launch-args"
              className="st-prov-field-input font-mono !text-[12px]"
              value={override.launchArgs ?? ""}
              placeholder={t("prov.optionalFlags")}
              onChange={e => onUpdateOverride({ launchArgs: e.target.value })}
            />
          </div>
        </div>
      ) : null}

      <div className="st-prov-section">
        <div className="st-prov-section-title">{t("prov.environment")}</div>
        <p className="mb-2 text-xs text-[rgb(var(--muted))]">
          {t("prov.variablesHint")}
        </p>
        <KeyValueListEditor
          items={override.envVars ?? []}
          onChange={envVars => onUpdateOverride({ envVars })}
          keyPlaceholder="ENV_KEY"
          valuePlaceholder={t("prov.valuePlaceholder")}
          addLabel={t("prov.addVariable")}
          removeLabel={t("prov.removeVariable")}
        />
      </div>
    </>
  )
}
