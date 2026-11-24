import { useCallback, useEffect, useMemo, useState } from "react"
import { request } from "../../../api"
import type { SessionArtifact, TimelineItem, WorkspaceGitSummary } from "../../../app-types"
import {
  extractToolCallFilePaths,
  getFileExtension,
  getFileFilterBucket,
  type ArtefactFilterBucket,
} from "../file-preview-utils"

export type ArtefactFileEntry = {
  path: string
  name: string
  ext: string
  size?: number
  modifiedAt?: number
  mimeType?: string
  gitStatus?: string | null
  source?: "project" | "session"
  sessionId?: string
  sessionLabel?: string
}

export type EnrichedSessionArtifact = SessionArtifact & {
  sessionLabel?: string
}

export function splitDirAndName(relPath: string): { dir: string; name: string } {
  const idx = relPath.lastIndexOf("/")
  if (idx === -1) return { dir: "", name: relPath }
  return { dir: relPath.slice(0, idx), name: relPath.slice(idx + 1) }
}

export function useArtefactsData({
  scope,
  sessionId,
  projectId,
  workspacePath,
  liveArtifacts,
  gitSummary,
  timelineItems,
  query,
  bucket,
}: {
  scope: "session" | "project"
  sessionId?: string
  projectId?: string
  workspacePath?: string | null
  liveArtifacts: SessionArtifact[]
  gitSummary?: WorkspaceGitSummary
  timelineItems: TimelineItem[]
  query: string
  bucket: ArtefactFilterBucket
}) {
  const [fetchedArtifacts, setFetchedArtifacts] = useState<EnrichedSessionArtifact[]>([])
  const [fetchedFiles, setFetchedFiles] = useState<ArtefactFileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const scopeKey = scope === "project" ? `project:${projectId ?? ""}` : `session:${sessionId ?? ""}`
  const [prevScopeKey, setPrevScopeKey] = useState(scopeKey)
  if (scopeKey !== prevScopeKey) {
    setPrevScopeKey(scopeKey)
    setLoading(true)
    setError("")
  }

  const endpoint = scope === "project"
    ? (projectId ? `/api/projects/${encodeURIComponent(projectId)}/artifacts` : null)
    : (sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}/artifacts` : null)

  const reload = useCallback(async () => {
    if (!endpoint) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await request<{ artifacts?: EnrichedSessionArtifact[]; files?: ArtefactFileEntry[] }>(endpoint)
      setFetchedArtifacts(Array.isArray(res.artifacts) ? res.artifacts : [])
      setFetchedFiles(Array.isArray(res.files) ? res.files : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load artefacts.")
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    let cancelled = false
    if (!endpoint) return
    void request<{ artifacts?: EnrichedSessionArtifact[]; files?: ArtefactFileEntry[] }>(endpoint)
      .then(res => {
        if (cancelled) return
        setFetchedArtifacts(Array.isArray(res.artifacts) ? res.artifacts : [])
        setFetchedFiles(Array.isArray(res.files) ? res.files : [])
        setError("")
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Could not load artefacts.")
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [endpoint])

  const allArtifacts = useMemo<EnrichedSessionArtifact[]>(() => {
    const byId = new Map<string, EnrichedSessionArtifact>()
    for (const a of fetchedArtifacts) byId.set(a.id, a)
    for (const a of liveArtifacts) {
      const prev = byId.get(a.id)
      byId.set(a.id, prev ? { ...prev, ...a } : a)
    }
    return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [fetchedArtifacts, liveArtifacts])

  const allFiles = useMemo<ArtefactFileEntry[]>(() => {
    const byKey = new Map<string, ArtefactFileEntry>()
    const keyOf = (f: ArtefactFileEntry) => `${f.sessionId ?? ""}:${f.path}`

    for (const f of fetchedFiles) byKey.set(keyOf(f), f)

    if (scope === "session") {
      if (gitSummary?.files) {
        for (const gf of gitSummary.files) {
          if (gf.status === "deleted") continue
          const k = `:${gf.path}`
          const existing = byKey.get(k)
          const { name } = splitDirAndName(gf.path)
          byKey.set(k, { path: gf.path, name, ext: getFileExtension(gf.path), ...existing, gitStatus: gf.status })
        }
      }
      for (const item of timelineItems) {
        if (item.kind !== "assistant") continue
        for (const tc of item.toolCalls) {
          for (const fp of extractToolCallFilePaths(tc, workspacePath)) {
            const k = `:${fp}`
            if (!byKey.has(k)) {
              const { name } = splitDirAndName(fp)
              byKey.set(k, { path: fp, name, ext: getFileExtension(fp), gitStatus: "created" })
            }
          }
        }
      }
    }

    return [...byKey.values()].sort((a, b) => {
      const aChanged = a.gitStatus ? 1 : 0
      const bChanged = b.gitStatus ? 1 : 0
      if (aChanged !== bChanged) return bChanged - aChanged
      return (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) || a.path.localeCompare(b.path)
    })
  }, [fetchedFiles, scope, gitSummary, timelineItems, workspacePath])

  const counts = useMemo(() => {
    const c = { all: allArtifacts.length + allFiles.length, plans: allArtifacts.length, docs: 0, code: 0, images: 0 }
    for (const f of allFiles) c[getFileFilterBucket(f.path, f.mimeType)]++
    return c
  }, [allArtifacts.length, allFiles])

  const q = query.trim().toLowerCase()
  const filteredArtifacts = useMemo(() => {
    if (bucket !== "all" && bucket !== "plans") return []
    if (!q) return allArtifacts
    return allArtifacts.filter(a =>
      a.title.toLowerCase().includes(q)
      || (a.sessionLabel?.toLowerCase().includes(q) ?? false)
      || a.kind.toLowerCase().includes(q),
    )
  }, [allArtifacts, bucket, q])

  const filteredFiles = useMemo(() => {
    if (bucket === "plans") return []
    return allFiles.filter(f => {
      if (bucket !== "all" && getFileFilterBucket(f.path, f.mimeType) !== bucket) return false
      if (!q) return true
      return (
        f.path.toLowerCase().includes(q)
        || f.name.toLowerCase().includes(q)
        || f.ext.toLowerCase().includes(q)
        || (f.sessionLabel?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [allFiles, bucket, q])

  return { loading, error, reload, allArtifacts, allFiles, counts, filteredArtifacts, filteredFiles }
}
