import { useEffect, useState } from "react"
import { request } from "../../api"
import { useEventStreamListener } from "../hooks/useEventStream"
import type { TeamView } from "./team-types"

/** A session's team board, live: reloaded whenever the runtime says it changed. */
export function useTeamState(sessionId: string | null) {
  const [team, setTeam] = useState<TeamView | null>(null)
  const [tick, setTick] = useState(0)
  useEventStreamListener("team.update", (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data) as { sessionId?: string; payload?: { sessionId?: string } }
      const id = data.sessionId ?? data.payload?.sessionId
      if (!id || id === sessionId) setTick(value => value + 1)
    } catch {
      setTick(value => value + 1)
    }
  })
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void request<TeamView>(`/api/sessions/${encodeURIComponent(sessionId)}/team`)
      .then(result => { if (!cancelled && Array.isArray(result?.tasks)) setTeam(result) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [sessionId, tick])
  const reload = () => setTick(value => value + 1)
  return { team, reload }
}
