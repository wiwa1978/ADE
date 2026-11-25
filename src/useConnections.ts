import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react"
import type { GitHubConnection } from "./ProjectsView"
import type { CopilotSignIn, ModelCredential, ModelCredentialProvider, ProviderTool, RuntimeHealth, Screen } from "./app-types"
import { request, requestJson } from "./api"
import { usePolling } from "./hooks/usePolling"

const modelCredentialProviders: { id: ModelCredentialProvider; name: string }[] = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
  { id: "radius", name: "Radius (Pi)" },
  { id: "compatible", name: "OpenAI-compatible" },
]

function isAbortError(cause: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || (cause instanceof DOMException && cause.name === "AbortError"))
}

export function useConnections(screen: Screen, setRuntime: Dispatch<SetStateAction<RuntimeHealth | null>>, environmentVersion = 0) {
  const [githubConnection, setGithubConnection] = useState<GitHubConnection | null>(null)
  const [githubStatusError, setGithubStatusError] = useState("")
  const [githubCliError, setGithubCliError] = useState("")
  const [githubActionError, setGithubActionError] = useState("")
  const [githubConnectionBusy, setGithubConnectionBusy] = useState(false)
  const githubConnectionRevision = useRef(0)
  const [copilotHealth, setCopilotHealth] = useState<RuntimeHealth | null>(null)
  const [copilotStatusError, setCopilotStatusError] = useState("")
  const [copilotActionError, setCopilotActionError] = useState("")
  const copilotAuthRevision = useRef(0)
  const [modelCredentials, setModelCredentials] = useState<ModelCredential[] | null>(null)
  const [modelCredentialStatusError, setModelCredentialStatusError] = useState("")
  const [modelCredentialActionError, setModelCredentialActionError] = useState("")
  const [modelCredentialBusy, setModelCredentialBusy] = useState<{ provider: ModelCredentialProvider; action: "save" | "remove" } | null>(null)
  const modelCredentialRevision = useRef(0)
  const [providerTools, setProviderTools] = useState<ProviderTool[] | null>(null)
  const [providerToolsError, setProviderToolsError] = useState("")
  const [providerToolsBusy, setProviderToolsBusy] = useState<string | null>(null)

  const [authBusy, setAuthBusy] = useState(false)

  const copilotSignIn = copilotHealth?.copilotSignIn
  const copilotWaiting = copilotSignIn?.status === "waiting"

  const githubPollingEnabled = ["settings", "project"].includes(screen) && !githubConnectionBusy
  const copilotCheckEnabled = screen === "settings" && !authBusy
  const modelCredPollingEnabled = screen === "settings" && !modelCredentialBusy
  const providerToolsPollingEnabled = screen === "settings" && !providerToolsBusy

  const refreshGitHub = useCallback(async (signal?: AbortSignal) => {
    const revision = githubConnectionRevision.current
    try {
      const connection = await request<GitHubConnection>("/api/github/connection", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal,
      })
      if (!signal?.aborted && revision === githubConnectionRevision.current) {
        setGithubConnection(connection)
        setGithubStatusError("")
      }
      if (!connection.login && !signal?.aborted && revision === githubConnectionRevision.current) {
        try {
          const detected = await request<GitHubConnection>("/api/github/auto-connect", {
            method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal,
          })
          if (!signal?.aborted && revision === githubConnectionRevision.current) {
            setGithubConnection(detected)
            setGithubCliError("")
          }
        } catch (cause) {
          if (!isAbortError(cause, signal) && revision === githubConnectionRevision.current) {
            setGithubCliError(cause instanceof Error ? cause.message : "Could not detect the GitHub CLI account.")
          }
        }
      }
    } catch (cause) {
      if (!isAbortError(cause, signal) && revision === githubConnectionRevision.current) {
        setGithubStatusError(cause instanceof Error ? cause.message : "Could not read the GitHub connection.")
      }
    }
  }, [])

  useEffect(() => {
    if (!githubPollingEnabled) return
    const controller = new AbortController()
    void Promise.resolve().then(() => refreshGitHub(controller.signal))
    return () => controller.abort()
  }, [githubPollingEnabled, environmentVersion, refreshGitHub])

  usePolling(refreshGitHub, 5_000, { enabled: githubPollingEnabled, immediate: false })

  const refreshCopilot = useCallback(async (signal?: AbortSignal) => {
    const revision = copilotAuthRevision.current
    try {
      const health = await request<RuntimeHealth>("/api/health?provider=github-copilot", { signal })
      if (health.provider !== "github-copilot") throw new Error("Copilot sign-in is unavailable in this runtime.")
      if (!signal?.aborted && revision === copilotAuthRevision.current) {
        setCopilotHealth(health)
        setCopilotStatusError("")
      }
    } catch (cause) {
      if (!isAbortError(cause, signal) && revision === copilotAuthRevision.current) {
        setCopilotStatusError(cause instanceof Error ? cause.message : "Could not read Copilot sign-in status.")
      }
    }
  }, [])

  // Fetch Copilot status once when entering Settings (or on environment switch); only poll at 2s while waiting for device sign-in.
  useEffect(() => {
    if (!copilotCheckEnabled) return
    const controller = new AbortController()
    void Promise.resolve().then(() => refreshCopilot(controller.signal))
    return () => controller.abort()
  }, [copilotCheckEnabled, environmentVersion, refreshCopilot])

  usePolling(refreshCopilot, 2_000, { enabled: copilotCheckEnabled && copilotWaiting, immediate: false })

  const refreshModelCredentials = useCallback(async (signal?: AbortSignal) => {
    const revision = modelCredentialRevision.current
    try {
      const result = await request<{ credentials: ModelCredential[] }>("/api/model-credentials", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "status" }), signal,
      })
      if (!signal?.aborted && revision === modelCredentialRevision.current) {
        setModelCredentials(result.credentials)
        setModelCredentialStatusError("")
      }
    } catch (cause) {
      if (!isAbortError(cause, signal) && revision === modelCredentialRevision.current) {
        setModelCredentialStatusError(cause instanceof Error ? cause.message : "Could not read model credential status.")
      }
    }
  }, [])

  useEffect(() => {
    if (!modelCredPollingEnabled) return
    const controller = new AbortController()
    void Promise.resolve().then(() => refreshModelCredentials(controller.signal))
    return () => controller.abort()
  }, [modelCredPollingEnabled, environmentVersion, refreshModelCredentials])

  usePolling(refreshModelCredentials, 5_000, { enabled: modelCredPollingEnabled, immediate: false })

  const refreshProviderTools = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await request<{ providers: ProviderTool[] }>("/api/provider-tools", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "status" }), signal,
      })
      if (!signal?.aborted) {
        setProviderTools(result.providers)
        setProviderToolsError("")
      }
    } catch (cause) {
      if (!isAbortError(cause, signal)) {
        setProviderToolsError(cause instanceof Error ? cause.message : "Could not scan host providers.")
      }
    }
  }, [])

  useEffect(() => {
    if (!providerToolsPollingEnabled) return
    const controller = new AbortController()
    void Promise.resolve().then(() => refreshProviderTools(controller.signal))
    return () => controller.abort()
  }, [providerToolsPollingEnabled, environmentVersion, refreshProviderTools])

  usePolling(refreshProviderTools, 10_000, { enabled: providerToolsPollingEnabled, immediate: false })

  async function changeGitHubConnection(action: "connect" | "disconnect") {
    if (githubConnectionBusy) return
    githubConnectionRevision.current++
    setGithubConnectionBusy(true)
    setGithubActionError("")
    try {
      const connection = await requestJson<GitHubConnection>(`/api/github/${action}`, "POST")
      setGithubConnection(connection)
      setGithubStatusError("")
      setGithubCliError("")
    } catch (cause) {
      setGithubActionError(cause instanceof Error ? cause.message : "Could not manage the GitHub connection.")
    } finally {
      githubConnectionRevision.current++
      setGithubConnectionBusy(false)
    }
  }

  async function changeModelCredential(action: "save" | "remove", provider: ModelCredentialProvider, key?: string) {
    if (modelCredentialBusy) return
    modelCredentialRevision.current++
    setModelCredentialBusy({ provider, action })
    setModelCredentialActionError("")
    try {
      const result = await requestJson<{ credentials: ModelCredential[] }>("/api/model-credentials", "POST", { action, provider, ...(key ? { key } : {}) })
      setModelCredentials(result.credentials)
      setModelCredentialStatusError("")
    } catch (cause) {
      setModelCredentialActionError(cause instanceof Error ? cause.message : "Could not update the model credential.")
    } finally {
      modelCredentialRevision.current++
      setModelCredentialBusy(null)
    }
  }

  function saveModelCredential(event: FormEvent<HTMLFormElement>, provider: ModelCredentialProvider) {
    event.preventDefault()
    const field = event.currentTarget.elements.namedItem("apiKey")
    if (!(field instanceof HTMLInputElement)) return
    const key = field.value.trim()
    if (!key) return
    field.value = ""
    void changeModelCredential("save", provider, key)
  }

  async function setProviderEnabled(id: string, enabled: boolean) {
    if (providerToolsBusy) return
    setProviderToolsBusy(id)
    setProviderToolsError("")
    try {
      const result = await requestJson<{ providers: ProviderTool[] }>("/api/provider-tools", "POST", { action: "set", id, enabled })
      setProviderTools(result.providers)
    } catch (cause) {
      setProviderToolsError(cause instanceof Error ? cause.message : "Could not update provider availability.")
    } finally {
      setProviderToolsBusy(null)
    }
  }

  async function changeCopilotAuth(action: "start" | "cancel" | "sign-out") {
    if (authBusy) return
    copilotAuthRevision.current++
    setAuthBusy(true)
    setCopilotActionError("")
    try {
      const state = await requestJson<CopilotSignIn>("/api/copilot/auth", "POST", { action })
      setRuntime(current => current?.provider === "github-copilot" ? {
        ...current,
        copilotSignIn: state,
        ...(action === "sign-out" ? { configured: false, copilotSignedIn: false, models: [], defaultModel: "" } : {}),
      } : current)
      setCopilotHealth(current => current ? {
        ...current,
        copilotSignIn: state,
        ...(action === "sign-out" ? { configured: false, copilotSignedIn: false, models: [], defaultModel: "" } : {}),
      } : current)
    } catch (cause) {
      setCopilotActionError(cause instanceof Error ? cause.message : "Could not manage Copilot sign-in.")
    } finally {
      copilotAuthRevision.current++
      setAuthBusy(false)
    }
  }

  function resetForEnvironmentChange() {
    githubConnectionRevision.current++
    copilotAuthRevision.current++
    modelCredentialRevision.current++
    setGithubConnection(null)
    setGithubStatusError("")
    setGithubCliError("")
    setGithubActionError("")
    setCopilotHealth(null)
    setCopilotStatusError("")
    setCopilotActionError("")
    setModelCredentials(null)
    setModelCredentialStatusError("")
    setModelCredentialActionError("")
    setProviderTools(null)
    setProviderToolsError("")
    setProviderToolsBusy(null)
  }

  return {
    githubConnection, githubStatusError, githubCliError, githubActionError, githubConnectionBusy, changeGitHubConnection,
    copilotHealth, copilotStatusError, copilotActionError, copilotSignIn, copilotWaiting, authBusy, changeCopilotAuth,
    modelCredentials, modelCredentialStatusError, modelCredentialActionError, modelCredentialBusy, saveModelCredential, changeModelCredential,
    providerTools, providerToolsError, providerToolsBusy, setProviderEnabled,
    resetForEnvironmentChange,
  }
}

export { modelCredentialProviders }
