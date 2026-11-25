import { useEffect, useState } from "react"
import { request } from "./api"

export type RunTarget = "local" | "docker" | "wsl" | "ssh" | "boat"
export type TargetSettings = { target: RunTarget; image: string; wslDistro: string; sshHost: string; remoteRoot: string }
export type TargetState = "absent" | "preparing" | "running" | "stopped" | "failed"

export const runTargetLabels: Record<RunTarget, string> = {
  local: "This Mac",
  docker: "Docker",
  wsl: "WSL2",
  ssh: "SSH host",
  boat: "Boat.dev",
}

export const runTargetDescriptions: Record<RunTarget, string> = {
  local: "Commands run directly on this computer, in the session's folder.",
  docker: "Commands, terminals, scripts and agents run in a container of their own.",
  wsl: "Commands run in a Linux distribution on this Windows computer.",
  ssh: "The workspace is copied to another machine over SSH before each command and back after it. Git stays on this computer.",
  boat: "A Boat.dev cloud VM per session, reached over SSH. Billed by Boat while it runs.",
}

export function targetLabel(target: RunTarget) {
  return target === "local" && !/Mac/i.test(navigator.platform) ? "This computer" : runTargetLabels[target]
}

export type RunTargetsInfo = {
  available: RunTarget[]
  docker: { available: boolean; version: string | null; message: string }
  boat: { configured: boolean }
}

/** Which targets this computer offers and whether Docker and Boat.dev are ready to use. */
export function useRunTargets() {
  const [info, setInfo] = useState<RunTargetsInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    void request<RunTargetsInfo>("/api/run-targets").then(result => { if (!cancelled) setInfo(result) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  return info
}

/** Why a target can't be chosen right now, or "" when it can. */
export function targetUnavailable(target: RunTarget, info: RunTargetsInfo | null, settings?: Partial<TargetSettings> | null) {
  if (!info) return ""
  if (target === "docker" && info.docker && !info.docker.available) return info.docker.message
  if (target === "boat" && info.boat && !info.boat.configured) return "Add a Boat.dev API key in Settings → Integrations first."
  if (target === "ssh" && settings && !settings.sshHost) return "Set the SSH host in Project settings → Run sessions on first."
  return ""
}
