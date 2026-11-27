import { useEffect, useState } from "react"
import { request } from "./api"

export type RunTarget = "local" | "docker" | "podman" | "wsl" | "ssh" | "boat" | "cloud"
export type VmSize = "small" | "medium" | "large"
export type TargetSettings = {
  target: RunTarget
  image: string
  wslDistro: string
  sshHost: string
  remoteRoot: string
  cloudProvider: string
  vmSize: VmSize
  idleSleepMinutes: number
}
export type TargetState = "absent" | "preparing" | "running" | "sleeping" | "stopped" | "failed"

export type CloudProviderField = {
  key: string
  label: string
  kind: "secret" | "text"
  required?: boolean
  placeholder?: string
  help?: string
}

export type CloudProviderInfo = {
  id: string
  label: string
  description: string
  website: string
  fields: CloudProviderField[]
  features: {
    sleep: "pause" | "stop" | "checkpoint"
    keepsDisk: boolean
    keepsMemory: boolean
    transport: "ssh" | "exec"
  }
  sizes: Record<VmSize, string>
  defaultSize: VmSize
  configured: boolean
}

export const runTargetLabels: Record<RunTarget, string> = {
  local: "This Mac",
  docker: "Docker",
  podman: "Podman (rootless)",
  wsl: "WSL2",
  ssh: "SSH host",
  boat: "Boat.dev",
  cloud: "Cloud VM",
}

export const runTargetDescriptions: Record<RunTarget, string> = {
  local: "Commands run directly on this computer, in the session's folder.",
  docker: "Commands, terminals, scripts and agents run in a Docker container of their own.",
  podman: "Commands, terminals, scripts and agents run in a rootless Podman container (no sudo or root daemon).",
  wsl: "Commands run in a Linux distribution on this Windows computer.",
  ssh: "The workspace is copied to another machine over SSH before each command and back after it. Git stays on this computer.",
  boat: "A Boat.dev cloud VM per session, reached over SSH. Billed by Boat while it runs.",
  cloud: "A dedicated cloud VM per session (Boat.dev, Daytona, E2B, …). Auto-sleeps when idle and wakes on your next message.",
}

export function targetLabel(target: RunTarget) {
  return target === "local" && !/Mac/i.test(navigator.platform) ? "This computer" : runTargetLabels[target]
}

export type RunTargetsInfo = {
  available: RunTarget[]
  docker: { available: boolean; version: string | null; message: string }
  podman?: { available: boolean; version: string | null; message: string }
  boat: { configured: boolean }
  cloudProviders?: CloudProviderInfo[]
}

/** Which targets this computer offers and whether Docker and cloud VM providers are ready to use. */
export function useRunTargets() {
  const [info, setInfo] = useState<RunTargetsInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    void request<RunTargetsInfo>("/api/run-targets").then(result => { if (!cancelled) setInfo(result) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  return info
}

export function configuredCloudProviders(info: RunTargetsInfo | null): CloudProviderInfo[] {
  return (info?.cloudProviders ?? []).filter(provider => provider.configured)
}

/** Why a target can't be chosen right now, or "" when it can. */
export function targetUnavailable(target: RunTarget, info: RunTargetsInfo | null, settings?: Partial<TargetSettings> | null) {
  if (!info) return ""
  if (target === "docker" && info.docker && !info.docker.available) return info.docker.message
  if (target === "podman" && info.podman && !info.podman.available) return info.podman.message
  if (target === "boat" && info.boat && !info.boat.configured) return "Add a Boat.dev API key in Settings → Integrations first."
  if (target === "cloud") {
    const providers = info.cloudProviders ?? []
    const anyConfigured = providers.some(provider => provider.configured) || Boolean(info.boat?.configured)
    if (!anyConfigured) return "Connect a Cloud VM provider (Boat.dev, Daytona, or E2B) in Settings → Integrations first."
  }
  if (target === "ssh" && settings && !settings.sshHost) return "Set the SSH host in Project settings → Run sessions on first."
  return ""
}
