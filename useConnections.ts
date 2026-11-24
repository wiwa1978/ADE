import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react"
import type { GitHubConnection } from "./ProjectsView"
import type { CopilotSignIn, ModelCredential, ModelCredentialProvider, ProviderTool, RuntimeHealth, Screen } from "./app-types"
import { request, requestJson } from "./api"

const modelCredentialProviders: { id: ModelCredentialProvider; name: string }[] = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
  { id: "radius", name: "Radius (Pi)" },
  { id: "compatible", name: "OpenAI-compatible" },
]

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

  useEffect(() => {
    if (!["settings", "project"].includes(screen) || githubConnectionBusy) return
    let active = true
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      const revision = githubConnectionRevision.current
      try {
        const connection = await requestJson<GitHubConnection>("/api/github/connection", "POST")
        if (active && revision === githubConnectionRevision.current) {
          setGithubConnection(connection)
          setGithubStatusError("")
        }
        if (!connection.login && active && revision === githubConnectionRevision.current) {
          try {
            const detected = await requestJson<GitHubConnection>("/api/github/auto-connect", "POST")
            if (active && revision === githubConnectionRevision.current) {
              setGithubConnection(detected)
              setGithubCliError("")
            }
          } catch (cause) {
            if (active && revision === githubConnectionRevision.current) {
              setGithubCliError(cause instanceof Error ? cause.message : "Could not detect the GitHub CLI account.")
            }
          }
        }
      } catch (cause) {
        if (active && revision === githubConnectionRevision.current) {
          setGithubStatusError(cause instanceof Error ? cause.message : "Could not read the GitHub connection.")
        }
      } finally { refreshing = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [screen, githubConnectionBusy, environmentVersion])

  useEffect(() => {
    if (screen !== "settings" || authBusy) return
    let active = true
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      const revision = copilotAuthRevision.current
      try {
        const health = await request<RuntimeHealth>("/api/health?provider=github-copilot")
        if (health.provider !== "github-copilot") throw new Error("Copilot sign-in is unavailable in this runtime.")
        if (active && revision === copilotAuthRevision.current) {
          setCopilotHealth(health)
          setCopilotStatusError("")
        }
      } catch (cause) {
        if (active && revision === copilotAuthRevision.current) {
          setCopilotStatusError(cause instanceof Error ? cause.message : "Could not read Copilot sign-in status.")
        }
      } finally { refreshing = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [screen, authBusy, environmentVersion])

  useEffect(() => {
    if (screen !== "settings" || modelCredentialBusy) return
    let active = true
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      const revision = modelCredentialRevision.current
      try {
        const result = await requestJson<{ credentials: ModelCredential[] }>("/api/model-credentials", "POST", { action: "status" })
        if (active && revision === modelCredentialRevision.current) {
          setModelCredentials(result.credentials)
          setModelCredentialStatusError("")
        }
      } catch (cause) {
        if (active && revision === modelCredentialRevision.current) {
          setModelCredentialStatusError(cause instanceof Error ? cause.message : "Could not read model credential status.")
        }
      } finally { refreshing = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [screen, modelCredentialBusy, environmentVersion])

  useEffect(() => {
    if (!["settings", "work"].includes(screen) || providerToolsBusy) return
    let active = true
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const result = await requestJson<{ providers: ProviderTool[] }>("/api/provider-tools", "POST", { action: "list" })
        if (active) {
          setProviderTools(result.providers)
          setProviderToolsError("")
        }
      } catch (cause) {
        if (active) setProviderToolsError(cause instanceof Error ? cause.message : "Could not scan host providers.")
      } finally {
        refreshing = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 10000)
    return () => { active = false; window.clearInterval(timer) }
  }, [screen, providerToolsBusy, environmentVersion])

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

  const copilotSignIn = copilotHealth?.copilotSignIn
  const copilotWaiting = copilotSignIn?.status === "waiting"

  return {
    githubConnection, githubStatusError, githubCliError, githubActionError, githubConnectionBusy, changeGitHubConnection,
    copilotHealth, copilotStatusError, copilotActionError, copilotSignIn, copilotWaiting, authBusy, changeCopilotAuth,
    modelCredentials, modelCredentialStatusError, modelCredentialActionError, modelCredentialBusy, saveModelCredential, changeModelCredential,
    providerTools, providerToolsError, providerToolsBusy, setProviderEnabled,
    resetForEnvironmentChange,
  }
}

export { modelCredentialProviders }
