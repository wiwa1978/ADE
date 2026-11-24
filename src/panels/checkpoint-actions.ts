import { requestJson } from "../../api"

export type CheckpointInfo = { id: string; label: string; createdAt: number; filesChanged: number }

export async function restoreCheckpoint(sessionId: string, checkpoint: CheckpointInfo) {
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints/${encodeURIComponent(checkpoint.id)}/restore`, "POST")
}

export function confirmRestore(checkpoint: CheckpointInfo) {
  return confirm(`Rewind the workspace to "${checkpoint.label}"?\n\n${checkpoint.filesChanged} file${checkpoint.filesChanged === 1 ? "" : "s"} will change back, including commits made since. Your current state is saved first, so you can undo this from History.`)
}
