import type { TaskStart } from "./app-types"

const pendingStartsKey = "ade-pending-task-starts-v1"

export function pendingStarts(): Record<string, TaskStart> {
  const raw = localStorage.getItem(pendingStartsKey)
  if (!raw) return {}
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Saved task starts could not be read.")
  return parsed as Record<string, TaskStart>
}

export function storePendingStart(task: TaskStart) {
  localStorage.setItem(pendingStartsKey, JSON.stringify({ ...pendingStarts(), [task.id]: task }))
}

export function clearPendingStart(id: string) {
  const pending = pendingStarts()
  delete pending[id]
  localStorage.setItem(pendingStartsKey, JSON.stringify(pending))
}

