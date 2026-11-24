import { ChevronUp, PauseCircle, Workflow } from "lucide-react"
import type { SessionBlueprintSummary } from "../../app-types"
import { shortBlueprintName } from "./blueprint-options"
import { stageStatusPhrase } from "./session-stages"
import { useI18n } from "../i18n/I18nContext"

/**
 * The slim bar at the bottom of a blueprint session while the drawer is closed: the blueprint,
 * the current stage and how far along it is. Clicking it opens the drawer on Stages.
 */
export function StageBar({ blueprint, onOpen }: { blueprint: SessionBlueprintSummary; onOpen: () => void }) {
  const { t } = useI18n()
  const stage = blueprint.stage
  const waiting = stage?.status === "awaiting_approval"
  const progress = blueprint.total ? Math.round((blueprint.done / blueprint.total) * 100) : 0
  return (
    <button type="button" className={`ade-stage-bar ${waiting ? "is-waiting" : ""}`} onClick={onOpen} title={t("stg.openStages")}>
      {waiting ? <PauseCircle className="size-3.5" /> : <Workflow className="size-3.5" />}
      <strong>{shortBlueprintName(blueprint.name)}</strong>
      <span className="ade-stage-bar-sep">·</span>
      {stage ? (
        <span className="ade-truncate">{stage.name} · {stageStatusPhrase(stage.status, waiting ? 1 : undefined)}</span>
      ) : (
        <span>{blueprint.status === "completed" ? t("stg.allDone") : t("stg.stopped")}</span>
      )}
      <span className="flex-1" />
      <span className="ade-stage-bar-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
      <span className="ade-muted">{blueprint.done} of {blueprint.total}</span>
      <ChevronUp className="size-3.5 opacity-60" />
    </button>
  )
}
