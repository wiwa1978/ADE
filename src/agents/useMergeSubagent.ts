import { useState } from "react"
import { requestJson } from "../api"
import type { SubagentInfo } from "../app-types"
import { useI18n } from "../i18n/I18nContext"

/** Bring a subagent's worktree branch into the session's branch, after asking. Shared by the Agents and Swarm views. */
export function useMergeSubagent(sessionId: string, sub: Pick<SubagentInfo, "id" | "name" | "branch">) {
  const { t } = useI18n()
  const [merging, setMerging] = useState(false)
  const [message, setMessage] = useState("")
  const merge = async () => {
    if (!window.confirm(t("ag.mergeConfirm", { name: sub.name, branch: sub.branch ?? "" }))) return
    setMerging(true)
    try {
      const result = await requestJson<{ merged: boolean; message: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(sub.id)}/merge`, "POST")
      setMessage(result.message)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("ag.mergeError"))
    } finally {
      setMerging(false)
    }
  }
  return { merge, merging, message }
}
