import { requestJson } from "../../api"
import type { ConfirmOptions } from "../../components/ui/index.ts"

export type CheckpointInfo = { id: string; label: string; createdAt: number; filesChanged: number }

export async function restoreCheckpoint(sessionId: string, checkpoint: CheckpointInfo) {
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoints/${encodeURIComponent(checkpoint.id)}/restore`, "POST")
}

export function getRestoreConfirmOptions(checkpoint: CheckpointInfo): ConfirmOptions {
  return {
    title: `Rewind workspace to "${checkpoint.label}"?`,
    description: `${checkpoint.filesChanged} file${checkpoint.filesChanged === 1 ? "" : "s"} will change back, including commits made since. Your current state is saved first, so you can undo this from History.`,
    confirmLabel: "Rewind",
    destructive: true,
  }
}

export function confirmRestore(
  checkpoint: CheckpointInfo,
  confirmFn: (message?: string) => boolean = message => globalThis.confirm(message),
) {
  const opts = getRestoreConfirmOptions(checkpoint)
  return confirmFn(`${opts.title}\n\n${opts.description}`)
}
